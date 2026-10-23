import Phaser from "phaser";
import type { Vec2 } from "@/simulation/Vec2";
import { buildHowTo, buildLegend, buildNarrative } from "@/rendering/ExplainerPanel";
import { ScrollingGraph, buildGraphRow } from "@/rendering/ScrollingGraph";

const W = 900;
const H = 600;
const TARGET_RADIUS = 16;
const SPAWN_INTERVAL = 1.2;   // seconds between targets
const TARGET_LIFETIME = 2.5;  // seconds before target disappears
const GRAPH_SAMPLES = 100;
const REACTION_HISTORY = 50;  // rolling window for stats

const TARGET_COLOR = 0xef5350;
const HIT_COLOR = 0x6fd48a;
const CROSSHAIR_COLOR = 0xffca28;

interface TargetSpawn {
    pos: Vec2;
    spawnTime: number;
    hit: boolean;
    hitTime: number;
}

interface ShotRecord {
    reactionMs: number;
    overshoot: boolean;   // did cursor overshoot past target before settling?
    distance: number;     // distance from crosshair to target center at time of click
}

class AimbotStatsScene extends Phaser.Scene {
    aimbotOn = false;
    aimbotNoisePixels = 0;
    aimbotReactionMs = 50;
    detectionSensitivity = 0.5;
    paused = false;

    aim: Vec2 = { x: W / 2, y: H / 2 };
    targets: TargetSpawn[] = [];

    totalShots = 0;
    totalHits = 0;
    shotRecords: ShotRecord[] = [];
    verdict: "clean" | "suspect" | "detected" = "clean";
    lastNarrative = "";
    reactionGraph: ScrollingGraph | null = null;
    accuracyGraph: ScrollingGraph | null = null;

    private elapsed = 0;
    private nextSpawn = 0;
    private aimbotTimer = 0;
    private cursorHistory: Vec2[] = [];  // last N cursor positions to detect overshoot
    private gfx!: Phaser.GameObjects.Graphics;

