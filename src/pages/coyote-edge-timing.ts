import Phaser from "phaser";
import { coyoteTimeAllowsJump } from "@/platformer/timing";
import { ScrollingGraph, buildGraphRow } from "@/rendering/ScrollingGraph";
import { buildHowTo, buildLegend, buildNarrative } from "@/rendering/ExplainerPanel";

const WORLD_WIDTH = 900;
const WORLD_HEIGHT = 420;
const GROUND_Y = 300;
const START_X = 80;
const EDGE_X = 560;
const RESPAWN_X = WORLD_WIDTH - 40;
const CHARACTER_RADIUS = 14;
const JUMP_DURATION = 0.45;
const JUMP_HEIGHT = 80;
const GRAVITY = 1400;
const AUTO_JUMP_MIN_MS = -60;
const AUTO_JUMP_MAX_MS = 260;

type RunState = "running" | "jumping" | "falling";

interface AttemptResult {
    hit: boolean;
    latenessMs: number;
}

class CoyoteEdgeScene extends Phaser.Scene {
    coyoteTimeMs = 100;
    runSpeed = 260;
    autoPlay = false;
    paused = false;

    attempts = 0;
    caught = 0;
    latenessSum = 0;
    log: AttemptResult[] = [];
    graph: ScrollingGraph | null = null;
    lastSummary = "";

    private x = START_X;
    private y = GROUND_Y;
    private state: RunState = "running";
    private leftGroundAt = -1;
    private jumpStartedAt = -1;
    private fallSpeed = 0;
    private elapsed = 0;
    private autoJumpAt = -1;

    private groundGraphics!: Phaser.GameObjects.Graphics;
    private windowGraphics!: Phaser.GameObjects.Graphics;
    private characterGraphics!: Phaser.GameObjects.Graphics;
    private flashGraphics!: Phaser.GameObjects.Graphics;
    private lastFlash: { time: number; hit: boolean; x: number } | null = null;

    constructor() {
        super("coyote-edge-timing");
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);

        this.groundGraphics = this.add.graphics();
        this.windowGraphics = this.add.graphics();
        this.characterGraphics = this.add.graphics();
        this.flashGraphics = this.add.graphics();

        this.drawGround();

        this.input.on("pointerdown", () => this.tryJump());
        this.input.keyboard?.on("keydown-SPACE", () => this.tryJump());
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

        if (this.state === "running") {
            this.x += this.runSpeed * dt;
            if (this.x > EDGE_X && this.leftGroundAt < 0) {
                this.leftGroundAt = this.elapsed;
                this.autoJumpAt = this.elapsed + Phaser.Math.FloatBetween(AUTO_JUMP_MIN_MS, AUTO_JUMP_MAX_MS) / 1000;
            }
            if (this.leftGroundAt >= 0) {
                const sinceLeft = (this.elapsed - this.leftGroundAt) * 1000;
                if (this.autoPlay && this.autoJumpAt >= 0 && this.elapsed >= this.autoJumpAt) {
                    this.autoJumpAt = -1;
                    this.tryJump();
                } else if (sinceLeft > this.coyoteTimeMs) {
                    this.state = "falling";
                    this.fallSpeed = 0;
                }
            }
            if (this.x > RESPAWN_X) this.respawnRunning();
        } else if (this.state === "jumping") {
            const t = (this.elapsed - this.jumpStartedAt) / JUMP_DURATION;
            this.x += this.runSpeed * dt;
            if (t >= 1) {
                this.state = "running";
                this.y = GROUND_Y;
                this.leftGroundAt = this.x > EDGE_X ? this.elapsed : -1;
            } else {
                this.y = GROUND_Y - JUMP_HEIGHT * Math.sin(Math.PI * Phaser.Math.Clamp(t, 0, 1));
            }
            if (this.x > RESPAWN_X) this.respawnRunning();
        } else {
            this.fallSpeed += GRAVITY * dt;
            this.y += this.fallSpeed * dt;
            this.x += this.runSpeed * 0.3 * dt;
            if (this.y > WORLD_HEIGHT + 60) this.respawnRunning();
        }

