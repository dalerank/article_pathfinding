import Phaser from "phaser";
import { Simulation, resolveCircleRectCollision } from "@/simulation/Simulation";
import { createWorld } from "@/simulation/World";
import { createTarget } from "@/simulation/Target";
import type { Agent } from "@/simulation/Agent";
import { AgentRenderer } from "@/rendering/AgentRenderer";
import {
    configureAvoidancePriority,
    DEFAULT_AVOIDANCE_PRIORITY_OPTIONS,
} from "@/experiments/AvoidanceExperiment";
import type { PriorityMode } from "@/avoidance/AvoidancePriority";

const WORLD_WIDTH = 900;
const WORLD_HEIGHT = 500;
const OBSTACLE_COLOR = 0x3a4152;
const TARGET_COLOR = 0xef5350;
const THROUGH_ZONE_X = WORLD_WIDTH - 70;
const COLLISION_ITERATIONS = 4;

/** Blue (low priority, yields) -> orange (high priority, bulldozes through). Uniform mode collapses to one shade. */
function colorForPriority(agent: Agent): number {
    const t = agent.avoidancePriority / 99;
    const r = Math.round(79 + (255 - 79) * t);
    const g = Math.round(195 + (112 - 195) * t);
    const b = Math.round(247 + (67 - 247) * t);
    return (r << 16) | (g << 8) | b;
}

class AvoidancePriorityScene extends Phaser.Scene {
    simulation!: Simulation;
    mode: PriorityMode = DEFAULT_AVOIDANCE_PRIORITY_OPTIONS.mode;
    agentCount = DEFAULT_AVOIDANCE_PRIORITY_OPTIONS.agentCount;
    gateWidth = DEFAULT_AVOIDANCE_PRIORITY_OPTIONS.gateWidth;
    clearedAt: number | null = null;
    blockedCount = 0;

    private agentRenderer!: AgentRenderer;
    private obstacleGraphics!: Phaser.GameObjects.Graphics;
    private targetGraphics!: Phaser.GameObjects.Graphics;
    private blockedIds = new Set<number>();

    constructor() {
        super("avoidance-priority");
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
        this.resolveAgentCollisions();
        this.blockedCount = this.blockedIds.size;
        this.agentRenderer.render(this.simulation.world.agents, colorForPriority);
        this.drawObstacles();
        this.drawTarget();

        if (this.clearedAt === null && this.agentsThrough() === this.simulation.world.agents.length) {
            this.clearedAt = this.simulation.getElapsedSeconds();
        }
    }

    /**
     * The shared Simulation only nudges agents apart with a soft steering push (see
     * LocalAvoidance.ts) — at a wide-open gate that's fine, but at this single-file width
     * (see Effective Width) it lets agents partially overlap and slip through together
     * regardless of priority, which is exactly why Uniform and Random used to clear at
     * the same rate. This resolves agent-agent overlap as a hard constraint (local to
     * this page) so priority actually decides who gets through the gate first.
     */
    private resolveAgentCollisions(): void {
        const agents = this.simulation.world.agents;
        const obstacles = this.simulation.world.obstacles;
        this.blockedIds.clear();

        for (let iteration = 0; iteration < COLLISION_ITERATIONS; iteration++) {
            for (let i = 0; i < agents.length; i++) {
                for (let j = i + 1; j < agents.length; j++) {
                    const a = agents[i];
                    const b = agents[j];
                    const dx = b.position.x - a.position.x;
                    const dy = b.position.y - a.position.y;
                    const minDist = a.radius + b.radius;
                    let dist = Math.hypot(dx, dy);
                    if (dist >= minDist) continue;

                    this.blockedIds.add(a.id);
                    this.blockedIds.add(b.id);

                    if (dist === 0) dist = 0.01;
                    const nx = dx / dist;
                    const ny = dy / dist;
                    const overlap = minDist - dist;

                    // Same priority semantics as LocalAvoidance's steering: the higher-priority
                    // agent gives up less ground. Equal priority (Uniform) reduces to the old 50/50 split.
                    const totalPriority = a.avoidancePriority + b.avoidancePriority || 1;
                    const aShare = b.avoidancePriority / totalPriority;
                    const bShare = a.avoidancePriority / totalPriority;

                    a.position = { x: a.position.x - nx * overlap * aShare, y: a.position.y - ny * overlap * aShare };
                    b.position = { x: b.position.x + nx * overlap * bShare, y: b.position.y + ny * overlap * bShare };
                }
            }

            for (const agent of agents) {
                for (const obstacle of obstacles) {
                    agent.position = resolveCircleRectCollision(agent.position, agent.radius, obstacle);
                }
            }
        }
    }

