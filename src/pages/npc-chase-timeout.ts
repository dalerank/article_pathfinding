import Phaser from "phaser";
import type { Vec2 } from "@/simulation/Vec2";
import { distance as vecDistance } from "@/simulation/Vec2";
import { segmentIntersectsRect, type AxisAlignedRect } from "@/netcode/raycast";
import { nextChaseState, type ChaseState } from "@/npc/chaseFsm";
import { buildHowTo, buildLegend, buildNarrative } from "@/rendering/ExplainerPanel";

const WORLD_WIDTH = 900;
const WORLD_HEIGHT = 600;
const HOME_POS: Vec2 = { x: 450, y: 110 };
const WALL: AxisAlignedRect = { x: 380, y: 260, width: 220, height: 40 };
const PLAYER_SPEED = 220;
const CHASE_SPEED = 190;
const SEARCH_SPEED = 160;
const PATROL_SPEED = 140;
const ARRIVE_EPS = 6;

const PATROL_COLOR = 0x8b93a3;
const CHASE_COLOR = 0xef5350;
const SEARCH_COLOR = 0xffca28;
const PLAYER_COLOR = 0x4fc3f7;
const WALL_COLOR = 0x3a4152;
const PERCEPTION_COLOR = 0x6fd48a;
const LAST_KNOWN_COLOR = 0xba68c8;

const STATE_COLOR: Record<ChaseState, number> = { patrol: PATROL_COLOR, chase: CHASE_COLOR, search: SEARCH_COLOR };
const STATE_LABEL_RU: Record<ChaseState, string> = { patrol: "Patrol", chase: "Chase", search: "Search" };

function moveToward(pos: Vec2, target: Vec2, speed: number, dt: number): Vec2 {
    const dx = target.x - pos.x;
    const dy = target.y - pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= ARRIVE_EPS) return { ...target };
    const step = Math.min(dist, speed * dt);
    return { x: pos.x + (dx / dist) * step, y: pos.y + (dy / dist) * step };
}

class ChaseTimeoutScene extends Phaser.Scene {
    giveUpAfterSec = 5;
    neverGivesUp = false;
    perceptionRadius = 150;
    paused = false;

    chaseState: ChaseState = "patrol";
    timeInStateSec = 0;
    totalChaseTimeSec = 0;
    escapes = 0;
    reacquisitions = 0;
    narrativeText = "Кликни по арене, чтобы задать точку, куда идёт игрок.";

    private npcPos: Vec2 = { ...HOME_POS };
    private playerPos: Vec2 = { x: 450, y: 480 };
    private playerTarget: Vec2 = { ...this.playerPos };
    private lastKnownPos: Vec2 | null = null;

    private arenaGraphics!: Phaser.GameObjects.Graphics;
    private actorGraphics!: Phaser.GameObjects.Graphics;

    constructor() {
        super("npc-chase-timeout");
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);
        this.arenaGraphics = this.add.graphics();
        this.actorGraphics = this.add.graphics();
        this.drawArena();

