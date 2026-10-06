import Phaser from "phaser";
import { Simulation, type PathfindingAlgorithm } from "@/simulation/Simulation";
import { createWorld } from "@/simulation/World";
import { createTarget } from "@/simulation/Target";
import { AgentRenderer } from "@/rendering/AgentRenderer";
import { PathRenderer } from "@/rendering/PathRenderer";
import { NavMeshRenderer } from "@/rendering/NavMeshRenderer";
import { configurePathfinding, DEFAULT_PATHFINDING_OPTIONS } from "@/experiments/PathfindingExperiment";
import { findPath } from "@/navigation/AStar";
import { findHierarchicalPath, type HierarchicalDebugInfo } from "@/navigation/HierarchicalAStar";
import { findNearestWalkable, worldToCell } from "@/navigation/NavMeshQuery";
import { distance, type Vec2 } from "@/simulation/Vec2";

/** How far (world px) to search for a walkable point when the click lands outside the NavMesh — NavMesh.SamplePosition's radius in the article. */
const SNAP_RADIUS = 100;

type TargetStatus = "ok" | "snapped" | "unreachable";

const WORLD_WIDTH = 900;
const WORLD_HEIGHT = 600;
const OBSTACLE_COLOR = 0x3a4152;
const TARGET_COLOR = 0xef5350;
const OPEN_COLOR = 0x4fc3f7;
const CLOSED_COLOR = 0x8b93a3;
const REGION_LINE_COLOR = 0x546e7a;
const REGION_HIGHLIGHT_COLOR = 0xffca28;

class PathfindingScene extends Phaser.Scene {
    simulation!: Simulation;
    agentCount = DEFAULT_PATHFINDING_OPTIONS.agentCount;
    algorithm: PathfindingAlgorithm = "astar";
    showGrid = true;
    showDebugSets = true;
    showRegions = false;
    lastFindPathMs = 0;
    heroPathLength = 0;
    targetStatus: TargetStatus = "ok";
    lastSnapDistance = 0;

    private agentRenderer!: AgentRenderer;
    private pathRenderer!: PathRenderer;
    private navMeshRenderer!: NavMeshRenderer;
    private obstacleGraphics!: Phaser.GameObjects.Graphics;
    private debugGraphics!: Phaser.GameObjects.Graphics;
    private regionGraphics!: Phaser.GameObjects.Graphics;
    private targetGraphics!: Phaser.GameObjects.Graphics;
    private debugInfo: HierarchicalDebugInfo = { openSet: [], closedSet: [], regionPath: [] };

    constructor() {
        super("pathfinding");
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);

        const world = createWorld(createTarget({ x: 0, y: 0 }), WORLD_WIDTH, WORLD_HEIGHT);
        this.simulation = new Simulation(world);

        // Draw order: grid tint, regions, obstacles, open/closed debug squares, paths, agents, target.
        this.navMeshRenderer = new NavMeshRenderer(this);
        this.regionGraphics = this.add.graphics();
        this.obstacleGraphics = this.add.graphics();
        this.debugGraphics = this.add.graphics();
        this.pathRenderer = new PathRenderer(this);
        this.agentRenderer = new AgentRenderer(this);
        this.targetGraphics = this.add.graphics();

        this.reset();

