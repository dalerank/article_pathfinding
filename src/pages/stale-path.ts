import Phaser from "phaser";
import { Simulation } from "@/simulation/Simulation";
import { createWorld } from "@/simulation/World";
import { createTarget } from "@/simulation/Target";
import { AgentRenderer } from "@/rendering/AgentRenderer";
import { buildNavMesh } from "@/navigation/NavMeshBuilder";
import type { Agent } from "@/simulation/Agent";
import type { Obstacle } from "@/simulation/Obstacle";
import type { Vec2 } from "@/simulation/Vec2";
import { configureStalePath, DEFAULT_STALE_PATH_OPTIONS } from "@/experiments/StalePathExperiment";

const WORLD_WIDTH = 900;
const WORLD_HEIGHT = 500;
const CELL_SIZE = DEFAULT_STALE_PATH_OPTIONS.cellSize;
const OBSTACLE_COLOR = 0x3a4152;
const WALL_COLOR = 0xffa726;
const TARGET_COLOR = 0xef5350;
const HERO_COLOR = 0x4fc3f7;
const HERO_STALE_COLOR = 0xffa726;
const DECOY_COLOR = 0x5c6472;
const DECOY_REPATH_INTERVAL = 0.5;
const DECOY_REPATH_JITTER = 0.3;
const GAP_HEIGHT = 120;

class StalePathScene extends Phaser.Scene {
    simulation!: Simulation;
    decoyCount = DEFAULT_STALE_PATH_OPTIONS.decoyCount;
    maxPerFrame = 2;

    heroStale = false;
    repathDelayFrames: number | null = null;
    touchingWallFrames = 0;

    private heroId!: number;
    private frameCount = 0;
    private staleSinceFrame = 0;
    private heroOldPathRef: Vec2[] | null = null;
    private wallSegments: Obstacle[] = [];
    private nextRepathTime = new Map<number, number>();

    private agentRenderer!: AgentRenderer;
    private obstacleGraphics!: Phaser.GameObjects.Graphics;
    private targetGraphics!: Phaser.GameObjects.Graphics;

    constructor() {
        super("stale-path");
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);

        const world = createWorld(createTarget({ x: 0, y: 0 }), WORLD_WIDTH, WORLD_HEIGHT);
        this.simulation = new Simulation(world);

        this.obstacleGraphics = this.add.graphics();
        this.agentRenderer = new AgentRenderer(this);
        this.targetGraphics = this.add.graphics();

        this.reset();

