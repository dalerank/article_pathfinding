import Phaser from "phaser";
import type { Vec2 } from "@/simulation/Vec2";
import { SnapshotHistory, lerpNumber } from "@/netcode/SnapshotHistory";
import { strafeX, type StrafeConfig } from "@/netcode/TargetMotion";
import { buildHowTo, buildLegend, buildNarrative } from "@/rendering/ExplainerPanel";

const WORLD_WIDTH = 900;
const ROW_HEIGHT = 260;
const ROW_GAP = 30;
const LABEL_HEIGHT = 30;
const TOP_ROW_Y = LABEL_HEIGHT + 6;
const BOTTOM_ROW_Y = TOP_ROW_Y + ROW_HEIGHT + ROW_GAP + LABEL_HEIGHT + 6;
const WORLD_HEIGHT = BOTTOM_ROW_Y + ROW_HEIGHT + 20;

const TARGET_RADIUS = 16;
const LANE_CENTER = 450;
const LANE_AMPLITUDE = 300;
const LANE_Y_LOCAL = ROW_HEIGHT - 40;
const SERVER_HZ = 30;
const FIXED_DT = 1 / SERVER_HZ;
const HISTORY_SECONDS = 3;
const HISTORY_CAPACITY = Math.ceil(HISTORY_SECONDS / FIXED_DT);
const BASE_PERIOD = 1.6;
const OTHER_ENTITY_COUNT = 16;
const REPLAY_HZ = 60;
const MEASURE_REPEATS = 60;
const FLASH_DURATION = 0.6;

const SHOOTER_Y_OFFSET = 50;

const TARGET_COLOR = 0x4fc3f7;
const GHOST_COLOR = 0xba68c8;
const ENTITY_COLOR = 0x5c6470;
const ENTITY_GHOST_COLOR = 0xef5350;
const HIT_COLOR = 0x6fd48a;
const MISS_COLOR = 0xef5350;

interface OtherEntity {
    id: number;
    centerX: number;
    centerY: number;
    radius: number;
    period: number;
    phase: number;
}

function spawnEntities(): OtherEntity[] {
    const entities: OtherEntity[] = [];
    for (let i = 0; i < OTHER_ENTITY_COUNT; i++) {
        entities.push({
            id: i,
            centerX: Phaser.Math.Between(60, WORLD_WIDTH - 60),
            centerY: Phaser.Math.Between(20, ROW_HEIGHT - 60),
            radius: Phaser.Math.Between(10, 26),
            period: Phaser.Math.FloatBetween(1.5, 4),
            phase: Phaser.Math.FloatBetween(0, Math.PI * 2),
        });
    }
    return entities;
}

function entityLocalPositionAt(entity: OtherEntity, time: number): Vec2 {
    const angle = entity.phase + (2 * Math.PI * time) / entity.period;
    return { x: entity.centerX + Math.cos(angle) * entity.radius, y: entity.centerY + Math.sin(angle) * entity.radius };
}

interface ShotStats {
    compensationMicros: number;
    rollbackMicros: number;
    hit: boolean;
}

class RollbackVsLagCompScene extends Phaser.Scene {
    rewindMs = 200;
    speedMultiplier = 1;
    paused = false;

    lastStats: ShotStats | null = null;
    shots = 0;

    private history = new SnapshotHistory<number>(HISTORY_CAPACITY);
    private entities: OtherEntity[] = [];
    private serverTick = 0;
    private elapsed = 0;
    private tickAccumulator = 0;
    private aimX = LANE_CENTER;
    private flashUntil = -1;
    private lastCheckX = LANE_CENTER;
    private lastHit = false;

    private rowGraphics!: Phaser.GameObjects.Graphics;
    private entityGraphics!: Phaser.GameObjects.Graphics;
    private targetGraphics!: Phaser.GameObjects.Graphics;
    private crosshairGraphics!: Phaser.GameObjects.Graphics;

    constructor() {
        super("shooting-rollback-vs-lagcomp");
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);

        this.rowGraphics = this.add.graphics();
        this.entityGraphics = this.add.graphics();
        this.targetGraphics = this.add.graphics();
        this.crosshairGraphics = this.add.graphics();

