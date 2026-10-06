import Phaser from "phaser";
import { Simulation } from "@/simulation/Simulation";
import { createWorld } from "@/simulation/World";
import { createTarget } from "@/simulation/Target";
import { AgentRenderer } from "@/rendering/AgentRenderer";
import { distance } from "@/simulation/Vec2";
import type { Agent } from "@/simulation/Agent";
import {
    configurePriorityStandoff,
    DEFAULT_PRIORITY_STANDOFF_OPTIONS,
    type PriorityMode,
} from "@/experiments/PriorityStandoffExperiment";

const WORLD_WIDTH = 900;
const WORLD_HEIGHT = 500;
const OBSTACLE_COLOR = 0x3a4152;
const A_COLOR = 0x4fc3f7;
const B_COLOR = 0xef5350;
const ARRIVE_RADIUS = 5;

class PriorityStandoffScene extends Phaser.Scene {
    simulation!: Simulation;
    mode: PriorityMode = DEFAULT_PRIORITY_STANDOFF_OPTIONS.mode;
    clearedAt: number | null = null;

    private aId!: number;
    private bId!: number;
    private agentRenderer!: AgentRenderer;
    private obstacleGraphics!: Phaser.GameObjects.Graphics;
    private markerGraphics!: Phaser.GameObjects.Graphics;

    constructor() {
        super("priority-standoff");
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);

        const world = createWorld(createTarget({ x: 0, y: 0 }), WORLD_WIDTH, WORLD_HEIGHT);
        this.simulation = new Simulation(world);

        this.obstacleGraphics = this.add.graphics();
        this.markerGraphics = this.add.graphics();
        this.agentRenderer = new AgentRenderer(this);

        this.reset();

        this.input.keyboard?.on("keydown-SPACE", () => this.simulation.togglePaused());
        this.input.keyboard?.on("keydown-R", () => this.reset());
    }

    update(_time: number, delta: number): void {
        this.simulation.update(delta);
        this.agentRenderer.render(this.simulation.world.agents, (agent) => (agent.id === this.aId ? A_COLOR : B_COLOR));
        this.drawObstacles();
        this.drawMarkers();

        if (this.clearedAt === null && this.bothArrived()) {
            this.clearedAt = this.simulation.getElapsedSeconds();
        }
    }

    reset(): void {
        this.clearedAt = null;
        configurePriorityStandoff(this.simulation, { mode: this.mode });
        this.aId = this.simulation.world.agents[0].id;
        this.bId = this.simulation.world.agents[1].id;
    }

    agentA(): Agent {
        return this.simulation.world.agents.find((a) => a.id === this.aId)!;
    }

    agentB(): Agent {
        return this.simulation.world.agents.find((a) => a.id === this.bId)!;
    }

    gap(): number {
        return distance(this.agentA().position, this.agentB().position);
    }

    private bothArrived(): boolean {
        return this.simulation.world.agents.every(
            (agent) => agent.destination !== null && distance(agent.position, agent.destination) < ARRIVE_RADIUS,
        );
    }

    private drawObstacles(): void {
        this.obstacleGraphics.clear();
        this.obstacleGraphics.fillStyle(OBSTACLE_COLOR, 1);
        for (const obstacle of this.simulation.world.obstacles) {
            this.obstacleGraphics.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
        }
    }

    private drawMarkers(): void {
        this.markerGraphics.clear();
        for (const [agent, color] of [
            [this.agentA(), A_COLOR],
            [this.agentB(), B_COLOR],
        ] as const) {
            if (!agent.destination) continue;
            this.markerGraphics.lineStyle(2, color, 0.7);
            this.markerGraphics.strokeCircle(agent.destination.x, agent.destination.y, 10);
        }
    }
}

