import Phaser from "phaser";
import { Simulation } from "@/simulation/Simulation";
import { createWorld } from "@/simulation/World";
import { createTarget } from "@/simulation/Target";
import type { Agent } from "@/simulation/Agent";
import { AgentRenderer } from "@/rendering/AgentRenderer";
import { PathRenderer } from "@/rendering/PathRenderer";
import { NavMeshRenderer } from "@/rendering/NavMeshRenderer";
import { configureLinkCost, DEFAULT_LINK_COST_OPTIONS, linkZoneFor, type LinkZone } from "@/experiments/LinkCostExperiment";

const WORLD_WIDTH = 900;
const WORLD_HEIGHT = 600;
const OBSTACLE_COLOR = 0x3a4152;
const TARGET_COLOR = 0xef5350;
const LINK_ZONE_COLOR = 0xffca28;

class LinkCostScene extends Phaser.Scene {
    simulation!: Simulation;
    agentCount = DEFAULT_LINK_COST_OPTIONS.agentCount;
    linkCost = DEFAULT_LINK_COST_OPTIONS.linkCost;
    showGrid = false;

    private agentRenderer!: AgentRenderer;
    private pathRenderer!: PathRenderer;
    private navMeshRenderer!: NavMeshRenderer;
    private obstacleGraphics!: Phaser.GameObjects.Graphics;
    private zoneGraphics!: Phaser.GameObjects.Graphics;
    private targetGraphics!: Phaser.GameObjects.Graphics;
    private zone!: LinkZone;

    constructor() {
        super("link-cost");
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);

        const world = createWorld(createTarget({ x: 0, y: 0 }), WORLD_WIDTH, WORLD_HEIGHT);
        this.simulation = new Simulation(world);
        this.zone = linkZoneFor(world);

        this.navMeshRenderer = new NavMeshRenderer(this);
        this.obstacleGraphics = this.add.graphics();
        this.zoneGraphics = this.add.graphics();
        this.pathRenderer = new PathRenderer(this);
        this.agentRenderer = new AgentRenderer(this);
        this.targetGraphics = this.add.graphics();

        this.reset();

        this.input.keyboard?.on("keydown-SPACE", () => this.simulation.togglePaused());
        this.input.keyboard?.on("keydown-R", () => this.reset());
    }

    update(_time: number, delta: number): void {
        this.simulation.update(delta);

        this.navMeshRenderer.render(this.showGrid ? this.simulation.navMesh : null);
        this.drawZone();
        this.drawObstacles();
        this.pathRenderer.render(this.simulation.world.agents);
        this.agentRenderer.render(this.simulation.world.agents);
        this.drawTarget();
    }

    reset(): void {
        configureLinkCost(this.simulation, { agentCount: this.agentCount, linkCost: this.linkCost });
    }

    /** An agent "uses the link" if its computed path passes through the narrow, cost-weighted gap. */
    usesLink(agent: Agent): boolean {
        return agent.path.some((p) => p.x >= this.zone.x0 && p.x <= this.zone.x1 && p.y >= this.zone.y0 && p.y <= this.zone.y1);
    }

    countViaLink(): number {
        return this.simulation.world.agents.filter((a) => this.usesLink(a)).length;
    }

    private drawObstacles(): void {
        this.obstacleGraphics.clear();
        this.obstacleGraphics.fillStyle(OBSTACLE_COLOR, 1);
        for (const obstacle of this.simulation.world.obstacles) {
            this.obstacleGraphics.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
        }
    }

    private drawZone(): void {
        this.zoneGraphics.clear();
        this.zoneGraphics.lineStyle(1.5, LINK_ZONE_COLOR, 0.8);
        this.zoneGraphics.strokeRect(this.zone.x0, this.zone.y0, this.zone.x1 - this.zone.x0, this.zone.y1 - this.zone.y0);
    }

    private drawTarget(): void {
        const { x, y } = this.simulation.world.target.position;
        this.targetGraphics.clear();
        this.targetGraphics.lineStyle(2, TARGET_COLOR, 1);
        this.targetGraphics.strokeCircle(x, y, 10);
    }
}

function buildControls(root: HTMLElement, scene: LinkCostScene): void {
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "Link Cost Override";
    root.appendChild(heading);

    const costRow = document.createElement("div");
    costRow.className = "control-row";
    const costLabel = document.createElement("label");
    costLabel.textContent = "Link cost";
    const costInput = document.createElement("input");
    costInput.type = "range";
    costInput.min = "1";
    costInput.max = "10";
    costInput.step = "0.5";
    costInput.value = String(scene.linkCost);
    const costValue = document.createElement("span");
    costValue.textContent = `${costInput.value}x`;
    costInput.addEventListener("input", () => {
        scene.linkCost = Number(costInput.value);
        costValue.textContent = `${costInput.value}x`;
        scene.reset();
    });
    costRow.append(costLabel, costInput, costValue);
    root.appendChild(costRow);

    const gridRow = document.createElement("div");
    gridRow.className = "control-row";
    const gridLabel = document.createElement("label");
    gridLabel.textContent = "Show grid";
    const gridCheckbox = document.createElement("input");
    gridCheckbox.type = "checkbox";
    gridCheckbox.checked = scene.showGrid;
    gridCheckbox.addEventListener("change", () => (scene.showGrid = gridCheckbox.checked));
    gridRow.append(gridLabel, gridCheckbox);
    root.appendChild(gridRow);

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
        ["link", "Via link (narrow, weighted)"],
        ["detour", "Via detour (wide, free)"],
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
        'Жёлтая рамка — узкий "линк" (короче, но по умолчанию не дороже обхода снизу). При cost 1x почти все агенты ' +
        'идут через него — A* просто минимизирует стоимость, ему всё равно, что там уже очередь. Подними Link cost, ' +
        'чтобы увидеть, как агенты сами перераспределяются на обход. Часть примеров к статье. ' +
        '<a href="../index.html" style="color:#4fc3f7">&larr; Все примеры</a> &middot; ' +
        '<a href="sandbox.html" style="color:#4fc3f7">Свободный sandbox</a> &middot; ' +
        '<a href="narrow-gate.html" style="color:#4fc3f7">Narrow Gate</a> &middot; ' +
        '<a href="effective-width.html" style="color:#4fc3f7">Effective Width</a> &middot; ' +
        '<a href="avoidance-priority.html" style="color:#4fc3f7">Avoidance Priority</a> &middot; ' +
        '<a href="local-avoidance.html" style="color:#4fc3f7">Local Avoidance</a> &middot; ' +
        '<a href="pathfinding.html" style="color:#4fc3f7">A* Pathfinding</a> &middot; ' +
        '<a href="flow-field.html" style="color:#4fc3f7">A* vs Flow Field</a> &middot; ' +
        '<a href="dynamic-obstacles.html" style="color:#4fc3f7">Dynamic Obstacles</a>';
    root.appendChild(hint);

    const tick = () => {
        const total = scene.simulation.world.agents.length;
        const viaLink = scene.countViaLink();
        cells.link.textContent = `${viaLink} / ${total}`;
        cells.detour.textContent = `${total - viaLink} / ${total}`;
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

const gameRoot = document.getElementById("game-root");
const controlRoot = document.getElementById("control-panel");

if (!gameRoot || !controlRoot) {
    throw new Error("link-cost: expected #game-root and #control-panel in examples/link-cost.html");
}

const scene = new LinkCostScene();
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
