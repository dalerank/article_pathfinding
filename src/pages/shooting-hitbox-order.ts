import Phaser from "phaser";
import type { Vec2 } from "@/simulation/Vec2";
import { raycastHitsCircle } from "@/netcode/raycast";
import { ScrollingGraph, buildGraphRow } from "@/rendering/ScrollingGraph";
import { buildHowTo, buildLegend, buildNarrative } from "@/rendering/ExplainerPanel";

const WORLD_WIDTH = 900;
const WORLD_HEIGHT = 600;
const TARGET_RADIUS = 14;
const SHOOTER_POS: Vec2 = { x: 450, y: 560 };
const ORBIT_CENTER: Vec2 = { x: 450, y: 300 };
const ORBIT_RADIUS_X = 260;
const ORBIT_RADIUS_Y = 200;
const BASE_PERIOD = 4;
const AUTO_FIRE_INTERVAL = 0.4;
const FLASH_DURATION = 0.6;
const GRAPH_SAMPLES = 150;
const LOG_CAPACITY = 8;

const VISUAL_COLOR = 0x4fc3f7;
const HITBOX_COLOR = 0xba68c8;
const HIT_COLOR = 0x6fd48a;
const MISS_COLOR = 0xef5350;

function characterPositionAt(time: number, period: number): Vec2 {
    const angle = (2 * Math.PI * time) / period;
    return {
        x: ORBIT_CENTER.x + Math.cos(angle) * ORBIT_RADIUS_X,
        y: ORBIT_CENTER.y + Math.sin(angle) * ORBIT_RADIUS_Y,
    };
}

interface ShotResult {
    hit: boolean;
    offset: number;
}

interface FlashState {
    time: number;
    hit: boolean;
    aim: Vec2;
    hitboxPos: Vec2;
}

class HitboxOrderScene extends Phaser.Scene {
    tickHz = 20;
    speedMultiplier = 1;
    buggyOrder = true;
    autoAim = true;
    paused = false;

    shots = 0;
    hits = 0;
    offsetSum = 0;
    shotLog: ShotResult[] = [];
    graph: ScrollingGraph | null = null;
    lastShotSummary = "";

    private visualPos: Vec2 = { ...ORBIT_CENTER };
    private hitboxPos: Vec2 = { ...ORBIT_CENTER };
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
        super("shooting-hitbox-order");
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
            const fixedDt = 1 / this.tickHz;
            this.tickAccumulator += dt;
            while (this.tickAccumulator >= fixedDt) {
                this.tickAccumulator -= fixedDt;
                this.tick();
            }

            if (this.autoAim) {
                this.aim = this.visualPos;
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
        this.visualPos = characterPositionAt(0, this.period());
        this.hitboxPos = { ...this.visualPos };
        this.elapsed = 0;
        this.tickAccumulator = 0;
        this.autoFireAccumulator = 0;
        this.aim = { ...this.visualPos };
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

    private period(): number {
        return BASE_PERIOD / this.speedMultiplier;
    }

    /** One server tick — order matters: SaveHitboxSnapshot() before UpdateAnimation() records last tick's pose (shooting.txt "Но где именно находится hitbox?"). */
    private tick(): void {
        const newPos = characterPositionAt(this.elapsed, this.period());
        if (this.buggyOrder) {
            this.hitboxPos = this.visualPos; // SaveHitboxSnapshot() — still the old pose
            this.visualPos = newPos; // UpdateAnimation()
        } else {
            this.visualPos = newPos; // UpdateAnimation()
            this.hitboxPos = this.visualPos; // SaveHitboxSnapshot() — the pose we just set
        }
    }

    fireShot(): void {
        const aim = this.aim;
        const hit = raycastHitsCircle(SHOOTER_POS, aim, this.hitboxPos, TARGET_RADIUS);
        const offset = Math.hypot(aim.x - this.hitboxPos.x, aim.y - this.hitboxPos.y);

        this.shots += 1;
        if (hit) this.hits += 1;
        this.offsetSum += offset;
        this.shotLog.unshift({ hit, offset });
        if (this.shotLog.length > LOG_CAPACITY) this.shotLog.length = LOG_CAPACITY;
        this.graph?.push(offset, TARGET_RADIUS * 3);
        this.lastFlash = { time: this.elapsed, hit, aim: { ...aim }, hitboxPos: { ...this.hitboxPos } };

        this.lastShotSummary = hit
            ? `<b style="color:#6fd48a">HIT.</b> Ты целился точно в видимую позицию — hitbox оказался там же (сдвиг ${offset.toFixed(0)}px).`
            : `<b style="color:#ef5350">MISS.</b> Ты целился точно в синий круг, но сохранённый hitbox отстал на ${offset.toFixed(0)}px — ` +
              (this.buggyOrder ? "это баг порядка, а не промах игрока." : "цель просто слишком быстрая для этого tick rate.");
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
        this.targetGraphics.clear();
        this.targetGraphics.fillStyle(VISUAL_COLOR, 1);
        this.targetGraphics.fillCircle(this.visualPos.x, this.visualPos.y, TARGET_RADIUS);
        this.targetGraphics.lineStyle(2, HITBOX_COLOR, 0.9);
        this.targetGraphics.strokeCircle(this.hitboxPos.x, this.hitboxPos.y, TARGET_RADIUS + 5);

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
                this.flashGraphics.fillCircle(this.lastFlash.hitboxPos.x, this.lastFlash.hitboxPos.y, TARGET_RADIUS + 6);
            } else {
                this.lastFlash = null;
            }
        }
    }
}

