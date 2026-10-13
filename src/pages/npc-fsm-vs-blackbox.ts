import Phaser from "phaser";
import type { Vec2 } from "@/simulation/Vec2";
import { distance as vecDistance } from "@/simulation/Vec2";
import { segmentIntersectsRect, type AxisAlignedRect } from "@/netcode/raycast";
import { nextChaseState, type ChaseState } from "@/npc/chaseFsm";
import { buildHowTo, buildLegend, buildNarrative } from "@/rendering/ExplainerPanel";

const PANEL_WIDTH = 420;
const PANEL_HEIGHT = 480;
const PANEL_GAP = 60;
const PANEL_TOP = 40;
const WORLD_WIDTH = PANEL_WIDTH * 2 + PANEL_GAP;
const WORLD_HEIGHT = PANEL_TOP + PANEL_HEIGHT + 20;

const LEFT_ORIGIN: Vec2 = { x: 0, y: PANEL_TOP };
const RIGHT_ORIGIN: Vec2 = { x: PANEL_WIDTH + PANEL_GAP, y: PANEL_TOP };

const POST: Vec2 = { x: 210, y: 420 };
const WALL: AxisAlignedRect = { x: 140, y: 220, width: 140, height: 30 };
const TOTAL_DURATION = 20;
const SIM_DT = 0.02;
const STEP_SEC = 0.5;

const STATE_COLOR: Record<ChaseState, number> = { patrol: 0x8b93a3, chase: 0xef5350, search: 0xffca28 };
const STATE_LABEL_RU: Record<ChaseState, string> = { patrol: "Patrol", chase: "Chase", search: "Search" };
const BLACKBOX_COLOR = 0x5c6370;
const INTRUDER_COLOR = 0x4fc3f7;
const WALL_COLOR = 0x3a4152;

const GRAPH_BOX_W = 90;
const GRAPH_BOX_H = 30;
const GRAPH_BOX_GAP = 20;
const GRAPH_BOX_Y = LEFT_ORIGIN.y + 14;
const GRAPH_BOX_START_X = LEFT_ORIGIN.x + (PANEL_WIDTH - (GRAPH_BOX_W * 3 + GRAPH_BOX_GAP * 2)) / 2;
const GRAPH_BOX_POS: Record<ChaseState, Vec2> = {
    patrol: { x: GRAPH_BOX_START_X, y: GRAPH_BOX_Y },
    chase: { x: GRAPH_BOX_START_X + GRAPH_BOX_W + GRAPH_BOX_GAP, y: GRAPH_BOX_Y },
    search: { x: GRAPH_BOX_START_X + (GRAPH_BOX_W + GRAPH_BOX_GAP) * 2, y: GRAPH_BOX_Y },
};

const KEYFRAMES: Array<{ t: number; pos: Vec2 }> = [
    { t: 0, pos: { x: 40, y: 460 } },
    { t: 3, pos: { x: 210, y: 330 } },
    { t: 6, pos: { x: 210, y: 180 } },
    { t: 9, pos: { x: 210, y: 180 } },
    { t: 14, pos: { x: 230, y: 340 } },
    { t: 17, pos: { x: 40, y: 460 } },
    { t: 20, pos: { x: 40, y: 460 } },
];

function intruderPositionAt(t: number): Vec2 {
    const time = ((t % TOTAL_DURATION) + TOTAL_DURATION) % TOTAL_DURATION;
    for (let i = 0; i < KEYFRAMES.length - 1; i++) {
        const a = KEYFRAMES[i];
        const b = KEYFRAMES[i + 1];
        if (time >= a.t && time <= b.t) {
            const f = (time - a.t) / (b.t - a.t || 1);
            return { x: a.pos.x + (b.pos.x - a.pos.x) * f, y: a.pos.y + (b.pos.y - a.pos.y) * f };
        }
    }
    return KEYFRAMES[KEYFRAMES.length - 1].pos;
}

function reasonFor(prev: ChaseState, next: ChaseState): string {
    if (prev === next) return "";
    if (next === "chase") return prev === "search" ? "снова видно нарушителя — Search &rarr; Chase" : "нарушитель в радиусе и на виду — Patrol &rarr; Chase";
    if (next === "search") return "потерял из виду (вне радиуса или за стеной) — Chase &rarr; Search";
    return "не нашёл за giveUpAfterSec — Search &rarr; Patrol";
}

interface TimelineEntry {
    state: ChaseState;
    reason: string;
}

