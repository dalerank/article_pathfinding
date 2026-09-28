import Phaser from "phaser";
import { Simulation } from "@/simulation/Simulation";
import { createWorld } from "@/simulation/World";
import { createTarget } from "@/simulation/Target";
import type { Agent } from "@/simulation/Agent";
import { AgentRenderer } from "@/rendering/AgentRenderer";
import { configureLocalAvoidance, DEFAULT_LOCAL_AVOIDANCE_OPTIONS } from "@/experiments/AvoidanceExperiment";
import { distance, normalize, scale, sub, type Vec2 } from "@/simulation/Vec2";

const WORLD_WIDTH = 700;
const WORLD_HEIGHT = 600;
const SELECT_RADIUS = 20;
const ARRIVE_RADIUS = 4;
const DESIRED_COLOR = 0x66bb6a;

function desiredVelocity(agent: Agent): Vec2 {
    if (!agent.destination) return { x: 0, y: 0 };
    return scale(normalize(sub(agent.destination, agent.position)), agent.maxSpeed);
}

class LocalAvoidanceScene extends Phaser.Scene {
    simulation!: Simulation;
    agentCount = DEFAULT_LOCAL_AVOIDANCE_OPTIONS.agentCount;
    avoidanceEnabled = true;
    selectedAgentId: number | null = null;

    private agentRenderer!: AgentRenderer;
    private desiredGraphics!: Phaser.GameObjects.Graphics;

    constructor() {
        super("local-avoidance");
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);

        const world = createWorld(createTarget({ x: 0, y: 0 }), WORLD_WIDTH, WORLD_HEIGHT);
        this.simulation = new Simulation(world);

        this.desiredGraphics = this.add.graphics();
        this.agentRenderer = new AgentRenderer(this);

        this.reset();

        this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
            const point = { x: pointer.worldX, y: pointer.worldY };
            const nearest = this.findAgentNear(point, SELECT_RADIUS);
            this.selectedAgentId = nearest?.id ?? null;
            this.agentRenderer.selectedAgentId = this.selectedAgentId;
        });

        this.input.keyboard?.on("keydown-SPACE", () => this.simulation.togglePaused());
        this.input.keyboard?.on("keydown-R", () => this.reset());
    }

    update(_time: number, delta: number): void {
        this.bounceArrivedAgents();
        this.simulation.update(delta);
        this.agentRenderer.render(this.simulation.world.agents);
        this.drawDesiredVelocity();
    }

    reset(): void {
        this.selectedAgentId = null;
        this.agentRenderer.selectedAgentId = null;
        configureLocalAvoidance(this.simulation, { agentCount: this.agentCount });
        this.setAvoidanceEnabled(this.avoidanceEnabled);
    }

    setAvoidanceEnabled(enabled: boolean): void {
        this.avoidanceEnabled = enabled;
        for (const agent of this.simulation.world.agents) {
            agent.avoidanceEnabled = enabled;
        }
    }

    getSelectedAgent(): Agent | null {
        return this.simulation.world.agents.find((a) => a.id === this.selectedAgentId) ?? null;
    }

    private findAgentNear(point: Vec2, maxDist: number): Agent | null {
        let closest: Agent | null = null;
        let closestDist = maxDist;
        for (const agent of this.simulation.world.agents) {
            const d = distance(agent.position, point);
            if (d < closestDist) {
                closest = agent;
                closestDist = d;
            }
        }
        return closest;
    }

    /** Once an agent reaches its destination, send it back across the circle so the demo keeps running. */
    private bounceArrivedAgents(): void {
        const cx = this.simulation.world.width / 2;
        const cy = this.simulation.world.height / 2;
        for (const agent of this.simulation.world.agents) {
            if (!agent.destination) continue;
            if (distance(agent.position, agent.destination) < ARRIVE_RADIUS) {
                agent.destination = { x: 2 * cx - agent.destination.x, y: 2 * cy - agent.destination.y };
            }
        }
    }

    private drawDesiredVelocity(): void {
        this.desiredGraphics.clear();
        const agent = this.getSelectedAgent();
        if (!agent) return;

        const desired = desiredVelocity(agent);
        const len = agent.radius * 3;
        const end = {
            x: agent.position.x + (desired.x / agent.maxSpeed) * len,
            y: agent.position.y + (desired.y / agent.maxSpeed) * len,
        };
        this.desiredGraphics.lineStyle(2, DESIRED_COLOR, 1);
        this.desiredGraphics.lineBetween(agent.position.x, agent.position.y, end.x, end.y);
    }
}

function buildControls(root: HTMLElement, scene: LocalAvoidanceScene): void {
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "Local Avoidance";
    root.appendChild(heading);

    const avoidanceRow = document.createElement("div");
    avoidanceRow.className = "control-row";
    const avoidanceLabel = document.createElement("label");
    avoidanceLabel.textContent = "Avoidance";
    const avoidanceCheckbox = document.createElement("input");
    avoidanceCheckbox.type = "checkbox";
    avoidanceCheckbox.checked = scene.avoidanceEnabled;
    avoidanceCheckbox.addEventListener("change", () => scene.setAvoidanceEnabled(avoidanceCheckbox.checked));
    avoidanceRow.append(avoidanceLabel, avoidanceCheckbox);
    root.appendChild(avoidanceRow);

    const agentsRow = document.createElement("div");
    agentsRow.className = "control-row";
    const agentsLabel = document.createElement("label");
    agentsLabel.textContent = "Agents";
    const agentsInput = document.createElement("input");
    agentsInput.type = "range";
    agentsInput.min = "4";
    agentsInput.max = "60";
    agentsInput.step = "2";
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
    const rows: Array<[string, string]> = [["selected", "Selected agent"]];
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
        'Клик по агенту: зелёная линия — desired velocity (куда он хочет), белая — actual (куда реально движется). ' +
        'Выключи avoidance, чтобы увидеть разницу. Часть примеров к статье. ' +
        '<a href="../index.html" style="color:#4fc3f7">Свободный sandbox</a> &middot; ' +
        '<a href="narrow-gate.html" style="color:#4fc3f7">Narrow Gate</a> &middot; ' +
        '<a href="avoidance-priority.html" style="color:#4fc3f7">Avoidance Priority</a> &middot; ' +
        '<a href="pathfinding.html" style="color:#4fc3f7">A* Pathfinding</a> &middot; ' +
        '<a href="flow-field.html" style="color:#4fc3f7">A* vs Flow Field</a> &middot; ' +
        '<a href="dynamic-obstacles.html" style="color:#4fc3f7">Dynamic Obstacles</a> &middot; ' +
        '<a href="link-cost.html" style="color:#4fc3f7">Link Cost Override</a> &middot; ' +
        '<a href="path-request-budget.html" style="color:#4fc3f7">Path Request Budget</a>';
    root.appendChild(hint);

    const tick = () => {
        cells.selected.textContent = scene.selectedAgentId !== null ? `#${scene.selectedAgentId}` : "-";
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

const gameRoot = document.getElementById("game-root");
const controlRoot = document.getElementById("control-panel");

if (!gameRoot || !controlRoot) {
    throw new Error("local-avoidance: expected #game-root and #control-panel in examples/local-avoidance.html");
}

const scene = new LocalAvoidanceScene();
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