        this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
            this.playerTarget = { x: Phaser.Math.Clamp(pointer.x, 10, WORLD_WIDTH - 10), y: Phaser.Math.Clamp(pointer.y, 10, WORLD_HEIGHT - 10) };
        });
        this.input.keyboard?.on("keydown-SPACE", () => this.togglePaused());
        this.input.keyboard?.on("keydown-R", () => this.reset());
    }

    update(_time: number, deltaMs: number): void {
        if (this.paused) {
            this.render();
            return;
        }
        const dt = deltaMs / 1000;

        this.playerPos = moveToward(this.playerPos, this.playerTarget, PLAYER_SPEED, dt);

        const playerVisible =
            vecDistance(this.npcPos, this.playerPos) <= this.perceptionRadius && !segmentIntersectsRect(this.npcPos, this.playerPos, WALL);

        const giveUpAfterSec = this.neverGivesUp ? Infinity : this.giveUpAfterSec;
        const prevState = this.chaseState;
        const nextState = nextChaseState({ state: this.chaseState, playerVisible, timeInStateSec: this.timeInStateSec, giveUpAfterSec });

        if (nextState !== prevState) {
            if (prevState === "search" && nextState === "patrol") {
                this.escapes += 1;
                this.narrativeText = "NPC потерял игрока и честно сдался — Search &rarr; Patrol по таймеру.";
            } else if (prevState === "search" && nextState === "chase") {
                this.reacquisitions += 1;
                this.narrativeText = "NPC заметил игрока снова во время поиска — Search &rarr; Chase.";
            } else if (nextState === "chase") {
                this.narrativeText = "Контакт! Patrol &rarr; Chase.";
            } else if (nextState === "search") {
                this.narrativeText = "Потерял из виду — Chase &rarr; Search, запомнил последнюю позицию.";
            }
            this.timeInStateSec = 0;
        } else {
            this.timeInStateSec += dt;
        }
        this.chaseState = nextState;

        if (playerVisible) this.lastKnownPos = { ...this.playerPos };

        if (this.chaseState === "chase") {
            this.npcPos = moveToward(this.npcPos, this.playerPos, CHASE_SPEED, dt);
            this.totalChaseTimeSec += dt;
        } else if (this.chaseState === "search" && this.lastKnownPos) {
            this.npcPos = moveToward(this.npcPos, this.lastKnownPos, SEARCH_SPEED, dt);
        } else if (this.chaseState === "patrol") {
            this.npcPos = moveToward(this.npcPos, HOME_POS, PATROL_SPEED, dt);
        }

        this.render();
    }

    reset(): void {
        this.chaseState = "patrol";
        this.timeInStateSec = 0;
        this.totalChaseTimeSec = 0;
        this.escapes = 0;
        this.reacquisitions = 0;
        this.npcPos = { ...HOME_POS };
        this.playerPos = { x: 450, y: 480 };
        this.playerTarget = { ...this.playerPos };
        this.lastKnownPos = null;
        this.narrativeText = "Кликни по арене, чтобы задать точку, куда идёт игрок.";
    }

    togglePaused(): void {
        this.paused = !this.paused;
    }

    private drawArena(): void {
        this.arenaGraphics.clear();
        this.arenaGraphics.fillStyle(0x1b1f27, 1);
        this.arenaGraphics.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
        this.arenaGraphics.fillStyle(WALL_COLOR, 1);
        this.arenaGraphics.fillRect(WALL.x, WALL.y, WALL.width, WALL.height);
        this.arenaGraphics.lineStyle(1.5, 0x8b93a3, 0.6);
        this.arenaGraphics.strokeCircle(HOME_POS.x, HOME_POS.y, 10);
        this.arenaGraphics.lineBetween(HOME_POS.x - 14, HOME_POS.y - 14, HOME_POS.x + 14, HOME_POS.y + 14);
        this.arenaGraphics.lineBetween(HOME_POS.x - 14, HOME_POS.y + 14, HOME_POS.x + 14, HOME_POS.y - 14);
    }

    private render(): void {
        this.actorGraphics.clear();

        this.actorGraphics.lineStyle(1.5, PERCEPTION_COLOR, 0.3);
        this.actorGraphics.strokeCircle(this.npcPos.x, this.npcPos.y, this.perceptionRadius);

        if (this.chaseState === "search" && this.lastKnownPos) {
            this.actorGraphics.lineStyle(2, LAST_KNOWN_COLOR, 0.8);
            this.actorGraphics.strokeCircle(this.lastKnownPos.x, this.lastKnownPos.y, 12);
        }

        this.actorGraphics.fillStyle(PLAYER_COLOR, 1);
        this.actorGraphics.fillCircle(this.playerPos.x, this.playerPos.y, 10);

        this.actorGraphics.fillStyle(STATE_COLOR[this.chaseState], 1);
        this.actorGraphics.fillCircle(this.npcPos.x, this.npcPos.y, 12);
    }
}

