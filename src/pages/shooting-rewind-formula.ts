import Phaser from "phaser";
import type { Vec2 } from "@/simulation/Vec2";
import { SnapshotHistory } from "@/netcode/SnapshotHistory";
import { raycastHitsCircle } from "@/netcode/raycast";
import { ScrollingGraph, buildGraphRow } from "@/rendering/ScrollingGraph";
import { buildHowTo, buildLegend, buildNarrative } from "@/rendering/ExplainerPanel";

const WORLD_WIDTH = 900;
const WORLD_HEIGHT = 600;
const TARGET_RADIUS = 16;
const SHOOTER_POS: Vec2 = { x: 450, y: 560 };
const ORBIT_CENTER: Vec2 = { x: 450, y: 300 };
const ORBIT_RADIUS_X = 260;
const ORBIT_RADIUS_Y = 200;
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
const HIT_COLOR = 0x6fd48a;
const MISS_COLOR = 0xef5350;

function lerpVec2(a: Vec2, b: Vec2, t: number): Vec2 {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

interface ShotResult {
    hit: boolean;
    offset: number;
    rewindMs: number;
}

interface FlashState {
    time: number;
    hit: boolean;
    aim: Vec2;
    checkPos: Vec2;
}

/** rewindTime = RTT/2 + interpolationDelay — see shooting.txt "На сколько тиков нужно вернуться?". */
function rewindTimeMs(rttMs: number, interpolationDelayMs: number): number {
    return rttMs / 2 + interpolationDelayMs;
}

class RewindFormulaScene extends Phaser.Scene {
    rttMs = 78;
    interpolationDelayMs = 100;
    speedMultiplier = 1;
    autoAim = false;
    paused = false;

    shots = 0;
    hits = 0;
    offsetSum = 0;
    shotLog: ShotResult[] = [];
    graph: ScrollingGraph | null = null;
    lastShotSummary = "";

    private history = new SnapshotHistory<Vec2>(HISTORY_CAPACITY);
    private serverTick = 0;
    private elapsed = 0;
    private tickAccumulator = 0;
    private autoFireAccumulator = 0;
    private aim: Vec2 = { ...ORBIT_CENTER };
    private lastFlash: FlashState | null = null;

    private arenaGraphics!: Phaser.GameObjects.Graphics;
    private targetGraphics!: Phaser.GameObjects.Graphics;
    private aimGraphics!: Phaser.GameObjects.Graphics;
    private flashGraphics!: Phaser.GameObjects.Graphics;

    constructor() {
        super("shooting-rewind-formula");
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
                this.aim = this.historyAt(this.rewindMs()) ?? this.aim;
                this.autoFireAccumulator += dt;
                if (this.autoFireAccumulator >= AUTO_FIRE_INTERVAL) {
                    this.autoFireAccumulator -= AUTO_FIRE_INTERVAL;
                    this.fireShot();
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
        this.aim = { ...ORBIT_CENTER };
        this.lastFlash = null;
        this.shots = 0;
        this.hits = 0;
        this.offsetSum = 0;
        this.shotLog = [];
        this.lastShotSummary = "";
        this.graph?.clear();
    }

    togglePaused(): void {
        this.paused = !this.paused;
    }

    rewindMs(): number {
        return rewindTimeMs(this.rttMs, this.interpolationDelayMs);
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

    private fireShot(): void {
        const serverSnapshot = this.history.newest;
        if (!serverSnapshot) return;

        const aim = this.aim;
        const checkPos = this.historyAt(this.rewindMs()) ?? serverSnapshot.value;
        const hit = raycastHitsCircle(SHOOTER_POS, aim, checkPos, TARGET_RADIUS);
        const offset = Math.hypot(aim.x - checkPos.x, aim.y - checkPos.y);

        this.shots += 1;
        if (hit) this.hits += 1;
        this.offsetSum += offset;
        this.shotLog.unshift({ hit, offset, rewindMs: this.rewindMs() });
        if (this.shotLog.length > LOG_CAPACITY) this.shotLog.length = LOG_CAPACITY;
        this.graph?.push(offset, TARGET_RADIUS * 4);
        this.lastFlash = { time: this.elapsed, hit, aim: { ...aim }, checkPos };

        const half = this.rttMs / 2;
        this.lastShotSummary = hit
            ? `rewindTime = RTT/2 (${half.toFixed(0)}ms) + interpolation delay (${this.interpolationDelayMs}ms) = ${this.rewindMs().toFixed(0)}ms. ` +
              `Сервер откатился ровно туда, куда ты целился — <b style="color:#6fd48a">HIT</b>.`
            : `rewindTime = ${this.rewindMs().toFixed(0)}ms получился неточным для этого момента (погрешность интерполяции ` +
              `между тиками) — промах ${offset.toFixed(0)}px, <b style="color:#ef5350">MISS</b>.`;
    }

    private drawArena(): void {
        this.arenaGraphics.clear();
        this.arenaGraphics.fillStyle(0x1b1f27, 1);
        this.arenaGraphics.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
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
        const clientPos = this.historyAt(this.rewindMs()) ?? ORBIT_CENTER;
        const serverPos = this.history.newest?.value ?? ORBIT_CENTER;
        const rewoundPos = this.historyAt(this.rewindMs()) ?? serverPos;

        this.targetGraphics.clear();
        this.targetGraphics.fillStyle(SERVER_COLOR, 0.9);
        this.targetGraphics.fillCircle(serverPos.x, serverPos.y, TARGET_RADIUS);
        this.targetGraphics.fillStyle(CLIENT_COLOR, 1);
        this.targetGraphics.fillCircle(clientPos.x, clientPos.y, TARGET_RADIUS);
        this.targetGraphics.lineStyle(2, GHOST_COLOR, 0.9);
        this.targetGraphics.strokeCircle(rewoundPos.x, rewoundPos.y, TARGET_RADIUS + 5);

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
            } else {
                this.lastFlash = null;
            }
        }
    }
}

function buildFormulaBar(root: HTMLElement, scene: RewindFormulaScene): () => void {
    const wrap = document.createElement("div");
    wrap.style.margin = "8px 0 12px";

    const readout = document.createElement("div");
    readout.style.fontVariantNumeric = "tabular-nums";
    readout.style.marginBottom = "4px";
    wrap.appendChild(readout);

    const bar = document.createElement("div");
    bar.style.display = "flex";
    bar.style.height = "18px";
    bar.style.borderRadius = "3px";
    bar.style.overflow = "hidden";
    bar.style.border = "1px solid #2a2f3a";
    const rttSegment = document.createElement("div");
    rttSegment.style.background = "#4fc3f7";
    const interpSegment = document.createElement("div");
    interpSegment.style.background = "#ba68c8";
    bar.append(rttSegment, interpSegment);
    wrap.appendChild(bar);

    const legend = document.createElement("div");
    legend.style.display = "flex";
    legend.style.justifyContent = "space-between";
    legend.style.fontSize = "11px";
    legend.style.color = "#8b93a3";
    legend.style.marginTop = "2px";
    legend.innerHTML = '<span style="color:#4fc3f7">■ RTT / 2</span><span style="color:#ba68c8">■ interpolation delay</span>';
    wrap.appendChild(legend);

    const meaning = document.createElement("div");
    meaning.style.fontSize = "11px";
    meaning.style.color = "#8b93a3";
    meaning.style.margin = "4px 0 0";
    meaning.textContent =
        "RTT/2 — время, за которое пакет с выстрелом долетел ДО сервера (половина пинга туда-обратно). " +
        "Interpolation delay — насколько клиент нарочно сглаживает движение других игроков, чтобы оно не дёргалось.";
    wrap.appendChild(meaning);

    root.appendChild(wrap);

    return () => {
        const half = scene.rttMs / 2;
        const total = half + scene.interpolationDelayMs;
        readout.textContent = `rewindTime = RTT/2 (${half.toFixed(0)}ms) + interpolation delay (${scene.interpolationDelayMs}ms) = ${total.toFixed(0)}ms`;
        const totalForScale = Math.max(total, 1);
        rttSegment.style.width = `${(half / totalForScale) * 100}%`;
        interpSegment.style.width = `${(scene.interpolationDelayMs / totalForScale) * 100}%`;
    };
}

function buildControls(root: HTMLElement, scene: RewindFormulaScene): void {
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "Rewind Formula";
    root.appendChild(heading);

    buildHowTo(
        root,
        "<b>Как пользоваться:</b> подвигай RTT и Interpolation delay по отдельности — полоска ниже покажет, из чего " +
            "складывается общий откат (rewindTime). Целься мышью в синий кружок и стреляй кликом/Space.",
    );
    buildLegend(root, [
        { color: "#4fc3f7", label: "цель глазами клиента" },
        { color: "#8b93a3", label: "цель на сервере сейчас" },
        { color: "#ba68c8", label: "hitbox, куда сервер откатился", shape: "ring" },
        { color: "#6fd48a", label: "HIT" },
        { color: "#ef5350", label: "MISS" },
    ]);
    const setNarrative = buildNarrative(root, "Сделай выстрел (клик или Space) — здесь появится разбор.");

    const updateFormulaBar = buildFormulaBar(root, scene);

    const rttRow = document.createElement("div");
    rttRow.className = "control-row";
    const rttLabel = document.createElement("label");
    rttLabel.textContent = "RTT (ping туда-обратно)";
    const rttInput = document.createElement("input");
    rttInput.type = "range";
    rttInput.min = "0";
    rttInput.max = "300";
    rttInput.step = "2";
    rttInput.value = String(scene.rttMs);
    const rttValue = document.createElement("span");
    rttValue.textContent = `${scene.rttMs} ms`;
    rttInput.addEventListener("input", () => {
        scene.rttMs = Number(rttInput.value);
        rttValue.textContent = `${scene.rttMs} ms`;
        updateFormulaBar();
    });
    rttRow.append(rttLabel, rttInput, rttValue);
    root.appendChild(rttRow);

    const interpRow = document.createElement("div");
    interpRow.className = "control-row";
    const interpLabel = document.createElement("label");
    interpLabel.textContent = "Interpolation delay";
    const interpInput = document.createElement("input");
    interpInput.type = "range";
    interpInput.min = "0";
    interpInput.max = "300";
    interpInput.step = "5";
    interpInput.value = String(scene.interpolationDelayMs);
    const interpValue = document.createElement("span");
    interpValue.textContent = `${scene.interpolationDelayMs} ms`;
    interpInput.addEventListener("input", () => {
        scene.interpolationDelayMs = Number(interpInput.value);
        interpValue.textContent = `${scene.interpolationDelayMs} ms`;
        updateFormulaBar();
    });
    interpRow.append(interpLabel, interpInput, interpValue);
    root.appendChild(interpRow);

    updateFormulaBar();

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

    const autoAimRow = document.createElement("div");
    autoAimRow.className = "control-row";
    const autoAimLabel = document.createElement("label");
    autoAimLabel.textContent = "Автонаводка (идеальный трекинг)";
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
        ["rate", "Hit rate"],
        ["offset", "Средний промах"],
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
    metricsNote.textContent = "Средний промах — насколько неточным оказался расчётный rewindTime для реальных выстрелов.";
    root.appendChild(metricsNote);

    root.appendChild(document.createElement("br"));
    scene.graph = new ScrollingGraph(
        buildGraphRow(root, "Промах на выстрел, px (0 = точно в центр)", "#ba68c8", GRAPH_SAMPLES),
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
        '<a href="shooting-max-rewind.html" style="color:#4fc3f7">Max Rewind Window</a> &middot; ' +
        '<a href="shooting-spatial-filter.html" style="color:#4fc3f7">Spatial Filter</a> &middot; ' +
        '<a href="shooting-hitbox-order.html" style="color:#4fc3f7">Hitbox vs Animation Order</a> &middot; ' +
        '<a href="shooting-trust-but-verify.html" style="color:#4fc3f7">Trust But Verify</a> &middot; ' +
        '<a href="shooting-already-dead.html" style="color:#4fc3f7">Already Dead</a> &middot; ' +
        '<a href="shooting-rollback-vs-lagcomp.html" style="color:#4fc3f7">Rollback vs Lag Compensation</a>';
    root.appendChild(hint);

    const tick = () => {
        cells.shots.textContent = String(scene.shots);
        cells.hits.textContent = String(scene.hits);
        cells.rate.textContent = scene.shots > 0 ? `${((scene.hits / scene.shots) * 100).toFixed(0)}%` : "-";
        cells.offset.textContent = scene.shots > 0 ? `${(scene.offsetSum / scene.shots).toFixed(1)} px` : "-";
        if (scene.lastShotSummary) setNarrative(scene.lastShotSummary);

        logList.innerHTML = scene.shotLog
            .map((entry) => {
                const color = entry.hit ? "#6fd48a" : "#ef5350";
                const label = entry.hit ? "HIT" : "MISS";
                return `<div style="color:${color}">${label} — offset ${entry.offset.toFixed(1)}px @ rewind ${entry.rewindMs.toFixed(0)}ms</div>`;
            })
            .join("");

        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

const gameRoot = document.getElementById("game-root");
const controlRoot = document.getElementById("control-panel");

if (!gameRoot || !controlRoot) {
    throw new Error("shooting-rewind-formula: expected #game-root and #control-panel in examples/shooting-rewind-formula.html");
}

const scene = new RewindFormulaScene();
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
