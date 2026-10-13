import Phaser from "phaser";
import { ACTIONS, allStates, sampleOutcome, solveMdp, stateKey, type NpcAction, type NpcState, type RewardWeights } from "@/npc/rewardMdp";
import { ScrollingGraph, buildGraphRow } from "@/rendering/ScrollingGraph";
import { buildHowTo, buildLegend, buildNarrative } from "@/rendering/ExplainerPanel";

const WORLD_WIDTH = 900;
const WORLD_HEIGHT = 480;
const CENTER = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
const RING_RADIUS: Record<NpcState["distance"], number> = { point: 40, close: 150, far: 270 };
const TICK_SEC = 1.0;
const GRAPH_SAMPLES = 150;

const ACTION_COLOR: Record<NpcAction, number> = {
    attack: 0xef5350,
    retreat: 0x4fc3f7,
    chase: 0xffca28,
    wait: 0x8b93a3,
};
const ACTION_LABEL_RU: Record<NpcAction, string> = {
    attack: "атаковать",
    retreat: "отступить",
    chase: "преследовать",
    wait: "ждать",
};
const DISTANCE_LABEL_RU: Record<NpcState["distance"], string> = { far: "далеко", close: "близко", point: "в упор" };
const HEALTH_LABEL_RU: Record<NpcState["health"], string> = { high: "здоров", low: "ранен" };
const COVER_LABEL_RU: Record<NpcState["cover"], string> = { no: "на виду", yes: "в укрытии" };
const COVER_COLOR = 0x6fd48a;
const HEALTH_HIGH_COLOR = 0x6fd48a;
const HEALTH_LOW_COLOR = 0xef5350;

function defaultState(): NpcState {
    return { distance: "far", health: "high", cover: "no" };
}

class RewardHackingScene extends Phaser.Scene {
    weights: RewardWeights = { killReward: 10, damagePenalty: 5, deathPenalty: 100, chaseTimeoutPenalty: 0 };
    paused = false;
    speedMultiplier = 1;

    steps = 0;
    totalReward = 0;
    actionCounts: Record<NpcAction, number> = { attack: 0, retreat: 0, chase: 0, wait: 0 };
    narrativeText = "Жди первого тика — здесь появится выбор policy.";
    policy = new Map<string, NpcAction>();
    graph: ScrollingGraph | null = null;

    private npcState: NpcState = defaultState();
    private tickAccumulator = 0;
    private orbitAngle = 0;
    private displayRadius = RING_RADIUS.far;

    private arenaGraphics!: Phaser.GameObjects.Graphics;
    private npcGraphics!: Phaser.GameObjects.Graphics;

