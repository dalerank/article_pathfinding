import Phaser from "phaser";
import { SnapshotHistory, lerpStep } from "@/netcode/SnapshotHistory";
import { ScrollingGraph, buildGraphRow } from "@/rendering/ScrollingGraph";
import { buildHowTo, buildLegend } from "@/rendering/ExplainerPanel";

const WORLD_WIDTH = 900;
const WORLD_HEIGHT = 380;
const SERVER_HZ = 30;
const FIXED_DT = 1 / SERVER_HZ;
const HISTORY_SECONDS = 8;
const HISTORY_CAPACITY = Math.ceil(HISTORY_SECONDS / FIXED_DT);
const TIMELINE_WINDOW_SEC = 5;
const TIMELINE_X_LEFT = 40;
const TIMELINE_X_RIGHT = 860;
const PX_PER_SECOND = (TIMELINE_X_RIGHT - TIMELINE_X_LEFT) / TIMELINE_WINDOW_SEC;
const ALIVE_ROW_Y = 90;
const NAIVE_ROW_Y = 190;
const COMPENSATED_ROW_Y = 290;
const GRAPH_SAMPLES = 100;

const ALIVE_COLOR = 0x6fd48a;
const DEAD_COLOR = 0x5c6470;
const PENDING_COLOR = 0xffca28;
const ACCEPT_COLOR = 0x6fd48a;
const REJECT_COLOR = 0xef5350;

interface Shot {
    id: number;
    firedAt: number;
    resolveAt: number;
    resolved: boolean;
    naiveAlive: boolean;
    compensatedAlive: boolean;
}

interface ScheduledDeath {
    at: number;
    alive: boolean;
}

class AlreadyDeadScene extends Phaser.Scene {
    delayMs = 250;
    paused = false;
    alive = true;

    totalShots = 0;
    naiveRejections = 0;
    compensatedAccepts = 0;
    injustices = 0;

    graph: ScrollingGraph | null = null;

    private history = new SnapshotHistory<boolean>(HISTORY_CAPACITY);
    private serverTick = 0;
    private elapsed = 0;
    private tickAccumulator = 0;
    private shots: Shot[] = [];
    private nextShotId = 1;
    private scheduledDeaths: ScheduledDeath[] = [];
    private flashLog: string[] = [];

    private laneGraphics!: Phaser.GameObjects.Graphics;
    private timelineGraphics!: Phaser.GameObjects.Graphics;

    constructor() {
        super("shooting-already-dead");
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);

        this.laneGraphics = this.add.graphics();
        this.timelineGraphics = this.add.graphics();

        this.add.text(20, ALIVE_ROW_Y - 30, "Состояние игрока на сервере (сейчас)", { fontSize: "13px", color: "#8b93a3" }).setOrigin(0, 0);
        this.add
            .text(20, NAIVE_ROW_Y - 30, "Наивно: alive() проверяется СЕЙЧАС", { fontSize: "13px", color: "#8b93a3" })
            .setOrigin(0, 0);
        this.add
            .text(20, COMPENSATED_ROW_Y - 30, "Честно: alive() проверяется В МОМЕНТ ВЫСТРЕЛА", { fontSize: "13px", color: "#8b93a3" })
            .setOrigin(0, 0);

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

                for (const death of this.scheduledDeaths) {
                    if (death.at <= serverTime) this.alive = death.alive;
                }
                this.scheduledDeaths = this.scheduledDeaths.filter((d) => d.at > serverTime);