    constructor() { super("cheat-aimbot-stats"); }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);
        this.gfx = this.add.graphics();

        this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
            if (!this.aimbotOn) {
                this.aim = { x: Phaser.Math.Clamp(p.x, 0, W), y: Phaser.Math.Clamp(p.y, 0, H) };
            }
        });
        this.input.on("pointerdown", () => this.shoot());
        this.input.keyboard?.on("keydown-SPACE", () => this.shoot());
        this.input.keyboard?.on("keydown-R", () => this.reset());

        this.reset();
    }

    update(_time: number, deltaMs: number): void {
        if (this.paused) { this.render(); return; }
        const dt = deltaMs / 1000;
        this.elapsed += dt;

        // Spawn targets
        if (this.elapsed >= this.nextSpawn) {
            this.nextSpawn = this.elapsed + SPAWN_INTERVAL;
            this.targets.push({
                pos: {
                    x: Phaser.Math.Between(TARGET_RADIUS + 50, W - TARGET_RADIUS - 50),
                    y: Phaser.Math.Between(TARGET_RADIUS + 50, H - TARGET_RADIUS - 50),
                },
                spawnTime: this.elapsed,
                hit: false,
                hitTime: 0,
            });
        }

        // Remove expired targets
        this.targets = this.targets.filter(t => t.hit || this.elapsed - t.spawnTime < TARGET_LIFETIME);

        // Aimbot logic
        if (this.aimbotOn) {
            const activeTarget = this.targets.find(t => !t.hit);
            if (activeTarget) {
                const timeSinceSpawn = (this.elapsed - activeTarget.spawnTime) * 1000;
                if (timeSinceSpawn >= this.aimbotReactionMs) {
                    // Snap to target with noise
                    const noise: Vec2 = {
                        x: (Math.random() - 0.5) * 2 * this.aimbotNoisePixels,
                        y: (Math.random() - 0.5) * 2 * this.aimbotNoisePixels,
                    };
                    this.aim = {
                        x: activeTarget.pos.x + noise.x,
                        y: activeTarget.pos.y + noise.y,
                    };

                    // Auto-fire
                    this.aimbotTimer += dt;
                    if (this.aimbotTimer >= 0.08) {
                        this.aimbotTimer = 0;
                        this.shoot();
                    }
                }
            }
        }

        // Track cursor for overshoot detection
        this.cursorHistory.push({ ...this.aim });
        if (this.cursorHistory.length > 10) this.cursorHistory.shift();

        this.render();
    }

    shoot(): void {
        const activeTarget = this.targets.find(t => !t.hit);
        if (!activeTarget) return;

        this.totalShots += 1;
        const d = Math.hypot(this.aim.x - activeTarget.pos.x, this.aim.y - activeTarget.pos.y);
        const hit = d <= TARGET_RADIUS;

        if (hit) {
            activeTarget.hit = true;
            activeTarget.hitTime = this.elapsed;
            this.totalHits += 1;
        }

        const reactionMs = (this.elapsed - activeTarget.spawnTime) * 1000;

        // Detect overshoot: did cursor path cross the target and come back?
        let overshoot = false;
        if (this.cursorHistory.length >= 3) {
            const recent = this.cursorHistory.slice(-5);
            let minDist = Infinity;
            let foundCloser = false;
            for (const p of recent) {
                const pd = Math.hypot(p.x - activeTarget.pos.x, p.y - activeTarget.pos.y);
                if (pd < minDist) { minDist = pd; foundCloser = true; }
                else if (foundCloser && pd > minDist + 5) { overshoot = true; break; }
            }
        }

        this.shotRecords.push({ reactionMs, overshoot, distance: d });
        if (this.shotRecords.length > REACTION_HISTORY) this.shotRecords.shift();

        // Push to graphs
        this.reactionGraph?.push(reactionMs, 500);
        const rollingAccuracy = this.shotRecords.filter(r => r.distance <= TARGET_RADIUS).length / this.shotRecords.length;
        this.accuracyGraph?.push(rollingAccuracy * 100, 100);

        // Run detection
        this.runDetection();
    }

    reset(): void {
        this.elapsed = 0;
        this.nextSpawn = 0;
        this.targets = [];
        this.totalShots = 0;
        this.totalHits = 0;
        this.shotRecords = [];
        this.verdict = "clean";
        this.lastNarrative = "";
        this.aimbotTimer = 0;
        this.cursorHistory = [];
        this.reactionGraph?.clear();
        this.accuracyGraph?.clear();
    }

    togglePaused(): void { this.paused = !this.paused; }

    private runDetection(): void {
        if (this.shotRecords.length < 8) { this.verdict = "clean"; return; }

        const reactions = this.shotRecords.map(r => r.reactionMs);
        const mean = reactions.reduce((a, b) => a + b, 0) / reactions.length;
        const variance = reactions.reduce((a, b) => a + (b - mean) ** 2, 0) / reactions.length;
        const stdDev = Math.sqrt(variance);

        const overshootRatio = this.shotRecords.filter(r => r.overshoot).length / this.shotRecords.length;
        const accuracy = this.shotRecords.filter(r => r.distance <= TARGET_RADIUS).length / this.shotRecords.length;

        // Thresholds scaled by sensitivity
        const stdDevThreshold = 80 * (1 + (1 - this.detectionSensitivity));
        const overshootThreshold = 0.15 * (1 + (1 - this.detectionSensitivity));
        const accuracyThreshold = 0.7 + 0.2 * this.detectionSensitivity;

        let score = 0;
        if (stdDev < stdDevThreshold) score += 1;
        if (overshootRatio < overshootThreshold) score += 1;
        if (accuracy > accuracyThreshold) score += 1;
        if (mean < 200) score += 1;

        if (score >= 3) {
            this.verdict = "detected";
            this.lastNarrative =
                `<b style="color:#ef5350">AIMBOT DETECTED.</b> σ(reaction)=${stdDev.toFixed(0)}ms (порог ${stdDevThreshold.toFixed(0)}), ` +
                `overshoot=${(overshootRatio * 100).toFixed(0)}% (порог ${(overshootThreshold * 100).toFixed(0)}%), ` +
                `accuracy=${(accuracy * 100).toFixed(0)}% (порог ${(accuracyThreshold * 100).toFixed(0)}%). ` +
                `Слишком стабильно для человека.`;
        } else if (score >= 2) {
            this.verdict = "suspect";
            this.lastNarrative =
                `<b style="color:#ffca28">Подозрение.</b> σ(reaction)=${stdDev.toFixed(0)}ms, ` +
                `accuracy=${(accuracy * 100).toFixed(0)}%. На грани — нужно больше данных.`;
        } else {
            this.verdict = "clean";
            this.lastNarrative =
                `<b style="color:#6fd48a">Чисто.</b> σ(reaction)=${stdDev.toFixed(0)}ms, ` +
                `overshoot=${(overshootRatio * 100).toFixed(0)}%. Поведение в пределах нормы.`;
        }
    }

    private render(): void {
        this.gfx.clear();

        // Background
        this.gfx.fillStyle(0x1b1f27, 1);
        this.gfx.fillRect(0, 0, W, H);

        // Grid
        this.gfx.lineStyle(1, 0x2a2f3a, 0.15);
        for (let x = 0; x < W; x += 50) this.gfx.lineBetween(x, 0, x, H);
        for (let y = 0; y < H; y += 50) this.gfx.lineBetween(0, y, W, y);

        // Targets
        for (const t of this.targets) {
            if (t.hit) {
                const age = this.elapsed - t.hitTime;
                if (age < 0.3) {
                    const alpha = 1 - age / 0.3;
                    this.gfx.lineStyle(2, HIT_COLOR, alpha);
                    this.gfx.strokeCircle(t.pos.x, t.pos.y, TARGET_RADIUS + age * 40);
                }
                continue;
            }
            const age = this.elapsed - t.spawnTime;
            const remaining = 1 - age / TARGET_LIFETIME;
            this.gfx.fillStyle(TARGET_COLOR, remaining * 0.8 + 0.2);
            this.gfx.fillCircle(t.pos.x, t.pos.y, TARGET_RADIUS);
            // Inner dot
            this.gfx.fillStyle(0xffffff, remaining * 0.5);
            this.gfx.fillCircle(t.pos.x, t.pos.y, 3);
        }

        // Crosshair
        this.gfx.lineStyle(1.5, CROSSHAIR_COLOR, 0.9);
        this.gfx.strokeCircle(this.aim.x, this.aim.y, 8);
        this.gfx.lineBetween(this.aim.x - 14, this.aim.y, this.aim.x - 4, this.aim.y);
        this.gfx.lineBetween(this.aim.x + 4, this.aim.y, this.aim.x + 14, this.aim.y);
        this.gfx.lineBetween(this.aim.x, this.aim.y - 14, this.aim.x, this.aim.y - 4);
        this.gfx.lineBetween(this.aim.x, this.aim.y + 4, this.aim.x, this.aim.y + 14);

        // Aimbot indicator
        if (this.aimbotOn) {
            this.gfx.lineStyle(1, 0xef5350, 0.3 + Math.sin(this.elapsed * 6) * 0.2);
            this.gfx.strokeCircle(this.aim.x, this.aim.y, 20);
        }
    }
}

