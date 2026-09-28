import Phaser from "phaser";
import { Simulation } from "@/simulation/Simulation";
import { createWorld } from "@/simulation/World";
import { createTarget } from "@/simulation/Target";
import { AgentRenderer } from "@/rendering/AgentRenderer";
import { PathRenderer } from "@/rendering/PathRenderer";
import { NavMeshRenderer } from "@/rendering/NavMeshRenderer";
import { configurePathfinding, DEFAULT_PATHFINDING_OPTIONS } from "@/experiments/PathfindingExperiment";
import { DEFAULT_ASTAR_OPTIONS, findPath, type AStarDebugInfo } from "@/navigation/AStar";
import type { Vec2 } from "@/simulation/Vec2";

const WORLD_WIDTH = 900;
const WORLD_HEIGHT = 600;
const OBSTACLE_COLOR = 0x3a4152;
const TARGET_COLOR = 0xef5350;
const OPEN_COLOR = 0x4fc3f7;
const CLOSED_COLOR = 0x8b93a3;

class PathfindingScene extends Phaser.Scene {
    simulation!: Simulation;
    agentCount = DEFAULT_PATHFINDING_OPTIONS.agentCount;
    showGrid = true;
    showDebugSets = true;
    lastFindPathMs = 0;
    heroPathLength = 0;

    private agentRenderer!: AgentRenderer;
    private pathRenderer!: PathRenderer;
    private navMeshRenderer!: NavMeshRenderer;
    private obstacleGraphics!: Phaser.GameObjects.Graphics;
    private debugGraphics!: Phaser.GameObjects.Graphics;
    private targetGraphics!: Phaser.GameObjects.Graphics;
    private debugInfo: AStarDebugInfo = { openSet: [], closedSet: [] };

    constructor() {
        super("pathfinding");
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);

        const world = createWorld(createTarget({ x: 0, y: 0 }), WORLD_WIDTH, WORLD_HEIGHT);
        this.simulation = new Simulation(world);

        // Draw order: grid tint, obstacles, open/closed debug squares, paths, agents, target.
        this.navMeshRenderer = new NavMeshRenderer(this);
        this.obstacleGraphics = this.add.graphics();
        this.debugGraphics = this.add.graphics();
        this.pathRenderer = new PathRenderer(this);
        this.agentRenderer = new AgentRenderer(this);
        this.targetGraphics = this.add.graphics();

        this.reset();

        this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
            this.simulation.setTarget({ x: pointer.worldX, y: pointer.worldY });
            this.recomputeDebug();
        });

        this.input.keyboard?.on("keydown-SPACE", () => this.simulation.togglePaused());
        this.input.keyboard?.on("keydown-R", () => this.reset());
    }

    update(_time: number, delta: number): void {
        this.simulation.update(delta);

        this.navMeshRenderer.render(this.showGrid ? this.simulation.navMesh : null);
        this.drawObstacles();
        this.drawDebugSets();
        this.pathRenderer.render(this.simulation.world.agents);
        this.agentRenderer.render(this.simulation.world.agents);
        this.drawTarget();
    }

    reset(): void {
        configurePathfinding(this.simulation, { agentCount: this.agentCount });
        this.recomputeDebug();
    }

    private recomputeDebug(): void {
        const navMesh = this.simulation.navMesh;
        if (!navMesh) return;

        const world = this.simulation.world;
        const start: Vec2 = world.agents[0]?.position ?? { x: world.width * 0.05, y: world.height / 2 };

        this.debugInfo = { openSet: [], closedSet: [] };
        const t0 = performance.now();
        const path = findPath(navMesh, start, world.target.position, DEFAULT_ASTAR_OPTIONS, this.debugInfo);
        this.lastFindPathMs = performance.now() - t0;
        this.heroPathLength = path.length;
    }

    private drawObstacles(): void {
        this.obstacleGraphics.clear();
        this.obstacleGraphics.fillStyle(OBSTACLE_COLOR, 1);
        for (const obstacle of this.simulation.world.obstacles) {
            this.obstacleGraphics.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
        }
    }

    private drawDebugSets(): void {
        this.debugGraphics.clear();
        if (!this.showDebugSets) return;

        const half = (this.simulation.navMesh?.cellSize ?? 20) * 0.35;

        this.debugGraphics.fillStyle(CLOSED_COLOR, 0.35);
        for (const p of this.debugInfo.closedSet) {
            this.debugGraphics.fillRect(p.x - half, p.y - half, half * 2, half * 2);
        }

        this.debugGraphics.fillStyle(OPEN_COLOR, 0.3);
        for (const p of this.debugInfo.openSet) {
            this.debugGraphics.fillRect(p.x - half, p.y - half, half * 2, half * 2);
        }
    }

    private drawTarget(): void {
        const { x, y } = this.simulation.world.target.position;
        this.targetGraphics.clear();
        this.targetGraphics.lineStyle(2, TARGET_COLOR, 1);
        this.targetGraphics.strokeCircle(x, y, 10);
    }
}

function buildControls(root: HTMLElement, scene: PathfindingScene): void {
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "A* Pathfinding";
    root.appendChild(heading);

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

    const debugRow = document.createElement("div");
    debugRow.className = "control-row";
    const debugLabel = document.createElement("label");
    debugLabel.textContent = "Open / closed set";
    const debugCheckbox = document.createElement("input");
    debugCheckbox.type = "checkbox";
    debugCheckbox.checked = scene.showDebugSets;
    debugCheckbox.addEventListener("change", () => (scene.showDebugSets = debugCheckbox.checked));
    debugRow.append(debugLabel, debugCheckbox);
    root.appendChild(debugRow);

    const agentsRow = document.createElement("div");
    agentsRow.className = "control-row";
    const agentsLabel = document.createElement("label");
    agentsLabel.textContent = "Agents";
    const agentsInput = document.createElement("input");
    agentsInput.type = "range";
    agentsInput.min = "2";
    agentsInput.max = "40";
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
    const rows: Array<[string, string]> = [
        ["findPath", "findPath() time"],
        ["waypoints", "Path waypoints"],
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
        'Клик — новая цель, путь пересчитывается. Красный тон вокруг стен — область, недоступная из-за радиуса агента ' +
        '(NavMesh &ne; видимый пол). Синий/серый — open/closed set последнего findPath(). Часть примеров к статье. ' +
        '<a href="../index.html" style="color:#4fc3f7">Свободный sandbox</a> &middot; ' +
        '<a href="narrow-gate.html" style="color:#4fc3f7">Narrow Gate</a> &middot; ' +
        '<a href="avoidance-priority.html" style="color:#4fc3f7">Avoidance Priority</a> &middot; ' +
        '<a href="local-avoidance.html" style="color:#4fc3f7">Local Avoidance</a>';
    root.appendChild(hint);

    const tick = () => {
        cells.findPath.textContent = `${scene.lastFindPathMs.toFixed(3)} ms`;
        cells.waypoints.textContent = String(scene.heroPathLength);
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

const gameRoot = document.getElementById("game-root");
const controlRoot = document.getElementById("control-panel");

if (!gameRoot || !controlRoot) {
    throw new Error("pathfinding: expected #game-root and #control-panel in examples/pathfinding.html");
}

const scene = new PathfindingScene();
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