                this.history.push(this.serverTick, serverTime, this.alive);
                this.resolveDueShots(serverTime);
            }
        }

        this.render();
    }

    reset(): void {
        this.history.clear();
        this.serverTick = 0;
        this.elapsed = 0;
        this.tickAccumulator = 0;
        this.shots = [];
        this.nextShotId = 1;
        this.scheduledDeaths = [];
        this.flashLog = [];
        this.alive = true;
        this.totalShots = 0;
        this.naiveRejections = 0;
        this.compensatedAccepts = 0;
        this.injustices = 0;
        this.graph?.clear();
    }

    togglePaused(): void {
        this.paused = !this.paused;
    }

    kill(): void {
        this.alive = false;
    }

    revive(): void {
        this.alive = true;
    }

    fireShot(): void {
        const firedAt = this.elapsed;
        this.shots.push({
            id: this.nextShotId++,
            firedAt,
            resolveAt: firedAt + this.delayMs / 1000,
            resolved: false,
            naiveAlive: false,
            compensatedAlive: false,
        });
        this.totalShots += 1;
    }

    /** Fires now and schedules death exactly mid-flight — deterministic replay of shooting.txt "А что если игрок уже умер?". */
    demoShotThenDeath(): void {
        this.revive();
        this.fireShot();
        this.scheduledDeaths.push({ at: this.elapsed + this.delayMs / 1000 / 2, alive: false });
    }

    private resolveDueShots(serverTime: number): void {
        for (const shot of this.shots) {
            if (shot.resolved || shot.resolveAt > serverTime) continue;
            shot.resolved = true;
            shot.naiveAlive = this.history.newest?.value ?? this.alive;
            shot.compensatedAlive = this.history.sampleAt(shot.firedAt, lerpStep) ?? this.alive;

            if (!shot.naiveAlive) this.naiveRejections += 1;
            if (shot.compensatedAlive) this.compensatedAccepts += 1;
            const injustice = !shot.naiveAlive && shot.compensatedAlive;
            if (injustice) this.injustices += 1;

            this.graph?.push(injustice ? 1 : 0, 1);
            this.flashLog.unshift(
                injustice
                    ? `#${shot.id}: наивно REJECT, честно ACCEPT — несправедливость исправлена`
                    : shot.compensatedAlive
                      ? `#${shot.id}: ACCEPT (жив был в момент выстрела)`
                      : `#${shot.id}: REJECT (был мёртв уже в момент выстрела)`,
            );
            if (this.flashLog.length > 8) this.flashLog.length = 8;
        }
        this.shots = this.shots.filter((s) => this.elapsed - s.firedAt < TIMELINE_WINDOW_SEC + 1);
    }

    getLog(): string[] {
        return this.flashLog;
    }

    private timeToX(t: number): number {
        return TIMELINE_X_RIGHT - (this.elapsed - t) * PX_PER_SECOND;
    }

    private render(): void {
        this.laneGraphics.clear();
        for (const y of [ALIVE_ROW_Y, NAIVE_ROW_Y, COMPENSATED_ROW_Y]) {
            this.laneGraphics.fillStyle(0x1b1f27, 1);
            this.laneGraphics.fillRect(TIMELINE_X_LEFT, y - 14, TIMELINE_X_RIGHT - TIMELINE_X_LEFT, 28);
            this.laneGraphics.lineStyle(1, 0x2a2f3a, 1);
            this.laneGraphics.strokeRect(TIMELINE_X_LEFT, y - 14, TIMELINE_X_RIGHT - TIMELINE_X_LEFT, 28);
        }

        this.timelineGraphics.clear();

        // Alive/dead history strip.
        let prevX = TIMELINE_X_LEFT;
        let prevAlive = true;
        const startTime = this.elapsed - TIMELINE_WINDOW_SEC;
        for (let t = startTime; t <= this.elapsed; t += FIXED_DT) {
            const alive = this.history.sampleAt(t, lerpStep) ?? true;
            const x = this.timeToX(t);
            if (alive !== prevAlive) {
                this.timelineGraphics.fillStyle(prevAlive ? ALIVE_COLOR : DEAD_COLOR, 1);
                this.timelineGraphics.fillRect(prevX, ALIVE_ROW_Y - 10, x - prevX, 20);
                prevX = x;
                prevAlive = alive;
            }
        }
        this.timelineGraphics.fillStyle(prevAlive ? ALIVE_COLOR : DEAD_COLOR, 1);
        this.timelineGraphics.fillRect(prevX, ALIVE_ROW_Y - 10, TIMELINE_X_RIGHT - prevX, 20);

        // "now" cursor.
        this.timelineGraphics.lineStyle(1.5, 0xffffff, 0.5);
        this.timelineGraphics.lineBetween(TIMELINE_X_RIGHT, ALIVE_ROW_Y - 20, TIMELINE_X_RIGHT, COMPENSATED_ROW_Y + 20);

        for (const shot of this.shots) {
            const x = this.timeToX(shot.firedAt);
            if (x < TIMELINE_X_LEFT) continue;

            if (!shot.resolved) {
                this.timelineGraphics.fillStyle(PENDING_COLOR, 0.9);
                this.timelineGraphics.fillCircle(x, NAIVE_ROW_Y, 6);
                this.timelineGraphics.fillCircle(x, COMPENSATED_ROW_Y, 6);
                continue;
            }
            this.timelineGraphics.fillStyle(shot.naiveAlive ? ACCEPT_COLOR : REJECT_COLOR, 1);
            this.timelineGraphics.fillCircle(x, NAIVE_ROW_Y, 6);
            this.timelineGraphics.fillStyle(shot.compensatedAlive ? ACCEPT_COLOR : REJECT_COLOR, 1);
            this.timelineGraphics.fillCircle(x, COMPENSATED_ROW_Y, 6);
        }
    }
}

