import Phaser from "phaser";
import { resolveDuel } from "@/npc/duel";
import { buildHowTo, buildLegend, buildNarrative } from "@/rendering/ExplainerPanel";

const WORLD_WIDTH = 900;
const WORLD_HEIGHT = 420;
const CHART_X = 40;
const CHART_Y = 40;
const CHART_WIDTH = WORLD_WIDTH - 80;
const CHART_HEIGHT = 300;
const MAX_REACTION_MS = 450;
const BUCKET_COUNT = 30;
const BUCKET_WIDTH_MS = MAX_REACTION_MS / BUCKET_COUNT;
const BATCH_SIZE = 200;

const WIN_COLOR = 0x6fd48a;
const LOSS_COLOR = 0xef5350;
const THRESHOLD_COLOR = 0xffca28;

/** A simplified, clearly-simulated model of human reaction-time spread — NOT a real measurement, just illustrative. */
function samplePlayerReactionMs(): number {
    return Phaser.Math.FloatBetween(20, 220) + Phaser.Math.FloatBetween(20, 220);
}

interface Bucket {
    wins: number;
    losses: number;
}

class ImperfectionScene extends Phaser.Scene {
    npcReactionDelayMs = 250;
    npcMissChance = 0.1;
    continuous = false;

    buckets: Bucket[] = Array.from({ length: BUCKET_COUNT }, () => ({ wins: 0, losses: 0 }));
    totalDuels = 0;
    playerWins = 0;
    marginSum = 0;
    lastBatchSummary = "";

    private chartGraphics!: Phaser.GameObjects.Graphics;

    constructor() {
        super("npc-imperfection");
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);
        this.chartGraphics = this.add.graphics();
        this.render();
    }

    update(): void {
        if (this.continuous) {
            for (let i = 0; i < 4; i++) this.recordDuel();
        }
        this.render();
    }

    reset(): void {
        this.buckets = this.buckets.map(() => ({ wins: 0, losses: 0 }));
        this.totalDuels = 0;
        this.playerWins = 0;
        this.marginSum = 0;
        this.lastBatchSummary = "";
    }

    runBatch(): void {
        const beforeWins = this.playerWins;
        const beforeTotal = this.totalDuels;
        for (let i = 0; i < BATCH_SIZE; i++) this.recordDuel();
        const winsInBatch = this.playerWins - beforeWins;
        const duelsInBatch = this.totalDuels - beforeTotal;
        const avgMargin = this.totalDuels > 0 ? this.marginSum / this.totalDuels : 0;
        this.lastBatchSummary =
            `missChance ${(this.npcMissChance * 100).toFixed(0)}% и delay ${this.npcReactionDelayMs}ms дали игроку ` +
            `${winsInBatch} побед из ${duelsInBatch} новых дуэлей (${((winsInBatch / duelsInBatch) * 100).toFixed(0)}%). ` +
            `Средний отрыв по времени — ${avgMargin.toFixed(0)}ms.`;
    }

    private recordDuel(): void {
        const playerReactionMs = samplePlayerReactionMs();
        const missRoll = Phaser.Math.FloatBetween(0, 1);
        const { playerWon, marginMs } = resolveDuel(playerReactionMs, this.npcReactionDelayMs, this.npcMissChance, missRoll);

        const bucket = Phaser.Math.Clamp(Math.floor(playerReactionMs / BUCKET_WIDTH_MS), 0, BUCKET_COUNT - 1);
        if (playerWon) this.buckets[bucket].wins += 1;
        else this.buckets[bucket].losses += 1;

        this.totalDuels += 1;
        if (playerWon) this.playerWins += 1;
        this.marginSum += marginMs;
    }

    private render(): void {
        this.chartGraphics.clear();
        this.chartGraphics.lineStyle(1, 0x2a2f3a, 1);
        this.chartGraphics.strokeRect(CHART_X, CHART_Y, CHART_WIDTH, CHART_HEIGHT);

        const totals = this.buckets.map((b) => b.wins + b.losses);
        const maxCount = Math.max(1, ...totals);
        const barWidth = CHART_WIDTH / BUCKET_COUNT;
        for (let i = 0; i < BUCKET_COUNT; i++) {
            const { wins, losses } = this.buckets[i];
            const total = wins + losses;
            if (total === 0) continue;
            const barHeight = (total / maxCount) * (CHART_HEIGHT - 10);
            const winHeight = (wins / total) * barHeight;
            const x = CHART_X + i * barWidth;
            const yBottom = CHART_Y + CHART_HEIGHT;

            this.chartGraphics.fillStyle(WIN_COLOR, 0.85);
            this.chartGraphics.fillRect(x, yBottom - winHeight, Math.max(1, barWidth - 2), winHeight);
            this.chartGraphics.fillStyle(LOSS_COLOR, 0.85);
            this.chartGraphics.fillRect(x, yBottom - barHeight, Math.max(1, barWidth - 2), barHeight - winHeight);
        }

        const thresholdX = CHART_X + (this.npcReactionDelayMs / MAX_REACTION_MS) * CHART_WIDTH;
        this.chartGraphics.lineStyle(2, THRESHOLD_COLOR, 0.95);
        this.chartGraphics.lineBetween(thresholdX, CHART_Y - 6, thresholdX, CHART_Y + CHART_HEIGHT + 6);

        this.chartGraphics.lineStyle(1, 0x8b93a3, 0.5);
        for (const ms of [100, 200, 300, 400]) {
            const x = CHART_X + (ms / MAX_REACTION_MS) * CHART_WIDTH;
            this.chartGraphics.lineBetween(x, CHART_Y + CHART_HEIGHT, x, CHART_Y + CHART_HEIGHT + 6);
        }
    }
}