function buildControls(root: HTMLElement, scene: PriorityStandoffScene): void {
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "Priority Standoff";
    root.appendChild(heading);

    const modeRow = document.createElement("div");
    modeRow.className = "control-row";
    const modeLabel = document.createElement("label");
    modeLabel.textContent = "Priority";
    const modeSelect = document.createElement("select");
    for (const [value, label] of [
        ["uniform", "Uniform (50 / 50)"],
        ["asymmetric", "Asymmetric (90 / 10)"],
    ] as const) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        modeSelect.appendChild(option);
    }
    modeSelect.value = scene.mode;
    modeSelect.addEventListener("change", () => {
        scene.mode = modeSelect.value as PriorityMode;
        scene.reset();
    });
    modeRow.append(modeLabel, modeSelect);
    root.appendChild(modeRow);

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
        ["priorityA", "Agent A priority (blue)"],
        ["priorityB", "Agent B priority (red)"],
        ["gap", "Distance A ↔ B"],
        ["elapsed", "Time (s)"],
        ["swapped", "Swapped in"],
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

    const hint = document.createElement("p");
    hint.style.color = "#8b93a3";
    hint.innerHTML =
        'A (голубой) и B (красный) меняются местами через ворота, в которые физически помещается только один ' +
        '(та же математика 1.6 м / 0.5 м радиуса, что в Effective Width). При Uniform у обоих avoidancePriority = 50 — ' +
        'отталкивание симметрично в буквальном смысле, никакой случайности в формуле нет, поэтому оба честно тормозят ' +
        'друг перед другом у ворот и подолгу топчутся на месте: "достаточно умные, чтобы не столкнуться, но недостаточно ' +
        'наглые, чтобы пройти первым". При Asymmetric (90 / 10) один буквально продавливает проход, а другой уступает — ' +
        'и обмен местами происходит сразу. Часть примеров к статье. ' +
        '<a href="../index.html" style="color:#4fc3f7">&larr; Все примеры</a> &middot; ' +
        '<a href="sandbox.html" style="color:#4fc3f7">Свободный sandbox</a> &middot; ' +
        '<a href="narrow-gate.html" style="color:#4fc3f7">Narrow Gate</a> &middot; ' +
        '<a href="effective-width.html" style="color:#4fc3f7">Effective Width</a> &middot; ' +
        '<a href="avoidance-priority.html" style="color:#4fc3f7">Avoidance Priority</a> &middot; ' +
        '<a href="local-avoidance.html" style="color:#4fc3f7">Local Avoidance</a> &middot; ' +
        '<a href="pathfinding.html" style="color:#4fc3f7">A* Pathfinding</a> &middot; ' +
        '<a href="target-snapping.html" style="color:#4fc3f7">Target Snapping</a> &middot; ' +
        '<a href="flow-field.html" style="color:#4fc3f7">A* vs Flow Field</a> &middot; ' +
        '<a href="dynamic-obstacles.html" style="color:#4fc3f7">Dynamic Obstacles</a> &middot; ' +
        '<a href="link-cost.html" style="color:#4fc3f7">Link Cost Override</a> &middot; ' +
        '<a href="path-request-budget.html" style="color:#4fc3f7">Path Request Budget</a> &middot; ' +
        '<a href="astar-scale.html" style="color:#4fc3f7">A* Cost at Scale</a> &middot; ' +
        '<a href="stale-path.html" style="color:#4fc3f7">Stale Path</a>';
    root.appendChild(hint);

    const tick = () => {
        cells.priorityA.textContent = String(scene.agentA().avoidancePriority);
        cells.priorityB.textContent = String(scene.agentB().avoidancePriority);
        cells.gap.textContent = `${scene.gap().toFixed(0)} px`;
        cells.elapsed.textContent = scene.simulation.getElapsedSeconds().toFixed(1);
        cells.swapped.textContent = scene.clearedAt !== null ? `${scene.clearedAt.toFixed(1)} s` : "still negotiating…";
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

const gameRoot = document.getElementById("game-root");
const controlRoot = document.getElementById("control-panel");

if (!gameRoot || !controlRoot) {
    throw new Error("priority-standoff: expected #game-root and #control-panel in examples/priority-standoff.html");
}

const scene = new PriorityStandoffScene();
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