function buildControls(root: HTMLElement, scene: ChaseTimeoutScene): void {
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "Chase Timeout";
    root.appendChild(heading);

    buildHowTo(
        root,
        "<b>Как пользоваться:</b> кликай по арене, чтобы водить игрока (синий). NPC гонится, пока видит тебя в " +
            "радиусе обзора и по прямой (серая стена блокирует обзор, но не движение). Спрячься за стену и беги — " +
            "включи «Никогда не сдаётся» и попробуй то же самое: NPC будет искать вечно, и тебе достаточно просто " +
            "кружить за углом.",
    );
    buildLegend(root, [
        { color: "#8b93a3", label: "Patrol" },
        { color: "#ef5350", label: "Chase" },
        { color: "#ffca28", label: "Search" },
        { color: "#4fc3f7", label: "игрок" },
        { color: "#6fd48a", label: "радиус обзора", shape: "ring" },
        { color: "#ba68c8", label: "последняя известная позиция", shape: "ring" },
    ]);
    const setNarrative = buildNarrative(root, scene.narrativeText);

    const giveUpRow = document.createElement("div");
    giveUpRow.className = "control-row";
    const giveUpLabel = document.createElement("label");
    giveUpLabel.textContent = "Таймаут поиска (giveUpAfterSec)";
    const giveUpInput = document.createElement("input");
    giveUpInput.type = "range";
    giveUpInput.min = "1";
    giveUpInput.max = "30";
    giveUpInput.step = "1";
    giveUpInput.value = String(scene.giveUpAfterSec);
    const giveUpValue = document.createElement("span");
    giveUpValue.textContent = `${scene.giveUpAfterSec} с`;
    giveUpInput.addEventListener("input", () => {
        scene.giveUpAfterSec = Number(giveUpInput.value);
        giveUpValue.textContent = `${scene.giveUpAfterSec} с`;
    });
    giveUpRow.append(giveUpLabel, giveUpInput, giveUpValue);
    root.appendChild(giveUpRow);

    const neverRow = document.createElement("div");
    neverRow.className = "control-row";
    const neverLabel = document.createElement("label");
    neverLabel.textContent = "Никогда не сдаётся («умный» режим)";
    const neverInput = document.createElement("input");
    neverInput.type = "checkbox";
    neverInput.checked = scene.neverGivesUp;
    neverInput.addEventListener("change", () => {
        scene.neverGivesUp = neverInput.checked;
        giveUpInput.disabled = neverInput.checked;
    });
    neverRow.append(neverLabel, neverInput);
    root.appendChild(neverRow);

    const radiusRow = document.createElement("div");
    radiusRow.className = "control-row";
    const radiusLabel = document.createElement("label");
    radiusLabel.textContent = "Радиус обзора";
    const radiusInput = document.createElement("input");
    radiusInput.type = "range";
    radiusInput.min = "60";
    radiusInput.max = "280";
    radiusInput.step = "10";
    radiusInput.value = String(scene.perceptionRadius);
    const radiusValue = document.createElement("span");
    radiusValue.textContent = `${scene.perceptionRadius}px`;
    radiusInput.addEventListener("input", () => {
        scene.perceptionRadius = Number(radiusInput.value);
        radiusValue.textContent = `${scene.perceptionRadius}px`;
    });
    radiusRow.append(radiusLabel, radiusInput, radiusValue);
    root.appendChild(radiusRow);

    const buttonRow = document.createElement("div");
    buttonRow.className = "control-row";
    const pauseButton = document.createElement("button");
    pauseButton.textContent = "Пауза (Space)";
    pauseButton.addEventListener("click", () => scene.togglePaused());
    const resetButton = document.createElement("button");
    resetButton.textContent = "Reset (R)";
    resetButton.addEventListener("click", () => scene.reset());
    buttonRow.append(pauseButton, resetButton);
    root.appendChild(buttonRow);

    const table = document.createElement("table");
    table.className = "metrics-table";
    const rows: Array<[string, string]> = [
        ["state", "Текущее состояние"],
        ["chaseTime", "Суммарное время в Chase"],
        ["escapes", "Успешных побегов (Search → Patrol)"],
        ["reacquisitions", "Повторных контактов (Search → Chase)"],
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
        "Часть примеров к статье dont_make_npc_smarter. " +
        '<a href="../index.html" style="color:#4fc3f7">&larr; Все примеры</a> &middot; ' +
        '<a href="npc-reward-hacking.html" style="color:#4fc3f7">Reward Hacking</a> &middot; ' +
        '<a href="npc-fsm-vs-blackbox.html" style="color:#4fc3f7">FSM vs Black Box</a> &middot; ' +
        '<a href="npc-imperfection.html" style="color:#4fc3f7">Deliberate Imperfection</a>';
    root.appendChild(hint);

    const tick = () => {
        cells.state.textContent = STATE_LABEL_RU[scene.chaseState];
        cells.state.style.color = `#${STATE_COLOR[scene.chaseState].toString(16).padStart(6, "0")}`;
        cells.chaseTime.textContent = `${scene.totalChaseTimeSec.toFixed(1)} с`;
        cells.escapes.textContent = String(scene.escapes);
        cells.reacquisitions.textContent = String(scene.reacquisitions);
        setNarrative(scene.narrativeText);
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

const gameRoot = document.getElementById("game-root");
const controlRoot = document.getElementById("control-panel");

if (!gameRoot || !controlRoot) {
    throw new Error("npc-chase-timeout: expected #game-root and #control-panel in examples/npc-chase-timeout.html");
}

const scene = new ChaseTimeoutScene();
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