        this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
            this.handleClick({ x: pointer.worldX, y: pointer.worldY });
        });

        this.input.keyboard?.on("keydown-SPACE", () => this.simulation.togglePaused());
        this.input.keyboard?.on("keydown-R", () => this.reset());
    }

    update(_time: number, delta: number): void {
        this.simulation.update(delta);

        this.navMeshRenderer.render(this.showGrid ? this.simulation.navMesh : null);
        this.drawRegions();
        this.drawObstacles();
        this.drawDebugSets();
        this.pathRenderer.render(this.simulation.world.agents);
        this.agentRenderer.render(this.simulation.world.agents);
        this.drawTarget();
    }

    reset(): void {
        configurePathfinding(this.simulation, { agentCount: this.agentCount });
        this.simulation.pathfindingAlgorithm = this.algorithm;
        this.repathAll();
    }

    setAlgorithm(algorithm: PathfindingAlgorithm): void {
        this.algorithm = algorithm;
        this.simulation.pathfindingAlgorithm = algorithm;
        this.repathAll();
    }

    private repathAll(): void {
        for (const agent of this.simulation.world.agents) {
            this.simulation.requestPath(agent);
        }
        this.recomputeDebug();
    }

    /**
     * Article section "Sometimes the agent got stuck before it even started moving": a click outside the
     * NavMesh doesn't just silently fail like SetDestination — it snaps to the nearest walkable
     * point within SNAP_RADIUS (NavMesh.SamplePosition), or leaves the target untouched if nothing
     * walkable is close enough.
     */
    private handleClick(point: Vec2): void {
        const navMesh = this.simulation.navMesh;
        if (!navMesh) return;

        const cell = worldToCell(navMesh, point);
        if (cell?.walkable) {
            this.targetStatus = "ok";
            this.simulation.setTarget(point);
        } else {
            const snapped = findNearestWalkable(navMesh, point, SNAP_RADIUS);
            if (!snapped) {
                this.targetStatus = "unreachable";
                return; // SetDestination would return false here — target stays where it was.
            }
            this.targetStatus = "snapped";
            this.lastSnapDistance = distance(point, snapped);
            this.simulation.setTarget(snapped);
        }

        this.repathAll();
    }

    private recomputeDebug(): void {
        const navMesh = this.simulation.navMesh;
        const regionGraph = this.simulation.regionGraph;
        if (!navMesh) return;

        const world = this.simulation.world;
        const start: Vec2 = world.agents[0]?.position ?? { x: world.width * 0.05, y: world.height / 2 };

        this.debugInfo = { openSet: [], closedSet: [], regionPath: [] };
        const t0 = performance.now();
        const path =
            this.algorithm === "hierarchical" && regionGraph
                ? findHierarchicalPath(navMesh, regionGraph, start, world.target.position, this.debugInfo)
                : findPath(navMesh, start, world.target.position, undefined, this.debugInfo);
        this.lastFindPathMs = performance.now() - t0;
        this.heroPathLength = path.length;
    }

    regionsInLastPath(): number {
        return this.debugInfo.regionPath.length;
    }

    private drawObstacles(): void {
        this.obstacleGraphics.clear();
        this.obstacleGraphics.fillStyle(OBSTACLE_COLOR, 1);
        for (const obstacle of this.simulation.world.obstacles) {
            this.obstacleGraphics.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
        }
    }

    private drawRegions(): void {
        this.regionGraphics.clear();
        const graph = this.simulation.regionGraph;
        const navMesh = this.simulation.navMesh;
        if (!this.showRegions || !graph || !navMesh) return;

        const regionPx = graph.regionSize * navMesh.cellSize;
        const world = this.simulation.world;

        this.regionGraphics.fillStyle(REGION_HIGHLIGHT_COLOR, 0.12);
        for (const regionId of this.debugInfo.regionPath) {
            const col = regionId % graph.regionCols;
            const row = Math.floor(regionId / graph.regionCols);
            this.regionGraphics.fillRect(col * regionPx, row * regionPx, regionPx, regionPx);
        }

        this.regionGraphics.lineStyle(1, REGION_LINE_COLOR, 0.6);
        for (let row = 0; row <= graph.regionRows; row++) {
            this.regionGraphics.lineBetween(0, row * regionPx, world.width, row * regionPx);
        }
        for (let col = 0; col <= graph.regionCols; col++) {
            this.regionGraphics.lineBetween(col * regionPx, 0, col * regionPx, world.height);
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
    heading.textContent = "A* / Hierarchical A*";
    root.appendChild(heading);

    const algoRow = document.createElement("div");
    algoRow.className = "control-row";
    const algoLabel = document.createElement("label");
    algoLabel.textContent = "Algorithm";
    const algoSelect = document.createElement("select");
    for (const [value, label] of [
        ["astar", "A*"],
        ["hierarchical", "Hierarchical A*"],
    ] as const) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        algoSelect.appendChild(option);
    }
    algoSelect.value = scene.algorithm;
    algoSelect.addEventListener("change", () => {
        scene.setAlgorithm(algoSelect.value as PathfindingAlgorithm);
        regionsRow.hidden = scene.algorithm !== "hierarchical";
    });
    algoRow.append(algoLabel, algoSelect);
    root.appendChild(algoRow);

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

    const regionsRow = document.createElement("div");
    regionsRow.className = "control-row";
    regionsRow.hidden = scene.algorithm !== "hierarchical";
    const regionsLabel = document.createElement("label");
    regionsLabel.textContent = "Show regions";
    const regionsCheckbox = document.createElement("input");
    regionsCheckbox.type = "checkbox";
    regionsCheckbox.checked = scene.showRegions;
    regionsCheckbox.addEventListener("change", () => (scene.showRegions = regionsCheckbox.checked));
    regionsRow.append(regionsLabel, regionsCheckbox);
    root.appendChild(regionsRow);

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
        ["regions", "Regions used"],
        ["target", "Last click"],
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
        'Клик — новая цель. Красный тон вокруг стен — недоступная из-за радиуса агента зона (NavMesh &ne; видимый пол). ' +
        'Кликнешь в стену — цель не пропадёт молча (как SetDestination), а притянется к ближайшей проходимой точке ' +
        '(NavMesh.SamplePosition), см. "Last click" ниже. Синий/серый — open/closed set последнего поиска. В Hierarchical A* жёлтым подсвечены регионы грубого пути. ' +
        'Два отдельных случая «NPC застрял» (мимо NavMesh и недостижимая, но валидная цель) разобраны подробнее в Target Snapping. ' +
        'Часть примеров к статье. ' +
        '<a href="../index.html" style="color:#4fc3f7">&larr; Все примеры</a> &middot; ' +
        '<a href="sandbox.html" style="color:#4fc3f7">Свободный sandbox</a> &middot; ' +
        '<a href="narrow-gate.html" style="color:#4fc3f7">Narrow Gate</a> &middot; ' +
        '<a href="effective-width.html" style="color:#4fc3f7">Effective Width</a> &middot; ' +
        '<a href="avoidance-priority.html" style="color:#4fc3f7">Avoidance Priority</a> &middot; ' +
        '<a href="priority-standoff.html" style="color:#4fc3f7">Priority Standoff</a> &middot; ' +
        '<a href="local-avoidance.html" style="color:#4fc3f7">Local Avoidance</a> &middot; ' +
        '<a href="flow-field.html" style="color:#4fc3f7">A* vs Flow Field</a> &middot; ' +
        '<a href="dynamic-obstacles.html" style="color:#4fc3f7">Dynamic Obstacles</a> &middot; ' +
        '<a href="link-cost.html" style="color:#4fc3f7">Link Cost Override</a> &middot; ' +
        '<a href="path-request-budget.html" style="color:#4fc3f7">Path Request Budget</a> &middot; ' +
        '<a href="target-snapping.html" style="color:#4fc3f7">Target Snapping</a> &middot; ' +
        '<a href="astar-scale.html" style="color:#4fc3f7">A* Cost at Scale</a> &middot; ' +
        '<a href="stale-path.html" style="color:#4fc3f7">Stale Path</a>';
    root.appendChild(hint);

    const tick = () => {
        cells.findPath.textContent = `${scene.lastFindPathMs.toFixed(3)} ms`;
        cells.waypoints.textContent = String(scene.heroPathLength);
        cells.regions.textContent = scene.algorithm === "hierarchical" ? String(scene.regionsInLastPath()) : "-";
        cells.target.textContent =
            scene.targetStatus === "ok"
                ? "OK (walkable)"
                : scene.targetStatus === "snapped"
                  ? `Snapped to nearest walkable (${scene.lastSnapDistance.toFixed(0)} px away)`
                  : "Unreachable — target unchanged (SetDestination-style false)";
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