function buildControls(root: HTMLElement, scene: HitboxOrderScene): void {
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "Hitbox vs Animation Order";
    root.appendChild(heading);

    buildHowTo(
        root,
        "<b>Как пользоваться:</b> персонаж сам бегает по кругу, сети тут нет вообще. При включённой автонаводке " +
            "стрелок всегда честно целится точно в видимый (синий) круг и стреляет сам. Выключи автонаводку, чтобы " +
            "целиться самому мышью и стрелять кликом/Space. Смотри на зазор между кругом и лиловым кольцом.",
    );
    buildLegend(root, [
        { color: "#4fc3f7", label: "видимая поза (UpdateAnimation)" },
        { color: "#ba68c8", label: "сохранённый hitbox (SaveHitboxSnapshot)", shape: "ring" },
        { color: "#6fd48a", label: "HIT" },
        { color: "#ef5350", label: "MISS" },
    ]);
    const setNarrative = buildNarrative(root, "Жди автовыстрел (или стреляй сам) — здесь появится разбор.");

    const buggyRow = document.createElement("div");
    buggyRow.className = "control-row";
    const buggyLabel = document.createElement("label");
    buggyLabel.textContent = "Баг: SaveHitboxSnapshot() до UpdateAnimation()";
    const buggyInput = document.createElement("input");
    buggyInput.type = "checkbox";
    buggyInput.checked = scene.buggyOrder;
    buggyInput.addEventListener("change", () => {
        scene.buggyOrder = buggyInput.checked;
    });
    buggyRow.append(buggyLabel, buggyInput);
    root.appendChild(buggyRow);

    const autoAimRow = document.createElement("div");
    autoAimRow.className = "control-row";
    const autoAimLabel = document.createElement("label");
    autoAimLabel.textContent = "Автонаводка + автоогонь";
    const autoAimInput = document.createElement("input");
    autoAimInput.type = "checkbox";
    autoAimInput.checked = scene.autoAim;
    autoAimInput.addEventListener("change", () => {
        scene.autoAim = autoAimInput.checked;
    });
    autoAimRow.append(autoAimLabel, autoAimInput);
    root.appendChild(autoAimRow);

    const speedRow = document.createElement("div");
    speedRow.className = "control-row";
    const speedLabel = document.createElement("label");
    speedLabel.textContent = "Скорость цели";
    const speedInput = document.createElement("input");
    speedInput.type = "range";
    speedInput.min = "0.3";
    speedInput.max = "3";
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

    const hzRow = document.createElement("div");
    hzRow.className = "control-row";
    const hzLabel = document.createElement("label");
    hzLabel.textContent = "Server tick rate";
    const hzInput = document.createElement("input");
    hzInput.type = "range";
    hzInput.min = "10";
    hzInput.max = "120";
    hzInput.step = "10";
    hzInput.value = String(scene.tickHz);
    const hzValue = document.createElement("span");
    hzValue.textContent = `${scene.tickHz} Hz`;
    hzInput.addEventListener("input", () => {
        scene.tickHz = Number(hzInput.value);
        hzValue.textContent = `${scene.tickHz} Hz`;
    });
    hzRow.append(hzLabel, hzInput, hzValue);
    root.appendChild(hzRow);

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
        ["offset", "Средний сдвиг hitbox"],
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
    metricsNote.textContent = "Стрелок всегда целится честно — Hit rate ниже 100% тут означает только баг порядка, а не плохую наводку.";
    root.appendChild(metricsNote);

    root.appendChild(document.createElement("br"));
    scene.graph = new ScrollingGraph(
        buildGraphRow(root, "Сдвиг hitbox от видимой позы, px", "#ba68c8", GRAPH_SAMPLES),
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
        '<a href="shooting-max-rewind.html" style="color:#4fc3f7">Max Rewind Window</a> &middot; ' +
        '<a href="shooting-spatial-filter.html" style="color:#4fc3f7">Spatial Filter</a> &middot; ' +
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
                return `<div style="color:${color}">${label} — сдвиг ${entry.offset.toFixed(1)}px</div>`;
            })
            .join("");

        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

const gameRoot = document.getElementById("game-root");
const controlRoot = document.getElementById("control-panel");

if (!gameRoot || !controlRoot) {
    throw new Error("shooting-hitbox-order: expected #game-root and #control-panel in examples/shooting-hitbox-order.html");
}

const scene = new HitboxOrderScene();
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