        this.render();
    }

    reset(): void {
        this.respawnRunning();
        this.attempts = 0;
        this.caught = 0;
        this.latenessSum = 0;
        this.log = [];
        this.lastSummary = "";
        this.lastFlash = null;
        this.graph?.clear();
    }

    togglePaused(): void {
        this.paused = !this.paused;
    }

    private respawnRunning(): void {
        this.x = START_X;
        this.y = GROUND_Y;
        this.state = "running";
        this.leftGroundAt = -1;
        this.autoJumpAt = -1;
        this.fallSpeed = 0;
    }

    private tryJump(): void {
        if (this.state !== "running" || this.leftGroundAt < 0) return;
        const latenessMs = (this.elapsed - this.leftGroundAt) * 1000;
        const hit = coyoteTimeAllowsJump(latenessMs, this.coyoteTimeMs);

        this.attempts += 1;
        if (hit) this.caught += 1;
        this.latenessSum += latenessMs;
        this.log.unshift({ hit, latenessMs });
        if (this.log.length > 8) this.log.length = 8;
        this.graph?.push(Math.max(latenessMs, 0), Math.max(this.coyoteTimeMs * 2, 50));
        this.lastFlash = { time: this.elapsed, hit, x: this.x };

        if (hit) {
            this.state = "jumping";
            this.jumpStartedAt = this.elapsed;
            this.lastSummary =
                latenessMs <= 0
                    ? `Прыжок нажат ещё на платформе — обычный честный прыжок. <b style="color:#6fd48a">HIT</b>.`
                    : `Прыжок нажат через ${latenessMs.toFixed(0)}ms после края — Coyote Time ${this.coyoteTimeMs}ms всё ещё прощает. <b style="color:#6fd48a">HIT</b>.`;
        } else {
            this.lastSummary = `Прыжок нажат через ${latenessMs.toFixed(0)}ms после края — это больше Coyote Time (${this.coyoteTimeMs}ms). <b style="color:#ef5350">MISS</b>, персонаж падает.`;
        }
    }

    private drawGround(): void {
        this.groundGraphics.clear();
        this.groundGraphics.fillStyle(0x1b1f27, 1);
        this.groundGraphics.fillRect(0, GROUND_Y + CHARACTER_RADIUS, EDGE_X, WORLD_HEIGHT - GROUND_Y - CHARACTER_RADIUS);
        this.groundGraphics.lineStyle(2, 0x3a4152, 1);
        this.groundGraphics.lineBetween(0, GROUND_Y + CHARACTER_RADIUS, EDGE_X, GROUND_Y + CHARACTER_RADIUS);
        this.groundGraphics.lineStyle(2, 0xffca28, 0.9);
        this.groundGraphics.lineBetween(EDGE_X, 20, EDGE_X, GROUND_Y + CHARACTER_RADIUS);
    }

    private render(): void {
        this.windowGraphics.clear();
        const windowWidth = (this.coyoteTimeMs / 1000) * this.runSpeed;
        this.windowGraphics.fillStyle(0xba68c8, 0.15);
        this.windowGraphics.fillRect(EDGE_X, 20, windowWidth, GROUND_Y + CHARACTER_RADIUS - 20);
        this.windowGraphics.lineStyle(1, 0xba68c8, 0.5);
        this.windowGraphics.lineBetween(EDGE_X + windowWidth, 20, EDGE_X + windowWidth, GROUND_Y + CHARACTER_RADIUS);

        this.characterGraphics.clear();
        const color = this.state === "falling" ? 0xef5350 : 0x4fc3f7;
        this.characterGraphics.fillStyle(color, 1);
        this.characterGraphics.fillCircle(this.x, this.y, CHARACTER_RADIUS);

        this.flashGraphics.clear();
        if (this.lastFlash) {
            const age = this.elapsed - this.lastFlash.time;
            if (age < 0.5) {
                const alpha = 1 - age / 0.5;
                const flashColor = this.lastFlash.hit ? 0x6fd48a : 0xef5350;
                this.flashGraphics.lineStyle(2, flashColor, alpha);
                this.flashGraphics.strokeCircle(this.lastFlash.x, GROUND_Y, CHARACTER_RADIUS + 10);
            } else {
                this.lastFlash = null;
            }
        }
    }
}

