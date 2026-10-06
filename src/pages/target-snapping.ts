import Phaser from "phaser";
import { Simulation } from "@/simulation/Simulation";
import { createWorld } from "@/simulation/World";
import { createTarget } from "@/simulation/Target";
import { AgentRenderer } from "@/rendering/AgentRenderer";
import { PathRenderer } from "@/rendering/PathRenderer";
import { NavMeshRenderer } from "@/rendering/NavMeshRenderer";
import { findPath, DEFAULT_ASTAR_OPTIONS } from "@/navigation/AStar";
import { findNearestWalkable, worldToCell } from "@/navigation/NavMeshQuery";
import { distance, type Vec2 } from "@/simulation/Vec2";
import { configureTargetSnapping, scatterSpawn } from "@/experiments/TargetSnappingExperiment";

/** NavMesh.SamplePosition's search radius in the article. */
const SNAP_RADIUS = 80;
const SCATTER_COUNT = 30;

const WORLD_WIDTH = 900;
const WORLD_HEIGHT = 500;
const OBSTACLE_COLOR = 0x3a4152;
const CLICK_OK_COLOR = 0x66bb6a;
const CLICK_BAD_COLOR = 0xef5350;
const LOST_AGENT_COLOR = 0xef5350;
const SETTLED_AGENT_COLOR = 0x8b93a3;

type Mode = "naive" | "snap" | "partial";

class TargetSnappingScene extends Phaser.Scene {
    simulation!: Simulation;
    mode: Mode = "naive";
    resultText = "Кликните где-нибудь на карте.";
    scatterSnap = false;
    lastScatterCount = 0;

    private heroId!: number;
    private lastClickRaw: Vec2 | null = null;
    private lastClickOnMesh = true;
    private lastSnappedTo: Vec2 | null = null;

    private agentRenderer!: AgentRenderer;
    private pathRenderer!: PathRenderer;
    private navMeshRenderer!: NavMeshRenderer;
    private obstacleGraphics!: Phaser.GameObjects.Graphics;
    private clickGraphics!: Phaser.GameObjects.Graphics;

    constructor() {
        super("target-snapping");
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);

        const world = createWorld(createTarget({ x: 0, y: 0 }), WORLD_WIDTH, WORLD_HEIGHT);
        this.simulation = new Simulation(world);

        this.navMeshRenderer = new NavMeshRenderer(this);
        this.obstacleGraphics = this.add.graphics();
        this.pathRenderer = new PathRenderer(this);
        this.agentRenderer = new AgentRenderer(this);
        this.clickGraphics = this.add.graphics();

        this.reset();