        this.add
            .text(20, 8, "LAG COMPENSATION — откатывается только цель", { fontSize: "13px", color: "#8b93a3" })
            .setOrigin(0, 0);
        this.add
            .text(20, TOP_ROW_Y + ROW_HEIGHT + ROW_GAP - 22, "ROLLBACK — откатывается весь мир (все точки)", {
                fontSize: "13px",
                color: "#8b93a3",
            })
            .setOrigin(0, 0);

        this.drawRowBackgrounds();

        this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
            this.aimX = Phaser.Math.Clamp(pointer.x, 40, WORLD_WIDTH - 40);
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
                this.history.push(this.serverTick, serverTime, strafeX(serverTime, this.targetConfig()));
            }
        }

        this.render();
    }

    reset(): void {
        this.history.clear();
        this.entities = spawnEntities();
        this.serverTick = 0;
        this.elapsed = 0;
        this.tickAccumulator = 0;
        this.aimX = LANE_CENTER;
        this.flashUntil = -1;
        this.lastCheckX = LANE_CENTER;
        this.lastHit = false;
        this.lastStats = null;
        this.shots = 0;
    }

    togglePaused(): void {
        this.paused = !this.paused;
    }

    private targetConfig(): StrafeConfig {
        return { center: LANE_CENTER, amplitude: LANE_AMPLITUDE, period: BASE_PERIOD / this.speedMultiplier };
    }

    /**
     * Fires both modes on the same shot, side by side. Both use the identical rewound position — the point is that
     * they reach the SAME correct hit, just at very different cost (see shooting.txt "Rollback vs Lag Compensation").
     */
    fireShot(): void {
        const rewoundTime = Math.max(0, this.elapsed - this.rewindMs / 1000);
        const rewindTicks = Math.max(1, Math.round((this.rewindMs / 1000) * REPLAY_HZ));
        const checkX = this.history.sampleAt(rewoundTime, lerpNumber) ?? LANE_CENTER;
        const hit = Math.abs(this.aimX - checkX) <= TARGET_RADIUS;

        const compStart = performance.now();
        for (let r = 0; r < MEASURE_REPEATS; r++) {
            this.history.sampleAt(rewoundTime, lerpNumber);
        }
        const compensationMicros = ((performance.now() - compStart) * 1000) / MEASURE_REPEATS;

        const rollbackStart = performance.now();
        for (let r = 0; r < MEASURE_REPEATS; r++) {
            for (let step = 0; step <= rewindTicks; step++) {
                const t = rewoundTime + step / REPLAY_HZ;
                strafeX(t, this.targetConfig());
                for (const entity of this.entities) entityLocalPositionAt(entity, t);
            }
        }
        const rollbackMicros = ((performance.now() - rollbackStart) * 1000) / MEASURE_REPEATS;

        this.lastStats = { compensationMicros, rollbackMicros, hit };
        this.lastCheckX = checkX;
        this.lastHit = hit;
        this.shots += 1;
        this.flashUntil = this.elapsed + FLASH_DURATION;
    }

    private drawRowBackgrounds(): void {
        this.rowGraphics.clear();
        for (const rowY of [TOP_ROW_Y, BOTTOM_ROW_Y]) {
            this.rowGraphics.fillStyle(0x1b1f27, 1);
            this.rowGraphics.fillRect(0, rowY, WORLD_WIDTH, ROW_HEIGHT);
            this.rowGraphics.lineStyle(1, 0x2a2f3a, 1);
            this.rowGraphics.strokeRect(0, rowY, WORLD_WIDTH, ROW_HEIGHT);

            const shooterY = rowY + LANE_Y_LOCAL + SHOOTER_Y_OFFSET;
            this.rowGraphics.fillStyle(0xffca28, 1);
            this.rowGraphics.fillTriangle(LANE_CENTER - 8, shooterY + 10, LANE_CENTER + 8, shooterY + 10, LANE_CENTER, shooterY - 4);
        }
    }

    private render(): void {
        const targetXLocal = this.history.newest?.value ?? LANE_CENTER;
        const flashing = this.elapsed < this.flashUntil;
        const flashAlpha = flashing ? Math.max(0, 1 - (this.elapsed - (this.flashUntil - FLASH_DURATION)) / FLASH_DURATION) : 0;
        const rewoundTime = Math.max(0, this.elapsed - this.rewindMs / 1000);
        const rewoundTargetXLocal = this.history.sampleAt(rewoundTime, lerpNumber) ?? targetXLocal;

        this.entityGraphics.clear();
        for (const entity of this.entities) {
            const pos = entityLocalPositionAt(entity, this.elapsed);
            const rewoundPos = entityLocalPositionAt(entity, rewoundTime);

            // Top row (Lag Compensation): entities never rewind.
            this.entityGraphics.fillStyle(ENTITY_COLOR, 1);
            this.entityGraphics.fillCircle(pos.x, TOP_ROW_Y + pos.y, 5);

            // Bottom row (Rollback): every entity rewinds along with the target.
            this.entityGraphics.fillStyle(ENTITY_COLOR, 1);
            this.entityGraphics.fillCircle(pos.x, BOTTOM_ROW_Y + pos.y, 5);
            if (flashing) {
                this.entityGraphics.fillStyle(ENTITY_GHOST_COLOR, flashAlpha * 0.85);
                this.entityGraphics.fillCircle(rewoundPos.x, BOTTOM_ROW_Y + rewoundPos.y, 5);
            }
        }

        this.targetGraphics.clear();
        this.targetGraphics.fillStyle(TARGET_COLOR, 1);
        this.targetGraphics.fillCircle(targetXLocal, TOP_ROW_Y + LANE_Y_LOCAL, TARGET_RADIUS);
        this.targetGraphics.fillStyle(TARGET_COLOR, 1);
        this.targetGraphics.fillCircle(targetXLocal, BOTTOM_ROW_Y + LANE_Y_LOCAL, TARGET_RADIUS);

        // Top row: a visible "trail" showing the target got pulled back in time before the check.
        if (Math.abs(targetXLocal - rewoundTargetXLocal) > 1) {
            this.targetGraphics.lineStyle(2, GHOST_COLOR, 0.5);
            this.targetGraphics.lineBetween(targetXLocal, TOP_ROW_Y + LANE_Y_LOCAL, rewoundTargetXLocal, TOP_ROW_Y + LANE_Y_LOCAL);
        }
        this.targetGraphics.lineStyle(3, GHOST_COLOR, 0.9);
        this.targetGraphics.strokeCircle(rewoundTargetXLocal, TOP_ROW_Y + LANE_Y_LOCAL, TARGET_RADIUS + 7);
        this.targetGraphics.lineStyle(3, ENTITY_GHOST_COLOR, 0.9);
        this.targetGraphics.strokeCircle(rewoundTargetXLocal, BOTTOM_ROW_Y + LANE_Y_LOCAL, TARGET_RADIUS + 7);

        this.crosshairGraphics.clear();
        this.crosshairGraphics.lineStyle(1.5, 0xffca28, 0.6);
        this.crosshairGraphics.lineBetween(this.aimX, TOP_ROW_Y, this.aimX, BOTTOM_ROW_Y + ROW_HEIGHT);

        if (flashing) {
            const flashColor = this.lastHit ? HIT_COLOR : MISS_COLOR;
            for (const rowY of [TOP_ROW_Y, BOTTOM_ROW_Y]) {
                this.crosshairGraphics.fillStyle(flashColor, flashAlpha * 0.6);
                this.crosshairGraphics.fillCircle(this.lastCheckX, rowY + LANE_Y_LOCAL, TARGET_RADIUS + 12);
            }
        }
    }
}

