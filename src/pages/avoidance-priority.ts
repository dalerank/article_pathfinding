import Phaser from "phaser";
import { Simulation } from "@/simulation/Simulation";
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
const THROTTLED_COLOR = 0x5c6472;

/** Must match NarrowGateExperiment's DEFAULT_NARROW_GATE_OPTIONS.wallThickness (configureAvoidancePriority doesn't override it). */
const WALL_THICKNESS = 40;
/** How close to the gate mouth counts as "contesting" it. */
const ZONE_WIDTH = 16;
/** Minimum avoidancePriority gap for one contester to be a clear winner — below this it's a tie. */
const GAP_THRESHOLD = 5;
/** Non-winners (and anyone behind a current occupant) crawl at this fraction of their speed — not frozen solid, so ties among equals still drift and resolve eventually instead of deadlocking forever. */
const THROTTLE = 0.15;

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
    throttledCount = 0;

    private agentRenderer!: AgentRenderer;
    private obstacleGraphics!: Phaser.GameObjects.Graphics;
    private targetGraphics!: Phaser.GameObjects.Graphics;

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
        const throttled = this.decideThrottled();
        const before = new Map(this.simulation.world.agents.map((a) => [a.id, { ...a.position }]));

        this.simulation.update(delta);

        for (const agent of this.simulation.world.agents) {
            if (!throttled.has(agent.id)) continue;
            const prev = before.get(agent.id)!;
            // Scale the actual displacement, not maxSpeed before the fact — maxSpeed feeds into
            // the desired/avoidance blend, so a "throttled" agent whose avoidance push partly
            // cancels its desired direction wouldn't reliably slow down by the same fraction.
            // Correcting the resulting movement afterwards is unambiguous regardless of direction.
            agent.position = {
                x: prev.x + (agent.position.x - prev.x) * THROTTLE,
                y: prev.y + (agent.position.y - prev.y) * THROTTLE,
            };
        }

        this.throttledCount = throttled.size;
        this.agentRenderer.render(this.simulation.world.agents, (agent) =>
            throttled.has(agent.id) ? THROTTLED_COLOR : colorForPriority(agent),
        );
        this.drawObstacles();
        this.drawTarget();

        if (this.clearedAt === null && this.agentsThrough() === this.simulation.world.agents.length) {
            this.clearedAt = this.simulation.getElapsedSeconds();
        }
    }

    /**
     * The shared Simulation's own avoidance is a soft steering nudge (see LocalAvoidance.ts):
     * it biases direction by priority, but its magnitude always maxes out at full speed, so it
     * can shove an agent sideways but can't make it patiently wait its turn — which is exactly
     * why Uniform and Random used to clear this gate at about the same rate. This adds an
     * explicit admission rule right at the gate mouth (local to this page): at most one agent
     * is ever inside the gate itself, and whoever's waiting with no clearly higher-priority
     * rival (gap >= GAP_THRESHOLD) goes next; everyone else just crawls instead of jostling.
     * Uniform means every rival is tied (gap 0), so there's rarely a decisive winner — the
     * throttle isn't a hard freeze so position noise still breaks ties eventually, but slowly.
     * Random almost always produces a clear winner, so the queue flows.
     */
    private decideThrottled(): Set<number> {
        const agents = this.simulation.world.agents;
        const midX = this.simulation.world.width / 2;
        const corridorLeft = midX - WALL_THICKNESS / 2;
        const corridorRight = midX + WALL_THICKNESS / 2;
        const zoneLeft = corridorLeft - ZONE_WIDTH;

        const throttled = new Set<number>();
        const occupant = agents.find((a) => a.position.x >= corridorLeft && a.position.x <= corridorRight);
        const zoneAgents = agents.filter((a) => a.position.x >= zoneLeft && a.position.x < corridorLeft);

        if (occupant) {
            for (const a of zoneAgents) throttled.add(a.id);
            return throttled;
        }

        if (zoneAgents.length === 0) return throttled;
        const sorted = [...zoneAgents].sort((a, b) => b.avoidancePriority - a.avoidancePriority);
        const top = sorted[0];
        const second = sorted[1];
        const decisive = !second || top.avoidancePriority - second.avoidancePriority >= GAP_THRESHOLD;

        for (const a of zoneAgents) {
            if (decisive && a === top) continue;
            throttled.add(a.id);
        }
        return throttled;
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
        ["blocked", "Waiting at the gate now"],
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
        'Синий = низкий приоритет (уступает), оранжевый = высокий (проталкивается), серый = сейчас ждёт своей очереди ' +
        'прямо у ворот. В сами ворота одновременно помещается только один — так и должно быть видно глазами. При Uniform ' +
        'все 50, явного победителя почти никогда нет, и очередь у входа подолгу топчется серой массой, пропуская по одному ' +
        'крайне редко. При Random почти всегда находится однозначно самый "наглый" — и он проходит почти без ожидания, ' +
        'очередь течёт. При 80 агентах полный Cleared in занимает пару-тройку минут реального времени — для разницы ' +
        'достаточно смотреть на серую массу у ворот первые 20-30 секунд, не дожидаясь полного прохода. Часть примеров к статье. ' +
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
        cells.blocked.textContent = String(scene.throttledCount);
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
