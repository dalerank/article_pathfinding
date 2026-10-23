import Phaser from "phaser";
import type { Vec2 } from "@/simulation/Vec2";
import { buildHowTo, buildLegend, buildNarrative } from "@/rendering/ExplainerPanel";
import { ScrollingGraph, buildGraphRow } from "@/rendering/ScrollingGraph";

const W = 900;
const H = 600;
const AGENT_RADIUS = 12;
const MOVE_SPEED = 160;           // px/s
const SERVER_HZ = 30;
const FIXED_DT = 1 / SERVER_HZ;
const GRAPH_SAMPLES = 150;
const BUDGET_REFILL_PER_TICK = MOVE_SPEED * FIXED_DT;  // px earned per server tick
const MAX_BUDGET_BASE = MOVE_SPEED * 0.3;              // 300ms worth of movement

const CLIENT_COLOR = 0x4fc3f7;
const SERVER_COLOR = 0x8b93a3;
const BUDGET_COLOR = 0x6fd48a;
const BUDGET_EMPTY = 0xef5350;
const RUBBER_COLOR = 0xef5350;
const TRAIL_ALPHA = 0.25;

interface TrailDot { pos: Vec2; age: number }

class SpeedhackBudgetScene extends Phaser.Scene {
    timeMultiplier = 1.0;
    budgetToleranceMs = 100;
    rubberBand = true;
    autoRun = true;
    paused = false;

    clientPos: Vec2 = { x: 150, y: 300 };
    serverPos: Vec2 = { x: 150, y: 300 };

    /** Movement budget: px of movement the server still allows. Refills with server time. */
    moveBudget = MAX_BUDGET_BASE;
    maxBudget = MAX_BUDGET_BASE;

    rubberBandEvents = 0;
    commandsPerSec = 0;
    serverTime = 0;
    clientTime = 0;

    lastNarrative = "";
    graph: ScrollingGraph | null = null;
    budgetGraph: ScrollingGraph | null = null;

    private elapsed = 0;
    private tickAcc = 0;
    private lapAngle = 0;
    private cmdCount = 0;
    private cmdTimer = 0;
    private trail: TrailDot[] = [];
    private serverTrail: TrailDot[] = [];
    private lastRubberTime = -999;
    private lastRubberPos: Vec2 = { x: 0, y: 0 };

    private keys!: { w: Phaser.Input.Keyboard.Key; a: Phaser.Input.Keyboard.Key; s: Phaser.Input.Keyboard.Key; d: Phaser.Input.Keyboard.Key };
    private gfx!: Phaser.GameObjects.Graphics;
    private flashGfx!: Phaser.GameObjects.Graphics;

