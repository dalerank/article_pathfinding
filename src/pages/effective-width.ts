import Phaser from "phaser";
import { Simulation } from "@/simulation/Simulation";
import { createWorld } from "@/simulation/World";
import { createTarget } from "@/simulation/Target";
import { AgentRenderer } from "@/rendering/AgentRenderer";
import { DEFAULT_AGENT_RADIUS } from "@/simulation/Agent";
import {
    configureEffectiveWidth,
    DEFAULT_EFFECTIVE_WIDTH_OPTIONS,
    GATE_WIDTH_M,
    GATE_WIDTH_PX,
    METERS_TO_PX,
} from "@/experiments/EffectiveWidthExperiment";

const WORLD_WIDTH = 900;
const WORLD_HEIGHT = 500;
const OBSTACLE_COLOR = 0x3a4152;
const TARGET_COLOR = 0xef5350;
const THROUGH_ZONE_X = WORLD_WIDTH - 70;

const AGENT_RADIUS_M = DEFAULT_AGENT_RADIUS / METERS_TO_PX;
const EFFECTIVE_WIDTH_M = GATE_WIDTH_M - 2 * AGENT_RADIUS_M;

class EffectiveWidthScene extends Phaser.Scene {
    simulation!: Simulation;
    agentCount = DEFAULT_EFFECTIVE_WIDTH_OPTIONS.agentCount;
    clearedAt: number | null = null;

    private agentRenderer!: AgentRenderer;
    private obstacleGraphics!: Phaser.GameObjects.Graphics;
    private targetGraphics!: Phaser.GameObjects.Graphics;

    constructor() {
        super("effective-width");
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);

        const world = createWorld(createTarget({ x: 0, y: 0 }), WORLD_WIDTH, WORLD_HEIGHT);
        this.simulation = new Simulation(world);

        this.obstacleGraphics = this.add.graphics();
        this.targetGraphics = this.add.graphics();
        this.agentRenderer = new AgentRenderer(this);

        this.reset();

        this.input.keyboard?.on("keydown-SPACE", () => this.simulation.togglePaused());
        this.input.keyboard?.on("keydown-R", () => this.reset());
    }

    update(_time: number, delta: number): void {
        this.simulation.update(delta);
        this.agentRenderer.render(this.simulation.world.agents);
        this.drawObstacles();
        this.drawTarget();

        if (this.clearedAt === null && this.agentsThrough() === this.simulation.world.agents.length) {
            this.clearedAt = this.simulation.getElapsedSeconds();
        }
    }

    reset(): void {
        this.clearedAt = null;
        configureEffectiveWidth(this.simulation, { agentCount: this.agentCount });
    }

    agentsThrough(): number {
        return this.simulation.world.agents.filter((agent) => agent.position.x >= THROUGH_ZONE_X).length;
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

function buildControls(root: HTMLElement, scene: EffectiveWidthScene): void {
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "Effective Width";
    root.appendChild(heading);

    const agentsRow = document.createElement("div");
    agentsRow.className = "control-row";
    const agentsLabel = document.createElement("label");
    agentsLabel.textContent = "Agents";
    const agentsSelect = document.createElement("select");
    for (const [value, label] of [
        ["1", "1 — проходит свободно"],
        ["2", "2 — уже мешают друг другу"],
        ["200", "200 — затор"],
    ] as const) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        agentsSelect.appendChild(option);
    }
    agentsSelect.value = String(scene.agentCount);
    agentsSelect.addEventListener("change", () => {
        scene.agentCount = Number(agentsSelect.value);
        scene.reset();
    });
    agentsRow.append(agentsLabel, agentsSelect);
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
        ["visual", "Visual gate width"],
        ["radius", "Agent radius"],
        ["effective", "Effective width (center)"],
        ["through", "Agents through"],
        ["elapsed", "Time (s)"],
        ["cleared", "Cleared in"],
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
    cells.visual.textContent = `${GATE_WIDTH_M.toFixed(1)} m (${GATE_WIDTH_PX.toFixed(1)} px)`;
    cells.radius.textContent = `${AGENT_RADIUS_M.toFixed(1)} m (${DEFAULT_AGENT_RADIUS} px)`;
    cells.effective.textContent =
        `${EFFECTIVE_WIDTH_M.toFixed(1)} m — NavMesh: path exists (${EFFECTIVE_WIDTH_M.toFixed(1)} m > 0)`;

    const hint = document.createElement("p");
    hint.style.color = "#8b93a3";
    hint.innerHTML =
        'Ворота здесь зафиксированы на числах из статьи: 1.6 м в ширину при Agent Radius 0.5 м — на вид в них помещаются ' +
        'трое NPC, а для центра агента остаётся всего 0.6 м. NavMesh честно считает, что путь существует (0.6 м &gt; 0), ' +
        'но переключи Agents: 1 агент проходит свободно, 2 уже мешают друг другу на входе, а 200 — затор, в котором ' +
        'локальному движению не хватает места провести даже пару соседей одновременно, хотя путь на сетке один и тот же. ' +
        'Ширину ворот можно покрутить в Narrow Gate рядом. Часть примеров к статье. ' +
        '<a href="../index.html" style="color:#4fc3f7">&larr; Все примеры</a> &middot; ' +
        '<a href="sandbox.html" style="color:#4fc3f7">Свободный sandbox</a> &middot; ' +
        '<a href="narrow-gate.html" style="color:#4fc3f7">Narrow Gate</a> &middot; ' +
        '<a href="avoidance-priority.html" style="color:#4fc3f7">Avoidance Priority</a> &middot; ' +
        '<a href="local-avoidance.html" style="color:#4fc3f7">Local Avoidance</a> &middot; ' +
        '<a href="pathfinding.html" style="color:#4fc3f7">A* Pathfinding</a> &middot; ' +
        '<a href="flow-field.html" style="color:#4fc3f7">A* vs Flow Field</a> &middot; ' +
        '<a href="dynamic-obstacles.html" style="color:#4fc3f7">Dynamic Obstacles</a> &middot; ' +
        '<a href="link-cost.html" style="color:#4fc3f7">Link Cost Override</a> &middot; ' +
        '<a href="path-request-budget.html" style="color:#4fc3f7">Path Request Budget</a>';
    root.appendChild(hint);

    const tick = () => {
        const total = scene.simulation.world.agents.length;
        cells.through.textContent = `${scene.agentsThrough()} / ${total}`;
        cells.elapsed.textContent = scene.simulation.getElapsedSeconds().toFixed(1);
        cells.cleared.textContent = scene.clearedAt !== null ? `${scene.clearedAt.toFixed(1)} s` : "-";
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

const gameRoot = document.getElementById("game-root");
const controlRoot = document.getElementById("control-panel");

if (!gameRoot || !controlRoot) {
    throw new Error("effective-width: expected #game-root and #control-panel in examples/effective-width.html");
}

const scene = new EffectiveWidthScene();
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
