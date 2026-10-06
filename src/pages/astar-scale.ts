import Phaser from "phaser";
import type { World } from "@/simulation/World";
import type { NavMesh } from "@/navigation/NavMesh";
import type { Vec2 } from "@/simulation/Vec2";
import { findPath, DEFAULT_ASTAR_OPTIONS, type AStarDebugInfo } from "@/navigation/AStar";
import { worldToCell } from "@/navigation/NavMeshQuery";
import { NavMeshRenderer } from "@/rendering/NavMeshRenderer";
import { buildScaleWorld, scatterObstacles, buildScaleNavMesh } from "@/experiments/AStarScaleExperiment";

const OBSTACLE_COLOR = 0x3a4152;
const OPEN_COLOR = 0x4fc3f7;
const CLOSED_COLOR = 0x8b93a3;
const PATH_COLOR = 0x66bb6a;
const START_COLOR = 0x66bb6a;
const TARGET_COLOR = 0xef5350;
const MARGIN = 20;
const FRAME_BUDGET_MS = 1000 / 60;

class AStarScaleScene extends Phaser.Scene {
    world!: World;
    navMesh!: NavMesh;
    start: Vec2 = { x: 0, y: 0 };
    target: Vec2 = { x: 0, y: 0 };
    debugInfo: AStarDebugInfo = { openSet: [], closedSet: [] };
    path: Vec2[] = [];
    lastFindPathMs = 0;
    batchCount = 10;
    lastBatchMs: number | null = null;
    lastBatchCount = 0;

    private obstacleGraphics!: Phaser.GameObjects.Graphics;
    private navMeshRenderer!: NavMeshRenderer;
    private debugGraphics!: Phaser.GameObjects.Graphics;
    private pathGraphics!: Phaser.GameObjects.Graphics;
    private markerGraphics!: Phaser.GameObjects.Graphics;

    constructor() {
        super("astar-scale");
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);

        this.navMeshRenderer = new NavMeshRenderer(this);
        this.obstacleGraphics = this.add.graphics();
        this.debugGraphics = this.add.graphics();
        this.pathGraphics = this.add.graphics();
        this.markerGraphics = this.add.graphics();

        this.reroll();
    }

    update(): void {
        this.navMeshRenderer.render(this.navMesh);
        this.drawObstacles();
        this.drawDebugSets();
        this.drawPath();
        this.drawMarkers();
    }

    reroll(): void {
        this.world = buildScaleWorld();
        this.start = { x: MARGIN, y: MARGIN };
        this.target = { x: this.world.width - MARGIN, y: this.world.height - MARGIN };

        // A random scatter can occasionally seal off a start/target corner, or cut the map in
        // two — retry rather than show a misleading "touched 0 cells" for a query that never
        // had a chance.
        for (let attempt = 0; attempt < 20; attempt++) {
            scatterObstacles(this.world);
            this.navMesh = buildScaleNavMesh(this.world);
            const reachable =
                worldToCell(this.navMesh, this.start)?.walkable &&
                worldToCell(this.navMesh, this.target)?.walkable &&
                findPath(this.navMesh, this.start, this.target).length > 0;
            if (reachable) break;
        }

        this.lastBatchMs = null;
        this.runSingleQuery();
    }

    runSingleQuery(): void {
        this.debugInfo = { openSet: [], closedSet: [] };
        const t0 = performance.now();
        this.path = findPath(this.navMesh, this.start, this.target, DEFAULT_ASTAR_OPTIONS, this.debugInfo);
        this.lastFindPathMs = performance.now() - t0;
    }

    /** Fires `n` real findPath() calls back to back and times the whole batch — no extrapolation, no hardcoded numbers. */
    runBatch(n: number): void {
        const t0 = performance.now();
        for (let i = 0; i < n; i++) {
            findPath(this.navMesh, this.start, this.target);
        }
        this.lastBatchMs = performance.now() - t0;
        this.lastBatchCount = n;
    }

    totalCells(): number {
        return this.navMesh.cols * this.navMesh.rows;
    }

    /**
     * closedSet is one push per distinct cell, but openSet can push the same cell again each
     * time a cheaper route to it is found — dedupe by position so this never claims more
     * "touched" cells than the NavMesh actually has.
     */
    touchedCells(): number {
        const seen = new Set<string>();
        for (const p of this.debugInfo.closedSet) seen.add(`${p.x},${p.y}`);
        for (const p of this.debugInfo.openSet) seen.add(`${p.x},${p.y}`);
        return seen.size;
    }

    touchedPct(): number {
        return (this.touchedCells() / this.totalCells()) * 100;
    }

    private drawObstacles(): void {
        this.obstacleGraphics.clear();
        this.obstacleGraphics.fillStyle(OBSTACLE_COLOR, 1);
        for (const obstacle of this.world.obstacles) {
            this.obstacleGraphics.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
        }
    }

    private drawDebugSets(): void {
        this.debugGraphics.clear();
        const half = this.navMesh.cellSize * 0.5;

        this.debugGraphics.fillStyle(CLOSED_COLOR, 0.5);
        for (const p of this.debugInfo.closedSet) {
            this.debugGraphics.fillRect(p.x - half, p.y - half, half * 2, half * 2);
        }

        this.debugGraphics.fillStyle(OPEN_COLOR, 0.5);
        for (const p of this.debugInfo.openSet) {
            this.debugGraphics.fillRect(p.x - half, p.y - half, half * 2, half * 2);
        }
    }

    private drawPath(): void {
        this.pathGraphics.clear();
        if (this.path.length === 0) return;
        this.pathGraphics.lineStyle(2, PATH_COLOR, 0.9);
        this.pathGraphics.beginPath();
        this.pathGraphics.moveTo(this.start.x, this.start.y);
        for (const point of this.path) this.pathGraphics.lineTo(point.x, point.y);
        this.pathGraphics.strokePath();
    }

    private drawMarkers(): void {
        this.markerGraphics.clear();
        this.markerGraphics.fillStyle(START_COLOR, 1);
        this.markerGraphics.fillCircle(this.start.x, this.start.y, 6);
        this.markerGraphics.lineStyle(2, TARGET_COLOR, 1);
        this.markerGraphics.strokeCircle(this.target.x, this.target.y, 8);
    }
}

