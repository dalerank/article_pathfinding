import Phaser from "phaser";
import { buildHowTo, buildLegend, buildNarrative } from "@/rendering/ExplainerPanel";
import { addButtons, addCheckbox, addFooter, addHeading, addMetrics, addNote, addSlider } from "@/lies/panel";
import { PityConfig, PityMode, dropChance, prdConstantFor } from "@/lies/pity";

const WORLD_WIDTH = 900;
const WORLD_HEIGHT = 420;
const LANE_W = 290;
const LANE_GAP = 15;
const LANE_X = (i: number) => 10 + i * (LANE_W + LANE_GAP);
const BAR_X = 18; // relative to lane
const BAR_W = LANE_W - 36;
const BAR_Y = 78;
const BAR_H = 26;
const STRIP_Y = 168;
const STRIP_N = 48;
const HIST_Y = 220;
const HIST_H = 150;
const HIST_MAX = 40;

const MODES: PityMode[] = ["honest", "pity", "prd"];
const MODE_TITLE: Record<PityMode, string> = {
    honest: "Честно: всегда ровно шанс",
    pity: "Pity: шанс растёт, потом гарантия",
    prd: "PRD: шанс = C × промахи",
};
const MODE_COLOR: Record<PityMode, number> = { honest: 0xef5350, pity: 0x6fd48a, prd: 0x4fc3f7 };
const MODE_CSS: Record<PityMode, string> = { honest: "#ef5350", pity: "#6fd48a", prd: "#4fc3f7" };

interface Lane {
    mode: PityMode;
    misses: number;
    rolls: number;
    drops: number;
    worst: number;
    streaks: number[];
    history: boolean[];
    lastChance: number; // chance that was used for the last roll
    lastHit: boolean | null;
    flash: number; // 0..1, fades after a drop
    chanceText: Phaser.GameObjects.Text;
    missText: Phaser.GameObjects.Text;
    resultText: Phaser.GameObjects.Text;
    statText: Phaser.GameObjects.Text;
}

class PityScene extends Phaser.Scene {
    cfg: PityConfig = { displayedChance: 0.1, softPityStart: 8, hardPity: 18 };
    rollsPerSecond = 3;
    auto = false;
    prdC = prdConstantFor(0.1);
    lanes: Lane[] = [];
    lastRoll: number | null = null; // shared dice value, 0..99
    rollingFor = 0; // ms left of the "dice is spinning" animation
    spinValue = 0;
    cooldown = 0;
    lastNarrative = "";
    private g!: Phaser.GameObjects.Graphics;
    private bigRoll!: Phaser.GameObjects.Text;

