import Phaser from "phaser";
import type { Vec2 } from "@/simulation/Vec2";
import { SnapshotHistory } from "@/netcode/SnapshotHistory";
import { raycastHitsCircle, segmentIntersectsRect, type AxisAlignedRect } from "@/netcode/raycast";
import { ScrollingGraph, buildGraphRow } from "@/rendering/ScrollingGraph";
import { buildHowTo, buildLegend, buildNarrative } from "@/rendering/ExplainerPanel";

const WORLD_WIDTH = 900;
const WORLD_HEIGHT = 600;
const TARGET_RADIUS = 14;
const SHOOTER_POS: Vec2 = { x: 450, y: 560 };
const OBSTACLE: AxisAlignedRect = { x: 340, y: 225, width: 220, height: 150 };
const ORBIT_CENTER: Vec2 = { x: 450, y: 300 };
const ORBIT_RADIUS_X = 230;
const ORBIT_RADIUS_Y = 170;
const SERVER_HZ = 30;
const FIXED_DT = 1 / SERVER_HZ;
const HISTORY_SECONDS = 3;
const HISTORY_CAPACITY = Math.ceil(HISTORY_SECONDS / FIXED_DT);
const BASE_PERIOD = 4;
const FLASH_DURATION = 0.7;
const GRAPH_SAMPLES = 150;
const LOG_CAPACITY = 8;
/** shooting.txt "Сервер должен быть честным": deviation tolerance around the server's own trusted estimate. */
const TOLERANCE_MS = 60;

const CLIENT_COLOR = 0x4fc3f7;
const SERVER_COLOR = 0x8b93a3;
const GHOST_COLOR = 0xba68c8;
const REJECT_COLOR = 0xffca28;
const HIT_COLOR = 0x6fd48a;
const MISS_COLOR = 0xef5350;
const OBSTACLE_COLOR = 0x3a4152;

