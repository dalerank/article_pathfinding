import Phaser from "phaser";
import { jumpBufferAllowsLanding } from "@/platformer/timing";
import { ScrollingGraph, buildGraphRow } from "@/rendering/ScrollingGraph";
import { buildHowTo, buildLegend, buildNarrative } from "@/rendering/ExplainerPanel";

const WORLD_WIDTH = 900;
const WORLD_HEIGHT = 420;
const GROUND_Y = 320;
const TOP_Y = 60;
const CHARACTER_X = 450;
const CHARACTER_RADIUS = 14;
const JUMP_DURATION = 0.45;
const JUMP_HEIGHT = 90;
const GROUNDED_PAUSE = 0.35;
const AUTO_PRESS_MIN_MS = -260;
const AUTO_PRESS_MAX_MS = 60;

type FallState = "falling" | "grounded" | "jumping";

interface AttemptResult {
    hit: boolean;
    earlyMs: number;
}

class JumpBufferScene extends Phaser.Scene {
    jumpBufferMs = 120;
    fallSpeed = 320;
    autoPlay = false;
    paused = false;

    attempts = 0;
    caught = 0;
    earlySum = 0;
    log: AttemptResult[] = [];
    graph: ScrollingGraph | null = null;
    lastSummary = "";

    private y = TOP_Y;
    private state: FallState = "falling";
    private elapsed = 0;
    private pendingPressAt = -1;
    private groundedUntil = -1;
    private jumpStartedAt = -1;
    private autoPressAt = -1;

    private groundGraphics!: Phaser.GameObjects.Graphics;
    private windowGraphics!: Phaser.GameObjects.Graphics;
    private characterGraphics!: Phaser.GameObjects.Graphics;
    private flashGraphics!: Phaser.GameObjects.Graphics;
    private lastFlash: { time: number; hit: boolean } | null = null;

    constructor() {
        super("coyote-jump-buffer");
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);

        this.groundGraphics = this.add.graphics();
        this.windowGraphics = this.add.graphics();
        this.characterGraphics = this.add.graphics();
        this.flashGraphics = this.add.graphics();

        this.drawGround();

        this.input.on("pointerdown", () => this.pressJump());
        this.input.keyboard?.on("keydown-SPACE", () => this.pressJump());
        this.input.keyboard?.on("keydown-R", () => this.reset());

