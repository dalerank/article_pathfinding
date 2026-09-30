import Phaser from "phaser";
import type { Vec2 } from "@/simulation/Vec2";
import { raycastHitsCircle } from "@/netcode/raycast";
import { ScrollingGraph, buildGraphRow } from "@/rendering/ScrollingGraph";
import { buildHowTo, buildLegend } from "@/rendering/ExplainerPanel";

const WORLD_WIDTH = 900;
const WORLD_HEIGHT = 600;
const SHOOTER_POS: Vec2 = { x: 450, y: 560 };
const PLAYER_RADIUS = 10;
const CAPSULES_PER_PLAYER = 18;
const CAPSULE_SPREAD = 8;
const CAPSULE_RADIUS = 4;
const BROAD_PHASE_RADIUS = 40;
const MEASURE_REPEATS = 200;
const GRAPH_SAMPLES = 100;

const PLAYER_COLOR = 0x5c6470;
const CANDIDATE_COLOR = 0x4fc3f7;
const HIT_COLOR = 0x6fd48a;
const RAY_COLOR = 0xffca28;

interface Player {
    id: number;
    position: Vec2;
    /** Fixed offsets simulating 18 hitbox capsules per character (shooting.txt "А зачем перематывать всех?"). */
    capsuleOffsets: Vec2[];
}

interface ShotStats {
    candidateCount: number;
    naiveMicros: number;
    filteredMicros: number;
    hitCount: number;
}

function makeCapsuleOffsets(): Vec2[] {
    const offsets: Vec2[] = [];
    for (let i = 0; i < CAPSULES_PER_PLAYER; i++) {
        const angle = (i / CAPSULES_PER_PLAYER) * Math.PI * 2;
        offsets.push({ x: Math.cos(angle) * CAPSULE_SPREAD * 0.3, y: Math.sin(angle) * CAPSULE_SPREAD });
    }
    return offsets;
}

function checkPlayerCapsules(player: Player, origin: Vec2, aim: Vec2): boolean {
    let hit = false;
    for (const offset of player.capsuleOffsets) {
        const capsuleCenter: Vec2 = { x: player.position.x + offset.x, y: player.position.y + offset.y };
        if (raycastHitsCircle(origin, aim, capsuleCenter, CAPSULE_RADIUS)) hit = true;
    }
    return hit;
}

class SpatialFilterScene extends Phaser.Scene {
    playerCount = 32;
    spatialFilterOn = true;

    players: Player[] = [];
    lastCandidateIds = new Set<number>();
    lastHitIds = new Set<number>();
    lastAim: Vec2 = { x: SHOOTER_POS.x, y: 0 };
    lastStats: ShotStats | null = null;
    naiveGraph: ScrollingGraph | null = null;
    filteredGraph: ScrollingGraph | null = null;

    private arenaGraphics!: Phaser.GameObjects.Graphics;
    private playerGraphics!: Phaser.GameObjects.Graphics;
    private rayGraphics!: Phaser.GameObjects.Graphics;

    constructor() {
        super("shooting-spatial-filter");
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);

        this.arenaGraphics = this.add.graphics();
        this.playerGraphics = this.add.graphics();
        this.rayGraphics = this.add.graphics();

        this.drawArena();
        this.spawnPlayers();

