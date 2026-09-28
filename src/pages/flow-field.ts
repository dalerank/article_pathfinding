import Phaser from "phaser";
import { Simulation, type PathfindingAlgorithm } from "@/simulation/Simulation";
import { createWorld } from "@/simulation/World";
import { createTarget } from "@/simulation/Target";
import { AgentRenderer } from "@/rendering/AgentRenderer";
import { PathRenderer } from "@/rendering/PathRenderer";
import { NavMeshRenderer } from "@/rendering/NavMeshRenderer";
import { FlowFieldRenderer } from "@/rendering/FlowFieldRenderer";
import { configureFlowField, DEFAULT_FLOW_FIELD_OPTIONS } from "@/experiments/FlowFieldExperiment";
import { buildFlowField } from "@/navigation/FlowField";
import { findPath } from "@/navigation/AStar";

const WORLD_WIDTH = 900;
const WORLD_HEIGHT = 600;
const OBSTACLE_COLOR = 0x3a4152;
const TARGET_COLOR = 0xef5350;

class FlowFieldScene extends Phaser.Scene {
    simulation!: Simulation;
    agentCount = DEFAULT_FLOW_FIELD_OPTIONS.agentCount;
    algorithm: PathfindingAlgorithm = DEFAULT_FLOW_FIELD_OPTIONS.algorithm;
    pillar1Size = DEFAULT_FLOW_FIELD_OPTIONS.pillar1Size;
    pillar2Size = DEFAULT_FLOW_FIELD_OPTIONS.pillar2Size;
    showField = true;
    showGrid = false;
    lastBenchmarkMs = 0;
    benchmarkLabel = "";
    fieldRebuilds = 0;

    private agentRenderer!: AgentRenderer;
    private pathRenderer!: PathRenderer;
    private navMeshRenderer!: NavMeshRenderer;
    private flowFieldRenderer!: FlowFieldRenderer;
    private obstacleGraphics!: Phaser.GameObjects.Graphics;
    private targetGraphics!: Phaser.GameObjects.Graphics;

    constructor() {
        super("flow-field");
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);

        const world = createWorld(createTarget({ x: 0, y: 0 }), WORLD_WIDTH, WORLD_HEIGHT);
        this.simulation = new Simulation(world);

        this.navMeshRenderer = new NavMeshRenderer(this);
        this.obstacleGraphics = this.add.graphics();
        this.flowFieldRenderer = new FlowFieldRenderer(this);
        this.pathRenderer = new PathRenderer(this);
        this.agentRenderer = new AgentRenderer(this);
        this.targetGraphics = this.add.graphics();

        this.reset();

