import Phaser from "phaser";
import { coyoteTimeAllowsJump } from "@/platformer/timing";
import { buildHowTo, buildLegend, buildNarrative } from "@/rendering/ExplainerPanel";

const WORLD_WIDTH = 900;
const WORLD_HEIGHT = 420;
const CHART_X = 40;
const CHART_Y = 40;
const CHART_WIDTH = WORLD_WIDTH - 80;
const CHART_HEIGHT = 300;
const MAX_LATENESS_MS = 450;
const BUCKET_COUNT = 30;
const BUCKET_WIDTH_MS = MAX_LATENESS_MS / BUCKET_COUNT;
const BATCH_SIZE = 200;

const CAUGHT_COLOR = 0x6fd48a;
const MISSED_COLOR = 0xef5350;
const THRESHOLD_COLOR = 0xffca28;

/** A simplified, clearly-simulated model of human reaction-time spread — NOT a real measurement, just illustrative. */
function sampleLatenessMs(): number {
    return Phaser.Math.FloatBetween(20, 220) + Phaser.Math.FloatBetween(20, 220);
}

class TuningScene extends Phaser.Scene {
    windowMs = 100;
    continuous = false;

    buckets = new Array<number>(BUCKET_COUNT).fill(0);
    totalAttempts = 0;
    totalCaught = 0;
    latenessSum = 0;
    lastBatchSummary = "";

    private chartGraphics!: Phaser.GameObjects.Graphics;

    constructor() {
        super("coyote-tuning");
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);
        this.chartGraphics = this.add.graphics();
        this.render();
    }

    update(): void {
        if (this.continuous) {
            for (let i = 0; i < 4; i++) this.recordSample(sampleLatenessMs());
        }
        this.render();
    }

    reset(): void {
        this.buckets.fill(0);
        this.totalAttempts = 0;
        this.totalCaught = 0;
        this.latenessSum = 0;
        this.lastBatchSummary = "";
    }

    runBatch(): void {
        const before = this.totalCaught;
        const beforeAttempts = this.totalAttempts;
        for (let i = 0; i < BATCH_SIZE; i++) this.recordSample(sampleLatenessMs());
        const caughtInBatch = this.totalCaught - before;
        const attemptsInBatch = this.totalAttempts - beforeAttempts;
        const avgLateness = this.totalAttempts > 0 ? this.latenessSum / this.totalAttempts : 0;
        this.lastBatchSummary =
            `Окно ${this.windowMs}ms поймало ${caughtInBatch} из ${attemptsInBatch} новых попыток ` +
            `(${((caughtInBatch / attemptsInBatch) * 100).toFixed(0)}%). Средняя задержка реакции по всем попыткам — ${avgLateness.toFixed(0)}ms.`;
    }

    private recordSample(latenessMs: number): void {
        const bucket = Phaser.Math.Clamp(Math.floor(latenessMs / BUCKET_WIDTH_MS), 0, BUCKET_COUNT - 1);
        this.buckets[bucket] += 1;
        this.totalAttempts += 1;
        this.latenessSum += latenessMs;
        if (coyoteTimeAllowsJump(latenessMs, this.windowMs)) this.totalCaught += 1;
    }

    private render(): void {
        this.chartGraphics.clear();
        this.chartGraphics.lineStyle(1, 0x2a2f3a, 1);
        this.chartGraphics.strokeRect(CHART_X, CHART_Y, CHART_WIDTH, CHART_HEIGHT);

        const maxCount = Math.max(1, ...this.buckets);
        const barWidth = CHART_WIDTH / BUCKET_COUNT;
        for (let i = 0; i < BUCKET_COUNT; i++) {
            const bucketStartMs = i * BUCKET_WIDTH_MS;
            const count = this.buckets[i];
            const barHeight = (count / maxCount) * (CHART_HEIGHT - 10);
            const color = bucketStartMs < this.windowMs ? CAUGHT_COLOR : MISSED_COLOR;
            this.chartGraphics.fillStyle(color, 0.85);
            this.chartGraphics.fillRect(CHART_X + i * barWidth, CHART_Y + CHART_HEIGHT - barHeight, Math.max(1, barWidth - 2), barHeight);
        }

        const thresholdX = CHART_X + (this.windowMs / MAX_LATENESS_MS) * CHART_WIDTH;
        this.chartGraphics.lineStyle(2, THRESHOLD_COLOR, 0.95);
        this.chartGraphics.lineBetween(thresholdX, CHART_Y - 6, thresholdX, CHART_Y + CHART_HEIGHT + 6);

        this.chartGraphics.lineStyle(1, 0x8b93a3, 0.5);
        for (const ms of [100, 200, 300, 400]) {
            const x = CHART_X + (ms / MAX_LATENESS_MS) * CHART_WIDTH;
            this.chartGraphics.lineBetween(x, CHART_Y + CHART_HEIGHT, x, CHART_Y + CHART_HEIGHT + 6);
        }
    }
}