        this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => this.fireAt({ x: pointer.x, y: pointer.y }));
        this.input.keyboard?.on("keydown-R", () => this.spawnPlayers());

        this.render();
    }

    spawnPlayers(): void {
        this.players = [];
        for (let i = 0; i < this.playerCount; i++) {
            const position: Vec2 = {
                x: Phaser.Math.Between(40, WORLD_WIDTH - 40),
                y: Phaser.Math.Between(40, WORLD_HEIGHT - 140),
            };
            this.players.push({ id: i, position, capsuleOffsets: makeCapsuleOffsets() });
        }
        this.lastCandidateIds.clear();
        this.lastHitIds.clear();
        this.lastStats = null;
        this.render();
    }

    setPlayerCount(count: number): void {
        this.playerCount = count;
        this.spawnPlayers();
    }

    private fireAt(aim: Vec2): void {
        this.lastAim = aim;
        const origin = SHOOTER_POS;

        const candidates = this.players.filter((player) => raycastHitsCircle(origin, aim, player.position, BROAD_PHASE_RADIUS));

        const naiveStart = performance.now();
        for (let r = 0; r < MEASURE_REPEATS; r++) {
            for (const player of this.players) checkPlayerCapsules(player, origin, aim);
        }
        const naiveMicros = ((performance.now() - naiveStart) * 1000) / MEASURE_REPEATS;

        const filteredStart = performance.now();
        for (let r = 0; r < MEASURE_REPEATS; r++) {
            for (const player of candidates) checkPlayerCapsules(player, origin, aim);
        }
        const filteredMicros = ((performance.now() - filteredStart) * 1000) / MEASURE_REPEATS;

        this.lastCandidateIds = new Set(candidates.map((p) => p.id));
        const checkedPool = this.spatialFilterOn ? candidates : this.players;
        this.lastHitIds = new Set(checkedPool.filter((p) => checkPlayerCapsules(p, origin, aim)).map((p) => p.id));
        this.lastStats = {
            candidateCount: candidates.length,
            naiveMicros,
            filteredMicros,
            hitCount: this.lastHitIds.size,
        };

        this.naiveGraph?.push(naiveMicros, 200);
        this.filteredGraph?.push(filteredMicros, 200);

        this.render();
    }

    private drawArena(): void {
        this.arenaGraphics.clear();
        this.arenaGraphics.fillStyle(0x1b1f27, 1);
        this.arenaGraphics.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
        this.arenaGraphics.fillStyle(0xffca28, 1);
        this.arenaGraphics.fillTriangle(
            SHOOTER_POS.x - 10,
            SHOOTER_POS.y + 14,
            SHOOTER_POS.x + 10,
            SHOOTER_POS.y + 14,
            SHOOTER_POS.x,
            SHOOTER_POS.y - 6,
        );
    }

    private render(): void {
        this.playerGraphics.clear();
        for (const player of this.players) {
            const isHit = this.lastHitIds.has(player.id);
            const isCandidate = this.lastCandidateIds.has(player.id);
            const color = isHit ? HIT_COLOR : isCandidate ? CANDIDATE_COLOR : PLAYER_COLOR;
            this.playerGraphics.fillStyle(color, 1);
            this.playerGraphics.fillCircle(player.position.x, player.position.y, PLAYER_RADIUS);
            if (isCandidate) {
                this.playerGraphics.lineStyle(1, CANDIDATE_COLOR, 0.5);
                this.playerGraphics.strokeCircle(player.position.x, player.position.y, BROAD_PHASE_RADIUS);
            }
        }

        this.rayGraphics.clear();
        this.rayGraphics.lineStyle(2, RAY_COLOR, 0.8);
        const dx = this.lastAim.x - SHOOTER_POS.x;
        const dy = this.lastAim.y - SHOOTER_POS.y;
        const len = Math.hypot(dx, dy) || 1;
        const scale = 2000 / len;
        this.rayGraphics.lineBetween(SHOOTER_POS.x, SHOOTER_POS.y, SHOOTER_POS.x + dx * scale, SHOOTER_POS.y + dy * scale);
    }
}

