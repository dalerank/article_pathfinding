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
const AUTO_FIRE_INTERVAL = 0.5;
const FLASH_DURATION = 0.6;
const GRAPH_SAMPLES = 150;
const LOG_CAPACITY = 8;

const CLIENT_COLOR = 0x4fc3f7;
const SERVER_COLOR = 0x8b93a3;
const GHOST_COLOR = 0xba68c8;
const CLAMPED_GHOST_COLOR = 0xffca28;
const HIT_COLOR = 0x6fd48a;
const MISS_COLOR = 0xef5350;
const UNFAIR_COLOR = 0xffca28;
const OBSTACLE_COLOR = 0x3a4152;

function lerpVec2(a: Vec2, b: Vec2, t: number): Vec2 {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

interface ShotResult {
    hit: boolean;
    unfair: boolean;
    clamped: boolean;
}

interface FlashState {
    time: number;
    hit: boolean;
    unfair: boolean;
    aim: Vec2;
    checkPos: Vec2;
}

class MaxRewindScene extends Phaser.Scene {
    delayMs = 250;
    maxRewindMs = 200;
    speedMultiplier = 1;
    autoAim = false;
    paused = false;

    shots = 0;
    hits = 0;
    unfairHits = 0;
    shotLog: ShotResult[] = [];
    graph: ScrollingGraph | null = null;
    lastShotSummary = "";

    private history = new SnapshotHistory<Vec2>(HISTORY_CAPACITY);
    private serverTick = 0;
    private elapsed = 0;
    private tickAccumulator = 0;
    private autoFireAccumulator = 0;
    private aim: Vec2 = { x: SHOOTER_POS.x, y: ORBIT_CENTER.y };
    private lastFlash: FlashState | null = null;

    private arenaGraphics!: Phaser.GameObjects.Graphics;
    private targetGraphics!: Phaser.GameObjects.Graphics;
    private aimGraphics!: Phaser.GameObjects.Graphics;
    private flashGraphics!: Phaser.GameObjects.Graphics;

    constructor() {
        super("shooting-max-rewind");
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);

        this.arenaGraphics = this.add.graphics();
        this.targetGraphics = this.add.graphics();
        this.aimGraphics = this.add.graphics();
        this.flashGraphics = this.add.graphics();

        this.drawArena();

        this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
            if (!this.autoAim) this.aim = { x: Phaser.Math.Clamp(pointer.x, 0, WORLD_WIDTH), y: Phaser.Math.Clamp(pointer.y, 0, WORLD_HEIGHT) };
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

            if (this.autoAim) {
                const clientPos = this.historyAt(this.delayMs);
                const clientVisible = clientPos && !segmentIntersectsRect(SHOOTER_POS, clientPos, OBSTACLE);
                if (clientVisible && clientPos) {
                    this.aim = clientPos;
                    this.autoFireAccumulator += dt;
                    if (this.autoFireAccumulator >= AUTO_FIRE_INTERVAL) {
                        this.autoFireAccumulator -= AUTO_FIRE_INTERVAL;
                        this.fireShot();
                    }
                }
            }
        }

        this.render();
    }

    reset(): void {
        this.history.clear();
        this.serverTick = 0;
        this.elapsed = 0;
        this.tickAccumulator = 0;
        this.autoFireAccumulator = 0;
        this.aim = { x: SHOOTER_POS.x, y: ORBIT_CENTER.y };
        this.lastFlash = null;
        this.shots = 0;
        this.hits = 0;
        this.unfairHits = 0;
        this.shotLog = [];
        this.lastShotSummary = "";
        this.graph?.clear();
    }

    togglePaused(): void {
        this.paused = !this.paused;
    }

    effectiveRewindMs(): number {
        return Math.min(this.delayMs, this.maxRewindMs);
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

        const effectiveRewind = this.effectiveRewindMs();
        const checkPos = this.historyAt(effectiveRewind) ?? trueNow;
        const hit = raycastHitsCircle(SHOOTER_POS, this.aim, checkPos, TARGET_RADIUS);
        const trueOccludedNow = segmentIntersectsRect(SHOOTER_POS, trueNow, OBSTACLE);
        const checkOccluded = segmentIntersectsRect(SHOOTER_POS, checkPos, OBSTACLE);
        const unfair = hit && trueOccludedNow && !checkOccluded;
        const clamped = this.delayMs > this.maxRewindMs;

        this.shots += 1;
        if (hit) this.hits += 1;
        if (unfair) this.unfairHits += 1;
        this.shotLog.unshift({ hit, unfair, clamped });
        if (this.shotLog.length > LOG_CAPACITY) this.shotLog.length = LOG_CAPACITY;
        this.graph?.push(Math.hypot(this.aim.x - checkPos.x, this.aim.y - checkPos.y), TARGET_RADIUS * 4);
        this.lastFlash = { time: this.elapsed, hit, unfair, aim: { ...this.aim }, checkPos };

        if (unfair) {
            this.lastShotSummary =
                `<b style="color:#ffca28">Нечестное попадание.</b> Цель прямо сейчас за стеной, но откат в ${effectiveRewind.toFixed(0)}ms ` +
                `(MAX_REWIND ${this.maxRewindMs}ms ≥ задержка ${this.delayMs}ms — не обрезан) дотянулся до момента, когда её ещё было видно из-за угла.`;
        } else if (!hit) {
            this.lastShotSummary = clamped
                ? `<b style="color:#ef5350">MISS, но честно.</b> Задержка ${this.delayMs}ms больше MAX_REWIND ${this.maxRewindMs}ms — откат ` +
                  `обрезан до ${effectiveRewind.toFixed(0)}ms и не достаёт до открытой позиции за стеной.`
                : `<b style="color:#ef5350">MISS.</b> Ты просто не попал в проверенную позицию.`;
        } else {
            this.lastShotSummary = `<b style="color:#6fd48a">HIT.</b> Позиция отката (${effectiveRewind.toFixed(0)}ms назад) была открытой — честное попадание.`;
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
        const clientPos = this.historyAt(this.delayMs);
        const clientVisible = clientPos !== undefined && !segmentIntersectsRect(SHOOTER_POS, clientPos, OBSTACLE);
        const effectiveRewind = this.effectiveRewindMs();
        const checkPos = this.historyAt(effectiveRewind) ?? trueNow;
        const clamped = this.delayMs > this.maxRewindMs;

        this.targetGraphics.clear();
        this.targetGraphics.fillStyle(SERVER_COLOR, trueOccludedNow ? 0.3 : 0.9);
        this.targetGraphics.fillCircle(trueNow.x, trueNow.y, TARGET_RADIUS);

        if (clientVisible && clientPos) {
            this.targetGraphics.fillStyle(CLIENT_COLOR, 1);
            this.targetGraphics.fillCircle(clientPos.x, clientPos.y, TARGET_RADIUS);
        }

        this.targetGraphics.lineStyle(2, clamped ? CLAMPED_GHOST_COLOR : GHOST_COLOR, 0.8);
        this.targetGraphics.strokeCircle(checkPos.x, checkPos.y, TARGET_RADIUS + 5);

        this.aimGraphics.clear();
        this.aimGraphics.lineStyle(1.5, 0xffca28, 0.6);
        this.aimGraphics.lineBetween(SHOOTER_POS.x, SHOOTER_POS.y, this.aim.x, this.aim.y);
        this.aimGraphics.lineStyle(1.5, 0xffca28, 0.9);
        this.aimGraphics.strokeCircle(this.aim.x, this.aim.y, 6);

        this.flashGraphics.clear();
        if (this.lastFlash) {
            const age = this.elapsed - this.lastFlash.time;
            if (age < FLASH_DURATION) {
                const alpha = 1 - age / FLASH_DURATION;
                const color = this.lastFlash.unfair ? UNFAIR_COLOR : this.lastFlash.hit ? HIT_COLOR : MISS_COLOR;
                this.flashGraphics.lineStyle(2, color, alpha);
                this.flashGraphics.lineBetween(SHOOTER_POS.x, SHOOTER_POS.y, this.lastFlash.aim.x, this.lastFlash.aim.y);
                this.flashGraphics.fillStyle(color, alpha * 0.6);
                this.flashGraphics.fillCircle(this.lastFlash.checkPos.x, this.lastFlash.checkPos.y, TARGET_RADIUS + 6);
            } else {
                this.lastFlash = null;
            }
        }
    }
}