function buildTimeline(giveUpAfterSec: number, perceptionRadius: number): TimelineEntry[] {
    const entries: TimelineEntry[] = [];
    let state: ChaseState = "patrol";
    let timeInState = 0;
    let lastReason = "Стоит на посту, никого не видно.";
    const steps = Math.round(TOTAL_DURATION / SIM_DT) + 1;
    for (let i = 0; i < steps; i++) {
        const t = i * SIM_DT;
        const intruderPos = intruderPositionAt(t);
        const visible = vecDistance(POST, intruderPos) <= perceptionRadius && !segmentIntersectsRect(POST, intruderPos, WALL);
        const next = nextChaseState({ state, playerVisible: visible, timeInStateSec: timeInState, giveUpAfterSec });
        if (next !== state) {
            lastReason = reasonFor(state, next);
            timeInState = 0;
        } else {
            timeInState += SIM_DT;
        }
        state = next;
        entries.push({ state, reason: lastReason });
    }
    return entries;
}

class FsmVsBlackBoxScene extends Phaser.Scene {
    giveUpAfterSec = 7;
    neverGivesUp = false;
    perceptionRadius = 140;
    playing = true;
    timeSec = 0;

    private timeline: TimelineEntry[] = buildTimeline(this.giveUpAfterSec, this.perceptionRadius);

    private arenaGraphics!: Phaser.GameObjects.Graphics;
    private actorGraphics!: Phaser.GameObjects.Graphics;
    private graphGraphics!: Phaser.GameObjects.Graphics;
    private reasonText!: Phaser.GameObjects.Text;
    private graphLabels: Record<ChaseState, Phaser.GameObjects.Text> = {} as Record<ChaseState, Phaser.GameObjects.Text>;