function buildControls(root: HTMLElement, scene: AlreadyDeadScene): void {
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "Already Dead";
    root.appendChild(heading);

    buildHowTo(
        root,
        "<b>Как пользоваться:</b> просто нажми «Демо: смерть посреди полёта пули» — это самый наглядный сценарий. " +
            "Три полосы ниже показывают одно и то же время: жив ли игрок на самом деле, и как один и тот же выстрел " +
            "оценивают наивная и честная проверки.",
    );
    buildLegend(root, [
        { color: "#6fd48a", label: "игрок жив" },
        { color: "#5c6470", label: "игрок мёртв" },
        { color: "#ffca28", label: "выстрел ещё летит" },
        { color: "#6fd48a", label: "выстрел засчитан" },
        { color: "#ef5350", label: "выстрел отклонён" },
    ]);

    const delayRow = document.createElement("div");
    delayRow.className = "control-row";
    const delayLabel = document.createElement("label");
    delayLabel.textContent = "Задержка пакета";
    const delayInput = document.createElement("input");
    delayInput.type = "range";
    delayInput.min = "50";
    delayInput.max = "600";
    delayInput.step = "10";
    delayInput.value = String(scene.delayMs);
    const delayValue = document.createElement("span");
    delayValue.textContent = `${scene.delayMs} ms`;
    delayInput.addEventListener("input", () => {
        scene.delayMs = Number(delayInput.value);
        delayValue.textContent = `${scene.delayMs} ms`;
    });
    delayRow.append(delayLabel, delayInput, delayValue);
    root.appendChild(delayRow);

    const buttonRow1 = document.createElement("div");
    buttonRow1.className = "control-row";
    const fireButton = document.createElement("button");
    fireButton.textContent = "Выстрел (Space)";
    fireButton.addEventListener("click", () => scene.fireShot());
    const killButton = document.createElement("button");
    killButton.textContent = "💀 Смерть сейчас";
    killButton.addEventListener("click", () => scene.kill());
    buttonRow1.append(fireButton, killButton);
    root.appendChild(buttonRow1);

    const buttonRow2 = document.createElement("div");
    buttonRow2.className = "control-row";
    const reviveButton = document.createElement("button");
    reviveButton.textContent = "❤ Воскресить";
    reviveButton.addEventListener("click", () => scene.revive());
    const demoButton = document.createElement("button");
    demoButton.textContent = "Демо: смерть посреди полёта пули";
    demoButton.addEventListener("click", () => scene.demoShotThenDeath());
    buttonRow2.append(reviveButton, demoButton);
    root.appendChild(buttonRow2);

    const buttonRow3 = document.createElement("div");
    buttonRow3.className = "control-row";
    const pauseButton = document.createElement("button");
    pauseButton.textContent = "Пауза";
    pauseButton.addEventListener("click", () => scene.togglePaused());
    const resetButton = document.createElement("button");
    resetButton.textContent = "Reset (R)";
    resetButton.addEventListener("click", () => scene.reset());
    buttonRow3.append(pauseButton, resetButton);
    root.appendChild(buttonRow3);

    const table = document.createElement("table");
    table.className = "metrics-table";
    const rows: Array<[string, string]> = [
        ["shots", "Выстрелов"],
        ["naiveRejections", "Наивно отклонено"],
        ["compensatedAccepts", "Честно принято"],
        ["injustices", "Исправленных несправедливостей"],
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

    root.appendChild(document.createElement("br"));
    scene.graph = new ScrollingGraph(
        buildGraphRow(root, "Исправленная несправедливость на выстрел (0/1)", "#ffca28", GRAPH_SAMPLES),
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
    root.appendChild(logList);

    const hint = document.createElement("p");
    hint.style.color = "#8b93a3";
    hint.innerHTML =
        "Жми «Демо: смерть посреди полёта пули» — выстрел улетает, а игрок умирает ровно посередине полёта пакета. " +
        "На нижней (наивной) полосе шарик красный: сервер проверил alive() СЕЙЧАС и увидел труп. На честной полосе " +
        "тот же выстрел зелёный: сервер спросил «а был ли он жив В МОМЕНТ выстрела?» — и да, был. Часть примеров " +
        "к статье про lag compensation. " +
        '<a href="../index.html" style="color:#4fc3f7">&larr; Все примеры</a> &middot; ' +
        '<a href="shooting-trust-but-verify.html" style="color:#4fc3f7">Trust But Verify</a> &middot; ' +
        '<a href="shooting-rollback-vs-lagcomp.html" style="color:#4fc3f7">Rollback vs Lag Compensation</a>';
    root.appendChild(hint);

    const tick = () => {
        cells.shots.textContent = String(scene.totalShots);
        cells.naiveRejections.textContent = String(scene.naiveRejections);
        cells.compensatedAccepts.textContent = String(scene.compensatedAccepts);
        cells.injustices.textContent = String(scene.injustices);

        logList.innerHTML = scene
            .getLog()
            .map((line) => {
                const color = line.includes("несправедлив") ? "#ffca28" : line.includes("REJECT") ? "#ef5350" : "#6fd48a";
                return `<div style="color:${color}">${line}</div>`;
            })
            .join("");

        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

const gameRoot = document.getElementById("game-root");
const controlRoot = document.getElementById("control-panel");

if (!gameRoot || !controlRoot) {
    throw new Error("shooting-already-dead: expected #game-root and #control-panel in examples/shooting-already-dead.html");
}

const scene = new AlreadyDeadScene();
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