    constructor() { super("cheat-speedhack-budget"); }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);
        this.gfx = this.add.graphics();
        this.flashGfx = this.add.graphics();
        this.keys = {
            w: this.input.keyboard!.addKey("W"),
            a: this.input.keyboard!.addKey("A"),
            s: this.input.keyboard!.addKey("S"),
            d: this.input.keyboard!.addKey("D"),
        };
        this.input.keyboard?.on("keydown-R", () => this.reset());
        this.reset();
    }

    update(_time: number, deltaMs: number): void {
        if (this.paused) { this.render(); return; }
        const realDt = deltaMs / 1000;
        this.elapsed += realDt;

        // Client perceives time faster
        const clientDt = realDt * this.timeMultiplier;
        this.clientTime += clientDt;

        // Gather input
        let dx = 0, dy = 0;
        if (this.keys.a.isDown) dx -= 1;
        if (this.keys.d.isDown) dx += 1;
        if (this.keys.w.isDown) dy -= 1;
        if (this.keys.s.isDown) dy += 1;

        if (dx === 0 && dy === 0 && this.autoRun) {
            // Auto-run around oval track
            this.lapAngle += 0.9 * clientDt;
            const targetX = W / 2 + Math.cos(this.lapAngle) * 280;
            const targetY = H / 2 + Math.sin(this.lapAngle) * 160;
            dx = targetX - this.clientPos.x;
            dy = targetY - this.clientPos.y;
        }

        const len = Math.hypot(dx, dy);
        if (len > 0) { dx /= len; dy /= len; }

        // Client moves at cheat speed
        const clientMoveDist = MOVE_SPEED * clientDt * (len > 0 ? 1 : 0);
        if (clientMoveDist > 0) {
            this.clientPos = this.clamp({
                x: this.clientPos.x + dx * clientMoveDist,
                y: this.clientPos.y + dy * clientMoveDist,
            });
            this.trail.push({ pos: { ...this.clientPos }, age: 0 });
            this.cmdCount += 1;
        }

        // Server ticks at real time
        this.tickAcc += realDt;
        while (this.tickAcc >= FIXED_DT) {
            this.tickAcc -= FIXED_DT;
            this.serverTime += FIXED_DT;

            // Refill budget
            this.maxBudget = MAX_BUDGET_BASE + (this.budgetToleranceMs / 1000) * MOVE_SPEED;
            this.moveBudget = Math.min(this.moveBudget + BUDGET_REFILL_PER_TICK, this.maxBudget);
        }

        // Server processes movement command
        if (clientMoveDist > 0) {
            if (this.moveBudget >= clientMoveDist) {
                // Enough budget — accept
                this.moveBudget -= clientMoveDist;
                this.serverPos = this.clamp({
                    x: this.serverPos.x + dx * clientMoveDist,
                    y: this.serverPos.y + dy * clientMoveDist,
                });
                this.serverTrail.push({ pos: { ...this.serverPos }, age: 0 });
            } else {
                // Budget exhausted — move only what's allowed, rubber-band client
                const allowed = Math.max(0, this.moveBudget);
                this.moveBudget = 0;
                if (allowed > 0.5) {
                    this.serverPos = this.clamp({
                        x: this.serverPos.x + dx * allowed,
                        y: this.serverPos.y + dy * allowed,
                    });
                    this.serverTrail.push({ pos: { ...this.serverPos }, age: 0 });
                }

                if (this.rubberBand) {
                    this.rubberBandEvents += 1;
                    this.lastRubberTime = this.elapsed;
                    this.lastRubberPos = { ...this.clientPos };
                    this.clientPos = { ...this.serverPos };
                    this.lastNarrative =
                        `<b style="color:#ef5350">Rubber-band!</b> Бюджет исчерпан (${this.moveBudget.toFixed(1)}px). ` +
                        `Клиент хотел пройти ${clientMoveDist.toFixed(1)}px, разрешено ${allowed.toFixed(1)}px. ` +
                        `Множитель ×${this.timeMultiplier.toFixed(1)}.`;
                }
            }
        }

        // Commands/sec meter
        this.cmdTimer += realDt;
        if (this.cmdTimer >= 1) {
            this.commandsPerSec = this.cmdCount;
            this.cmdCount = 0;
            this.cmdTimer -= 1;
        }

        // Age trails
        for (const d of this.trail) d.age += realDt;
        for (const d of this.serverTrail) d.age += realDt;
        this.trail = this.trail.filter(d => d.age < 3);
        this.serverTrail = this.serverTrail.filter(d => d.age < 3);

        // Push to graphs
        this.graph?.push(this.commandsPerSec, Math.max(SERVER_HZ * 3, this.commandsPerSec));
        this.budgetGraph?.push(this.moveBudget, this.maxBudget);

        this.render();
    }

    reset(): void {
        this.clientPos = { x: 150, y: 300 };
        this.serverPos = { x: 150, y: 300 };
        this.moveBudget = MAX_BUDGET_BASE;
        this.maxBudget = MAX_BUDGET_BASE;
        this.rubberBandEvents = 0;
        this.commandsPerSec = 0;
        this.serverTime = 0;
        this.clientTime = 0;
        this.elapsed = 0;
        this.tickAcc = 0;
        this.cmdCount = 0;
        this.cmdTimer = 0;
        this.trail = [];
        this.serverTrail = [];
        this.lastNarrative = "";
        this.graph?.clear();
        this.budgetGraph?.clear();
    }

    togglePaused(): void { this.paused = !this.paused; }

    private clamp(p: Vec2): Vec2 {
        return {
            x: Phaser.Math.Clamp(p.x, AGENT_RADIUS, W - AGENT_RADIUS),
            y: Phaser.Math.Clamp(p.y, AGENT_RADIUS, H - AGENT_RADIUS),
        };
    }

    private render(): void {
        this.gfx.clear();
        this.flashGfx.clear();

        // Background
        this.gfx.fillStyle(0x1b1f27, 1);
        this.gfx.fillRect(0, 0, W, H);

        // Grid
        this.gfx.lineStyle(1, 0x2a2f3a, 0.2);
        for (let x = 0; x < W; x += 50) this.gfx.lineBetween(x, 0, x, H);
        for (let y = 0; y < H; y += 50) this.gfx.lineBetween(0, y, W, y);

        // Race track guide
        this.gfx.lineStyle(2, 0x3a455a, 0.4);
        this.gfx.strokeEllipse(W / 2, H / 2, 560, 320);

        // Budget bar (left edge)
        const barW = 14, barH = H - 40, barX = 10, barY = 20;
        this.gfx.fillStyle(0x2a2f3a, 1);
        this.gfx.fillRect(barX, barY, barW, barH);
        const fill = this.maxBudget > 0 ? this.moveBudget / this.maxBudget : 0;
        const budgetColor = fill > 0.2 ? BUDGET_COLOR : BUDGET_EMPTY;
        this.gfx.fillStyle(budgetColor, 0.8);
        this.gfx.fillRect(barX, barY + barH * (1 - fill), barW, barH * fill);

        // Server trail
        for (const d of this.serverTrail) {
            const a = TRAIL_ALPHA * (1 - d.age / 3);
            this.gfx.fillStyle(SERVER_COLOR, a);
            this.gfx.fillCircle(d.pos.x, d.pos.y, 3);
        }
        // Client trail
        for (const d of this.trail) {
            const a = TRAIL_ALPHA * (1 - d.age / 3);
            this.gfx.fillStyle(CLIENT_COLOR, a);
            this.gfx.fillCircle(d.pos.x, d.pos.y, 3);
        }

        // Server pos
        const gap = Math.hypot(this.clientPos.x - this.serverPos.x, this.clientPos.y - this.serverPos.y);
        if (gap > 3) {
            this.gfx.fillStyle(SERVER_COLOR, 0.5);
            this.gfx.fillCircle(this.serverPos.x, this.serverPos.y, AGENT_RADIUS);
            this.gfx.lineStyle(1, RUBBER_COLOR, 0.3);
            this.gfx.lineBetween(this.clientPos.x, this.clientPos.y, this.serverPos.x, this.serverPos.y);
        }

        // Client pos
        this.gfx.fillStyle(CLIENT_COLOR, 1);
        this.gfx.fillCircle(this.clientPos.x, this.clientPos.y, AGENT_RADIUS);

        // Rubber-band flash
        const flashAge = this.elapsed - this.lastRubberTime;
        if (flashAge < 0.5) {
            const alpha = 1 - flashAge / 0.5;
            this.flashGfx.lineStyle(3, RUBBER_COLOR, alpha);
            this.flashGfx.strokeCircle(this.lastRubberPos.x, this.lastRubberPos.y, AGENT_RADIUS + 8 + flashAge * 30);
        }
    }
}