    constructor() {
        super("npc-fsm-vs-blackbox");
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);
        this.arenaGraphics = this.add.graphics();
        this.graphGraphics = this.add.graphics();
        this.actorGraphics = this.add.graphics();
        this.reasonText = this.add.text(LEFT_ORIGIN.x + 10, 8, "", { fontSize: "13px", color: "#e6e8eb" });
        this.add.text(RIGHT_ORIGIN.x + 10, 8, "чёрный ящик: видно только действие", { fontSize: "13px", color: "#8b93a3" });
        for (const state of ["patrol", "chase", "search"] as const) {
            const pos = GRAPH_BOX_POS[state];
            this.graphLabels[state] = this.add
                .text(pos.x + GRAPH_BOX_W / 2, pos.y + GRAPH_BOX_H / 2, STATE_LABEL_RU[state], { fontSize: "12px", color: "#e6e8eb" })
                .setOrigin(0.5);
        }
        this.drawArenas();
    }

    update(_time: number, deltaMs: number): void {
        if (this.playing) this.advance(deltaMs / 1000);
        this.render();
    }

    rebuildTimeline(): void {
        const giveUpAfterSec = this.neverGivesUp ? Infinity : this.giveUpAfterSec;
        this.timeline = buildTimeline(giveUpAfterSec, this.perceptionRadius);
    }

    advance(dt: number): void {
        this.timeSec = (this.timeSec + dt) % TOTAL_DURATION;
    }

    step(): void {
        this.playing = false;
        this.timeSec = (this.timeSec + STEP_SEC) % TOTAL_DURATION;
    }

    reset(): void {
        this.timeSec = 0;
        this.playing = true;
    }

    togglePlaying(): void {
        this.playing = !this.playing;
    }

    currentEntry(): TimelineEntry {
        const index = Math.min(this.timeline.length - 1, Math.round(this.timeSec / SIM_DT));
        return this.timeline[index];
    }

    private drawArenas(): void {
        this.arenaGraphics.clear();
        for (const origin of [LEFT_ORIGIN, RIGHT_ORIGIN]) {
            this.arenaGraphics.fillStyle(0x1b1f27, 1);
            this.arenaGraphics.fillRect(origin.x, origin.y, PANEL_WIDTH, PANEL_HEIGHT);
            this.arenaGraphics.lineStyle(1, 0x2a2f3a, 1);
            this.arenaGraphics.strokeRect(origin.x, origin.y, PANEL_WIDTH, PANEL_HEIGHT);
            this.arenaGraphics.fillStyle(WALL_COLOR, 1);
            this.arenaGraphics.fillRect(origin.x + WALL.x, origin.y + WALL.y, WALL.width, WALL.height);
        }
    }

    private drawGraph(entry: TimelineEntry): void {
        this.graphGraphics.clear();
        const boxW = GRAPH_BOX_W;
        const boxH = GRAPH_BOX_H;
        const positions = GRAPH_BOX_POS;

        this.graphGraphics.lineStyle(1.5, 0x4a5262, 0.8);
        this.graphGraphics.lineBetween(positions.patrol.x + boxW, positions.patrol.y + boxH / 2, positions.chase.x, positions.chase.y + boxH / 2);
        this.graphGraphics.lineBetween(positions.chase.x + boxW, positions.chase.y + boxH / 2, positions.search.x, positions.search.y + boxH / 2);
        this.graphGraphics.lineBetween(positions.search.x, positions.search.y + boxH / 2 + 8, positions.chase.x + boxW, positions.chase.y + boxH / 2 + 8);
        this.graphGraphics.lineBetween(positions.search.x + boxW / 2, positions.search.y + boxH, positions.search.x + boxW / 2, positions.search.y + boxH + 18);
        this.graphGraphics.lineBetween(positions.search.x + boxW / 2, positions.search.y + boxH + 18, positions.patrol.x + boxW / 2, positions.patrol.y + boxH + 18);
        this.graphGraphics.lineBetween(positions.patrol.x + boxW / 2, positions.patrol.y + boxH + 18, positions.patrol.x + boxW / 2, positions.patrol.y + boxH);

        for (const state of ["patrol", "chase", "search"] as const) {
            const pos = positions[state];
            const active = state === entry.state;
            this.graphGraphics.fillStyle(active ? STATE_COLOR[state] : 0x242934, 1);
            this.graphGraphics.fillRoundedRect(pos.x, pos.y, boxW, boxH, 5);
            this.graphGraphics.lineStyle(active ? 2 : 1, active ? 0xffffff : 0x3a4152, active ? 0.9 : 0.6);
            this.graphGraphics.strokeRoundedRect(pos.x, pos.y, boxW, boxH, 5);
            this.graphLabels[state].setColor(active ? "#14181f" : "#8b93a3");
        }
    }

    private render(): void {
        const entry = this.currentEntry();
        const intruderPos = intruderPositionAt(this.timeSec);

        this.drawGraph(entry);
        this.reasonText.setText([STATE_LABEL_RU[entry.state], entry.reason.replace(/&rarr;/g, "->")]);
        this.reasonText.setColor(`#${STATE_COLOR[entry.state].toString(16).padStart(6, "0")}`);

        this.actorGraphics.clear();
        for (const [origin, isBlackBox] of [
            [LEFT_ORIGIN, false],
            [RIGHT_ORIGIN, true],
        ] as const) {
            const postPos = { x: origin.x + POST.x, y: origin.y + POST.y };
            const bugPos = { x: origin.x + intruderPos.x, y: origin.y + intruderPos.y };

            this.actorGraphics.fillStyle(INTRUDER_COLOR, 1);
            this.actorGraphics.fillCircle(bugPos.x, bugPos.y, 9);

            const npcColor = isBlackBox ? BLACKBOX_COLOR : STATE_COLOR[entry.state];
            this.actorGraphics.fillStyle(npcColor, 1);
            this.actorGraphics.fillCircle(postPos.x, postPos.y, 12);
            if (!isBlackBox) {
                this.actorGraphics.lineStyle(1.5, STATE_COLOR[entry.state], 0.3);
                this.actorGraphics.strokeCircle(postPos.x, postPos.y, this.perceptionRadius);
            }
        }
    }
}