function buildControls(root: HTMLElement, scene: SpatialFilterScene): void {
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "Spatial Filter";
    root.appendChild(heading);

    buildHowTo(
        root,
        "<b>Как пользоваться:</b> кликай в любую точку поля — это выстрел, от жёлтого треугольника (шутер) полетит луч. " +
            "Сравни числа внизу с включённым и выключенным «Spatial filter».",
    );
    buildLegend(root, [
        { color: "#5c6470", label: "игрок вне зоны луча" },
        { color: "#4fc3f7", label: "прошёл дешёвую проверку (кандидат)" },
        { color: "#6fd48a", label: "реальное попадание" },
        { color: "#ffca28", label: "луч выстрела", shape: "line" },
    ]);

    const filterRow = document.createElement("div");
    filterRow.className = "control-row";
    const filterLabel = document.createElement("label");
    filterLabel.textContent = "Spatial filter";
    const filterInput = document.createElement("input");
    filterInput.type = "checkbox";
    filterInput.checked = scene.spatialFilterOn;
    filterInput.addEventListener("change", () => {
        scene.spatialFilterOn = filterInput.checked;
    });
    filterRow.append(filterLabel, filterInput);
    root.appendChild(filterRow);

    const countRow = document.createElement("div");
    countRow.className = "control-row";
    const countLabel = document.createElement("label");
    countLabel.textContent = "Игроков";
    const countInput = document.createElement("input");
    countInput.type = "range";
    countInput.min = "4";
    countInput.max = "64";
    countInput.step = "4";
    countInput.value = String(scene.playerCount);
    const countValue = document.createElement("span");
    countValue.textContent = String(scene.playerCount);
    countInput.addEventListener("input", () => {
        countValue.textContent = countInput.value;
    });
    countInput.addEventListener("change", () => {
        scene.setPlayerCount(Number(countInput.value));
    });
    countRow.append(countLabel, countInput, countValue);
    root.appendChild(countRow);

    const buttonRow = document.createElement("div");
    buttonRow.className = "control-row";
    const resetButton = document.createElement("button");
    resetButton.textContent = "Новая расстановка (R)";
    resetButton.addEventListener("click", () => scene.spawnPlayers());
    buttonRow.appendChild(resetButton);
    root.appendChild(buttonRow);

    const table = document.createElement("table");
    table.className = "metrics-table";
    const rows: Array<[string, string]> = [
        ["candidates", "Кандидатов после фильтра"],
        ["naive", "Naive: все игроки"],
        ["filtered", "Filtered: после фильтра"],
        ["speedup", "Ускорение"],
        ["hits", "Попаданий в этот выстрел"],
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

    root.appendChild(document.createElement("br"));
    scene.naiveGraph = new ScrollingGraph(
        buildGraphRow(root, "Naive: проверка всех игроков, мкс/выстрел", "#ef5350", GRAPH_SAMPLES),
        GRAPH_SAMPLES,
        "#ef5350",
    );
    scene.filteredGraph = new ScrollingGraph(
        buildGraphRow(root, "Filtered: только кандидаты, мкс/выстрел", "#4fc3f7", GRAPH_SAMPLES),
        GRAPH_SAMPLES,
        "#4fc3f7",
    );

    const hint = document.createElement("p");
    hint.style.color = "#8b93a3";
    hint.innerHTML =
        "Клик по полю — выстрел (жёлтый луч). Каждого из N игроков нужно было бы отмотать и проверить по 18 " +
        "hitbox-капсул — дёшево при 32 игроках, но растёт линейно. Голубой бокс вокруг игрока — он прошёл дешёвый " +
        "broad-phase (просто «луч вообще рядом?») и только для него реально гоняется дорогая проверка капсул. Числа " +
        "внизу — честно измеренные performance.now(), а не выдуманные. Часть примеров к статье про lag compensation. " +
        '<a href="../index.html" style="color:#4fc3f7">&larr; Все примеры</a> &middot; ' +
        '<a href="shooting-max-rewind.html" style="color:#4fc3f7">Max Rewind Window</a> &middot; ' +
        '<a href="shooting-hitbox-order.html" style="color:#4fc3f7">Hitbox vs Animation Order</a> &middot; ' +
        '<a href="shooting-trust-but-verify.html" style="color:#4fc3f7">Trust But Verify</a> &middot; ' +
        '<a href="shooting-already-dead.html" style="color:#4fc3f7">Already Dead</a> &middot; ' +
        '<a href="shooting-rollback-vs-lagcomp.html" style="color:#4fc3f7">Rollback vs Lag Compensation</a>';
    root.appendChild(hint);

    const tick = () => {
        const stats = scene.lastStats;
        cells.candidates.textContent = stats ? `${stats.candidateCount} / ${scene.playerCount}` : "-";
        cells.naive.textContent = stats ? `${stats.naiveMicros.toFixed(1)} мкс` : "-";
        cells.filtered.textContent = stats ? `${stats.filteredMicros.toFixed(1)} мкс` : "-";
        cells.speedup.textContent = stats && stats.filteredMicros > 0 ? `${(stats.naiveMicros / stats.filteredMicros).toFixed(1)}x` : "-";
        cells.hits.textContent = stats ? String(stats.hitCount) : "-";
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

const gameRoot = document.getElementById("game-root");
const controlRoot = document.getElementById("control-panel");

if (!gameRoot || !controlRoot) {
    throw new Error("shooting-spatial-filter: expected #game-root and #control-panel in examples/shooting-spatial-filter.html");
}

const scene = new SpatialFilterScene();
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