function buildControls(root: HTMLElement, scene: RollbackVsLagCompScene): void {
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "Rollback vs Lag Compensation";
    root.appendChild(heading);

    buildHowTo(
        root,
        "<b>Как пользоваться:</b> лиловое/красное кольцо — это и есть rewind: сервер уже сейчас откатил цель на " +
            "«Окно отката» назад и проверяет попадание именно там (не там, где цель находится по-настоящему прямо " +
            "сейчас). Целься мышью в это кольцо и стреляй кликом/Space — попадёшь в ОБЕИХ сценах одинаково честно, " +
            "потому что результат один и тот же. Разница только в том, что для этого пришлось сделать: сверху " +
            "(Lag Compensation) откатилась только сама цель, снизу (Rollback) — вообще ВСЁ (все серые точки мигнут " +
            "красным призраком).",
    );
    buildLegend(root, [
        { color: "#4fc3f7", label: "цель (сейчас)" },
        { color: "#5c6470", label: "остальной мир (физика/AI/снаряды)" },
        { color: "#ba68c8", label: "куда откатилась цель для проверки", shape: "ring" },
        { color: "#6fd48a", label: "HIT" },
        { color: "#ef5350", label: "MISS / откат всего мира (Rollback)" },
    ]);
    const setNarrative = buildNarrative(root, "Кликни по полю или нажми Space — здесь появится сравнение стоимости.");

    const rewindRow = document.createElement("div");
    rewindRow.className = "control-row";
    const rewindLabel = document.createElement("label");
    rewindLabel.textContent = "Окно отката";
    const rewindInput = document.createElement("input");
    rewindInput.type = "range";
    rewindInput.min = "20";
    rewindInput.max = "500";
    rewindInput.step = "10";
    rewindInput.value = String(scene.rewindMs);
    const rewindValue = document.createElement("span");
    rewindValue.textContent = `${scene.rewindMs} ms`;
    rewindInput.addEventListener("input", () => {
        scene.rewindMs = Number(rewindInput.value);
        rewindValue.textContent = `${scene.rewindMs} ms`;
    });
    rewindRow.append(rewindLabel, rewindInput, rewindValue);
    root.appendChild(rewindRow);

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
    const fireButton = document.createElement("button");
    fireButton.textContent = "Выстрел (Space)";
    fireButton.addEventListener("click", () => scene.fireShot());
    const pauseButton = document.createElement("button");
    pauseButton.textContent = "Пауза";
    pauseButton.addEventListener("click", () => scene.togglePaused());
    buttonRow.append(fireButton, pauseButton);
    root.appendChild(buttonRow);

    const resetRow = document.createElement("div");
    resetRow.className = "control-row";
    const resetButton = document.createElement("button");
    resetButton.textContent = "Reset (R)";
    resetButton.addEventListener("click", () => scene.reset());
    resetRow.appendChild(resetButton);
    root.appendChild(resetRow);

    const table = document.createElement("table");
    table.className = "metrics-table";
    const rows: Array<[string, string]> = [
        ["shots", "Выстрелов"],
        ["compCost", "Lag Compensation, мкс"],
        ["rollbackCost", "Rollback, мкс"],
        ["speedup", "Rollback дороже в"],
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
    metricsNote.textContent = `Обе стоимости честно измерены через performance.now() на ${OTHER_ENTITY_COUNT} точках мира — числа не выдуманы.`;
    root.appendChild(metricsNote);

    const hint = document.createElement("p");
    hint.style.color = "#8b93a3";
    hint.innerHTML =
        "Часть примеров к статье про lag compensation. " +
        '<a href="../index.html" style="color:#4fc3f7">&larr; Все примеры</a> &middot; ' +
        '<a href="shooting-already-dead.html" style="color:#4fc3f7">Already Dead</a>';
    root.appendChild(hint);

    const tick = () => {
        cells.shots.textContent = String(scene.shots);
        const stats = scene.lastStats;
        cells.compCost.textContent = stats ? stats.compensationMicros.toFixed(2) : "-";
        cells.rollbackCost.textContent = stats ? stats.rollbackMicros.toFixed(2) : "-";
        cells.speedup.textContent = stats && stats.compensationMicros > 0 ? `${(stats.rollbackMicros / stats.compensationMicros).toFixed(1)}x` : "-";
        if (stats) {
            const verdict = stats.hit
                ? `<b style="color:#6fd48a">HIT</b> в обеих сценах — компенсация сработала одинаково честно в обоих случаях.`
                : `<b style="color:#ef5350">MISS</b> в обеих сценах — ты целился мимо кольца, а не мимо цели: результат одинаков независимо от способа.`;
            setNarrative(
                `${verdict} Стоимость: Lag Compensation <b style="color:#ba68c8">${stats.compensationMicros.toFixed(2)} мкс</b> ` +
                    `(1 объект) против Rollback <b style="color:#ef5350">${stats.rollbackMicros.toFixed(2)} мкс</b> ` +
                    `(${OTHER_ENTITY_COUNT + 1} объектов × шаги окна отката) — в ` +
                    `${(stats.rollbackMicros / Math.max(stats.compensationMicros, 0.001)).toFixed(1)} раза дороже за тот же самый результат.`,
            );
        }

        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

const gameRoot = document.getElementById("game-root");
const controlRoot = document.getElementById("control-panel");

if (!gameRoot || !controlRoot) {
    throw new Error("shooting-rollback-vs-lagcomp: expected #game-root and #control-panel in examples/shooting-rollback-vs-lagcomp.html");
}

const scene = new RollbackVsLagCompScene();
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