    constructor() {
        super("lie-pity-timer");
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);
        this.g = this.add.graphics();
        const small = { fontFamily: "system-ui, sans-serif", fontSize: "11px", color: "#8b93a3" };
        const mid = { fontFamily: "system-ui, sans-serif", fontSize: "13px", color: "#e6e8eb" };
        this.bigRoll = this.add
            .text(WORLD_WIDTH / 2, 6, "", { fontFamily: "system-ui, sans-serif", fontSize: "16px", color: "#ffca28" })
            .setOrigin(0.5, 0);
        MODES.forEach((mode, i) => {
            const x = LANE_X(i);
            this.add.text(x + BAR_X, 34, MODE_TITLE[mode], { ...mid, color: MODE_CSS[mode] });
            this.add.text(x + BAR_X, BAR_Y + BAR_H + 2, "0", small);
            this.add.text(x + BAR_X + BAR_W - 14, BAR_Y + BAR_H + 2, "99", small);
            this.add.text(x + BAR_X, STRIP_Y - 15, `последние ${STRIP_N} бросков`, small);
            this.add.text(x + BAR_X, HIST_Y - 15, "серии промахов до выпадения", small);
            this.add.text(x + BAR_X + BAR_W - 18, HIST_Y + HIST_H + 2, `${HIST_MAX}+`, small);
            this.lanes.push({
                mode,
                misses: 0,
                rolls: 0,
                drops: 0,
                worst: 0,
                streaks: [],
                history: [],
                lastChance: 0,
                lastHit: null,
                flash: 0,
                chanceText: this.add.text(x + BAR_X, BAR_Y - 20, "", mid),
                missText: this.add.text(x + BAR_X, BAR_Y + BAR_H + 18, "", mid),
                resultText: this.add.text(x + LANE_W - 18, BAR_Y + BAR_H + 18, "", mid).setOrigin(1, 0),
                statText: this.add.text(x + BAR_X, HIST_Y + HIST_H + 16, "", small),
            });
        });
    }

    setChance(v: number): void {
        this.cfg.displayedChance = v;
        this.prdC = prdConstantFor(v);
    }

    currentChance(lane: Lane): number {
        return dropChance(lane.mode, lane.misses, this.cfg, this.prdC);
    }

    reset(): void {
        for (const l of this.lanes) {
            Object.assign(l, { misses: 0, rolls: 0, drops: 0, worst: 0, streaks: [], history: [], lastHit: null, flash: 0 });
        }
        this.lastRoll = null;
        this.lastNarrative = "";
    }

    /** Start the visible roll; the result is applied when the spin ends. */
    roll(): void {
        if (this.rollingFor > 0) return;
        this.rollingFor = this.rollsPerSecond > 8 ? 0 : Math.min(450, 900 / this.rollsPerSecond);
        if (this.rollingFor === 0) this.resolve(Math.floor(Math.random() * 100));
    }

    /** Same dice value for all three lanes — only the rule about "how lucky must you be now" differs. */
    resolve(value: number, quiet = false): void {
        this.lastRoll = value;
        const parts: string[] = [];
        for (const l of this.lanes) {
            const chance = this.currentChance(l);
            const hit = value < Math.round(chance * 100);
            l.lastChance = chance;
            l.lastHit = hit;
            l.rolls += 1;
            if (hit) {
                l.streaks.push(l.misses);
                l.drops += 1;
                l.misses = 0;
                l.flash = 1;
            } else {
                l.misses += 1;
                l.worst = Math.max(l.worst, l.misses);
            }
            l.history.push(hit);
            if (l.history.length > STRIP_N) l.history.shift();
            if (!quiet) {
                const name = l.mode === "honest" ? "Честно" : l.mode === "pity" ? "Pity" : "PRD";
                parts.push(
                    `${name}: нужно &lt;${Math.round(chance * 100)} — ` +
                        (hit ? `<b style="color:${MODE_CSS[l.mode]}">ВЫПАЛО</b>` : `мимо (${l.misses}-й подряд)`),
                );
            }
        }
        if (!quiet) this.lastNarrative = `Кубик показал <b>${value}</b>. ` + parts.join("; ") + ".";
    }

    burst(n: number): void {
        for (let i = 0; i < n; i++) this.resolve(Math.floor(Math.random() * 100), true);
        this.lastNarrative =
            `Прокрутили ${n} бросков мгновенно. Смотри на «худшую серию»: у честного кубика она почти всегда в разы длиннее, ` +
            `хотя на экране у всех одно и то же ${Math.round(this.cfg.displayedChance * 100)}%.`;
    }

    update(_time: number, delta: number): void {
        if (this.rollingFor > 0) {
            this.rollingFor -= delta;
            this.spinValue = Math.floor(Math.random() * 100);
            if (this.rollingFor <= 0) {
                this.rollingFor = 0;
                this.resolve(Math.floor(Math.random() * 100));
                this.cooldown = 1000 / this.rollsPerSecond - Math.min(450, 900 / this.rollsPerSecond);
            }
        } else if (this.auto) {
            this.cooldown -= delta;
            if (this.cooldown <= 0) {
                if (this.rollsPerSecond > 8) {
                    // fast mode: several resolves per frame, no spin
                    const n = Math.max(1, Math.round((this.rollsPerSecond * delta) / 1000));
                    for (let i = 0; i < n; i++) this.resolve(Math.floor(Math.random() * 100));
                    this.cooldown = 0;
                } else {
                    this.roll();
                }
            }
        }
        for (const l of this.lanes) l.flash = Math.max(0, l.flash - delta / 700);
        this.draw();
    }

    draw(): void {
        const g = this.g;
        g.clear();
        const spinning = this.rollingFor > 0;
        const shown = spinning ? this.spinValue : this.lastRoll;
        this.bigRoll.setText(
            shown === null ? "Нажми «Бросить»" : spinning ? `кубик крутится… ${shown}` : `кубик: ${shown}  (один и тот же для всех трёх)`,
        );

        this.lanes.forEach((l, i) => {
            const x = LANE_X(i);
            const color = MODE_COLOR[l.mode];
            g.fillStyle(0x1b1f27, 1);
            g.fillRoundedRect(x, 26, LANE_W, WORLD_HEIGHT - 32, 6);
            if (l.flash > 0) {
                g.fillStyle(color, 0.25 * l.flash);
                g.fillRoundedRect(x, 26, LANE_W, WORLD_HEIGHT - 32, 6);
            }

            // chance bar: the green zone is "values that drop the item" right now
            const chanceNow = this.currentChance(l);
            const bx = x + BAR_X;
            g.fillStyle(0x2a2f3a, 1);
            g.fillRect(bx, BAR_Y, BAR_W, BAR_H);
            g.fillStyle(color, 0.85);
            g.fillRect(bx, BAR_Y, BAR_W * chanceNow, BAR_H);
            // the number the tooltip promises, as a fixed tick: everything right of it is the lie
            g.lineStyle(2, 0xffffff, 0.8);
            const promisedX = bx + BAR_W * this.cfg.displayedChance;
            g.lineBetween(promisedX, BAR_Y - 4, promisedX, BAR_Y + BAR_H + 4);

            if (shown !== null) {
                const px = bx + (BAR_W * (shown + 0.5)) / 100;
                const markerColor = spinning ? 0xffca28 : l.lastHit ? 0xffffff : 0x8b93a3;
                g.fillStyle(markerColor, 1);
                g.fillTriangle(px - 6, BAR_Y - 12, px + 6, BAR_Y - 12, px, BAR_Y - 2);
                g.lineStyle(2, markerColor, 1);
                g.lineBetween(px, BAR_Y, px, BAR_Y + BAR_H);
            }

            const lied = Math.round(chanceNow * 100) !== Math.round(this.cfg.displayedChance * 100);
            l.chanceText.setText(
                `на экране ${Math.round(this.cfg.displayedChance * 100)}%  →  сейчас ${Math.round(chanceNow * 100)}%` +
                    (lied ? "  (подкрутили)" : ""),
            );
            l.chanceText.setColor(lied ? MODE_CSS[l.mode] : "#e6e8eb");
            l.missText.setText(`промахов подряд: ${l.misses}`);
            l.missText.setColor(l.misses >= 2 / this.cfg.displayedChance ? "#ef5350" : "#e6e8eb");
            l.resultText.setText(spinning || l.lastHit === null ? "" : l.lastHit ? "ВЫПАЛО!" : "мимо");
            l.resultText.setColor(l.lastHit ? MODE_CSS[l.mode] : "#8b93a3");

            // history strip
            const cw = BAR_W / STRIP_N;
            l.history.forEach((hit, k) => {
                g.fillStyle(hit ? color : 0x2a2f3a, 1);
                g.fillRect(bx + k * cw, STRIP_Y, Math.max(1, cw - 1), 18);
            });

            // live histogram of dry streaks
            const hist = new Array(HIST_MAX + 1).fill(0);
            for (const s of l.streaks) hist[Math.min(HIST_MAX, s)] += 1;
            const maxC = Math.max(1, ...hist);
            const hw = BAR_W / (HIST_MAX + 1);
            g.lineStyle(1, 0x2a2f3a, 1);
            g.strokeRect(bx, HIST_Y, BAR_W, HIST_H);
            hist.forEach((c, k) => {
                if (!c) return;
                const h = (c / maxC) * (HIST_H - 6);
                g.fillStyle(color, 0.8);
                g.fillRect(bx + k * hw, HIST_Y + HIST_H - h, Math.max(1, hw - 1), h);
            });
            if (l.worst > 0) {
                const wx = bx + (Math.min(HIST_MAX, l.worst) + 0.5) * hw;
                g.lineStyle(2, 0xffca28, 0.9);
                g.lineBetween(wx, HIST_Y, wx, HIST_Y + HIST_H);
            }
            l.statText.setText(
                `бросков ${l.rolls} · выпало ${l.rolls ? ((l.drops / l.rolls) * 100).toFixed(1) : "0"}% · худшая серия ${l.worst}`,
            );
        });
    }
}