function buildControls(root: HTMLElement, scene: FsmVsBlackBoxScene): void {
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "FSM vs Black Box";
    root.appendChild(heading);

    buildHowTo(
        root,
        "<b>Как пользоваться:</b> это один и тот же автомат (Patrol/Chase/Search), прогнанный по одному и тому же " +
            "скриптованному таймлайну сразу на двух панелях. Слева — граф состояний с подписанной причиной каждого " +
            "перехода; справа — буквально то же самое поведение, но без подписей, только действие. Жми Play/Pause, " +
            "Step или таскай Scrub, чтобы перематывать вручную.",
    );
    buildLegend(root, [
        { color: "#8b93a3", label: "Patrol" },
        { color: "#ef5350", label: "Chase" },
        { color: "#ffca28", label: "Search" },
        { color: "#4fc3f7", label: "нарушитель (скриптован)" },
    ]);
    const setNarrative = buildNarrative(root, "Таймлайн 20с, зациклен. Следи за левой панелью — справа ровно то же самое.");

    const giveUpRow = document.createElement("div");
    giveUpRow.className = "control-row";
    const giveUpLabel = document.createElement("label");
    giveUpLabel.textContent = "Таймаут поиска (giveUpAfterSec)";
    const giveUpInput = document.createElement("input");
    giveUpInput.type = "range";
    giveUpInput.min = "1";
    giveUpInput.max = "20";
    giveUpInput.step = "1";
    giveUpInput.value = String(scene.giveUpAfterSec);
    const giveUpValue = document.createElement("span");
    giveUpValue.textContent = `${scene.giveUpAfterSec} с`;
    giveUpInput.addEventListener("input", () => {
        scene.giveUpAfterSec = Number(giveUpInput.value);
        giveUpValue.textContent = `${scene.giveUpAfterSec} с`;
        scene.rebuildTimeline();
    });
    giveUpRow.append(giveUpLabel, giveUpInput, giveUpValue);
    root.appendChild(giveUpRow);

    const neverRow = document.createElement("div");
    neverRow.className = "control-row";
    const neverLabel = document.createElement("label");
    neverLabel.textContent = "Никогда не сдаётся";
    const neverInput = document.createElement("input");
    neverInput.type = "checkbox";
    neverInput.checked = scene.neverGivesUp;
    neverInput.addEventListener("change", () => {
        scene.neverGivesUp = neverInput.checked;
        giveUpInput.disabled = neverInput.checked;
        scene.rebuildTimeline();
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
    radiusInput.max = "260";
    radiusInput.step = "10";
    radiusInput.value = String(scene.perceptionRadius);
    const radiusValue = document.createElement("span");
    radiusValue.textContent = `${scene.perceptionRadius}px`;
    radiusInput.addEventListener("input", () => {
        scene.perceptionRadius = Number(radiusInput.value);
        radiusValue.textContent = `${scene.perceptionRadius}px`;
        scene.rebuildTimeline();
    });
    radiusRow.append(radiusLabel, radiusInput, radiusValue);
    root.appendChild(radiusRow);

    const scrubRow = document.createElement("div");
    scrubRow.className = "control-row";
    const scrubLabel = document.createElement("label");
    scrubLabel.textContent = "Scrub";
    const scrubInput = document.createElement("input");
    scrubInput.type = "range";
    scrubInput.min = "0";
    scrubInput.max = String(TOTAL_DURATION);
    scrubInput.step = "0.1";
    scrubInput.value = "0";
    scrubInput.addEventListener("input", () => {
        scene.playing = false;
        scene.timeSec = Number(scrubInput.value);
    });
    scrubRow.append(scrubLabel, scrubInput);
    root.appendChild(scrubRow);

    const buttonRow = document.createElement("div");
    buttonRow.className = "control-row";
    const playButton = document.createElement("button");
    playButton.textContent = "Play / Pause";
    playButton.addEventListener("click", () => scene.togglePlaying());
    const stepButton = document.createElement("button");
    stepButton.textContent = `Step (+${STEP_SEC}с)`;
    stepButton.addEventListener("click", () => scene.step());
    const resetButton = document.createElement("button");
    resetButton.textContent = "Reset";
    resetButton.addEventListener("click", () => scene.reset());
    buttonRow.append(playButton, stepButton, resetButton);
    root.appendChild(buttonRow);

    const table = document.createElement("table");
    table.className = "metrics-table";
    const rows: Array<[string, string]> = [
        ["time", "Время таймлайна"],
        ["state", "Состояние (слева)"],
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
        '<a href="npc-chase-timeout.html" style="color:#4fc3f7">Chase Timeout</a> &middot; ' +
        '<a href="npc-imperfection.html" style="color:#4fc3f7">Deliberate Imperfection</a>';
    root.appendChild(hint);

    const tick = () => {
        const entry = scene.currentEntry();
        cells.time.textContent = `${scene.timeSec.toFixed(1)} с / ${TOTAL_DURATION} с`;
        cells.state.textContent = STATE_LABEL_RU[entry.state];
        if (entry.reason) setNarrative(entry.reason);
        scrubInput.value = String(scene.timeSec);
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

const gameRoot = document.getElementById("game-root");
const controlRoot = document.getElementById("control-panel");

if (!gameRoot || !controlRoot) {
    throw new Error("npc-fsm-vs-blackbox: expected #game-root and #control-panel in examples/npc-fsm-vs-blackbox.html");
}

const scene = new FsmVsBlackBoxScene();
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