function buildControls(root: HTMLElement, scene: ImperfectionScene): void {
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "Deliberate Imperfection";
    root.appendChild(heading);

    buildHowTo(
        root,
        "<b>Как пользоваться:</b> гистограмма — это смоделированный (не измеренный по-настоящему) разброс времени " +
            "реакции игрока в абстрактной дуэли «кто выстрелил первым». Жёлтая линия — задержка реакции NPC. Зелёная " +
            "часть столбика — победы игрока, красная — победы NPC. Двигай missChance/delay или жми пресеты, потом " +
            "«Прогнать 200 дуэлей».",
    );
    buildLegend(root, [
        { color: "#6fd48a", label: "победа игрока" },
        { color: "#ef5350", label: "победа NPC" },
        { color: "#ffca28", label: "задержка реакции NPC", shape: "line" },
    ]);
    const setNarrative = buildNarrative(root, "Нажми «Прогнать 200 дуэлей» — здесь появится сводка.");

    const delayRow = document.createElement("div");
    delayRow.className = "control-row";
    const delayLabel = document.createElement("label");
    delayLabel.textContent = "Задержка реакции NPC";
    const delayInput = document.createElement("input");
    delayInput.type = "range";
    delayInput.min = "0";
    delayInput.max = "450";
    delayInput.step = "10";
    delayInput.value = String(scene.npcReactionDelayMs);
    const delayValue = document.createElement("span");
    delayValue.textContent = `${scene.npcReactionDelayMs} ms`;
    delayInput.addEventListener("input", () => {
        scene.npcReactionDelayMs = Number(delayInput.value);
        delayValue.textContent = `${scene.npcReactionDelayMs} ms`;
    });
    delayRow.append(delayLabel, delayInput, delayValue);
    root.appendChild(delayRow);

    const missRow = document.createElement("div");
    missRow.className = "control-row";
    const missLabel = document.createElement("label");
    missLabel.textContent = "Шанс промаха NPC";
    const missInput = document.createElement("input");
    missInput.type = "range";
    missInput.min = "0";
    missInput.max = "0.8";
    missInput.step = "0.05";
    missInput.value = String(scene.npcMissChance);
    const missValue = document.createElement("span");
    missValue.textContent = `${Math.round(scene.npcMissChance * 100)}%`;
    missInput.addEventListener("input", () => {
        scene.npcMissChance = Number(missInput.value);
        missValue.textContent = `${Math.round(scene.npcMissChance * 100)}%`;
    });
    missRow.append(missLabel, missInput, missValue);
    root.appendChild(missRow);

    const presetRow = document.createElement("div");
    presetRow.className = "control-row";
    presetRow.style.flexWrap = "wrap";
    const presets: Array<[string, number, number]> = [
        ["Читерский снайпер (0ms, 0%)", 0, 0],
        ["Сбалансированный (250ms, 10%)", 250, 0.1],
        ["Слишком прощающий (400ms, 40%)", 400, 0.4],
    ];
    for (const [label, delayMs, missChance] of presets) {
        const button = document.createElement("button");
        button.textContent = label;
        button.style.fontSize = "11px";
        button.addEventListener("click", () => {
            scene.npcReactionDelayMs = delayMs;
            scene.npcMissChance = missChance;
            delayInput.value = String(delayMs);
            delayValue.textContent = `${delayMs} ms`;
            missInput.value = String(missChance);
            missValue.textContent = `${Math.round(missChance * 100)}%`;
        });
        presetRow.appendChild(button);
    }
    root.appendChild(presetRow);

    const buttonRow = document.createElement("div");
    buttonRow.className = "control-row";
    const runButton = document.createElement("button");
    runButton.textContent = "Прогнать 200 дуэлей";
    runButton.addEventListener("click", () => scene.runBatch());
    const continuousLabel = document.createElement("label");
    continuousLabel.textContent = "Непрерывно";
    const continuousInput = document.createElement("input");
    continuousInput.type = "checkbox";
    continuousInput.checked = scene.continuous;
    continuousInput.addEventListener("change", () => {
        scene.continuous = continuousInput.checked;
    });
    buttonRow.append(runButton, continuousLabel, continuousInput);
    root.appendChild(buttonRow);

    const resetRow = document.createElement("div");
    resetRow.className = "control-row";
    const resetButton = document.createElement("button");
    resetButton.textContent = "Сбросить статистику";
    resetButton.addEventListener("click", () => scene.reset());
    resetRow.appendChild(resetButton);
    root.appendChild(resetRow);

    const table = document.createElement("table");
    table.className = "metrics-table";
    const rows: Array<[string, string]> = [
        ["total", "Всего дуэлей"],
        ["wins", "Побед игрока"],
        ["rate", "Win rate игрока"],
        ["margin", "Средний отрыв"],
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

    const metricsNote = document.createElement("div");
    metricsNote.style.color = "#8b93a3";
    metricsNote.style.fontSize = "11px";
    metricsNote.style.margin = "4px 0 10px";
    metricsNote.textContent = "Правильного win rate не существует — слишком высокий читерский, слишком низкий скучный, это всегда компромисс.";
    root.appendChild(metricsNote);

    const hint = document.createElement("p");
    hint.style.color = "#8b93a3";
    hint.innerHTML =
        "Часть примеров к статье dont_make_npc_smarter. " +
        '<a href="../index.html" style="color:#4fc3f7">&larr; Все примеры</a> &middot; ' +
        '<a href="npc-reward-hacking.html" style="color:#4fc3f7">Reward Hacking</a> &middot; ' +
        '<a href="npc-chase-timeout.html" style="color:#4fc3f7">Chase Timeout</a> &middot; ' +
        '<a href="npc-fsm-vs-blackbox.html" style="color:#4fc3f7">FSM vs Black Box</a>';
    root.appendChild(hint);

    const tick = () => {
        cells.total.textContent = String(scene.totalDuels);
        cells.wins.textContent = String(scene.playerWins);
        cells.rate.textContent = scene.totalDuels > 0 ? `${((scene.playerWins / scene.totalDuels) * 100).toFixed(0)}%` : "-";
        cells.margin.textContent = scene.totalDuels > 0 ? `${(scene.marginSum / scene.totalDuels).toFixed(0)} ms` : "-";
        if (scene.lastBatchSummary) setNarrative(scene.lastBatchSummary);

        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

const gameRoot = document.getElementById("game-root");
const controlRoot = document.getElementById("control-panel");

if (!gameRoot || !controlRoot) {
    throw new Error("npc-imperfection: expected #game-root and #control-panel in examples/npc-imperfection.html");
}

const scene = new ImperfectionScene();
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
