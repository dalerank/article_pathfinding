import Phaser from "phaser";
import { Simulation } from "@/simulation/Simulation";
import { createWorld } from "@/simulation/World";
import { createTarget } from "@/simulation/Target";
import { AgentRenderer } from "@/rendering/AgentRenderer";
import { configurePathRequests, DEFAULT_PATH_REQUEST_OPTIONS } from "@/experiments/PathRequestExperiment";

const WORLD_WIDTH = 900;
const WORLD_HEIGHT = 600;
const OBSTACLE_COLOR = 0x3a4152;
const TARGET_COLOR = 0xef5350;
const GRAPH_SAMPLES = 150;

/** Minimal scrolling bar graph on a plain <canvas> — one bar per sample, newest on the right. */
class ScrollingGraph {
    private readonly ctx: CanvasRenderingContext2D;
    private readonly samples: number[] = [];

    constructor(
        private readonly canvas: HTMLCanvasElement,
        private readonly maxSamples: number,
        private readonly color: string,
    ) {
        this.ctx = canvas.getContext("2d")!;
    }

    push(value: number, scaleMax: number): void {
        this.samples.push(value);
        if (this.samples.length > this.maxSamples) this.samples.shift();
        this.draw(Math.max(scaleMax, 1));
    }

    private draw(scaleMax: number): void {
        const { width, height } = this.canvas;
        this.ctx.clearRect(0, 0, width, height);
        const barWidth = width / this.maxSamples;

        this.ctx.fillStyle = this.color;
        this.samples.forEach((value, i) => {
            const barHeight = Math.min(height, (value / scaleMax) * height);
            this.ctx.fillRect(i * barWidth, height - barHeight, Math.max(1, barWidth - 1), barHeight);
        });
    }
}

class PathRequestScene extends Phaser.Scene {
    simulation!: Simulation;
    agentCount = DEFAULT_PATH_REQUEST_OPTIONS.agentCount;
    repathInterval = 0.45;
    repathJitter = 0;
    maxPerFrame = Infinity;

    requestGraph: ScrollingGraph | null = null;
    frameGraph: ScrollingGraph | null = null;

    private agentRenderer!: AgentRenderer;
    private obstacleGraphics!: Phaser.GameObjects.Graphics;
    private targetGraphics!: Phaser.GameObjects.Graphics;
    private nextRepathTime = new Map<number, number>();

    constructor() {
        super("path-request-budget");
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);

        const world = createWorld(createTarget({ x: 0, y: 0 }), WORLD_WIDTH, WORLD_HEIGHT);
        this.simulation = new Simulation(world);

        this.obstacleGraphics = this.add.graphics();
        this.agentRenderer = new AgentRenderer(this);
        this.targetGraphics = this.add.graphics();

        this.reset();

        this.input.keyboard?.on("keydown-SPACE", () => this.simulation.togglePaused());
        this.input.keyboard?.on("keydown-R", () => this.reset());
    }

    update(_time: number, delta: number): void {
        this.simulation.maxPathRequestsPerFrame = this.maxPerFrame;
        this.simulation.update(delta);
        this.scheduleRepaths();

        this.agentRenderer.render(this.simulation.world.agents);
        this.drawObstacles();
        this.drawTarget();

        const budgetForScale = Number.isFinite(this.maxPerFrame) ? this.maxPerFrame : this.agentCount;
        this.requestGraph?.push(this.simulation.lastFrameRequestsProcessed, budgetForScale);
        this.frameGraph?.push(this.simulation.getMetrics().frameTime, 20);
    }

    reset(): void {
        this.nextRepathTime.clear();
        configurePathRequests(this.simulation, { agentCount: this.agentCount });

        // Everyone spawns "at the same time" with the same interval — the sync-burst setup the article warns about.
        const now = this.simulation.getElapsedSeconds();
        for (const agent of this.simulation.world.agents) {
            this.nextRepathTime.set(agent.id, now + this.repathInterval);
        }
    }

    /** Enqueues a repath for every agent whose scheduled time has come, then reschedules it with fresh jitter. */
    private scheduleRepaths(): void {
        const now = this.simulation.getElapsedSeconds();
        for (const agent of this.simulation.world.agents) {
            const due = this.nextRepathTime.get(agent.id) ?? 0;
            if (now < due) continue;

            this.simulation.enqueuePathRequest(agent);
            const jitter = this.repathJitter > 0 ? Math.random() * this.repathJitter : 0;
            this.nextRepathTime.set(agent.id, now + this.repathInterval + jitter);
        }
    }

    private drawObstacles(): void {
        this.obstacleGraphics.clear();
        this.obstacleGraphics.fillStyle(OBSTACLE_COLOR, 1);
        for (const obstacle of this.simulation.world.obstacles) {
            this.obstacleGraphics.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
        }
    }

    private drawTarget(): void {
        const { x, y } = this.simulation.world.target.position;
        this.targetGraphics.clear();
        this.targetGraphics.lineStyle(2, TARGET_COLOR, 1);
        this.targetGraphics.strokeCircle(x, y, 10);
    }
}

