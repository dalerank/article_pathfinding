import Phaser from "phaser";
import { buildHowTo, buildLegend, buildNarrative } from "@/rendering/ExplainerPanel";
import { addButtons, addCheckbox, addFooter, addHeading, addMetrics, addNote, addSegmented, addSlider } from "@/lies/panel";
import { NGramPredictor, argmax } from "@/lies/ngram";

const WORLD_WIDTH = 900;
const WORLD_HEIGHT = 420;
const AX = 10;
const AY = 30;
const AW = 600;
const AH = 380;
const LANES = 3;
const LANE_W = 150;
const LANES_X0 = AX + (AW - LANE_W * LANES) / 2;
const TURRET_Y = AY + 50;
const PLAYER_Y = AY + AH - 50;
const SIDE_X = 625;
const SIDE_W = 265;
const ROLLING = 12;
const LANE_ARROW = ["←", "↑", "→"];

type Shooter = "random" | "full" | "dda";
type Phase = "aim" | "fire" | "result" | "idle";

const SHOOTER_NAME: Record<Shooter, string> = {
    random: "случайный стрелок",
    full: "предсказатель на полную",
    dda: "предсказатель с DDA",
};

class DdaScene extends Phaser.Scene {
    shooter: Shooter = "full";
    roundSec = 1.1;
    targetHitRate = 0.35;
    showThoughts = true;
    botPlays = false;
    predictor = new NGramPredictor(3, LANES);
    lane = 1;
    phase: Phase = "idle";
    timer = 0;
    shotLane = 1;
    predicted = 1;
    predictedProbs = [1 / 3, 1 / 3, 1 / 3];
    contextLen = 0;
    mercy = 0; // DDA: probability of deliberately shooting away from the prediction
    usedMercy = false;
    rounds = 0;
    hits = 0;
    correctPredictions = 0;
    outcomes: boolean[] = []; // true = player was hit
    rollingLog: number[] = [];
    mercyLog: number[] = [];
    lastResult: "hit" | "miss" | null = null;
    flash = 0;
    narrative = "";
    private botState = { last: 1, streak: 0 };
    private g!: Phaser.GameObjects.Graphics;
    private texts: Record<string, Phaser.GameObjects.Text> = {};