function buildControls(root: HTMLElement, scene: MaxRewindScene): void {
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "Max Rewind Window";
    root.appendChild(heading);

    buildHowTo(
        root,
        "<b>Как пользоваться:</b> цель сама ходит по кругу вокруг стены — то видна, то прячется за углом. Целься " +
            "мышью в любую точку комнаты и стреляй кликом/Space из жёлтого треугольника внизу. Подними «MAX_REWIND» " +
            "выше «Задержки стрелка» (или опусти ниже) и попробуй попасть туда, где сейчас лиловое/жёлтое кольцо, " +
            "когда цель уже скрылась за стеной.",
    );
    buildLegend(root, [
        { color: "#4fc3f7", label: "цель глазами клиента (пропадает за стеной)" },
        { color: "#8b93a3", label: "истинная позиция (тускнеет за стеной)" },
        { color: "#ba68c8", label: "куда сервер откатился", shape: "ring" },
        { color: "#ffca28", label: "откат обрезан / нечестное попадание", shape: "ring" },
    ]);
    const setNarrative = buildNarrative(root, "Выстрели (клик/Space) — здесь появится разбор.");

    const delayRow = document.createElement("div");
    delayRow.className = "control-row";
    const delayLabel = document.createElement("label");
    delayLabel.textContent = "Задержка стрелка";
    const delayInput = document.createElement("input");
    delayInput.type = "range";
    delayInput.min = "0";
    delayInput.max = "600";
    delayInput.step = "10";
    delayInput.value = String(scene.delayMs);
    const delayValue = document.createElement("span");
    delayValue.textContent = `${scene.delayMs} ms`;
    delayInput.addEventListener("input", () => {
        scene.delayMs = Number(delayInput.value);
        delayValue.textContent = `${scene.delayMs} ms`;
        updateClampNote();
    });
    delayRow.append(delayLabel, delayInput, delayValue);
    root.appendChild(delayRow);

    const maxRow = document.createElement("div");
    maxRow.className = "control-row";
    const maxLabel = document.createElement("label");
    maxLabel.textContent = "MAX_REWIND";
    const maxInput = document.createElement("input");
    maxInput.type = "range";
    maxInput.min = "0";
    maxInput.max = "600";
    maxInput.step = "10";
    maxInput.value = String(scene.maxRewindMs);
    const maxValue = document.createElement("span");
    maxValue.textContent = `${scene.maxRewindMs} ms`;
    maxInput.addEventListener("input", () => {
        scene.maxRewindMs = Number(maxInput.value);
        maxValue.textContent = `${scene.maxRewindMs} ms`;
        updateClampNote();
    });
    maxRow.append(maxLabel, maxInput, maxValue);
    root.appendChild(maxRow);

    const clampNote = document.createElement("div");
    clampNote.style.fontSize = "12px";
    clampNote.style.margin = "-4px 0 8px";
    root.appendChild(clampNote);
    const updateClampNote = () => {
        const eff = scene.effectiveRewindMs();
        if (scene.delayMs > scene.maxRewindMs) {
            clampNote.style.color = "#ffca28";
            clampNote.textContent = `Откат обрезан: ${scene.delayMs}ms → ${eff}ms`;
        } else {
            clampNote.style.color = "#8b93a3";
            clampNote.textContent = `Откат = задержке: ${eff}ms`;
        }
    };
    updateClampNote();

    const speedRow = document.createElement("div");
    speedRow.className = "control-row";
    const speedLabel = document.createElement("label");
    speedLabel.textContent = "Скорость цели";
    const speedInput = document.createElement("input");
    speedInput.type = "range";
    speedInput.min = "0.3";
    speedInput.max = "2.5";
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

    const autoAimRow = document.createElement("div");
    autoAimRow.className = "control-row";
    const autoAimLabel = document.createElement("label");
    autoAimLabel.textContent = "Автонаводка (стреляет только когда видно)";
    const autoAimInput = document.createElement("input");
    autoAimInput.type = "checkbox";
    autoAimInput.checked = scene.autoAim;
    autoAimInput.addEventListener("change", () => {
        scene.autoAim = autoAimInput.checked;
    });
    autoAimRow.append(autoAimLabel, autoAimInput);
    root.appendChild(autoAimRow);

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
        ["unfair", "Нечестных попаданий"],
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
    metricsNote.textContent =
        "Нечестных попаданий — сколько раз откат дотянулся до цели, уже скрывшейся за стеной. В хорошо настроенной системе это число должно быть 0.";
    root.appendChild(metricsNote);

    root.appendChild(document.createElement("br"));
    scene.graph = new ScrollingGraph(
        buildGraphRow(root, "Промах на выстрел, px", "#ba68c8", GRAPH_SAMPLES),
        GRAPH_SAMPLES,
        "#ba68c8",
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
        '<a href="shooting-spatial-filter.html" style="color:#4fc3f7">Spatial Filter</a> &middot; ' +
        '<a href="shooting-hitbox-order.html" style="color:#4fc3f7">Hitbox vs Animation Order</a> &middot; ' +
        '<a href="shooting-trust-but-verify.html" style="color:#4fc3f7">Trust But Verify</a> &middot; ' +
        '<a href="shooting-already-dead.html" style="color:#4fc3f7">Already Dead</a> &middot; ' +
        '<a href="shooting-rollback-vs-lagcomp.html" style="color:#4fc3f7">Rollback vs Lag Compensation</a>';
    root.appendChild(hint);

    const tick = () => {
        cells.shots.textContent = String(scene.shots);
        cells.hits.textContent = String(scene.hits);
        cells.unfair.textContent = String(scene.unfairHits);
        if (scene.lastShotSummary) setNarrative(scene.lastShotSummary);

        logList.innerHTML = scene.shotLog
            .map((entry) => {
                if (entry.unfair) return `<div style="color:#ffca28">UNFAIR HIT — за стеной, но откат достал</div>`;
                const color = entry.hit ? "#6fd48a" : "#ef5350";
                const label = entry.hit ? "HIT" : "MISS";
                return `<div style="color:${color}">${label}${entry.clamped ? " (окно обрезано)" : ""}</div>`;
            })
            .join("");

        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

const gameRoot = document.getElementById("game-root");
const controlRoot = document.getElementById("control-panel");

if (!gameRoot || !controlRoot) {
    throw new Error("shooting-max-rewind: expected #game-root and #control-panel in examples/shooting-max-rewind.html");
}

const scene = new MaxRewindScene();
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