function buildControls(root: HTMLElement, scene: TuningScene): void {
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "Forgiveness Tuning";
    root.appendChild(heading);

    buildHowTo(
        root,
        "<b>Как пользоваться:</b> гистограмма — это смоделированный (не измеренный по-настоящему) разброс задержки " +
            "человеческой реакции на нажатие. Жёлтая линия — окно прощения (coyoteTime/jumpBuffer). Всё слева от неё " +
            "«поймано» (зелёное), всё справа — потеряно (красное). Двигай окно или жми пресеты, потом «Прогнать 200 " +
            "попыток», чтобы набрать статистику.",
    );
    buildLegend(root, [
        { color: "#6fd48a", label: "попытки внутри окна (поймано)" },
        { color: "#ef5350", label: "попытки за окном (потеряно)" },
        { color: "#ffca28", label: "граница окна прощения", shape: "line" },
    ]);
    const setNarrative = buildNarrative(root, "Нажми «Прогнать 200 попыток» — здесь появится сводка.");

    const windowRow = document.createElement("div");
    windowRow.className = "control-row";
    const windowLabel = document.createElement("label");
    windowLabel.textContent = "Окно прощения";
    const windowInput = document.createElement("input");
    windowInput.type = "range";
    windowInput.min = "0";
    windowInput.max = "400";
    windowInput.step = "10";
    windowInput.value = String(scene.windowMs);
    const windowValue = document.createElement("span");
    windowValue.textContent = `${scene.windowMs} ms`;
    windowInput.addEventListener("input", () => {
        scene.windowMs = Number(windowInput.value);
        windowValue.textContent = `${scene.windowMs} ms`;
    });
    windowRow.append(windowLabel, windowInput, windowValue);
    root.appendChild(windowRow);

    const presetRow = document.createElement("div");
    presetRow.className = "control-row";
    const presets: Array<[string, number]> = [
        ["Наивно (0ms)", 0],
        ["Mario (100ms)", 100],
        ["Hollow Knight (120ms)", 120],
    ];
    for (const [label, ms] of presets) {
        const button = document.createElement("button");
        button.textContent = label;
        button.style.fontSize = "11px";
        button.addEventListener("click", () => {
            scene.windowMs = ms;
            windowInput.value = String(ms);
            windowValue.textContent = `${ms} ms`;
        });
        presetRow.appendChild(button);
    }
    root.appendChild(presetRow);

    const buttonRow = document.createElement("div");
    buttonRow.className = "control-row";
    const runButton = document.createElement("button");
    runButton.textContent = "Прогнать 200 попыток";
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
        ["total", "Всего попыток"],
        ["caught", "Поймано"],
        ["rate", "Доля поймано"],
        ["avg", "Средняя задержка реакции"],
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
    metricsNote.textContent = "Правильного числа для окна прощения не существует — это всегда компромисс между «слишком туго» и «слишком щедро».";
    root.appendChild(metricsNote);

    const hint = document.createElement("p");
    hint.style.color = "#8b93a3";
    hint.innerHTML =
        "Часть примеров к статье про coyote time. " +
        '<a href="../index.html" style="color:#4fc3f7">&larr; Все примеры</a> &middot; ' +
        '<a href="coyote-edge-timing.html" style="color:#4fc3f7">Coyote Time</a> &middot; ' +
        '<a href="coyote-jump-buffer.html" style="color:#4fc3f7">Jump Buffer</a>';
    root.appendChild(hint);

    const tick = () => {
        cells.total.textContent = String(scene.totalAttempts);
        cells.caught.textContent = String(scene.totalCaught);
        cells.rate.textContent = scene.totalAttempts > 0 ? `${((scene.totalCaught / scene.totalAttempts) * 100).toFixed(0)}%` : "-";
        cells.avg.textContent = scene.totalAttempts > 0 ? `${(scene.latenessSum / scene.totalAttempts).toFixed(0)} ms` : "-";
        if (scene.lastBatchSummary) setNarrative(scene.lastBatchSummary);

        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

const gameRoot = document.getElementById("game-root");
const controlRoot = document.getElementById("control-panel");

if (!gameRoot || !controlRoot) {
    throw new Error("coyote-tuning: expected #game-root and #control-panel in examples/coyote-tuning.html");
}

const scene = new TuningScene();
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