    constructor() {
        super("lie-dda");
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);
        this.g = this.add.graphics();
        const font = "system-ui, sans-serif";
        const t = (key: string, x: number, y: number, size: number, color = "#e6e8eb") => {
            this.texts[key] = this.add.text(x, y, "", { fontFamily: font, fontSize: `${size}px`, color }).setDepth(5);
        };
        t("title", AX, 8, 13, "#c5cad3");
        t("score", SIDE_X, 8, 14);
        t("thought", SIDE_X, 36, 12, "#ffca28");
        t("graphCap", SIDE_X, 214, 11, "#8b93a3");
        t("mercy", SIDE_X, 338, 12, "#6fd48a");
        t("overlay", AX + AW / 2, AY + AH / 2, 18, "#ffca28");
        t("result", AX + AW / 2, PLAYER_Y - 70, 22, "#ffffff");
        this.texts.overlay.setOrigin(0.5).setAlign("center");
        this.texts.result.setOrigin(0.5);
        this.texts.thought.setWordWrapWidth(SIDE_W);
        this.texts.mercy.setWordWrapWidth(SIDE_W);
        this.texts.graphCap.setText(`в тебя попали за последние ${ROLLING} раундов`);
        for (let i = 0; i < LANES; i++) {
            this.add
                .text(LANES_X0 + i * LANE_W + LANE_W / 2, PLAYER_Y + 26, `${LANE_ARROW[i]} / ${"ASD"[i]}`, {
                    fontFamily: font,
                    fontSize: "12px",
                    color: "#8b93a3",
                })
                .setOrigin(0.5, 0);
        }
        const kb = this.input.keyboard!;
        kb.on("keydown", (e: KeyboardEvent) => {
            const map: Record<string, number> = { ArrowLeft: 0, KeyA: 0, ArrowUp: 1, ArrowDown: 1, KeyS: 1, KeyW: 1, ArrowRight: 2, KeyD: 2, Digit1: 0, Digit2: 1, Digit3: 2 };
            if (e.code in map) {
                e.preventDefault();
                this.choose(map[e.code]);
            }
        });
        this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
            if (this.phase === "idle") {
                this.startRound();
                return;
            }
            const i = Math.floor((p.x - LANES_X0) / LANE_W);
            if (i >= 0 && i < LANES) this.choose(i);
        });
        this.narrative =
            "Кликни по полю. Каждый раунд стрелок стреляет в одну из трёх дорожек — успей встать в другую " +
            "(стрелки ← ↑ → или A/S/D, или клик по дорожке). Стрелок учится на твоих ходах.";
    }

    choose(lane: number): void {
        if (this.botPlays) return;
        if (this.phase === "idle") this.startRound();
        if (this.phase === "aim") this.lane = lane;
    }

    resetAll(): void {
        this.predictor.reset();
        this.mercy = 0;
        this.rounds = 0;
        this.hits = 0;
        this.correctPredictions = 0;
        this.outcomes = [];
        this.rollingLog = [];
        this.mercyLog = [];
        this.lastResult = null;
        this.phase = "idle";
        this.narrative = "Сброшено: стрелок забыл всё, что знал о тебе. Кликни по полю.";
    }

    startRound(): void {
        const pred = this.predictor.predict();
        this.predictedProbs = pred.probs;
        this.contextLen = pred.contextLen;
        this.predicted = argmax(pred.probs);
        this.usedMercy = false;
        if (this.shooter === "random") this.shotLane = Math.floor(Math.random() * LANES);
        else if (this.shooter === "full") this.shotLane = this.predicted;
        else {
            if (Math.random() < this.mercy) {
                // deliberately aim where the player most likely is NOT
                const others = [0, 1, 2].filter((l) => l !== this.predicted);
                this.shotLane = others[Math.floor(Math.random() * others.length)];
                this.usedMercy = true;
            } else this.shotLane = this.predicted;
        }
        this.phase = "aim";
        this.timer = this.roundSec;
        this.lastResult = null;
    }

    resolveRound(): void {
        const hit = this.lane === this.shotLane;
        this.rounds += 1;
        if (hit) this.hits += 1;
        if (this.lane === this.predicted) this.correctPredictions += 1;
        this.outcomes.push(hit);
        if (this.outcomes.length > ROLLING) this.outcomes.shift();
        const rolling = this.outcomes.filter(Boolean).length / this.outcomes.length;
        this.rollingLog.push(rolling);
        if (this.rollingLog.length > 80) this.rollingLog.shift();

        // DDA controller: push mercy up when the player is hit more than the target, down otherwise
        if (this.shooter === "dda") {
            const error = rolling - this.targetHitRate;
            this.mercy = Phaser.Math.Clamp(this.mercy + error * 0.35, 0, 1);
        }
        this.mercyLog.push(this.mercy);
        if (this.mercyLog.length > 80) this.mercyLog.shift();

        this.predictor.observe(this.lane);
        this.lastResult = hit ? "hit" : "miss";
        this.flash = 1;
        if (!this.botPlays || this.rounds % 5 === 0) {
            const accuracy = (this.correctPredictions / this.rounds) * 100;
            this.narrative =
                (hit ? "<b>Попал в тебя.</b> " : "Увернулся. ") +
                `Стрелок угадывает твой ход в ${accuracy.toFixed(0)}% раундов (случайно было бы 33%). ` +
                (this.shooter === "dda"
                    ? this.usedMercy
                        ? "В этом раунде он <b>знал</b>, куда ты пойдёшь, и специально выстрелил мимо."
                        : `Сейчас поддаётся с шансом ${(this.mercy * 100).toFixed(0)}%.`
                    : this.shooter === "full"
                      ? "Он бьёт туда, куда ты скорее всего пойдёшь, без жалости."
                      : "Он не думает вообще, просто бросает кубик.");
        }
    }

    /** A "human-like" bot: likes to alternate, avoids staying 3 times in a row, a bit of noise. */
    botMove(): number {
        const s = this.botState;
        let lane: number;
        const r = Math.random();
        if (r < 0.2) lane = Math.floor(Math.random() * LANES);
        else if (s.streak >= 2) lane = (s.last + 1 + Math.floor(Math.random() * 2)) % LANES;
        else if (r < 0.65) lane = s.last === 0 ? 2 : s.last === 2 ? 0 : Math.random() < 0.5 ? 0 : 2;
        else lane = s.last;
        s.streak = lane === s.last ? s.streak + 1 : 0;
        s.last = lane;
        return lane;
    }

    fastForward(n: number): void {
        const wasBot = this.botPlays;
        for (let i = 0; i < n; i++) {
            this.startRound();
            this.lane = this.botMove();
            this.resolveRound();
        }
        this.botPlays = wasBot;
        this.phase = "idle";
        this.narrative =
            `Бот-«человек» (любит чередовать, не стоит три раза подряд) сыграл ${n} раундов. ` +
            `Стрелок угадал его ход в ${((this.correctPredictions / this.rounds) * 100).toFixed(0)}% случаев, ` +
            `попаданий ${((this.hits / this.rounds) * 100).toFixed(0)}%.` +
            (this.shooter === "dda" ? ` DDA держит цель ${(this.targetHitRate * 100).toFixed(0)}%.` : "");
    }

    update(_time: number, deltaMs: number): void {
        const dt = Math.min(deltaMs, 50) / 1000;
        this.flash = Math.max(0, this.flash - dt * 2.5);
        if (this.phase === "aim") {
            this.timer -= dt;
            if (this.botPlays && this.timer < this.roundSec * 0.4 && this.timer + dt >= this.roundSec * 0.4) this.lane = this.botMove();
            if (this.timer <= 0) {
                this.phase = "fire";
                this.timer = 0.28;
            }
        } else if (this.phase === "fire") {
            this.timer -= dt;
            if (this.timer <= 0) {
                this.resolveRound();
                this.phase = "result";
                this.timer = 0.7; // a short breather to see the result and the shooter's reasoning
            }
        } else if (this.phase === "result") {
            this.timer -= dt;
            if (this.timer <= 0) this.startRound();
        } else if (this.phase === "idle" && this.botPlays) this.startRound();
        this.draw();
    }

    /** The shooter's prediction is only shown once the shot is committed, otherwise dodging is trivial. */
    get revealed(): boolean {
        return this.phase === "fire" || this.phase === "result";
    }

    draw(): void {
        const g = this.g;
        g.clear();
        g.fillStyle(0x1b1f27, 1);
        g.fillRect(AX, AY, AW, AH);
        g.lineStyle(1, 0x2a2f3a, 1);
        g.strokeRect(AX, AY, AW, AH);
        const laneCx = (i: number) => LANES_X0 + i * LANE_W + LANE_W / 2;

        for (let i = 0; i < LANES; i++) {
            g.fillStyle(i === this.lane ? 0x223040 : 0x181c23, 1);
            g.fillRect(LANES_X0 + i * LANE_W + 4, AY + 10, LANE_W - 8, AH - 20);
            if (this.showThoughts && this.revealed && this.shooter !== "random") {
                const p = this.predictedProbs[i];
                g.fillStyle(0xff8a3d, 0.15 + p * 0.6);
                g.fillRect(LANES_X0 + i * LANE_W + 10, TURRET_Y + 28, (LANE_W - 20) * p, 8);
            }
        }

        // turret
        const aimX = this.revealed ? laneCx(this.shotLane) : AX + AW / 2;
        g.fillStyle(0xb57edc, 1);
        g.fillCircle(AX + AW / 2, TURRET_Y, 18);
        g.lineStyle(6, 0xb57edc, 1);
        g.lineBetween(AX + AW / 2, TURRET_Y, AX + AW / 2 + (aimX - (AX + AW / 2)) * 0.25, TURRET_Y + 26);
        if (this.phase === "aim") {
            const k = 1 - this.timer / this.roundSec;
            g.fillStyle(0xffca28, 0.9);
            g.fillRect(AX + AW / 2 - 60, TURRET_Y - 34, 120 * Phaser.Math.Clamp(k, 0, 1), 5);
        }
        if (this.phase === "fire") {
            const k = 1 - this.timer / 0.28;
            const bx = AX + AW / 2 + (laneCx(this.shotLane) - (AX + AW / 2)) * k;
            const by = TURRET_Y + (PLAYER_Y - TURRET_Y) * k;
            g.fillStyle(0xef5350, 1);
            g.fillCircle(bx, by, 9);
        }

        // player
        const hitFlash = this.lastResult === "hit" && this.flash > 0;
        g.fillStyle(hitFlash ? 0xef5350 : 0x4fc3f7, 1);
        g.fillRoundedRect(laneCx(this.lane) - 18, PLAYER_Y - 14, 36, 28, 6);
        this.texts.result.setText(this.flash > 0 && this.lastResult ? (this.lastResult === "hit" ? "ПОПАЛ" : "мимо") : "");
        this.texts.result.setColor(this.lastResult === "hit" ? "#ef5350" : "#6fd48a").setAlpha(this.flash);

        if (this.phase === "idle") {
            g.fillStyle(0x14181f, 0.7);
            g.fillRect(AX, AY, AW, AH);
        }
        this.texts.overlay.setText(this.phase === "idle" ? "Кликни, чтобы начать\n← ↑ → или A/S/D" : "");
        this.texts.title.setText(`Стрелок: ${SHOOTER_NAME[this.shooter]}`);

        // side
        const rate = this.rounds ? (this.hits / this.rounds) * 100 : 0;
        this.texts.score.setText(`Раунд ${this.rounds} · попаданий ${rate.toFixed(0)}%`);
        let thought = "";
        if (!this.showThoughts) thought = "Мысли стрелка скрыты.";
        else if (this.shooter === "random") thought = "Стреляю куда попало. Ничего о тебе не помню.";
        else if (!this.revealed) thought = "Целюсь… (мысли покажу после выстрела, иначе было бы слишком просто)";
        else {
            const ctx = this.predictor.history.slice(this.predictor.history.length - this.contextLen).map((l) => LANE_ARROW[l]).join("");
            const probs = this.predictedProbs.map((p, i) => `${LANE_ARROW[i]} ${(p * 100).toFixed(0)}%`).join("  ");
            thought =
                (this.contextLen ? `Последние ходы: ${ctx}\nПосле такого ты обычно идёшь:\n` : "Пока мало данных, считаю общие частоты:\n") +
                `${probs}\nЦелюсь в ${LANE_ARROW[this.shotLane]}` +
                (this.usedMercy ? " — нарочно мимо прогноза" : "");
        }
        this.texts.thought.setText(thought);

        // rolling hit-rate graph
        const gy = 230;
        const gh = 100;
        g.fillStyle(0x1b1f27, 1);
        g.fillRect(SIDE_X, gy, SIDE_W, gh);
        g.lineStyle(1, 0x2a2f3a, 1);
        g.strokeRect(SIDE_X, gy, SIDE_W, gh);
        const yOf = (v: number) => gy + gh - v * (gh - 6) - 3;
        g.lineStyle(1, 0x4fc3f7, 0.25);
        g.lineBetween(SIDE_X, yOf(1 / 3), SIDE_X + SIDE_W, yOf(1 / 3));
        if (this.shooter === "dda") {
            g.lineStyle(1.5, 0x6fd48a, 0.8);
            g.lineBetween(SIDE_X, yOf(this.targetHitRate), SIDE_X + SIDE_W, yOf(this.targetHitRate));
        }
        const plot = (log: number[], color: number) => {
            if (log.length < 2) return;
            g.lineStyle(2, color, 0.95);
            g.beginPath();
            log.forEach((v, i) => {
                const x = SIDE_X + (i / 79) * SIDE_W;
                if (i === 0) g.moveTo(x, yOf(v));
                else g.lineTo(x, yOf(v));
            });
            g.strokePath();
        };
        plot(this.rollingLog, 0xef5350);
        if (this.shooter === "dda") plot(this.mercyLog, 0x6fd48a);
        this.texts.mercy.setText(
            this.shooter === "dda"
                ? `DDA: поддаётся с шансом ${(this.mercy * 100).toFixed(0)}% (зелёная линия — цель и «жалость»)`
                : "голубая линия — 33%, уровень случайного стрелка",
        );
    }
}