    reset(): void {
        this.clearedAt = null;
        configureAvoidancePriority(this.simulation, {
            mode: this.mode,
            agentCount: this.agentCount,
            gateWidth: this.gateWidth,
        });
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

function buildControls(root: HTMLElement, scene: AvoidancePriorityScene): void {
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "Avoidance Priority";
    root.appendChild(heading);

    const modeRow = document.createElement("div");
    modeRow.className = "control-row";
    const modeLabel = document.createElement("label");
    modeLabel.textContent = "Priority";
    const modeSelect = document.createElement("select");
    for (const [value, label] of [
        ["uniform", "Uniform (50)"],
        ["random", "Random (0-99)"],
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

    const gateRow = document.createElement("div");
    gateRow.className = "control-row";
    const gateLabel = document.createElement("label");
    gateLabel.textContent = "Gate width";
    const gateInput = document.createElement("input");
    gateInput.type = "range";
    gateInput.min = "20";
    gateInput.max = "260";
    gateInput.step = "5";
    gateInput.value = String(scene.gateWidth);
    const gateValue = document.createElement("span");
    gateValue.textContent = `${gateInput.value} px`;
    gateInput.addEventListener("input", () => {
        scene.gateWidth = Number(gateInput.value);
        gateValue.textContent = `${gateInput.value} px`;
        scene.reset();
    });
    gateRow.append(gateLabel, gateInput, gateValue);
    root.appendChild(gateRow);

    const agentsRow = document.createElement("div");
    agentsRow.className = "control-row";
    const agentsLabel = document.createElement("label");
    agentsLabel.textContent = "Agents";
    const agentsInput = document.createElement("input");
    agentsInput.type = "range";
    agentsInput.min = "20";
    agentsInput.max = "200";
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
        ["through", "Agents through"],
        ["blocked", "Blocked now (overlapping)"],
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

    const hint = document.createElement("p");
    hint.style.color = "#8b93a3";
    hint.innerHTML =
        'Синий = низкий приоритет (уступает), оранжевый = высокий (проталкивается). Ворота здесь намеренно однополосные ' +
        '(как в Effective Width) — при Uniform всем достаётся ровно 50, отталкивание буквально симметрично, и толпа ' +
        'подолгу топчется перед проходом, пропуская по одному крайне редко. При Random у каждого свой приоритет 0-99: ' +
        'более "наглые" агенты естественным образом формируют очередь и проходят почти без запинки — сравните Cleared in ' +
        'на одном и том же количестве агентов. Часть примеров к статье. ' +
        '<a href="../index.html" style="color:#4fc3f7">&larr; Все примеры</a> &middot; ' +
        '<a href="sandbox.html" style="color:#4fc3f7">Свободный sandbox</a> &middot; ' +
        '<a href="narrow-gate.html" style="color:#4fc3f7">Narrow Gate</a> &middot; ' +
        '<a href="priority-standoff.html" style="color:#4fc3f7">Priority Standoff</a> &middot; ' +
        '<a href="effective-width.html" style="color:#4fc3f7">Effective Width</a> &middot; ' +
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
        const total = scene.simulation.world.agents.length;
        cells.through.textContent = `${scene.agentsThrough()} / ${total}`;
        cells.blocked.textContent = String(scene.blockedCount);
        cells.elapsed.textContent = scene.simulation.getElapsedSeconds().toFixed(1);
        cells.cleared.textContent = scene.clearedAt !== null ? `${scene.clearedAt.toFixed(1)} s` : "-";
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

const gameRoot = document.getElementById("game-root");
const controlRoot = document.getElementById("control-panel");

if (!gameRoot || !controlRoot) {
    throw new Error("avoidance-priority: expected #game-root and #control-panel in examples/avoidance-priority.html");
}

const scene = new AvoidancePriorityScene();
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