    constructor() {
        super("npc-reward-hacking");
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);
        this.arenaGraphics = this.add.graphics();
        this.npcGraphics = this.add.graphics();
        this.resolvePolicy();
        this.drawArena();
    }

    update(_time: number, deltaMs: number): void {
        const dt = (deltaMs / 1000) * this.speedMultiplier;
        if (!this.paused) {
            this.tickAccumulator += dt;
            while (this.tickAccumulator >= TICK_SEC) {
                this.tickAccumulator -= TICK_SEC;
                this.step();
            }
        }
        this.orbitAngle += dt * 0.6;
        const targetRadius = RING_RADIUS[this.npcState.distance];
        this.displayRadius = Phaser.Math.Linear(this.displayRadius, targetRadius, Math.min(1, dt * 3));
        this.render();
    }

    reset(): void {
        this.npcState = defaultState();
        this.steps = 0;
        this.totalReward = 0;
        this.actionCounts = { attack: 0, retreat: 0, chase: 0, wait: 0 };
        this.narrativeText = "Жди первого тика — здесь появится выбор policy.";
        this.displayRadius = RING_RADIUS.far;
        this.graph?.clear();
    }

    togglePaused(): void {
        this.paused = !this.paused;
    }

    resolvePolicy(): void {
        const { policy } = solveMdp(this.weights);
        this.policy = policy;
    }

    private step(): void {
        const action = this.policy.get(stateKey(this.npcState)) ?? "wait";
        const { next, reward } = sampleOutcome(this.npcState, action, this.weights, Phaser.Math.FloatBetween(0, 1));
        this.steps += 1;
        this.totalReward += reward;
        this.actionCounts[action] += 1;
        this.narrativeText =
            `Состояние (${DISTANCE_LABEL_RU[this.npcState.distance]}, ${HEALTH_LABEL_RU[this.npcState.health]}, ${COVER_LABEL_RU[this.npcState.cover]}) → ` +
            `policy выбирает <b style="color:#${ACTION_COLOR[action].toString(16).padStart(6, "0")}">${ACTION_LABEL_RU[action]}</b>, награда за шаг: ${reward >= 0 ? "+" : ""}${reward.toFixed(1)}.`;
        this.npcState = next;
        this.graph?.push(Math.max(0, reward + 20), 40);
    }

    private drawArena(): void {
        this.arenaGraphics.clear();
        this.arenaGraphics.fillStyle(0x1b1f27, 1);
        this.arenaGraphics.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
        this.arenaGraphics.lineStyle(1, 0x2a2f3a, 1);
        for (const d of ["point", "close", "far"] as const) {
            this.arenaGraphics.strokeCircle(CENTER.x, CENTER.y, RING_RADIUS[d]);
        }
        this.arenaGraphics.fillStyle(0xffca28, 1);
        this.arenaGraphics.fillTriangle(CENTER.x - 10, CENTER.y + 10, CENTER.x + 10, CENTER.y + 10, CENTER.x, CENTER.y - 10);
    }

    private render(): void {
        this.npcGraphics.clear();
        const x = CENTER.x + Math.cos(this.orbitAngle) * this.displayRadius;
        const y = CENTER.y + Math.sin(this.orbitAngle) * this.displayRadius * 0.55;

        if (this.npcState.cover === "yes") {
            this.npcGraphics.lineStyle(2, COVER_COLOR, 0.8);
            this.npcGraphics.strokeCircle(x, y, 16);
        }

        const healthColor = this.npcState.health === "high" ? HEALTH_HIGH_COLOR : HEALTH_LOW_COLOR;
        this.npcGraphics.fillStyle(healthColor, 1);
        this.npcGraphics.fillCircle(x, y, 10);

        const action = this.policy.get(stateKey(this.npcState)) ?? "wait";
        this.npcGraphics.lineStyle(2, ACTION_COLOR[action], 0.9);
        this.npcGraphics.strokeCircle(x, y, 15);
    }
}

function buildPolicyTable(root: HTMLElement, scene: RewardHackingScene): () => void {
    const heading = document.createElement("div");
    heading.textContent = "Policy по всем 12 состояниям";
    heading.style.color = "#8b93a3";
    heading.style.margin = "10px 0 4px";
    root.appendChild(heading);

    const table = document.createElement("table");
    table.className = "metrics-table";
    table.style.fontSize = "11px";
    const cells = new Map<string, HTMLTableCellElement>();
    for (const s of allStates()) {
        const tr = document.createElement("tr");
        const th = document.createElement("td");
        th.textContent = `${DISTANCE_LABEL_RU[s.distance]} / ${HEALTH_LABEL_RU[s.health]} / ${COVER_LABEL_RU[s.cover]}`;
        th.style.color = "#8b93a3";
        const td = document.createElement("td");
        td.textContent = "-";
        cells.set(stateKey(s), td);
        tr.append(th, td);
        table.appendChild(tr);
    }
    root.appendChild(table);

    return () => {
        for (const s of allStates()) {
            const action = scene.policy.get(stateKey(s)) ?? "wait";
            const cell = cells.get(stateKey(s))!;
            cell.textContent = ACTION_LABEL_RU[action];
            cell.style.color = `#${ACTION_COLOR[action].toString(16).padStart(6, "0")}`;
        }
    };
}