function buildControls(root: HTMLElement, scene: AStarScaleScene): void {
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "A* Cost at Scale";
    root.appendChild(heading);

    const buttonRow = document.createElement("div");
    buttonRow.className = "control-row";
    const rerollButton = document.createElement("button");
    rerollButton.textContent = "Re-roll obstacles";
    rerollButton.addEventListener("click", () => scene.reroll());
    buttonRow.append(rerollButton);
    root.appendChild(buttonRow);

    const table = document.createElement("table");
    table.className = "metrics-table";
    const rows: Array<[string, string]> = [
        ["cells", "NavMesh cells"],
        ["single", "Single findPath()"],
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

    const batchHeading = document.createElement("h2");
    batchHeading.textContent = "Concurrent requests";
    batchHeading.style.marginTop = "18px";
    root.appendChild(batchHeading);

    const batchRow = document.createElement("div");
    batchRow.className = "control-row";
    const batchLabel = document.createElement("label");
    batchLabel.textContent = "Requests";
    const batchInput = document.createElement("input");
    batchInput.type = "range";
    batchInput.min = "1";
    batchInput.max = "30";
    batchInput.step = "1";
    batchInput.value = String(scene.batchCount);
    const batchValue = document.createElement("span");
    batchValue.textContent = batchInput.value;
    batchInput.addEventListener("input", () => {
        scene.batchCount = Number(batchInput.value);
        batchValue.textContent = batchInput.value;
        estimateRow.textContent = estimateText();
    });
    batchRow.append(batchLabel, batchInput, batchValue);
    root.appendChild(batchRow);

    const estimateText = () => `~${(scene.batchCount * scene.lastFindPathMs).toFixed(0)} ms if run now (real per-query cost × N)`;
    const estimateRow = document.createElement("p");
    estimateRow.style.color = "#8b93a3";
    estimateRow.style.margin = "0 0 8px";
    estimateRow.textContent = estimateText();
    root.appendChild(estimateRow);

    const runRow = document.createElement("div");
    runRow.className = "control-row";
    const runButton = document.createElement("button");
    runButton.textContent = "Run N requests now";
    runButton.addEventListener("click", () => scene.runBatch(scene.batchCount));
    runRow.append(runButton);
    root.appendChild(runRow);

    const batchTable = document.createElement("table");
    batchTable.className = "metrics-table";
    const batchRows: Array<[string, string]> = [
        ["batch", "Batch real time"],
        ["budget", "Frame budget (16.6 ms)"],
    ];
    const batchCells: Record<string, HTMLTableCellElement> = {};
    for (const [key, label] of batchRows) {
        const tr = document.createElement("tr");
        const th = document.createElement("td");
        th.textContent = label;
        const td = document.createElement("td");
        td.textContent = "-";
        batchCells[key] = td;
        tr.append(th, td);
        batchTable.appendChild(tr);
    }
    root.appendChild(batchTable);

    const hint = document.createElement("p");
    hint.style.color = "#8b93a3";
    hint.innerHTML =
        'Синий/серый — open/closed set одного запроса из угла в угол: на карте с десятками тысяч ячеек он честно ' +
        'трогает заметную её часть (в статье — "больше трети"). "Run N requests now" не экстраполирует — реально ' +
        'вызывает findPath() N раз подряд и меряет настоящее время performance.now(), как если бы N агентов ' +
        'одновременно потребовали путь в один и тот же кадр. Requests специально ограничены тридцатью: честная ' +
        'цена одного запроса здесь — десятки миллисекунд (это игрушечный линейный open-list, а не бинарная куча из ' +
        'реального движка), так что даже скромное N уже кратно превышает бюджет кадра 16.6 мс (60 FPS) — отсюда и ' +
        'очередь запросов вместо синхронного залпа, см. Path Request Budget. Часть примеров к статье. ' +
        '<a href="../index.html" style="color:#4fc3f7">&larr; Все примеры</a> &middot; ' +
        '<a href="sandbox.html" style="color:#4fc3f7">Свободный sandbox</a> &middot; ' +
        '<a href="narrow-gate.html" style="color:#4fc3f7">Narrow Gate</a> &middot; ' +
        '<a href="effective-width.html" style="color:#4fc3f7">Effective Width</a> &middot; ' +
        '<a href="avoidance-priority.html" style="color:#4fc3f7">Avoidance Priority</a> &middot; ' +
        '<a href="priority-standoff.html" style="color:#4fc3f7">Priority Standoff</a> &middot; ' +
        '<a href="local-avoidance.html" style="color:#4fc3f7">Local Avoidance</a> &middot; ' +
        '<a href="pathfinding.html" style="color:#4fc3f7">A* Pathfinding</a> &middot; ' +
        '<a href="target-snapping.html" style="color:#4fc3f7">Target Snapping</a> &middot; ' +
        '<a href="flow-field.html" style="color:#4fc3f7">A* vs Flow Field</a> &middot; ' +
        '<a href="dynamic-obstacles.html" style="color:#4fc3f7">Dynamic Obstacles</a> &middot; ' +
        '<a href="link-cost.html" style="color:#4fc3f7">Link Cost Override</a> &middot; ' +
        '<a href="path-request-budget.html" style="color:#4fc3f7">Path Request Budget</a> &middot; ' +
        '<a href="stale-path.html" style="color:#4fc3f7">Stale Path</a>';
    root.appendChild(hint);

    const tick = () => {
        const total = scene.totalCells();
        cells.cells.textContent = `${scene.navMesh.cols} × ${scene.navMesh.rows} = ${total.toLocaleString("en-US")}`;
        cells.single.textContent =
            `${scene.lastFindPathMs.toFixed(3)} ms — touched ${scene.touchedCells().toLocaleString("en-US")} cells ` +
            `(${scene.touchedPct().toFixed(1)}%)`;
        estimateRow.textContent = estimateText();

        if (scene.lastBatchMs === null) {
            batchCells.batch.textContent = "-";
            batchCells.budget.textContent = "-";
        } else {
            const perRequest = scene.lastBatchMs / scene.lastBatchCount;
            batchCells.batch.textContent =
                `${scene.lastBatchMs.toFixed(1)} ms for ${scene.lastBatchCount} requests (${perRequest.toFixed(3)} ms/req)`;
            batchCells.budget.textContent = `${(scene.lastBatchMs / FRAME_BUDGET_MS).toFixed(1)}× over budget`;
        }

        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

const gameRoot = document.getElementById("game-root");
const controlRoot = document.getElementById("control-panel");

if (!gameRoot || !controlRoot) {
    throw new Error("astar-scale: expected #game-root and #control-panel in examples/astar-scale.html");
}

const scene = new AStarScaleScene();
const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: gameRoot,
    width: 900,
    height: 600,
    backgroundColor: "#14181f",
    scene: [scene],
    fps: { target: 60 },
});

game.events.once(Phaser.Core.Events.READY, () => buildControls(controlRoot, scene));