        this.reset();
    }

    update(_time: number, deltaMs: number): void {
        const dt = deltaMs / 1000;
        if (this.paused) {
            this.render();
            return;
        }
        this.elapsed += dt;

        if (this.state === "falling") {
            const remainingMs = ((GROUND_Y - this.y) / this.fallSpeed) * 1000;
            if (this.autoPlay && this.autoPressAt < 0) {
                this.autoPressAt = this.elapsed + (remainingMs + Phaser.Math.FloatBetween(AUTO_PRESS_MIN_MS, AUTO_PRESS_MAX_MS)) / 1000;
            }
            if (this.autoPlay && this.autoPressAt >= 0 && this.elapsed >= this.autoPressAt) {
                this.autoPressAt = -1;
                this.pressJump();
            }

            this.y += this.fallSpeed * dt;
            if (this.y >= GROUND_Y) {
                this.y = GROUND_Y;
                this.land();
            }
        } else if (this.state === "jumping") {
            const t = (this.elapsed - this.jumpStartedAt) / JUMP_DURATION;
            if (t >= 1) {
                this.respawnFalling();
            } else {
                this.y = GROUND_Y - JUMP_HEIGHT * Math.sin(Math.PI * Phaser.Math.Clamp(t, 0, 1));
            }
        } else if (this.state === "grounded") {
            if (this.elapsed >= this.groundedUntil) this.respawnFalling();
        }

        this.render();
    }

    reset(): void {
        this.respawnFalling();
        this.attempts = 0;
        this.caught = 0;
        this.earlySum = 0;
        this.log = [];
        this.lastSummary = "";
        this.lastFlash = null;
        this.graph?.clear();
    }

    togglePaused(): void {
        this.paused = !this.paused;
    }

    private respawnFalling(): void {
        this.y = TOP_Y;
        this.state = "falling";
        this.pendingPressAt = -1;
        this.autoPressAt = -1;
    }

    private pressJump(): void {
        if (this.state !== "falling") return;
        this.pendingPressAt = this.elapsed;
    }

    private land(): void {
        if (this.pendingPressAt >= 0) {
            const earlyMs = (this.elapsed - this.pendingPressAt) * 1000;
            const hit = jumpBufferAllowsLanding(earlyMs, this.jumpBufferMs);

            this.attempts += 1;
            if (hit) this.caught += 1;
            this.earlySum += earlyMs;
            this.log.unshift({ hit, earlyMs });
            if (this.log.length > 8) this.log.length = 8;
            this.graph?.push(Math.max(earlyMs, 0), Math.max(this.jumpBufferMs * 2, 50));
            this.lastFlash = { time: this.elapsed, hit };

            if (hit) {
                this.state = "jumping";
                this.jumpStartedAt = this.elapsed;
                this.lastSummary =
                    earlyMs <= 0
                        ? `Прыжок нажат ровно в момент приземления — обычный честный прыжок. <b style="color:#6fd48a">HIT</b>.`
                        : `Прыжок нажат за ${earlyMs.toFixed(0)}ms до приземления — Jump Buffer ${this.jumpBufferMs}ms запомнил нажатие. <b style="color:#6fd48a">HIT</b>.`;
            } else {
                this.state = "grounded";
                this.groundedUntil = this.elapsed + GROUNDED_PAUSE;
                this.lastSummary = `Прыжок нажат за ${earlyMs.toFixed(0)}ms до приземления — это больше Jump Buffer (${this.jumpBufferMs}ms). <b style="color:#ef5350">MISS</b>, нажатие потеряно.`;
            }
        } else {
            this.state = "grounded";
            this.groundedUntil = this.elapsed + GROUNDED_PAUSE;
        }
        this.pendingPressAt = -1;
    }

    private drawGround(): void {
        this.groundGraphics.clear();
        this.groundGraphics.fillStyle(0x1b1f27, 1);
        this.groundGraphics.fillRect(0, GROUND_Y + CHARACTER_RADIUS, WORLD_WIDTH, WORLD_HEIGHT - GROUND_Y - CHARACTER_RADIUS);
        this.groundGraphics.lineStyle(2, 0xffca28, 0.9);
        this.groundGraphics.lineBetween(0, GROUND_Y + CHARACTER_RADIUS, WORLD_WIDTH, GROUND_Y + CHARACTER_RADIUS);
    }

    private render(): void {
        this.windowGraphics.clear();
        const windowHeight = (this.jumpBufferMs / 1000) * this.fallSpeed;
        this.windowGraphics.fillStyle(0xba68c8, 0.15);
        this.windowGraphics.fillRect(CHARACTER_X - 120, GROUND_Y - windowHeight, 240, windowHeight);
        this.windowGraphics.lineStyle(1, 0xba68c8, 0.5);
        this.windowGraphics.lineBetween(CHARACTER_X - 120, GROUND_Y - windowHeight, CHARACTER_X + 120, GROUND_Y - windowHeight);

        this.characterGraphics.clear();
        const color = this.state === "grounded" && this.lastFlash && !this.lastFlash.hit ? 0xef5350 : 0x4fc3f7;
        this.characterGraphics.fillStyle(color, 1);
        this.characterGraphics.fillCircle(CHARACTER_X, this.y, CHARACTER_RADIUS);

        this.flashGraphics.clear();
        if (this.lastFlash) {
            const age = this.elapsed - this.lastFlash.time;
            if (age < 0.5) {
                const alpha = 1 - age / 0.5;
                const flashColor = this.lastFlash.hit ? 0x6fd48a : 0xef5350;
                this.flashGraphics.lineStyle(2, flashColor, alpha);
                this.flashGraphics.strokeCircle(CHARACTER_X, GROUND_Y, CHARACTER_RADIUS + 10);
            } else {
                this.lastFlash = null;
            }
        }
    }
}