function buildActionBars(root: HTMLElement, scene: RewardHackingScene): () => void {
    const heading = document.createElement("div");
    heading.textContent = "Какое действие выбирала policy за всё время";
    heading.style.color = "#8b93a3";
    heading.style.margin = "10px 0 4px";
    root.appendChild(heading);

    const bars = new Map<NpcAction, { fill: HTMLDivElement; label: HTMLSpanElement }>();
    for (const action of ACTIONS) {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.alignItems = "center";
        row.style.gap = "6px";
        row.style.margin = "2px 0";
        row.style.fontSize = "11px";

        const name = document.createElement("span");
        name.textContent = ACTION_LABEL_RU[action];
        name.style.width = "70px";
        name.style.color = "#c5cad3";

        const track = document.createElement("div");
        track.style.flex = "1";
        track.style.height = "8px";
        track.style.background = "#1b1f27";
        track.style.border = "1px solid #2a2f3a";
        track.style.borderRadius = "3px";
        track.style.overflow = "hidden";
        const fill = document.createElement("div");
        fill.style.height = "100%";
        fill.style.width = "0%";
        fill.style.background = `#${ACTION_COLOR[action].toString(16).padStart(6, "0")}`;
        track.appendChild(fill);

        const label = document.createElement("span");
        label.textContent = "0";
        label.style.width = "32px";
        label.style.textAlign = "right";
        label.style.color = "#8b93a3";

        row.append(name, track, label);
        root.appendChild(row);
        bars.set(action, { fill, label });
    }

    return () => {
        const total = Math.max(1, ACTIONS.reduce((sum, a) => sum + scene.actionCounts[a], 0));
        for (const action of ACTIONS) {
            const count = scene.actionCounts[action];
            const { fill, label } = bars.get(action)!;
            fill.style.width = `${(count / total) * 100}%`;
            label.textContent = String(count);
        }
    };
}

