import Phaser from "phaser";
import { Simulation } from "@/simulation/Simulation";
import { createWorld } from "@/simulation/World";
import { createTarget } from "@/simulation/Target";
import type { Obstacle } from "@/simulation/Obstacle";
import { buildNavMesh } from "@/navigation/NavMeshBuilder";
import { AgentRenderer } from "@/rendering/AgentRenderer";
import { PathRenderer } from "@/rendering/PathRenderer";
import { NavMeshRenderer } from "@/rendering/NavMeshRenderer";
import { configureDynamicObstacles, DEFAULT_DYNAMIC_OBSTACLE_OPTIONS } from "@/experiments/DynamicObstacleExperiment";

const WORLD_WIDTH = 900;
const WORLD_HEIGHT = 600;
const TARGET_COLOR = 0xef5350;
const MOVABLE_FILL = 0x3a4152;
const MOVABLE_STROKE = 0xffca28;

type RebuildMode = "continuous" | "on-release";

class DynamicObstacleScene extends Phaser.Scene {
    simulation!: Simulation;
    agentCount = DEFAULT_DYNAMIC_OBSTACLE_OPTIONS.agentCount;
    rebuildMode: RebuildMode = "continuous";
    showGrid = true;
    rebuildCount = 0;
    lastRebuildMs = 0;
    totalRebuildMs = 0;

    private agentRenderer!: AgentRenderer;
    private pathRenderer!: PathRenderer;
    private navMeshRenderer!: NavMeshRenderer;
    private targetGraphics!: Phaser.GameObjects.Graphics;
    private movableObstacle!: Obstacle;
    private movableRect!: Phaser.GameObjects.Rectangle;

    constructor() {
        super("dynamic-obstacles");
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);

        const world = createWorld(createTarget({ x: 0, y: 0 }), WORLD_WIDTH, WORLD_HEIGHT);
        this.simulation = new Simulation(world);

        this.navMeshRenderer = new NavMeshRenderer(this);
        this.pathRenderer = new PathRenderer(this);
        this.agentRenderer = new AgentRenderer(this);
        this.targetGraphics = this.add.graphics();

        this.reset();

        this.input.on(
            "pointerdown",
            (pointer: Phaser.Input.Pointer, currentlyOver: Phaser.GameObjects.GameObject[]) => {
                if (currentlyOver.length > 0) return; // let the draggable rect handle its own clicks
                this.simulation.setTarget({ x: pointer.worldX, y: pointer.worldY });
                this.rebuildNavigation();
            },
        );

        this.input.keyboard?.on("keydown-SPACE", () => this.simulation.togglePaused());
        this.input.keyboard?.on("keydown-R", () => this.reset());
    }

    update(_time: number, delta: number): void {
        this.simulation.update(delta);
        this.navMeshRenderer.render(this.showGrid ? this.simulation.navMesh : null);
        this.pathRenderer.render(this.simulation.world.agents);
        this.agentRenderer.render(this.simulation.world.agents);
        this.drawTarget();
    }

    reset(): void {
        this.movableRect?.destroy();
        this.rebuildCount = 0;
        this.lastRebuildMs = 0;
        this.totalRebuildMs = 0;

        this.movableObstacle = configureDynamicObstacles(this.simulation, { agentCount: this.agentCount });
        this.createMovableRect();
    }

    private createMovableRect(): void {
        const o = this.movableObstacle;
        const rect = this.add.rectangle(o.x + o.width / 2, o.y + o.height / 2, o.width, o.height, MOVABLE_FILL);
        rect.setStrokeStyle(2, MOVABLE_STROKE);
        rect.setInteractive({ draggable: true, useHandCursor: true });

        rect.on("drag", (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
            rect.x = dragX;
            rect.y = dragY;
            this.movableObstacle.x = dragX - o.width / 2;
            this.movableObstacle.y = dragY - o.height / 2;
            if (this.rebuildMode === "continuous") this.rebuildNavigation();
        });

        rect.on("dragend", () => {
            if (this.rebuildMode === "on-release") this.rebuildNavigation();
        });

        this.movableRect = rect;
    }

    /** Rebuilds the NavMesh grid and repaths every agent — the expensive operation the article warns about. */
    private rebuildNavigation(): void {
        const t0 = performance.now();
        const navMesh = buildNavMesh(this.simulation.world, DEFAULT_DYNAMIC_OBSTACLE_OPTIONS.cellSize);
        this.simulation.setNavMesh(navMesh);
        for (const agent of this.simulation.world.agents) {
            this.simulation.requestPath(agent);
        }
        const dt = performance.now() - t0;

        this.rebuildCount++;
        this.lastRebuildMs = dt;
        this.totalRebuildMs += dt;
    }

    private drawTarget(): void {
        const { x, y } = this.simulation.world.target.position;
        this.targetGraphics.clear();
        this.targetGraphics.lineStyle(2, TARGET_COLOR, 1);
        this.targetGraphics.strokeCircle(x, y, 10);
    }
}

function buildControls(root: HTMLElement, scene: DynamicObstacleScene): void {
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "Dynamic Obstacles";
    root.appendChild(heading);

    const modeRow = document.createElement("div");
    modeRow.className = "control-row";
    const modeLabel = document.createElement("label");
    modeLabel.textContent = "Rebuild";
    const modeSelect = document.createElement("select");
    for (const [value, label] of [
        ["continuous", "Every drag move"],
        ["on-release", "Only on release"],
    ] as const) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        modeSelect.appendChild(option);
    }
    modeSelect.value = scene.rebuildMode;
    modeSelect.addEventListener("change", () => (scene.rebuildMode = modeSelect.value as RebuildMode));
    modeRow.append(modeLabel, modeSelect);
    root.appendChild(modeRow);

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
        ["rebuilds", "NavMesh rebuilds"],
        ["last", "Last rebuild"],
        ["total", "Total rebuild time"],
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
        'Перетащи жёлтый квадрат. "Every drag move" честно перестраивает NavMesh на каждый кадр драга — дорого. ' +
        '"Only on release" двигает препятствие физически сразу (агенты и так его не пройдут — локальное столкновение), ' +
        'а путь/NavMesh пересчитывает только один раз, когда отпустишь. Часть примеров к статье. ' +
        '<a href="../index.html" style="color:#4fc3f7">Свободный sandbox</a> &middot; ' +
        '<a href="narrow-gate.html" style="color:#4fc3f7">Narrow Gate</a> &middot; ' +
        '<a href="avoidance-priority.html" style="color:#4fc3f7">Avoidance Priority</a> &middot; ' +
        '<a href="local-avoidance.html" style="color:#4fc3f7">Local Avoidance</a> &middot; ' +
        '<a href="pathfinding.html" style="color:#4fc3f7">A* Pathfinding</a> &middot; ' +
        '<a href="flow-field.html" style="color:#4fc3f7">A* vs Flow Field</a>';
    root.appendChild(hint);

    const tick = () => {
        cells.rebuilds.textContent = String(scene.rebuildCount);
        cells.last.textContent = `${scene.lastRebuildMs.toFixed(2)} ms`;
        cells.total.textContent = `${scene.totalRebuildMs.toFixed(1)} ms`;
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

const gameRoot = document.getElementById("game-root");
const controlRoot = document.getElementById("control-panel");

if (!gameRoot || !controlRoot) {
    throw new Error("dynamic-obstacles: expected #game-root and #control-panel in examples/dynamic-obstacles.html");
}

const scene = new DynamicObstacleScene();
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