function lerpVec2(a: Vec2, b: Vec2, t: number): Vec2 {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

interface ShotResult {
    accepted: boolean;
    hit: boolean;
    exploited: boolean;
}

interface FlashState {
    time: number;
    hit: boolean;
    accepted: boolean;
    aim: Vec2;
    checkPos: Vec2;
}

class TrustButVerifyScene extends Phaser.Scene {
    realDelayMs = 80;
    claimedDelayMs = 80;
    speedMultiplier = 1;
    paused = false;

    shots = 0;
    hits = 0;
    rejected = 0;
    exploited = 0;
    shotLog: ShotResult[] = [];
    graph: ScrollingGraph | null = null;
    lastShotSummary = "";

    private history = new SnapshotHistory<Vec2>(HISTORY_CAPACITY);
    private serverTick = 0;
    private elapsed = 0;
    private tickAccumulator = 0;
    private aim: Vec2 = { ...ORBIT_CENTER };
    private lastFlash: FlashState | null = null;

    private arenaGraphics!: Phaser.GameObjects.Graphics;
    private targetGraphics!: Phaser.GameObjects.Graphics;
    private aimGraphics!: Phaser.GameObjects.Graphics;
    private flashGraphics!: Phaser.GameObjects.Graphics;

    constructor() {
        super("shooting-trust-but-verify");
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);

        this.arenaGraphics = this.add.graphics();
        this.targetGraphics = this.add.graphics();
        this.aimGraphics = this.add.graphics();
        this.flashGraphics = this.add.graphics();

        this.drawArena();

        this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
            this.aim = { x: Phaser.Math.Clamp(pointer.x, 0, WORLD_WIDTH), y: Phaser.Math.Clamp(pointer.y, 0, WORLD_HEIGHT) };
        });
        this.input.on("pointerdown", () => this.fireShot());
        this.input.keyboard?.on("keydown-SPACE", () => this.fireShot());
        this.input.keyboard?.on("keydown-R", () => this.reset());

        this.reset();
    }

    update(_time: number, deltaMs: number): void {
        const dt = deltaMs / 1000;

        if (!this.paused) {
            this.elapsed += dt;
            this.tickAccumulator += dt;
            while (this.tickAccumulator >= FIXED_DT) {
                this.tickAccumulator -= FIXED_DT;
                this.serverTick += 1;
                const serverTime = this.serverTick * FIXED_DT;
                this.history.push(this.serverTick, serverTime, this.targetPositionAt(serverTime));
            }
        }

        this.render();
    }

    reset(): void {
        this.history.clear();
        this.serverTick = 0;
        this.elapsed = 0;
        this.tickAccumulator = 0;
        this.aim = { ...ORBIT_CENTER };
        this.lastFlash = null;
        this.shots = 0;
        this.hits = 0;
        this.rejected = 0;
        this.exploited = 0;
        this.shotLog = [];
        this.lastShotSummary = "";
        this.graph?.clear();
    }

    togglePaused(): void {
        this.paused = !this.paused;
    }

    private targetPositionAt(time: number): Vec2 {
        const period = BASE_PERIOD / this.speedMultiplier;
        const angle = (2 * Math.PI * time) / period;
        return {
            x: ORBIT_CENTER.x + Math.cos(angle) * ORBIT_RADIUS_X,
            y: ORBIT_CENTER.y + Math.sin(angle) * ORBIT_RADIUS_Y,
        };
    }

    private historyAt(delayMs: number): Vec2 | undefined {
        return this.history.sampleAt(this.elapsed - delayMs / 1000, lerpVec2);
    }

    fireShot(): void {
        const trueNow = this.history.newest?.value;
        if (!trueNow) return;

        const accepted = Math.abs(this.claimedDelayMs - this.realDelayMs) <= TOLERANCE_MS;
        const effectiveRewindMs = accepted ? this.claimedDelayMs : this.realDelayMs;
        const checkPos = this.historyAt(effectiveRewindMs) ?? trueNow;

        const aim = this.aim;
        const hit = raycastHitsCircle(SHOOTER_POS, aim, checkPos, TARGET_RADIUS);
        const trueOccludedNow = segmentIntersectsRect(SHOOTER_POS, trueNow, OBSTACLE);
        const checkOccluded = segmentIntersectsRect(SHOOTER_POS, checkPos, OBSTACLE);
        const exploited = hit && trueOccludedNow && !checkOccluded;

        this.shots += 1;
        if (hit) this.hits += 1;
        if (!accepted) this.rejected += 1;
        if (exploited) this.exploited += 1;
        this.shotLog.unshift({ accepted, hit, exploited });
        if (this.shotLog.length > LOG_CAPACITY) this.shotLog.length = LOG_CAPACITY;
        this.graph?.push(Math.abs(this.claimedDelayMs - this.realDelayMs), TOLERANCE_MS * 3);
        this.lastFlash = { time: this.elapsed, hit, accepted, aim: { ...aim }, checkPos };

        const deviation = this.claimedDelayMs - this.realDelayMs;
        if (exploited) {
            this.lastShotSummary =
                `<b style="color:#ef5350">Чит удался.</b> Заявка ${this.claimedDelayMs}ms прошла проверку (отклонение ` +
                `${deviation.toFixed(0)}ms ≤ ${TOLERANCE_MS}ms) и дотянулась до цели, которая уже спряталась за стеной.`;
        } else if (!accepted) {
            this.lastShotSummary =
                `<b style="color:#ffca28">Заявка отклонена.</b> Клиент заявил задержку ${this.claimedDelayMs}ms, реальная — ` +
                `${this.realDelayMs}ms (отклонение ${deviation.toFixed(0)}ms > ${TOLERANCE_MS}ms). Сервер не поверил и ` +
                `откатился только на честные ${this.realDelayMs}ms → ${hit ? "HIT" : "MISS"} по-честному.`;
        } else {
            this.lastShotSummary = hit
                ? `<b style="color:#6fd48a">HIT.</b> Заявка ${this.claimedDelayMs}ms близка к реальной ${this.realDelayMs}ms — сервер поверил и откатился как просили.`
                : `<b style="color:#ef5350">MISS.</b> Заявка принята, но цель всё равно оказалась не там — обычный промах.`;
        }
    }

    private drawArena(): void {
        this.arenaGraphics.clear();
        this.arenaGraphics.fillStyle(0x1b1f27, 1);
        this.arenaGraphics.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
        this.arenaGraphics.fillStyle(OBSTACLE_COLOR, 1);
        this.arenaGraphics.fillRect(OBSTACLE.x, OBSTACLE.y, OBSTACLE.width, OBSTACLE.height);
        this.arenaGraphics.fillStyle(0xffca28, 1);
        this.arenaGraphics.fillTriangle(
            SHOOTER_POS.x - 10,
            SHOOTER_POS.y + 14,
            SHOOTER_POS.x + 10,
            SHOOTER_POS.y + 14,
            SHOOTER_POS.x,
            SHOOTER_POS.y - 6,
        );
    }

    private render(): void {
        const trueNow = this.history.newest?.value ?? ORBIT_CENTER;
        const trueOccludedNow = segmentIntersectsRect(SHOOTER_POS, trueNow, OBSTACLE);
        const clientPos = this.historyAt(this.realDelayMs);
        const clientVisible = clientPos !== undefined && !segmentIntersectsRect(SHOOTER_POS, clientPos, OBSTACLE);
        const accepted = Math.abs(this.claimedDelayMs - this.realDelayMs) <= TOLERANCE_MS;
        const effectiveRewindMs = accepted ? this.claimedDelayMs : this.realDelayMs;
        const checkPos = this.historyAt(effectiveRewindMs) ?? trueNow;

        this.targetGraphics.clear();
        this.targetGraphics.fillStyle(SERVER_COLOR, trueOccludedNow ? 0.3 : 0.9);
        this.targetGraphics.fillCircle(trueNow.x, trueNow.y, TARGET_RADIUS);

        if (clientVisible && clientPos) {
            this.targetGraphics.fillStyle(CLIENT_COLOR, 1);
            this.targetGraphics.fillCircle(clientPos.x, clientPos.y, TARGET_RADIUS);
        }

        this.targetGraphics.lineStyle(2, accepted ? GHOST_COLOR : REJECT_COLOR, 0.9);
        this.targetGraphics.strokeCircle(checkPos.x, checkPos.y, TARGET_RADIUS + 5);

        this.aimGraphics.clear();
        this.aimGraphics.lineStyle(1.5, 0xffca28, 0.5);
        this.aimGraphics.lineBetween(SHOOTER_POS.x, SHOOTER_POS.y, this.aim.x, this.aim.y);
        this.aimGraphics.lineStyle(1.5, 0xffca28, 0.9);
        this.aimGraphics.strokeCircle(this.aim.x, this.aim.y, 6);

        this.flashGraphics.clear();
        if (this.lastFlash) {
            const age = this.elapsed - this.lastFlash.time;
            if (age < FLASH_DURATION) {
                const alpha = 1 - age / FLASH_DURATION;
                const color = this.lastFlash.hit ? HIT_COLOR : MISS_COLOR;
                this.flashGraphics.lineStyle(2, color, alpha);
                this.flashGraphics.lineBetween(SHOOTER_POS.x, SHOOTER_POS.y, this.lastFlash.aim.x, this.lastFlash.aim.y);
                this.flashGraphics.fillStyle(color, alpha * 0.6);
                this.flashGraphics.fillCircle(this.lastFlash.checkPos.x, this.lastFlash.checkPos.y, TARGET_RADIUS + 6);
                if (!this.lastFlash.accepted) {
                    this.flashGraphics.lineStyle(1.5, REJECT_COLOR, alpha * 0.9);
                    this.flashGraphics.strokeCircle(this.lastFlash.checkPos.x, this.lastFlash.checkPos.y, TARGET_RADIUS + 12);
                }
            } else {
                this.lastFlash = null;
            }
        }
    }
}