function buildControls(root: HTMLElement, scene: RewardHackingScene): void {
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "Reward Hacking";
    root.appendChild(heading);

    buildHowTo(
        root,
        "<b>Как пользоваться:</b> это настоящий value iteration на 12 состояниях (дистанция × здоровье × укрытие), " +
            "решаемый заново при каждом движении слайдера. Крути веса награды и смотри, как policy целиком " +
            "перекрашивается — NPC справа честно выполняет то действие, которое policy считает оптимальным " +
            "в его текущем состоянии.",
    );
    buildLegend(root, [
        { color: "#ef5350", label: "атаковать" },
        { color: "#4fc3f7", label: "отступить" },
        { color: "#ffca28", label: "преследовать" },
        { color: "#8b93a3", label: "ждать" },
        { color: "#6fd48a", label: "в укрытии (кольцо)", shape: "ring" },
    ]);
    const setNarrative = buildNarrative(root, scene.narrativeText);

    const sliders: Array<[keyof RewardWeights, string, number, number, number]> = [
        ["killReward", "Награда за убийство", 0, 50, 1],
        ["damagePenalty", "Штраф за урон", 0, 30, 1],
        ["deathPenalty", "Штраф за смерть", 0, 150, 5],
        ["chaseTimeoutPenalty", "Штраф за долгое преследование", 0, 30, 1],
    ];
    const inputs: Record<string, HTMLInputElement> = {};
    const valueLabels: Record<string, HTMLSpanElement> = {};
    for (const [key, label, min, max, step] of sliders) {
        const row = document.createElement("div");
        row.className = "control-row";
        const labelEl = document.createElement("label");
        labelEl.textContent = label;
        const input = document.createElement("input");
        input.type = "range";
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);
        input.value = String(scene.weights[key]);
        const valueEl = document.createElement("span");
        valueEl.textContent = String(scene.weights[key]);
        input.addEventListener("input", () => {
            scene.weights[key] = Number(input.value);
            valueEl.textContent = input.value;
            scene.resolvePolicy();
        });
        row.append(labelEl, input, valueEl);
        root.appendChild(row);
        inputs[key] = input;
        valueLabels[key] = valueEl;
    }

    const presetRow = document.createElement("div");
    presetRow.className = "control-row";
    presetRow.style.flexWrap = "wrap";
    const presets: Array<[string, RewardWeights]> = [
        ["Наивная (10/5/100/0)", { killReward: 10, damagePenalty: 5, deathPenalty: 100, chaseTimeoutPenalty: 0 }],
        ["Буст убийства (50/5/100/0)", { killReward: 50, damagePenalty: 5, deathPenalty: 100, chaseTimeoutPenalty: 0 }],
        ["+ штраф преследования (10/5/100/20)", { killReward: 10, damagePenalty: 5, deathPenalty: 100, chaseTimeoutPenalty: 20 }],
    ];
    for (const [label, weights] of presets) {
        const button = document.createElement("button");
        button.textContent = label;
        button.style.fontSize = "11px";
        button.addEventListener("click", () => {
            scene.weights = { ...weights };
            for (const [key] of sliders) {
                inputs[key].value = String(scene.weights[key]);
                valueLabels[key].textContent = String(scene.weights[key]);
            }
            scene.resolvePolicy();
        });
        presetRow.appendChild(button);
    }
    root.appendChild(presetRow);

    const buttonRow = document.createElement("div");
    buttonRow.className = "control-row";
    const pauseButton = document.createElement("button");
    pauseButton.textContent = "Пауза";
    pauseButton.addEventListener("click", () => scene.togglePaused());
    const resetButton = document.createElement("button");
    resetButton.textContent = "Сбросить статистику";
    resetButton.addEventListener("click", () => scene.reset());
    buttonRow.append(pauseButton, resetButton);
    root.appendChild(buttonRow);

    const speedRow = document.createElement("div");
    speedRow.className = "control-row";
    const speedLabel = document.createElement("label");
    speedLabel.textContent = "Скорость";
    const speedInput = document.createElement("input");
    speedInput.type = "range";
    speedInput.min = "1";
    speedInput.max = "8";
    speedInput.step = "1";
    speedInput.value = String(scene.speedMultiplier);
    const speedValue = document.createElement("span");
    speedValue.textContent = `${scene.speedMultiplier}x`;
    speedInput.addEventListener("input", () => {
        scene.speedMultiplier = Number(speedInput.value);
        speedValue.textContent = `${scene.speedMultiplier}x`;
    });
    speedRow.append(speedLabel, speedInput, speedValue);
    root.appendChild(speedRow);

    const table = document.createElement("table");
    table.className = "metrics-table";
    const rows: Array<[string, string]> = [
        ["steps", "Шагов"],
        ["avgReward", "Средняя награда/шаг"],
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

    const updatePolicyTable = buildPolicyTable(root, scene);
    const updateActionBars = buildActionBars(root, scene);

    root.appendChild(document.createElement("br"));
    scene.graph = new ScrollingGraph(buildGraphRow(root, "Награда за шаг (сдвинута на +20, чтобы влезли штрафы)", "#6fd48a", GRAPH_SAMPLES), GRAPH_SAMPLES, "#6fd48a");

    const hint = document.createElement("p");
    hint.style.color = "#8b93a3";
    hint.innerHTML =
        "Часть примеров к статье dont_make_npc_smarter. " +
        '<a href="../index.html" style="color:#4fc3f7">&larr; Все примеры</a> &middot; ' +
        '<a href="npc-chase-timeout.html" style="color:#4fc3f7">Chase Timeout</a> &middot; ' +
        '<a href="npc-fsm-vs-blackbox.html" style="color:#4fc3f7">FSM vs Black Box</a> &middot; ' +
        '<a href="npc-imperfection.html" style="color:#4fc3f7">Deliberate Imperfection</a>';
    root.appendChild(hint);

    updatePolicyTable();
    const tick = () => {
        cells.steps.textContent = String(scene.steps);
        cells.avgReward.textContent = scene.steps > 0 ? (scene.totalReward / scene.steps).toFixed(2) : "-";
        setNarrative(scene.narrativeText);
        updatePolicyTable();
        updateActionBars();
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

const gameRoot = document.getElementById("game-root");
const controlRoot = document.getElementById("control-panel");

if (!gameRoot || !controlRoot) {
    throw new Error("npc-reward-hacking: expected #game-root and #control-panel in examples/npc-reward-hacking.html");
}

const scene = new RewardHackingScene();
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