        this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
            this.handleClick({ x: pointer.worldX, y: pointer.worldY });
        });

        this.input.keyboard?.on("keydown-SPACE", () => this.simulation.togglePaused());
        this.input.keyboard?.on("keydown-R", () => this.reset());
    }

    update(_time: number, delta: number): void {
        this.simulation.update(delta);

        this.navMeshRenderer.render(this.simulation.navMesh);
        this.drawObstacles();
        this.pathRenderer.render(this.simulation.world.agents);
        this.agentRenderer.render(this.simulation.world.agents, (agent) => {
            if (agent.id === this.heroId) return 0x4fc3f7;
            const cell = this.simulation.navMesh ? worldToCell(this.simulation.navMesh, agent.position) : null;
            return cell?.walkable ? SETTLED_AGENT_COLOR : LOST_AGENT_COLOR;
        });
        this.drawClickMarkers();
    }

    reset(): void {
        configureTargetSnapping(this.simulation);
        this.heroId = this.simulation.world.agents[0].id;
        this.lastClickRaw = null;
        this.lastSnappedTo = null;
        this.resultText = "Кликните где-нибудь на карте.";
        this.lastScatterCount = 0;
    }

    scatter(): void {
        // Scattered props only — remove any previous batch, keep the hero.
        this.simulation.world.agents = this.simulation.world.agents.filter((a) => a.id === this.heroId);
        scatterSpawn(this.simulation, SCATTER_COUNT, this.scatterSnap);
        this.lastScatterCount = SCATTER_COUNT;
    }

    lostAtSpawnCount(): number {
        const navMesh = this.simulation.navMesh;
        if (!navMesh) return 0;
        return this.simulation.world.agents.filter((agent) => {
            if (agent.id === this.heroId) return false;
            return !worldToCell(navMesh, agent.position)?.walkable;
        }).length;
    }

    private handleClick(point: Vec2): void {
        const navMesh = this.simulation.navMesh;
        const hero = this.simulation.world.agents.find((a) => a.id === this.heroId);
        if (!navMesh || !hero) return;

        this.lastClickRaw = point;
        this.lastSnappedTo = null;
        const clickOnMesh = !!worldToCell(navMesh, point)?.walkable;
        this.lastClickOnMesh = clickOnMesh;

        let destination = point;
        let snappedDistance: number | null = null;

        if (this.mode === "snap" && !clickOnMesh) {
            const snapped = findNearestWalkable(navMesh, point, SNAP_RADIUS);
            if (snapped) {
                destination = snapped;
                snappedDistance = distance(point, snapped);
                this.lastSnappedTo = snapped;
            }
        }

        const destOnMesh = !!worldToCell(navMesh, destination)?.walkable;
        hero.destination = { ...destination };

        if (!destOnMesh) {
            // Mirrors the real NavMeshAgent: SetDestination(target) returns false and
            // leaves the previous path untouched — most code never checks that return value.
            hero.path = [];
            hero.pathIndex = 0;
            this.resultText =
                "Клик вне NavMesh (в стене). SetDestination(target) → false — путь ни разу не считался, " +
                "агент просто стоит. Профайлер тут бесполезен: искать нечего, поиск не запускался.";
            return;
        }

        const path = findPath(navMesh, hero.position, destination, {
            ...DEFAULT_ASTAR_OPTIONS,
            partial: this.mode === "partial",
        });
        hero.path = path;
        hero.pathIndex = 0;

        const snapNote = snappedDistance !== null ? ` (снято на NavMesh, ${snappedDistance.toFixed(0)} px от клика)` : "";

        if (path.length === 0) {
            this.resultText =
                `Цель на NavMesh${snapNote}, но недостижима отсюда (запечатанная комната без двери). ` +
                "findPath() честно отработал и вернул пустой путь — агент снова стоит, но на этот раз поиск " +
                "реально запускался. Снаружи тот же «застрял», внутри — другая история.";
        } else {
            const reachedExact = distance(path[path.length - 1], destination) < 1;
            this.resultText = reachedExact
                ? `OK${snapNote} — полный путь, ${path.length} точек.`
                : `Partial path${snapNote}: путь есть, но заканчивается в ${path.length} точке(ах) от старта — ` +
                  "у ближайшей достижимой стены запечатанной комнаты, дальше идти некуда.";
        }
    }

    private drawObstacles(): void {
        this.obstacleGraphics.clear();
        this.obstacleGraphics.fillStyle(OBSTACLE_COLOR, 1);
        for (const obstacle of this.simulation.world.obstacles) {
            this.obstacleGraphics.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
        }
    }

    private drawClickMarkers(): void {
        this.clickGraphics.clear();
        if (!this.lastClickRaw) return;

        this.clickGraphics.lineStyle(2, this.lastClickOnMesh ? CLICK_OK_COLOR : CLICK_BAD_COLOR, 1);
        this.clickGraphics.strokeCircle(this.lastClickRaw.x, this.lastClickRaw.y, 8);

        if (this.lastSnappedTo) {
            this.clickGraphics.lineStyle(1, CLICK_OK_COLOR, 0.8);
            this.clickGraphics.lineBetween(
                this.lastClickRaw.x,
                this.lastClickRaw.y,
                this.lastSnappedTo.x,
                this.lastSnappedTo.y,
            );
            this.clickGraphics.fillStyle(CLICK_OK_COLOR, 1);
            this.clickGraphics.fillCircle(this.lastSnappedTo.x, this.lastSnappedTo.y, 4);
        }
    }
}