/* ── Controls ── */

function buildControls(root: HTMLElement, scene: AimbotStatsScene): void {
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "Aimbot Statistics";
    root.appendChild(heading);

    buildHowTo(
        root,
        "<b>Как пользоваться:</b> стреляй по красным мишеням кликом или Space. Потом включи «Aimbot» — " +
        "и смотри, как гистограмма времени реакции сужается, overshoot исчезает, и детект срабатывает. " +
        "Добавь шум и задержку боту, чтобы замаскировать — но тогда он теряет преимущество.",
    );
    buildLegend(root, [
        { color: "#ef5350", label: "мишень" },
        { color: "#6fd48a", label: "попадание" },
        { color: "#ffca28", label: "прицел", shape: "ring" },
    ]);
    const setNarrative = buildNarrative(root, "Стреляй по мишеням — тут появится анализ поведения.");

    // Aimbot toggle
    const abRow = document.createElement("div");
    abRow.className = "control-row";
    const abLabel = document.createElement("label");
    abLabel.textContent = "🤖 Aimbot";
    const abCheck = document.createElement("input");
    abCheck.type = "checkbox";
    abCheck.checked = scene.aimbotOn;
    abCheck.addEventListener("change", () => { scene.aimbotOn = abCheck.checked; });
    abRow.append(abLabel, abCheck);
    root.appendChild(abRow);

    // Aimbot noise
    const noiseRow = document.createElement("div");
    noiseRow.className = "control-row";
    const noiseLabel = document.createElement("label");
    noiseLabel.textContent = "Noise (маскировка)";
    const noiseInput = document.createElement("input");
    noiseInput.type = "range";
    noiseInput.min = "0";
    noiseInput.max = "40";
    noiseInput.step = "1";
    noiseInput.value = String(scene.aimbotNoisePixels);
    const noiseValue = document.createElement("span");
    noiseValue.textContent = `${scene.aimbotNoisePixels}px`;
    noiseInput.addEventListener("input", () => {
        scene.aimbotNoisePixels = Number(noiseInput.value);
        noiseValue.textContent = `${scene.aimbotNoisePixels}px`;
    });
    noiseRow.append(noiseLabel, noiseInput, noiseValue);
    root.appendChild(noiseRow);

    // Aimbot reaction
    const reactRow = document.createElement("div");
    reactRow.className = "control-row";
    const reactLabel = document.createElement("label");
    reactLabel.textContent = "Задержка бота";
    const reactInput = document.createElement("input");
    reactInput.type = "range";
    reactInput.min = "0";
    reactInput.max = "400";
    reactInput.step = "10";
    reactInput.value = String(scene.aimbotReactionMs);
    const reactValue = document.createElement("span");
    reactValue.textContent = `${scene.aimbotReactionMs}ms`;
    reactInput.addEventListener("input", () => {
        scene.aimbotReactionMs = Number(reactInput.value);
        reactValue.textContent = `${scene.aimbotReactionMs}ms`;
    });
    reactRow.append(reactLabel, reactInput, reactValue);
    root.appendChild(reactRow);

    // Detection sensitivity
    const sensRow = document.createElement("div");
    sensRow.className = "control-row";
    const sensLabel = document.createElement("label");
    sensLabel.textContent = "Чувствительность";
    const sensInput = document.createElement("input");
    sensInput.type = "range";
    sensInput.min = "0.1";
    sensInput.max = "1.0";
    sensInput.step = "0.1";
    sensInput.value = String(scene.detectionSensitivity);
    const sensValue = document.createElement("span");
    sensValue.textContent = `${scene.detectionSensitivity.toFixed(1)}`;
    sensInput.addEventListener("input", () => {
        scene.detectionSensitivity = Number(sensInput.value);
        sensValue.textContent = `${scene.detectionSensitivity.toFixed(1)}`;
    });
    sensRow.append(sensLabel, sensInput, sensValue);
    root.appendChild(sensRow);

    // Pause / Reset
    const btnRow = document.createElement("div");
    btnRow.className = "control-row";
    const pauseBtn = document.createElement("button");
    pauseBtn.textContent = "Пауза";
    pauseBtn.addEventListener("click", () => scene.togglePaused());
    const resetBtn = document.createElement("button");
    resetBtn.textContent = "Reset (R)";
    resetBtn.addEventListener("click", () => scene.reset());
    btnRow.append(pauseBtn, resetBtn);
    root.appendChild(btnRow);

    // Metrics
    const table = document.createElement("table");
    table.className = "metrics-table";
    const metricsKeys: Array<[string, string]> = [
        ["accuracy", "Accuracy %"],
        ["reaction", "Median reaction"],
        ["stddev", "σ reaction"],
        ["overshoot", "Overshoot %"],
        ["verdict", "Вердикт"],
    ];
    const cells: Record<string, HTMLTableCellElement> = {};
    for (const [key, label] of metricsKeys) {
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
    scene.reactionGraph = new ScrollingGraph(
        buildGraphRow(root, "Время реакции, ms", "#4fc3f7", GRAPH_SAMPLES),
        GRAPH_SAMPLES,
        "#4fc3f7",
    );
    scene.accuracyGraph = new ScrollingGraph(
        buildGraphRow(root, "Accuracy (rolling), %", "#6fd48a", GRAPH_SAMPLES),
        GRAPH_SAMPLES,
        "#6fd48a",
    );

    // Links
    const hint = document.createElement("p");
    hint.style.color = "#8b93a3";
    hint.innerHTML =
        'Часть примеров к статье «Как немножко обмануть сервер». ' +
        '<a href="../index.html" style="color:#4fc3f7">&larr; Все примеры</a> &middot; ' +
        '<a href="cheat-hallucination-trap.html" style="color:#4fc3f7">Hallucination Trap</a> &middot; ' +
        '<a href="cheat-client-authority.html" style="color:#4fc3f7">Client Authority</a>';
    root.appendChild(hint);

    const tick = () => {
        if (scene.shotRecords.length > 0) {
            const acc = scene.shotRecords.filter(r => r.distance <= TARGET_RADIUS).length / scene.shotRecords.length;
            cells.accuracy.textContent = `${(acc * 100).toFixed(1)}%`;
            cells.accuracy.style.color = acc > 0.85 ? "#ffca28" : "#6fd48a";

            const reactions = scene.shotRecords.map(r => r.reactionMs).sort((a, b) => a - b);
            const median = reactions[Math.floor(reactions.length / 2)];
            cells.reaction.textContent = `${median.toFixed(0)}ms`;

            const mean = reactions.reduce((a, b) => a + b, 0) / reactions.length;
            const variance = reactions.reduce((a, b) => a + (b - mean) ** 2, 0) / reactions.length;
            const stdDev = Math.sqrt(variance);
            cells.stddev.textContent = `${stdDev.toFixed(0)}ms`;
            cells.stddev.style.color = stdDev < 50 ? "#ef5350" : "#6fd48a";

            const overshoot = scene.shotRecords.filter(r => r.overshoot).length / scene.shotRecords.length;
            cells.overshoot.textContent = `${(overshoot * 100).toFixed(0)}%`;
        }

        const verdictMap = { clean: ["✅ Чисто", "#6fd48a"], suspect: ["⚠ Подозрение", "#ffca28"], detected: ["🚫 AIMBOT!", "#ef5350"] };
        const [text, color] = verdictMap[scene.verdict];
        cells.verdict.textContent = text;
        cells.verdict.style.color = color;

        if (scene.lastNarrative) setNarrative(scene.lastNarrative);
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

/* ── Boot ── */

const gameRoot = document.getElementById("game-root");
const controlRoot = document.getElementById("control-panel");
if (!gameRoot || !controlRoot) throw new Error("cheat-aimbot-stats: expected #game-root and #control-panel");

const scene = new AimbotStatsScene();
const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: gameRoot,
    width: W,
    height: H,
    backgroundColor: "#14181f",
    scene: [scene],
    fps: { target: 60 },
});

game.events.once(Phaser.Core.Events.READY, () => buildControls(controlRoot, scene));