function buildControls(root: HTMLElement, scene: CoyoteEdgeScene): void {
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "Coyote Time";
    root.appendChild(heading);

    buildHowTo(
        root,
        "<b>Как пользоваться:</b> персонаж бежит и падает с края сам по себе — жми клик или Space в момент, когда он " +
            "добегает до жёлтой черты (или чуть позже неё). Лиловая зона за краем — это окно Coyote Time, в котором " +
            "прыжок ещё засчитывается, даже если персонаж уже в воздухе.",
    );
    buildLegend(root, [
        { color: "#4fc3f7", label: "персонаж (бежит/прыгает)" },
        { color: "#ef5350", label: "персонаж падает" },
        { color: "#ffca28", label: "край платформы" },
        { color: "#ba68c8", label: "окно Coyote Time" },
    ]);
    const setNarrative = buildNarrative(root, "Нажми прыжок у края платформы — здесь появится разбор.");

    const coyoteRow = document.createElement("div");
    coyoteRow.className = "control-row";
    const coyoteLabel = document.createElement("label");
    coyoteLabel.textContent = "Coyote Time";
    const coyoteInput = document.createElement("input");
    coyoteInput.type = "range";
    coyoteInput.min = "0";
    coyoteInput.max = "300";
    coyoteInput.step = "10";
    coyoteInput.value = String(scene.coyoteTimeMs);
    const coyoteValue = document.createElement("span");
    coyoteValue.textContent = `${scene.coyoteTimeMs} ms`;
    coyoteInput.addEventListener("input", () => {
        scene.coyoteTimeMs = Number(coyoteInput.value);
        coyoteValue.textContent = `${scene.coyoteTimeMs} ms`;
    });
    coyoteRow.append(coyoteLabel, coyoteInput, coyoteValue);
    root.appendChild(coyoteRow);

    const speedRow = document.createElement("div");
    speedRow.className = "control-row";
    const speedLabel = document.createElement("label");
    speedLabel.textContent = "Скорость бега";
    const speedInput = document.createElement("input");
    speedInput.type = "range";
    speedInput.min = "120";
    speedInput.max = "420";
    speedInput.step = "10";
    speedInput.value = String(scene.runSpeed);
    const speedValue = document.createElement("span");
    speedValue.textContent = `${scene.runSpeed} px/s`;
    speedInput.addEventListener("input", () => {
        scene.runSpeed = Number(speedInput.value);
        speedValue.textContent = `${scene.runSpeed} px/s`;
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
        ["lateness", "Средняя задержка нажатия"],
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
    metricsNote.textContent = "При Coyote Time = 0 это ровно наивная проверка IsGrounded() — попробуй сравнить долю засчитанных прыжков с ней и с включённым окном.";
    root.appendChild(metricsNote);

    root.appendChild(document.createElement("br"));
    scene.graph = new ScrollingGraph(
        buildGraphRow(root, "Задержка нажатия после края, ms", "#ba68c8", 120),
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
        '<a href="coyote-jump-buffer.html" style="color:#4fc3f7">Jump Buffer</a> &middot; ' +
        '<a href="coyote-tuning.html" style="color:#4fc3f7">Forgiveness Tuning</a>';
    root.appendChild(hint);

    const tick = () => {
        cells.attempts.textContent = String(scene.attempts);
        cells.caught.textContent = String(scene.caught);
        cells.rate.textContent = scene.attempts > 0 ? `${((scene.caught / scene.attempts) * 100).toFixed(0)}%` : "-";
        cells.lateness.textContent = scene.attempts > 0 ? `${(scene.latenessSum / scene.attempts).toFixed(0)} ms` : "-";
        if (scene.lastSummary) setNarrative(scene.lastSummary);

        logList.innerHTML = scene.log
            .map((entry) => {
                const color = entry.hit ? "#6fd48a" : "#ef5350";
                const label = entry.hit ? "HIT" : "MISS";
                return `<div style="color:${color}">${label} — задержка ${entry.latenessMs.toFixed(0)}ms</div>`;
            })
            .join("");

        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

const gameRoot = document.getElementById("game-root");
const controlRoot = document.getElementById("control-panel");

if (!gameRoot || !controlRoot) {
    throw new Error("coyote-edge-timing: expected #game-root and #control-panel in examples/coyote-edge-timing.html");
}

const scene = new CoyoteEdgeScene();
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