function buildControls(root: HTMLElement, scene: TrustButVerifyScene): void {
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "Trust But Verify";
    root.appendChild(heading);

    buildHowTo(
        root,
        "<b>Как пользоваться:</b> целься мышью и стреляй кликом или Space (либо жми кнопку «Выстрел» ниже). Играй за " +
            "читера: подними «Заявленную задержку» намного выше «Реальной», дождись, пока цель скроется за стеной, и " +
            "целься в то место, где она была видна секунду назад — если заявка пройдёт проверку, попадёшь по " +
            "спрятавшемуся.",
    );
    buildLegend(root, [
        { color: "#4fc3f7", label: "цель глазами клиента (пропадает за стеной)" },
        { color: "#8b93a3", label: "истинная позиция (тускнеет за стеной)" },
        { color: "#ba68c8", label: "заявка принята — сюда откатился сервер", shape: "ring" },
        { color: "#ffca28", label: "заявка отклонена", shape: "ring" },
    ]);
    const setNarrative = buildNarrative(root, "Нажми «Выстрел» — здесь появится вердикт сервера.");

    const fireRow = document.createElement("div");
    fireRow.className = "control-row";
    const fireButton = document.createElement("button");
    fireButton.textContent = "Выстрел (Space)";
    fireButton.addEventListener("click", () => scene.fireShot());
    fireRow.appendChild(fireButton);
    root.appendChild(fireRow);

    const realRow = document.createElement("div");
    realRow.className = "control-row";
    const realLabel = document.createElement("label");
    realLabel.textContent = "Реальная задержка";
    const realInput = document.createElement("input");
    realInput.type = "range";
    realInput.min = "0";
    realInput.max = "300";
    realInput.step = "10";
    realInput.value = String(scene.realDelayMs);
    const realValue = document.createElement("span");
    realValue.textContent = `${scene.realDelayMs} ms`;
    realInput.addEventListener("input", () => {
        scene.realDelayMs = Number(realInput.value);
        realValue.textContent = `${scene.realDelayMs} ms`;
        updateVerdict();
    });
    realRow.append(realLabel, realInput, realValue);
    root.appendChild(realRow);

    const claimedRow = document.createElement("div");
    claimedRow.className = "control-row";
    const claimedLabel = document.createElement("label");
    claimedLabel.textContent = "Заявленная задержка (ложь клиента)";
    const claimedInput = document.createElement("input");
    claimedInput.type = "range";
    claimedInput.min = "0";
    claimedInput.max = "1000";
    claimedInput.step = "10";
    claimedInput.value = String(scene.claimedDelayMs);
    const claimedValue = document.createElement("span");
    claimedValue.textContent = `${scene.claimedDelayMs} ms`;
    claimedInput.addEventListener("input", () => {
        scene.claimedDelayMs = Number(claimedInput.value);
        claimedValue.textContent = `${scene.claimedDelayMs} ms`;
        updateVerdict();
    });
    claimedRow.append(claimedLabel, claimedInput, claimedValue);
    root.appendChild(claimedRow);

    const verdictNote = document.createElement("div");
    verdictNote.style.fontSize = "12px";
    verdictNote.style.margin = "-4px 0 8px";
    root.appendChild(verdictNote);
    const updateVerdict = () => {
        const deviation = scene.claimedDelayMs - scene.realDelayMs;
        const accepted = Math.abs(deviation) <= TOLERANCE_MS;
        if (accepted) {
            verdictNote.style.color = "#8b93a3";
            verdictNote.textContent = `Отклонение ${deviation.toFixed(0)}ms ≤ ${TOLERANCE_MS}ms — сервер доверяет заявке`;
        } else {
            verdictNote.style.color = "#ffca28";
            verdictNote.textContent = `Отклонение ${deviation.toFixed(0)}ms > ${TOLERANCE_MS}ms — REJECTED, используется реальная задержка`;
        }
    };
    updateVerdict();

    const speedRow = document.createElement("div");
    speedRow.className = "control-row";
    const speedLabel = document.createElement("label");
    speedLabel.textContent = "Скорость цели";
    const speedInput = document.createElement("input");
    speedInput.type = "range";
    speedInput.min = "0.3";
    speedInput.max = "2.2";
    speedInput.step = "0.1";
    speedInput.value = String(scene.speedMultiplier);
    const speedValue = document.createElement("span");
    speedValue.textContent = `${scene.speedMultiplier.toFixed(1)}x`;
    speedInput.addEventListener("input", () => {
        scene.speedMultiplier = Number(speedInput.value);
        speedValue.textContent = `${scene.speedMultiplier.toFixed(1)}x`;
    });
    speedRow.append(speedLabel, speedInput, speedValue);
    root.appendChild(speedRow);

    const buttonRow = document.createElement("div");
    buttonRow.className = "control-row";
    const pauseButton = document.createElement("button");
    pauseButton.textContent = "Пауза (Space стреляет)";
    pauseButton.addEventListener("click", () => scene.togglePaused());
    const resetButton = document.createElement("button");
    resetButton.textContent = "Reset (R)";
    resetButton.addEventListener("click", () => scene.reset());
    buttonRow.append(pauseButton, resetButton);
    root.appendChild(buttonRow);

    const table = document.createElement("table");
    table.className = "metrics-table";
    const rows: Array<[string, string]> = [
        ["shots", "Выстрелов"],
        ["hits", "Попаданий"],
        ["rejected", "Отклонено сервером"],
        ["exploited", "Успешных читов"],
    ];
    const cells: Record<string, HTMLTableCellElement> = {};
    for (const [key, label] of rows) {
        const tr = document.createElement("tr");
        const th = document.createElement("td");
        th.textContent = label;
        const td = document.createElement("td");
        td.textContent = "-";
        cells[key] = td;
        tr.append(th, td);
        table.appendChild(tr);
    }
    root.appendChild(table);

    const metricsNote = document.createElement("div");
    metricsNote.style.color = "#8b93a3";
    metricsNote.style.fontSize = "11px";
    metricsNote.style.margin = "4px 0 10px";
    metricsNote.textContent = "Успешных читов — сколько раз ложь клиента о задержке прошла проверку сервера и дала нечестное попадание. Цель — 0.";
    root.appendChild(metricsNote);

    root.appendChild(document.createElement("br"));
    scene.graph = new ScrollingGraph(
        buildGraphRow(root, "|Заявлено − реально|, ms", "#ffca28", GRAPH_SAMPLES),
        GRAPH_SAMPLES,
        "#ffca28",
    );

    const logHeading = document.createElement("div");
    logHeading.textContent = "Последние выстрелы";
    logHeading.style.color = "#8b93a3";
    logHeading.style.margin = "10px 0 4px";
    root.appendChild(logHeading);
    const logList = document.createElement("div");
    logList.style.fontSize = "12px";
    logList.style.fontVariantNumeric = "tabular-nums";
    root.appendChild(logList);

    const hint = document.createElement("p");
    hint.style.color = "#8b93a3";
    hint.innerHTML =
        "Часть примеров к статье про lag compensation. " +
        '<a href="../index.html" style="color:#4fc3f7">&larr; Все примеры</a> &middot; ' +
        '<a href="shooting-naive-raycast.html" style="color:#4fc3f7">Naive Raycast</a> &middot; ' +
        '<a href="shooting-time-machine.html" style="color:#4fc3f7">Time Machine</a> &middot; ' +
        '<a href="shooting-rewind-formula.html" style="color:#4fc3f7">Rewind Formula</a> &middot; ' +
        '<a href="shooting-max-rewind.html" style="color:#4fc3f7">Max Rewind Window</a> &middot; ' +
        '<a href="shooting-spatial-filter.html" style="color:#4fc3f7">Spatial Filter</a> &middot; ' +
        '<a href="shooting-hitbox-order.html" style="color:#4fc3f7">Hitbox vs Animation Order</a> &middot; ' +
        '<a href="shooting-already-dead.html" style="color:#4fc3f7">Already Dead</a> &middot; ' +
        '<a href="shooting-rollback-vs-lagcomp.html" style="color:#4fc3f7">Rollback vs Lag Compensation</a>';
    root.appendChild(hint);

    const tick = () => {
        cells.shots.textContent = String(scene.shots);
        cells.hits.textContent = String(scene.hits);
        cells.rejected.textContent = String(scene.rejected);
        cells.exploited.textContent = String(scene.exploited);
        if (scene.lastShotSummary) setNarrative(scene.lastShotSummary);

        logList.innerHTML = scene.shotLog
            .map((entry) => {
                if (entry.exploited) return `<div style="color:#ef5350">EXPLOIT — попал по спрятавшемуся</div>`;
                if (!entry.accepted) return `<div style="color:#ffca28">REJECTED — заявка отклонена, использована честная задержка</div>`;
                const color = entry.hit ? "#6fd48a" : "#8b93a3";
                return `<div style="color:${color}">${entry.hit ? "HIT" : "MISS"} — заявка принята</div>`;
            })
            .join("");

        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

const gameRoot = document.getElementById("game-root");
const controlRoot = document.getElementById("control-panel");

if (!gameRoot || !controlRoot) {
    throw new Error("shooting-trust-but-verify: expected #game-root and #control-panel in examples/shooting-trust-but-verify.html");
}

const scene = new TrustButVerifyScene();
const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: gameRoot,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    backgroundColor: "#14181f",
    scene: [scene],
    fps: { target: 60 },
});

game.events.once(Phaser.Core.Events.READY, () => buildControls(controlRoot, scene));