/* ── Controls ── */

function buildControls(root: HTMLElement, scene: SpeedhackBudgetScene): void {
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "Speedhack Budget";
    root.appendChild(heading);

    buildHowTo(
        root,
        "<b>Как пользоваться:</b> двигайся WASD. Подними «Множитель клиентского времени» выше 1× — " +
        "агент разгонится, но бюджет движения (зелёная полоска слева) быстро кончится, и сервер вернёт назад. " +
        "Увеличь «Допуск» — бюджет прощает больше, но всё равно конечен.",
    );
    buildLegend(root, [
        { color: "#4fc3f7", label: "клиентская позиция" },
        { color: "#8b93a3", label: "серверная позиция" },
        { color: "#6fd48a", label: "бюджет движения", shape: "line" },
        { color: "#ef5350", label: "rubber-band (возврат)", shape: "ring" },
    ]);
    const setNarrative = buildNarrative(root, "Подними множитель и двигайся — тут появится реакция сервера.");

    // Time multiplier
    const tmRow = document.createElement("div");
    tmRow.className = "control-row";
    const tmLabel = document.createElement("label");
    tmLabel.textContent = "Множитель времени";
    const tmInput = document.createElement("input");
    tmInput.type = "range";
    tmInput.min = "1";
    tmInput.max = "3";
    tmInput.step = "0.1";
    tmInput.value = String(scene.timeMultiplier);
    const tmValue = document.createElement("span");
    tmValue.textContent = `${scene.timeMultiplier.toFixed(1)}×`;
    tmInput.addEventListener("input", () => {
        scene.timeMultiplier = Number(tmInput.value);
        tmValue.textContent = `${scene.timeMultiplier.toFixed(1)}×`;
    });
    tmRow.append(tmLabel, tmInput, tmValue);
    root.appendChild(tmRow);

    // Budget tolerance
    const budRow = document.createElement("div");
    budRow.className = "control-row";
    const budLabel = document.createElement("label");
    budLabel.textContent = "Допуск (бюджет)";
    const budInput = document.createElement("input");
    budInput.type = "range";
    budInput.min = "0";
    budInput.max = "300";
    budInput.step = "10";
    budInput.value = String(scene.budgetToleranceMs);
    const budValue = document.createElement("span");
    budValue.textContent = `${scene.budgetToleranceMs} ms`;
    budInput.addEventListener("input", () => {
        scene.budgetToleranceMs = Number(budInput.value);
        budValue.textContent = `${scene.budgetToleranceMs} ms`;
    });
    budRow.append(budLabel, budInput, budValue);
    root.appendChild(budRow);

    // Rubber-band toggle
    const rbRow = document.createElement("div");
    rbRow.className = "control-row";
    const rbLabel = document.createElement("label");
    rbLabel.textContent = "Rubber-band";
    const rbCheck = document.createElement("input");
    rbCheck.type = "checkbox";
    rbCheck.checked = scene.rubberBand;
    rbCheck.addEventListener("change", () => { scene.rubberBand = rbCheck.checked; });
    rbRow.append(rbLabel, rbCheck);
    root.appendChild(rbRow);

    // Auto-run toggle
    const arRow = document.createElement("div");
    arRow.className = "control-row";
    const arLabel = document.createElement("label");
    arLabel.textContent = "Бег по кругу (Auto-run)";
    const arCheck = document.createElement("input");
    arCheck.type = "checkbox";
    arCheck.checked = scene.autoRun;
    arCheck.addEventListener("change", () => { scene.autoRun = arCheck.checked; });
    arRow.append(arLabel, arCheck);
    root.appendChild(arRow);

    // Pause / Reset
    const btnRow = document.createElement("div");
    btnRow.className = "control-row";
    const pauseBtn = document.createElement("button");
    pauseBtn.textContent = "Пауза";
    pauseBtn.addEventListener("click", () => scene.togglePaused());
    const resetBtn = document.createElement("button");
    resetBtn.textContent = "Reset (R)";
    resetBtn.addEventListener("click", () => scene.reset());
    btnRow.append(pauseBtn, resetBtn);
    root.appendChild(btnRow);

    // Metrics
    const table = document.createElement("table");
    table.className = "metrics-table";
    const metricsKeys: Array<[string, string]> = [
        ["serverT", "Серверное время"],
        ["clientT", "Клиентское время"],
        ["budget", "Бюджет движения"],
        ["rubber", "Rubber-band событий"],
        ["cmds", "Команд/с"],
    ];
    const cells: Record<string, HTMLTableCellElement> = {};
    for (const [key, label] of metricsKeys) {
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
        buildGraphRow(root, "Команд / сек", "#4fc3f7", GRAPH_SAMPLES),
        GRAPH_SAMPLES,
        "#4fc3f7",
    );
    scene.budgetGraph = new ScrollingGraph(
        buildGraphRow(root, "Бюджет движения (px)", "#6fd48a", GRAPH_SAMPLES),
        GRAPH_SAMPLES,
        "#6fd48a",
    );

    // Links
    const hint = document.createElement("p");
    hint.style.color = "#8b93a3";
    hint.innerHTML =
        'Часть примеров к статье «Как немножко обмануть сервер». ' +
        '<a href="../index.html" style="color:#4fc3f7">&larr; Все примеры</a> &middot; ' +
        '<a href="cheat-client-authority.html" style="color:#4fc3f7">Client Authority</a> &middot; ' +
        '<a href="cheat-lag-switch.html" style="color:#4fc3f7">Lag Switch</a>';
    root.appendChild(hint);

    const tick = () => {
        cells.serverT.textContent = `${scene.serverTime.toFixed(1)}s`;
        cells.clientT.textContent = `${scene.clientTime.toFixed(1)}s`;
        cells.clientT.style.color = scene.clientTime > scene.serverTime + 0.5 ? "#ef5350" : "#6fd48a";
        cells.budget.textContent = `${scene.moveBudget.toFixed(1)} / ${scene.maxBudget.toFixed(1)} px`;
        cells.budget.style.color = scene.moveBudget < scene.maxBudget * 0.2 ? "#ef5350" : "#6fd48a";
        cells.rubber.textContent = String(scene.rubberBandEvents);
        cells.cmds.textContent = String(scene.commandsPerSec);
        if (scene.lastNarrative) setNarrative(scene.lastNarrative);
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

/* ── Boot ── */

const gameRoot = document.getElementById("game-root");
const controlRoot = document.getElementById("control-panel");
if (!gameRoot || !controlRoot) throw new Error("cheat-speedhack-budget: expected #game-root and #control-panel");

const scene = new SpeedhackBudgetScene();
const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: gameRoot,
    width: W,
    height: H,
    backgroundColor: "#14181f",
    scene: [scene],
    fps: { target: 60 },
});

game.events.once(Phaser.Core.Events.READY, () => buildControls(controlRoot, scene));