        this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
            this.simulation.setTarget({ x: pointer.worldX, y: pointer.worldY });
            this.recomputeBenchmark();
        });

        this.input.keyboard?.on("keydown-SPACE", () => this.simulation.togglePaused());
        this.input.keyboard?.on("keydown-R", () => this.reset());
    }

    update(_time: number, delta: number): void {
        this.simulation.update(delta);

        this.navMeshRenderer.render(this.showGrid ? this.simulation.navMesh : null);
        this.drawObstacles();
        this.flowFieldRenderer.render(this.showField ? this.simulation.flowField : null);
        this.pathRenderer.render(this.simulation.world.agents);
        this.agentRenderer.render(this.simulation.world.agents);
        this.drawTarget();
    }

    reset(): void {
        configureFlowField(this.simulation, {
            agentCount: this.agentCount,
            algorithm: this.algorithm,
            pillar1Size: this.pillar1Size,
            pillar2Size: this.pillar2Size,
        });
        this.recomputeBenchmark();
    }

    setAlgorithm(algorithm: PathfindingAlgorithm): void {
        this.algorithm = algorithm;
        this.reset();
    }

    /** Independent timing probe: what would it cost to path every agent right now, with the current algorithm. */
    private recomputeBenchmark(): void {
        const navMesh = this.simulation.navMesh;
        const world = this.simulation.world;
        if (!navMesh) return;

        if (this.algorithm === "flow-field") {
            const t0 = performance.now();
            buildFlowField(navMesh, world.target.position);
            this.lastBenchmarkMs = performance.now() - t0;
            this.benchmarkLabel = "buildFlowField() once";
            this.fieldRebuilds++;
        } else {
            const t0 = performance.now();
            for (const agent of world.agents) {
                findPath(navMesh, agent.position, world.target.position);
            }
            this.lastBenchmarkMs = performance.now() - t0;
            this.benchmarkLabel = `findPath() x ${world.agents.length}`;
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

function buildControls(root: HTMLElement, scene: FlowFieldScene): void {
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "A* vs Flow Field";
    root.appendChild(heading);

    const algoRow = document.createElement("div");
    algoRow.className = "control-row";
    const algoLabel = document.createElement("label");
    algoLabel.textContent = "Algorithm";
    const algoSelect = document.createElement("select");
    for (const [value, label] of [
        ["flow-field", "Flow Field"],
        ["astar", "A* (per agent)"],
    ] as const) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        algoSelect.appendChild(option);
    }
    algoSelect.value = scene.algorithm;
    algoSelect.addEventListener("change", () => scene.setAlgorithm(algoSelect.value as PathfindingAlgorithm));
    algoRow.append(algoLabel, algoSelect);
    root.appendChild(algoRow);

    const fieldRow = document.createElement("div");
    fieldRow.className = "control-row";
    const fieldLabel = document.createElement("label");
    fieldLabel.textContent = "Show field";
    const fieldCheckbox = document.createElement("input");
    fieldCheckbox.type = "checkbox";
    fieldCheckbox.checked = scene.showField;
    fieldCheckbox.addEventListener("change", () => (scene.showField = fieldCheckbox.checked));
    fieldRow.append(fieldLabel, fieldCheckbox);
    root.appendChild(fieldRow);

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

    const pillar1Row = document.createElement("div");
    pillar1Row.className = "control-row";
    const pillar1Label = document.createElement("label");
    pillar1Label.textContent = "Pillar 1 size";
    const pillar1Input = document.createElement("input");
    pillar1Input.type = "range";
    pillar1Input.min = "10";
    pillar1Input.max = "300";
    pillar1Input.step = "10";
    pillar1Input.value = String(scene.pillar1Size);
    const pillar1Value = document.createElement("span");
    pillar1Value.textContent = `${pillar1Input.value} px`;
    pillar1Input.addEventListener("input", () => {
        scene.pillar1Size = Number(pillar1Input.value);
        pillar1Value.textContent = `${pillar1Input.value} px`;
        scene.reset();
    });
    pillar1Row.append(pillar1Label, pillar1Input, pillar1Value);
    root.appendChild(pillar1Row);

    const pillar2Row = document.createElement("div");
    pillar2Row.className = "control-row";
    const pillar2Label = document.createElement("label");
    pillar2Label.textContent = "Pillar 2 size";
    const pillar2Input = document.createElement("input");
    pillar2Input.type = "range";
    pillar2Input.min = "10";
    pillar2Input.max = "300";
    pillar2Input.step = "10";
    pillar2Input.value = String(scene.pillar2Size);
    const pillar2Value = document.createElement("span");
    pillar2Value.textContent = `${pillar2Input.value} px`;
    pillar2Input.addEventListener("input", () => {
        scene.pillar2Size = Number(pillar2Input.value);
        pillar2Value.textContent = `${pillar2Input.value} px`;
        scene.reset();
    });
    pillar2Row.append(pillar2Label, pillar2Input, pillar2Value);
    root.appendChild(pillar2Row);

    const agentsRow = document.createElement("div");
    agentsRow.className = "control-row";
    const agentsLabel = document.createElement("label");
    agentsLabel.textContent = "Agents";
    const agentsInput = document.createElement("input");
    agentsInput.type = "range";
    agentsInput.min = "20";
    agentsInput.max = "400";
    agentsInput.step = "20";
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
        ["benchmark", "Benchmark"],
        ["rebuilds", "Field rebuilds"],
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
        'Клик — новая цель. Flow Field: одно общее поле направлений читают все агенты сразу. A*: каждый агент ищет ' +
        'свой путь отдельно — сравни Benchmark при 200+ агентах. Часть примеров к статье. ' +
        '<a href="../index.html" style="color:#4fc3f7">Свободный sandbox</a> &middot; ' +
        '<a href="narrow-gate.html" style="color:#4fc3f7">Narrow Gate</a> &middot; ' +
        '<a href="avoidance-priority.html" style="color:#4fc3f7">Avoidance Priority</a> &middot; ' +
        '<a href="local-avoidance.html" style="color:#4fc3f7">Local Avoidance</a> &middot; ' +
        '<a href="pathfinding.html" style="color:#4fc3f7">A* Pathfinding</a> &middot; ' +
        '<a href="dynamic-obstacles.html" style="color:#4fc3f7">Dynamic Obstacles</a>';
    root.appendChild(hint);

    const tick = () => {
        cells.benchmark.textContent = `${scene.benchmarkLabel}: ${scene.lastBenchmarkMs.toFixed(2)} ms`;
        cells.rebuilds.textContent = String(scene.fieldRebuilds);
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

const gameRoot = document.getElementById("game-root");
const controlRoot = document.getElementById("control-panel");

if (!gameRoot || !controlRoot) {
    throw new Error("flow-field: expected #game-root and #control-panel in examples/flow-field.html");
}

const scene = new FlowFieldScene();
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