        this.input.keyboard?.on("keydown-SPACE", () => this.simulation.togglePaused());
        this.input.keyboard?.on("keydown-R", () => this.reset());
    }

    update(_time: number, delta: number): void {
        this.frameCount++;
        this.simulation.maxPathRequestsPerFrame = this.maxPerFrame;
        this.simulation.update(delta);
        this.scheduleDecoyRepaths();
        this.trackHero();

        this.agentRenderer.render(this.simulation.world.agents, (agent) => {
            if (agent.id !== this.heroId) return DECOY_COLOR;
            return this.heroStale ? HERO_STALE_COLOR : HERO_COLOR;
        });
        this.drawObstacles();
        this.drawTarget();
    }

    reset(): void {
        this.nextRepathTime.clear();
        this.wallSegments = [];
        this.heroStale = false;
        this.repathDelayFrames = null;
        this.touchingWallFrames = 0;
        this.frameCount = 0;
        this.heroOldPathRef = null;

        configureStalePath(this.simulation, { decoyCount: this.decoyCount });
        this.heroId = this.simulation.world.agents[0].id;

        const now = this.simulation.getElapsedSeconds();
        for (const agent of this.simulation.world.agents) {
            if (agent.id === this.heroId) continue;
            this.nextRepathTime.set(agent.id, now + Math.random() * DECOY_REPATH_INTERVAL);
        }
    }

    hero(): Agent {
        return this.simulation.world.agents.find((a) => a.id === this.heroId)!;
    }

    queueLength(): number {
        return this.simulation.pendingPathRequests;
    }

    /** Drops a wall with one gap across the hero's current path and enqueues (not forces) its repath. */
    dropWall(): void {
        const world = this.simulation.world;
        const hero = this.hero();

        const wallX = Math.min(hero.position.x + 150, world.width - 60);
        const gapNearTop = hero.position.y > world.height / 2; // force a real detour, not a straight continuation
        const gapY = gapNearTop ? 20 : world.height - GAP_HEIGHT - 20;

        const top = this.simulation.addObstacle(wallX - 10, 0, 20, gapY);
        const bottom = this.simulation.addObstacle(wallX - 10, gapY + GAP_HEIGHT, 20, world.height - gapY - GAP_HEIGHT);
        this.wallSegments = [top, bottom];

        this.simulation.setNavMesh(buildNavMesh(world, CELL_SIZE));

        this.heroOldPathRef = hero.path;
        this.simulation.enqueuePathRequest(hero);
        this.heroStale = true;
        this.staleSinceFrame = this.frameCount;
        this.repathDelayFrames = null;
        this.touchingWallFrames = 0;
    }

    private trackHero(): void {
        if (!this.heroStale) return;
        const hero = this.hero();

        if (hero.path !== this.heroOldPathRef) {
            this.heroStale = false;
            this.repathDelayFrames = this.frameCount - this.staleSinceFrame;
            return;
        }

        const touching = this.wallSegments.some((wall) => circleRectDistance(hero.position, wall) <= hero.radius + 1);
        if (touching) this.touchingWallFrames++;
    }

    /** Mirrors Path Request Budget's scheduleRepaths, but the hero's repath is event-driven (dropWall), not periodic. */
    private scheduleDecoyRepaths(): void {
        const now = this.simulation.getElapsedSeconds();
        for (const agent of this.simulation.world.agents) {
            if (agent.id === this.heroId) continue;
            const due = this.nextRepathTime.get(agent.id) ?? 0;
            if (now < due) continue;

            this.simulation.enqueuePathRequest(agent);
            const jitter = Math.random() * DECOY_REPATH_JITTER;
            this.nextRepathTime.set(agent.id, now + DECOY_REPATH_INTERVAL + jitter);
        }
    }

    private drawObstacles(): void {
        this.obstacleGraphics.clear();
        for (const obstacle of this.simulation.world.obstacles) {
            const isWall = this.wallSegments.includes(obstacle);
            this.obstacleGraphics.fillStyle(isWall ? WALL_COLOR : OBSTACLE_COLOR, 1);
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

function circleRectDistance(pos: Vec2, rect: Obstacle): number {
    const closestX = Math.min(Math.max(pos.x, rect.x), rect.x + rect.width);
    const closestY = Math.min(Math.max(pos.y, rect.y), rect.y + rect.height);
    return Math.hypot(pos.x - closestX, pos.y - closestY);
}

function buildControls(root: HTMLElement, scene: StalePathScene): void {
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "Stale Path";
    root.appendChild(heading);

    const budgetRow = document.createElement("div");
    budgetRow.className = "control-row";
    const budgetLabel = document.createElement("label");
    budgetLabel.textContent = "Max requests/frame";
    const budgetSelect = document.createElement("select");
    for (const value of ["1", "2", "4", "8", "unlimited"]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        budgetSelect.appendChild(option);
    }
    budgetSelect.value = String(scene.maxPerFrame);
    budgetSelect.addEventListener("change", () => {
        scene.maxPerFrame = budgetSelect.value === "unlimited" ? Infinity : Number(budgetSelect.value);
    });
    budgetRow.append(budgetLabel, budgetSelect);
    root.appendChild(budgetRow);

    const decoyRow = document.createElement("div");
    decoyRow.className = "control-row";
    const decoyLabel = document.createElement("label");
    decoyLabel.textContent = "Decoy agents";
    const decoyInput = document.createElement("input");
    decoyInput.type = "range";
    decoyInput.min = "0";
    decoyInput.max = "150";
    decoyInput.step = "10";
    decoyInput.value = String(scene.decoyCount);
    const decoyValue = document.createElement("span");
    decoyValue.textContent = decoyInput.value;
    decoyInput.addEventListener("input", () => {
        scene.decoyCount = Number(decoyInput.value);
        decoyValue.textContent = decoyInput.value;
        scene.reset();
    });
    decoyRow.append(decoyLabel, decoyInput, decoyValue);
    root.appendChild(decoyRow);

    const buttonRow = document.createElement("div");
    buttonRow.className = "control-row";
    const dropButton = document.createElement("button");
    dropButton.textContent = "Drop wall across hero's path";
    dropButton.addEventListener("click", () => scene.dropWall());
    buttonRow.append(dropButton);
    root.appendChild(buttonRow);

    const buttonRow2 = document.createElement("div");
    buttonRow2.className = "control-row";
    const pauseButton = document.createElement("button");
    pauseButton.textContent = "Pause / Resume (Space)";
    pauseButton.addEventListener("click", () => scene.simulation.togglePaused());
    const resetButton = document.createElement("button");
    resetButton.textContent = "Reset (R)";
    resetButton.addEventListener("click", () => scene.reset());
    buttonRow2.append(pauseButton, resetButton);
    root.appendChild(buttonRow2);

    const table = document.createElement("table");
    table.className = "metrics-table";
    const rows: Array<[string, string]> = [
        ["queue", "Queue length (shared)"],
        ["status", "Hero status"],
        ["delay", "Repath delay (last)"],
        ["touching", "Walked into new wall"],
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
        'Герой (голубой) идёт направо вместе с толпой декоративных агентов, которые раз в полсекунды тоже просят путь ' +
        'и съедают общий бюджет. Жми "Drop wall" — новая стена (оранжевая) встаёт прямо на пути героя, его repath ставится ' +
        'в ту же очередь, что и у всех остальных. При маленьком Max requests/frame герой не фризит — он просто идёт в ' +
        'новую стену и стоит там несколько кадров (оранжевый), пока очередь не дойдёт до его запроса. Поставь "unlimited" — ' +
        'и та же стена чинится мгновенно, без бампа, но тогда вернулся риск большого фриза из A* Cost at Scale. ' +
        'Часть примеров к статье. ' +
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
        '<a href="astar-scale.html" style="color:#4fc3f7">A* Cost at Scale</a>';
    root.appendChild(hint);

    const tick = () => {
        cells.queue.textContent = String(scene.queueLength());
        cells.status.textContent = scene.heroStale ? "STALE — repath queued, walking old path" : "OK";
        cells.delay.textContent =
            scene.repathDelayFrames !== null
                ? `${scene.repathDelayFrames} frames`
                : scene.heroStale
                  ? "pending…"
                  : "-";
        cells.touching.textContent = scene.touchingWallFrames > 0 ? `${scene.touchingWallFrames} frames` : "-";
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

const gameRoot = document.getElementById("game-root");
const controlRoot = document.getElementById("control-panel");

if (!gameRoot || !controlRoot) {
    throw new Error("stale-path: expected #game-root and #control-panel in examples/stale-path.html");
}

const scene = new StalePathScene();
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