function buildControls(root: HTMLElement, scene: DdaScene): void {
    root.innerHTML = "";
    addHeading(root, "DDA: n-gram");
    buildHowTo(
        root,
        "<b>Как пользоваться:</b> кликни по полю и уворачивайся: перед выстрелом встань в дорожку, куда стрелок " +
            "не попадёт (← ↑ → или A/S/D). Стрелок запоминает последовательности твоих ходов. «На полную» быстро " +
            "начинает попадать — люди предсказуемы. DDA знает то же самое, но нарочно мажет, чтобы держать заданный процент.",
    );
    buildLegend(root, [
        { color: "#4fc3f7", label: "ты" },
        { color: "#ff8a3d", label: "прогноз стрелка" },
        { color: "#ef5350", label: "доля попаданий" },
        { color: "#6fd48a", label: "цель DDA / жалость", shape: "line" },
    ]);
    const setNarrative = buildNarrative(root, "");

    addSegmented(
        root,
        "Стрелок",
        [
            { value: "random" as Shooter, label: "Случайный" },
            { value: "full" as Shooter, label: "На полную" },
            { value: "dda" as Shooter, label: "DDA" },
        ],
        scene.shooter,
        (s) => {
            scene.shooter = s;
            scene.mercy = 0;
        },
    );
    addSlider(root, "Цель DDA: попаданий", { min: 0.1, max: 0.6, step: 0.05, value: scene.targetHitRate, format: (v) => `${Math.round(v * 100)}%` }, (v) => {
        scene.targetHitRate = v;
    });
    addSlider(root, "Время на раунд", { min: 0.5, max: 2, step: 0.1, value: scene.roundSec, format: (v) => `${v.toFixed(1)}с` }, (v) => {
        scene.roundSec = v;
    });
    addCheckbox(root, "Показать мысли стрелка", scene.showThoughts, (v) => {
        scene.showThoughts = v;
    });
    addCheckbox(root, "Бот-«человек» играет за меня", scene.botPlays, (v) => {
        scene.botPlays = v;
    });
    addButtons(root, [
        { label: "Бот ×200 мгновенно", onClick: () => scene.fastForward(200) },
        { label: "Сбросить память стрелка", onClick: () => scene.resetAll() },
    ]);

    const set = addMetrics(root, [""], [
        ["rounds", "Раундов"],
        ["hits", "В тебя попали"],
        ["acc", "Стрелок угадал ход"],
        ["mercy", "Поддаётся (DDA)"],
    ]);
    addNote(root, "Стрелок угадывает ход заметно чаще 33%, если ты играешь «как человек». Попробуй нарочно ходить случайно — это тяжелее, чем кажется.");
    addFooter(root, "lie-dda.html");

    let last = "";
    const tick = () => {
        set("rounds", 0, String(scene.rounds));
        set("hits", 0, scene.rounds ? `${((scene.hits / scene.rounds) * 100).toFixed(0)}%` : "-");
        set("acc", 0, scene.rounds ? `${((scene.correctPredictions / scene.rounds) * 100).toFixed(0)}%` : "-");
        set("mercy", 0, scene.shooter === "dda" ? `${(scene.mercy * 100).toFixed(0)}%` : "-");
        if (scene.narrative !== last) {
            last = scene.narrative;
            setNarrative(last);
        }
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

const gameRoot = document.getElementById("game-root");
const controlRoot = document.getElementById("control-panel");
if (!gameRoot || !controlRoot) throw new Error("lie-dda: expected #game-root and #control-panel");

const scene = new DdaScene();
const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: gameRoot,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    backgroundColor: "#14181f",
    scene: [scene],
});
game.events.once(Phaser.Core.Events.READY, () => buildControls(controlRoot, scene));