function buildControls(root: HTMLElement, scene: PityScene): void {
    root.innerHTML = "";
    addHeading(root, "Pity Timer");
    buildHowTo(
        root,
        "<b>Как пользоваться:</b> три игрока кидают <b>один и тот же</b> кубик 0–99. Выпадение — если число попало " +
            "в цветную зону. Белая черта — шанс, который написан в игре. У честного зона не меняется никогда, у " +
            "Pity и PRD она растёт с каждым промахом. Жми «Бросить» или включи автоброски и смотри, где начинается враньё.",
    );
    buildLegend(root, [
        { color: MODE_CSS.honest, label: "честно" },
        { color: MODE_CSS.pity, label: "pity" },
        { color: MODE_CSS.prd, label: "PRD" },
        { color: "#ffffff", label: "обещанный шанс", shape: "line" },
        { color: "#ffca28", label: "худшая серия", shape: "line" },
    ]);
    const setNarrative = buildNarrative(root, "Нажми «Бросить».");

    addButtons(root, [
        { label: "🎲 Бросить", onClick: () => scene.roll() },
        { label: "×100 мгновенно", onClick: () => scene.burst(100) },
        { label: "Сброс", onClick: () => scene.reset() },
    ]);
    addCheckbox(root, "Автоброски", scene.auto, (v) => {
        scene.auto = v;
    });
    addSlider(root, "Скорость, бросков/с", { min: 1, max: 40, step: 1, value: scene.rollsPerSecond, format: (v) => String(v) }, (v) => {
        scene.rollsPerSecond = v;
    });
    addSlider(root, "Шанс на экране", { min: 0.02, max: 0.5, step: 0.01, value: scene.cfg.displayedChance, format: (v) => `${Math.round(v * 100)}%` }, (v) =>
        scene.setChance(v),
    );
    addSlider(root, "Pity: рост с промаха", { min: 1, max: 60, step: 1, value: scene.cfg.softPityStart, format: (v) => String(v) }, (v) => {
        scene.cfg.softPityStart = Math.min(v, scene.cfg.hardPity - 1);
    });
    addSlider(root, "Pity: гарантия на", { min: 2, max: 80, step: 1, value: scene.cfg.hardPity, format: (v) => String(v) }, (v) => {
        scene.cfg.hardPity = Math.max(v, scene.cfg.softPityStart + 1);
    });

    const set = addMetrics(root, ["Честно", "Pity", "PRD"], [
        ["real", "Реально выпало"],
        ["avg", "Средняя серия"],
        ["worst", "Худшая серия"],
    ]);
    addNote(root, "Pity честно врёт в пользу игрока — реальный шанс выше обещанного. PRD держит среднее честным, но отрезает длинные хвосты неудач.");
    addFooter(root, "lie-pity-timer.html");

    const tick = () => {
        scene.lanes.forEach((l, col) => {
            set("real", col, l.rolls ? `${((l.drops / l.rolls) * 100).toFixed(1)}%` : "-");
            const avg = l.streaks.length ? l.streaks.reduce((a, b) => a + b, 0) / l.streaks.length : NaN;
            set("avg", col, Number.isNaN(avg) ? "-" : avg.toFixed(1));
            set("worst", col, String(l.worst));
        });
        if (scene.lastNarrative) setNarrative(scene.lastNarrative);
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

const gameRoot = document.getElementById("game-root");
const controlRoot = document.getElementById("control-panel");
if (!gameRoot || !controlRoot) throw new Error("lie-pity-timer: expected #game-root and #control-panel");

const scene = new PityScene();
const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: gameRoot,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    backgroundColor: "#14181f",
    scene: [scene],
});
game.events.once(Phaser.Core.Events.READY, () => buildControls(controlRoot, scene));