function buildControls(root: HTMLElement, scene: TargetSnappingScene): void {
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "Target Snapping";
    root.appendChild(heading);

    const modeRow = document.createElement("div");
    modeRow.className = "control-row";
    const modeLabel = document.createElement("label");
    modeLabel.textContent = "Mode";
    const modeSelect = document.createElement("select");
    for (const [value, label] of [
        ["naive", "Naive (SetDestination, false ignored)"],
        ["snap", "Snap target (SamplePosition)"],
        ["partial", "Partial path (PathPartial)"],
    ] as const) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        modeSelect.appendChild(option);
    }
    modeSelect.value = scene.mode;
    modeSelect.addEventListener("change", () => {
        scene.mode = modeSelect.value as Mode;
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

    const resultBox = document.createElement("p");
    resultBox.style.color = "#e6e8eb";
    resultBox.style.background = "#1b1f27";
    resultBox.style.border = "1px solid #2a2f3a";
    resultBox.style.borderRadius = "6px";
    resultBox.style.padding = "8px 10px";
    resultBox.style.fontSize = "13px";
    root.appendChild(resultBox);

    const spawnHeading = document.createElement("h2");
    spawnHeading.textContent = "Spawn points";
    spawnHeading.style.marginTop = "18px";
    root.appendChild(spawnHeading);

    const snapSpawnRow = document.createElement("div");
    snapSpawnRow.className = "control-row";
    const snapSpawnLabel = document.createElement("label");
    snapSpawnLabel.textContent = "Snap spawn to NavMesh";
    const snapSpawnCheckbox = document.createElement("input");
    snapSpawnCheckbox.type = "checkbox";
    snapSpawnCheckbox.checked = scene.scatterSnap;
    snapSpawnCheckbox.addEventListener("change", () => (scene.scatterSnap = snapSpawnCheckbox.checked));
    snapSpawnRow.append(snapSpawnLabel, snapSpawnCheckbox);
    root.appendChild(snapSpawnRow);

    const scatterRow = document.createElement("div");
    scatterRow.className = "control-row";
    const scatterButton = document.createElement("button");
    scatterButton.textContent = `Scatter ${SCATTER_COUNT} agents`;
    scatterButton.addEventListener("click", () => scene.scatter());
    scatterRow.append(scatterButton);
    root.appendChild(scatterRow);

    const table = document.createElement("table");
    table.className = "metrics-table";
    const rows: Array<[string, string]> = [["lost", "Lost at spawn"]];
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
        'Кликните в открытом полу, в стене запечатанной комнаты (справа сверху — без двери) или внутри неё. ' +
        'Naive: цель ставится без проверки, как игнорирование false от SetDestination. Snap: клик вне NavMesh ' +
        'притягивается к ближайшей проходимой точке (SamplePosition) — чинит промах мимо сетки, но не чинит ' +
        'недостижимую комнату. Partial: если полного пути нет, возвращается путь до ближайшей достижимой точки ' +
        '(как Unity NavMeshPathStatus.PathPartial) — чинит комнату, но не чинит клик мимо сетки. Внизу — тот же ' +
        'эффект для точки появления: агент, заспавненный внутри препятствия, потерян с первого кадра (красный), ' +
        'и никакой pathfinding это уже не исправит. Часть примеров к статье. ' +
        '<a href="../index.html" style="color:#4fc3f7">&larr; Все примеры</a> &middot; ' +
        '<a href="sandbox.html" style="color:#4fc3f7">Свободный sandbox</a> &middot; ' +
        '<a href="narrow-gate.html" style="color:#4fc3f7">Narrow Gate</a> &middot; ' +
        '<a href="effective-width.html" style="color:#4fc3f7">Effective Width</a> &middot; ' +
        '<a href="avoidance-priority.html" style="color:#4fc3f7">Avoidance Priority</a> &middot; ' +
        '<a href="local-avoidance.html" style="color:#4fc3f7">Local Avoidance</a> &middot; ' +
        '<a href="pathfinding.html" style="color:#4fc3f7">A* Pathfinding</a> &middot; ' +
        '<a href="flow-field.html" style="color:#4fc3f7">A* vs Flow Field</a> &middot; ' +
        '<a href="dynamic-obstacles.html" style="color:#4fc3f7">Dynamic Obstacles</a> &middot; ' +
        '<a href="link-cost.html" style="color:#4fc3f7">Link Cost Override</a> &middot; ' +
        '<a href="path-request-budget.html" style="color:#4fc3f7">Path Request Budget</a>';
    root.appendChild(hint);

    const tick = () => {
        resultBox.textContent = scene.resultText;
        const total = scene.lastScatterCount;
        cells.lost.textContent = total > 0 ? `${scene.lostAtSpawnCount()} / ${total}` : "-";
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

const gameRoot = document.getElementById("game-root");
const controlRoot = document.getElementById("control-panel");

if (!gameRoot || !controlRoot) {
    throw new Error("target-snapping: expected #game-root and #control-panel in examples/target-snapping.html");
}

const scene = new TargetSnappingScene();
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