function buildControls(root: HTMLElement, scene: JumpBufferScene): void {
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "Jump Buffer";
    root.appendChild(heading);

    buildHowTo(
        root,
        "<b>Как пользоваться:</b> персонаж сам падает на землю (жёлтая черта) — жми клик или Space чуть ДО момента " +
            "приземления, как будто предугадываешь его. Лиловая зона над землёй — окно Jump Buffer, в котором раннее " +
            "нажатие всё ещё запоминается и сработает точно в момент касания земли.",
    );
    buildLegend(root, [
        { color: "#4fc3f7", label: "персонаж (падает/прыгает)" },
        { color: "#ef5350", label: "нажатие потеряно" },
        { color: "#ffca28", label: "земля" },
        { color: "#ba68c8", label: "окно Jump Buffer" },
    ]);
    const setNarrative = buildNarrative(root, "Нажми прыжок чуть раньше приземления — здесь появится разбор.");

    const bufferRow = document.createElement("div");
    bufferRow.className = "control-row";
    const bufferLabel = document.createElement("label");
    bufferLabel.textContent = "Jump Buffer";
    const bufferInput = document.createElement("input");
    bufferInput.type = "range";
    bufferInput.min = "0";
    bufferInput.max = "300";
    bufferInput.step = "10";
    bufferInput.value = String(scene.jumpBufferMs);
    const bufferValue = document.createElement("span");
    bufferValue.textContent = `${scene.jumpBufferMs} ms`;
    bufferInput.addEventListener("input", () => {
        scene.jumpBufferMs = Number(bufferInput.value);
        bufferValue.textContent = `${scene.jumpBufferMs} ms`;
    });
    bufferRow.append(bufferLabel, bufferInput, bufferValue);
    root.appendChild(bufferRow);

    const speedRow = document.createElement("div");
    speedRow.className = "control-row";
    const speedLabel = document.createElement("label");
    speedLabel.textContent = "Скорость падения";
    const speedInput = document.createElement("input");
    speedInput.type = "range";
    speedInput.min = "160";
    speedInput.max = "520";
    speedInput.step = "10";
    speedInput.value = String(scene.fallSpeed);
    const speedValue = document.createElement("span");
    speedValue.textContent = `${scene.fallSpeed} px/s`;
    speedInput.addEventListener("input", () => {
        scene.fallSpeed = Number(speedInput.value);
        speedValue.textContent = `${scene.fallSpeed} px/s`;
    });
    speedRow.append(speedLabel, speedInput, speedValue);
    root.appendChild(speedRow);

    const autoRow = document.createElement("div");
    autoRow.className = "control-row";
    const autoLabel = document.createElement("label");
    autoLabel.textContent = "Авто-прыжок (случайная реакция)";
    const autoInput = document.createElement("input");
    autoInput.type = "checkbox";
    autoInput.checked = scene.autoPlay;
    autoInput.addEventListener("change", () => {
        scene.autoPlay = autoInput.checked;
    });
    autoRow.append(autoLabel, autoInput);
    root.appendChild(autoRow);

    const buttonRow = document.createElement("div");
    buttonRow.className = "control-row";
    const pauseButton = document.createElement("button");
    pauseButton.textContent = "Пауза";
    pauseButton.addEventListener("click", () => scene.togglePaused());
    const resetButton = document.createElement("button");
    resetButton.textContent = "Reset (R)";
    resetButton.addEventListener("click", () => scene.reset());
    buttonRow.append(pauseButton, resetButton);
    root.appendChild(buttonRow);

    const table = document.createElement("table");
    table.className = "metrics-table";
    const rows: Array<[string, string]> = [
        ["attempts", "Попыток прыжка"],
        ["caught", "Засчитано"],
        ["rate", "Доля засчитанных"],
        ["early", "Средняя раннота нажатия"],
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
    metricsNote.textContent = "При Jump Buffer = 0 это ровно наивная проверка IsGrounded() в момент нажатия — раннее нажатие всегда теряется.";
    root.appendChild(metricsNote);

    root.appendChild(document.createElement("br"));
    scene.graph = new ScrollingGraph(
        buildGraphRow(root, "Насколько рано нажат прыжок, ms", "#ba68c8", 120),
        120,
        "#ba68c8",
    );

    const logHeading = document.createElement("div");
    logHeading.textContent = "Последние попытки";
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
        "Часть примеров к статье про coyote time. " +
        '<a href="../index.html" style="color:#4fc3f7">&larr; Все примеры</a> &middot; ' +
        '<a href="coyote-edge-timing.html" style="color:#4fc3f7">Coyote Time</a> &middot; ' +
        '<a href="coyote-tuning.html" style="color:#4fc3f7">Forgiveness Tuning</a>';
    root.appendChild(hint);

    const tick = () => {
        cells.attempts.textContent = String(scene.attempts);
        cells.caught.textContent = String(scene.caught);
        cells.rate.textContent = scene.attempts > 0 ? `${((scene.caught / scene.attempts) * 100).toFixed(0)}%` : "-";
        cells.early.textContent = scene.attempts > 0 ? `${(scene.earlySum / scene.attempts).toFixed(0)} ms` : "-";
        if (scene.lastSummary) setNarrative(scene.lastSummary);

        logList.innerHTML = scene.log
            .map((entry) => {
                const color = entry.hit ? "#6fd48a" : "#ef5350";
                const label = entry.hit ? "HIT" : "MISS";
                return `<div style="color:${color}">${label} — рано на ${entry.earlyMs.toFixed(0)}ms</div>`;
            })
            .join("");

        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

const gameRoot = document.getElementById("game-root");
const controlRoot = document.getElementById("control-panel");

if (!gameRoot || !controlRoot) {
    throw new Error("coyote-jump-buffer: expected #game-root and #control-panel in examples/coyote-jump-buffer.html");
}

const scene = new JumpBufferScene();
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