function buildGraphRow(root: HTMLElement, label: string, color: string): HTMLCanvasElement {
    const row = document.createElement("div");
    row.style.marginBottom = "8px";
    const rowLabel = document.createElement("div");
    rowLabel.textContent = label;
    rowLabel.style.color = "#8b93a3";
    rowLabel.style.marginBottom = "2px";
    const canvas = document.createElement("canvas");
    canvas.width = GRAPH_SAMPLES * 2;
    canvas.height = 50;
    canvas.style.width = "100%";
    canvas.style.height = "50px";
    canvas.style.display = "block";
    canvas.style.background = "#1b1f27";
    canvas.style.border = `1px solid ${color}33`;
    row.append(rowLabel, canvas);
    root.appendChild(row);
    return canvas;
}

function buildControls(root: HTMLElement, scene: PathRequestScene): void {
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "Path Request Budget & Jitter";
    root.appendChild(heading);

    const budgetRow = document.createElement("div");
    budgetRow.className = "control-row";
    const budgetLabel = document.createElement("label");
    budgetLabel.textContent = "Max requests/frame";
    const budgetSelect = document.createElement("select");
    for (const value of ["1", "4", "8", "12", "24", "unlimited"]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        budgetSelect.appendChild(option);
    }
    budgetSelect.value = "unlimited";
    budgetSelect.addEventListener("change", () => {
        scene.maxPerFrame = budgetSelect.value === "unlimited" ? Infinity : Number(budgetSelect.value);
    });
    budgetRow.append(budgetLabel, budgetSelect);
    root.appendChild(budgetRow);

    const intervalRow = document.createElement("div");
    intervalRow.className = "control-row";
    const intervalLabel = document.createElement("label");
    intervalLabel.textContent = "Repath interval";
    const intervalInput = document.createElement("input");
    intervalInput.type = "range";
    intervalInput.min = "0.1";
    intervalInput.max = "2";
    intervalInput.step = "0.05";
    intervalInput.value = String(scene.repathInterval);
    const intervalValue = document.createElement("span");
    intervalValue.textContent = `${scene.repathInterval.toFixed(2)} s`;
    intervalInput.addEventListener("input", () => {
        scene.repathInterval = Number(intervalInput.value);
        intervalValue.textContent = `${scene.repathInterval.toFixed(2)} s`;
    });
    intervalRow.append(intervalLabel, intervalInput, intervalValue);
    root.appendChild(intervalRow);

    const jitterRow = document.createElement("div");
    jitterRow.className = "control-row";
    const jitterLabel = document.createElement("label");
    jitterLabel.textContent = "Repath jitter";
    const jitterInput = document.createElement("input");
    jitterInput.type = "range";
    jitterInput.min = "0";
    jitterInput.max = "0.5";
    jitterInput.step = "0.05";
    jitterInput.value = String(scene.repathJitter);
    const jitterValue = document.createElement("span");
    jitterValue.textContent = `${scene.repathJitter.toFixed(2)} s`;
    jitterInput.addEventListener("input", () => {
        scene.repathJitter = Number(jitterInput.value);
        jitterValue.textContent = `${scene.repathJitter.toFixed(2)} s`;
    });
    jitterRow.append(jitterLabel, jitterInput, jitterValue);
    root.appendChild(jitterRow);

    const agentsRow = document.createElement("div");
    agentsRow.className = "control-row";
    const agentsLabel = document.createElement("label");
    agentsLabel.textContent = "Agents";
    const agentsInput = document.createElement("input");
    agentsInput.type = "range";
    agentsInput.min = "20";
    agentsInput.max = "300";
    agentsInput.step = "10";
    agentsInput.value = String(scene.agentCount);
    const agentsValue = document.createElement("span");
    agentsValue.textContent = agentsInput.value;
    agentsInput.addEventListener("input", () => {
        scene.agentCount = Number(agentsInput.value);
        agentsValue.textContent = agentsInput.value;
        scene.reset();
    });
    agentsRow.append(agentsLabel, agentsInput, agentsValue);
    root.appendChild(agentsRow);

    const buttonRow = document.createElement("div");
    buttonRow.className = "control-row";
    const pauseButton = document.createElement("button");
    pauseButton.textContent = "Pause / Resume (Space)";
    pauseButton.addEventListener("click", () => scene.simulation.togglePaused());
    const resetButton = document.createElement("button");
    resetButton.textContent = "Reset (R)";
    resetButton.addEventListener("click", () => scene.reset());
    buttonRow.append(pauseButton, resetButton);
    root.appendChild(buttonRow);

    const table = document.createElement("table");
    table.className = "metrics-table";
    const rows: Array<[string, string]> = [
        ["queue", "Queue length"],
        ["processed", "Requests this frame"],
        ["frameTime", "Frame time"],
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
    scene.requestGraph = new ScrollingGraph(buildGraphRow(root, "Path requests processed / frame", "#4fc3f7"), GRAPH_SAMPLES, "#4fc3f7");
    scene.frameGraph = new ScrollingGraph(buildGraphRow(root, "Frame time (scaled to 20ms)", "#ef5350"), GRAPH_SAMPLES, "#ef5350");

    const hint = document.createElement("p");
    hint.style.color = "#8b93a3";
    hint.innerHTML =
        'Все агенты появляются одновременно с одинаковым Repath interval — при Jitter = 0 они синхронно просыпаются каждые ' +
        'X секунд, и с "unlimited" бюджетом это виден пик frame time на графике внизу. Добавь Jitter, чтобы размазать ' +
        'пробуждения по времени, или ограничь Max requests/frame, чтобы превратить пик в очередь. Часть примеров к статье. ' +
        '<a href="../index.html" style="color:#4fc3f7">&larr; Все примеры</a> &middot; ' +
        '<a href="sandbox.html" style="color:#4fc3f7">Свободный sandbox</a> &middot; ' +
        '<a href="narrow-gate.html" style="color:#4fc3f7">Narrow Gate</a> &middot; ' +
        '<a href="effective-width.html" style="color:#4fc3f7">Effective Width</a> &middot; ' +
        '<a href="avoidance-priority.html" style="color:#4fc3f7">Avoidance Priority</a> &middot; ' +
        '<a href="priority-standoff.html" style="color:#4fc3f7">Priority Standoff</a> &middot; ' +
        '<a href="local-avoidance.html" style="color:#4fc3f7">Local Avoidance</a> &middot; ' +
        '<a href="pathfinding.html" style="color:#4fc3f7">A* Pathfinding</a> &middot; ' +
        '<a href="target-snapping.html" style="color:#4fc3f7">Target Snapping</a> &middot; ' +
        '<a href="flow-field.html" style="color:#4fc3f7">A* vs Flow Field</a> &middot; ' +
        '<a href="dynamic-obstacles.html" style="color:#4fc3f7">Dynamic Obstacles</a> &middot; ' +
        '<a href="link-cost.html" style="color:#4fc3f7">Link Cost Override</a> &middot; ' +
        '<a href="astar-scale.html" style="color:#4fc3f7">A* Cost at Scale</a> &middot; ' +
        '<a href="stale-path.html" style="color:#4fc3f7">Stale Path</a>';
    root.appendChild(hint);

    const tick = () => {
        cells.queue.textContent = String(scene.simulation.pendingPathRequests);
        cells.processed.textContent = String(scene.simulation.lastFrameRequestsProcessed);
        cells.frameTime.textContent = `${scene.simulation.getMetrics().frameTime.toFixed(2)} ms`;
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

const gameRoot = document.getElementById("game-root");
const controlRoot = document.getElementById("control-panel");

if (!gameRoot || !controlRoot) {
    throw new Error("path-request-budget: expected #game-root and #control-panel in examples/path-request-budget.html");
}

const scene = new PathRequestScene();
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
