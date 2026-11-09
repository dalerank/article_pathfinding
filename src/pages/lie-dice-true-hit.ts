import Phaser from "phaser";
import { buildHowTo, buildLegend, buildNarrative } from "@/rendering/ExplainerPanel";
import { addButtons, addCheckbox, addFooter, addHeading, addMetrics, addNote, addSlider } from "@/lies/panel";
import { realHitChance } from "@/lies/dice";

const WORLD_WIDTH = 900;
const WORLD_HEIGHT = 420;
const LANE_W = 440;
const LANE_X = [6, 454];
const LINE_X = 20;
const LINE_W = 270;
const LINE_Y = 92;
const LINE_H = 22;
const ENEMY_X = 360;
const ENEMY_Y = 140;
const DICE_Y = 160;
const DIE = 34;
const LOG_Y = 232;
const LOG_N = 36;
const HIST_Y = 272;
const HIST_H = 92;
const HIST_MAX = 16;
const SPIN_MS = 420;

const HONEST = 0xef5350;
const LIED = 0x6fd48a;

interface LaneState {
    title: string;
    color: number;
    twoRn: boolean;
    damageDice: number[]; // sides of each damage die, e.g. [12] or [6, 6]
    hp: number;
    attacks: number;
    hits: number;
    doubleMiss: number;
    missStreak: number;
    worstMissStreak: number;
    hitsThisKill: number;
    attacksThisKill: number;
    killAttacks: number[]; // attacks needed for each kill
    log: Array<"hit" | "miss" | "double">;
    // last resolved roll, for drawing
    a: number | null;
    b: number | null;
    damage: number[];
    lastHit: boolean | null;
    shake: number;
}

class DiceScene extends Phaser.Scene {
    displayed = 70;
    enemyHp = 30;
    auto = false;
    attacksPerSecond = 2;
    lieHit = true;
    lieDamage = true;
    lanes: LaneState[] = [];
    spin = 0; // ms left of rolling animation
    cooldown = 0;
    narrative = "";
    private g!: Phaser.GameObjects.Graphics;
    private laneTexts: Phaser.GameObjects.Text[][] = [];

    constructor() {
        super("lie-dice-true-hit");
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);
        this.g = this.add.graphics();
        this.lanes = [this.makeLane("Честно: 1 бросок на попадание, урон 1d12", HONEST, false, [12]), this.makeLane("", LIED, true, [6, 6])];
        this.applyLies();
        const small = { fontFamily: "system-ui, sans-serif", fontSize: "11px", color: "#8b93a3" };
        const mid = { fontFamily: "system-ui, sans-serif", fontSize: "13px", color: "#e6e8eb" };
        LANE_X.forEach((x0) => {
            const t = (dx: number, dy: number, style: object) => this.add.text(x0 + dx, dy, "", style);
            this.laneTexts.push([
                t(LINE_X, 34, mid), // 0 title
                t(LINE_X, LINE_Y - 34, mid), // 1 hit caption
                t(LINE_X, LINE_Y + LINE_H + 4, small), // 2 hit formula
                t(LINE_X + 2 * (DIE + 8) + 30, DICE_Y - 14, small), // 3 damage caption
                t(LINE_X, LOG_Y - 15, small), // 4 log caption
                t(LINE_X, HIST_Y - 15, small), // 5 hist caption
                t(LINE_X, HIST_Y + HIST_H + 4, small), // 6 stats
                t(ENEMY_X - 40, ENEMY_Y + 44, small), // 7 enemy hp text
            ]);
        });
    }

    makeLane(title: string, color: number, twoRn: boolean, damageDice: number[]): LaneState {
        return {
            title,
            color,
            twoRn,
            damageDice,
            hp: this.enemyHp,
            attacks: 0,
            hits: 0,
            doubleMiss: 0,
            missStreak: 0,
            worstMissStreak: 0,
            hitsThisKill: 0,
            attacksThisKill: 0,
            killAttacks: [],
            log: [],
            a: null,
            b: null,
            damage: [],
            lastHit: null,
            shake: 0,
        };
    }

    applyLies(): void {
        const r = this.lanes[1];
        if (!r) return;
        r.twoRn = this.lieHit;
        r.damageDice = this.lieDamage ? [6, 6] : [12];
        const parts = [this.lieHit ? "true hit (среднее 2 бросков)" : "1 бросок", this.lieDamage ? "урон 2d6" : "урон 1d12"];
        r.title = `Соврали: ${parts.join(", ")}`;
    }

    reset(): void {
        this.lanes = this.lanes.map((l) => {
            const fresh = this.makeLane(l.title, l.color, l.twoRn, l.damageDice);
            return fresh;
        });
        this.applyLies();
        this.narrative = "";
    }

    attack(): void {
        if (this.spin > 0) return;
        if (this.attacksPerSecond > 6) {
            this.resolve(false);
            return;
        }
        this.spin = Math.min(SPIN_MS, 800 / this.attacksPerSecond);
    }

    burst(n: number): void {
        for (let i = 0; i < n; i++) this.resolve(true);
        this.narrative =
            `Прокрутили ${n} атак. Сравни «реально попал» и «худшую серию промахов»: на экране у обоих ${this.displayed}%, ` +
            `а ощущения от боя совсем разные.`;
    }

    /** One swing for both heroes. They share the first die so you can see the second die "rescue" a miss. */
    resolve(quiet: boolean): void {
        const a = Math.floor(Math.random() * 100);
        const b = Math.floor(Math.random() * 100);
        const lines: string[] = [];
        for (const l of this.lanes) {
            const value = l.twoRn ? (a + b) / 2 : a;
            const hit = value < this.displayed;
            l.a = a;
            l.b = l.twoRn ? b : null;
            l.lastHit = hit;
            l.attacks += 1;
            l.attacksThisKill += 1;
            let dmgTotal = 0;
            if (hit) {
                l.hits += 1;
                l.missStreak = 0;
                l.damage = l.damageDice.map((sides) => 1 + Math.floor(Math.random() * sides));
                dmgTotal = l.damage.reduce((s, d) => s + d, 0);
                l.hp -= dmgTotal;
                l.shake = 1;
                l.log.push("hit");
            } else {
                l.damage = [];
                l.missStreak += 1;
                l.worstMissStreak = Math.max(l.worstMissStreak, l.missStreak);
                const double = l.missStreak >= 2;
                if (double) l.doubleMiss += 1;
                l.log.push(double ? "double" : "miss");
            }
            if (l.log.length > LOG_N) l.log.shift();
            let killed = false;
            if (l.hp <= 0) {
                l.killAttacks.push(l.attacksThisKill);
                l.attacksThisKill = 0;
                l.hp = this.enemyHp;
                killed = true;
            }
            if (!quiet) {
                const idx = this.lanes.indexOf(l);
                this.floatText(idx, hit ? `-${dmgTotal}` : "MISS", hit ? "#ffca28" : "#8b93a3");
                if (killed) this.floatText(idx, "убит!", "#ffffff", 26);
                const who = l === this.lanes[0] ? "Честно" : "Соврали";
                const formula = l.twoRn ? `(${a}+${b})/2 = ${value}` : `${a}`;
                lines.push(
                    `${who}: ${formula} ${hit ? "&lt;" : "≥"} ${this.displayed} → ` +
                        (hit ? `<b>попал</b> на ${dmgTotal}` : `<b>мимо</b>${l.missStreak >= 2 ? ` (${l.missStreak}-й подряд!)` : ""}`),
                );
            }
        }
        if (!quiet) this.narrative = lines.join("<br>");
    }

    floatText(laneIdx: number, text: string, color: string, dy = 0): void {
        const t = this.add
            .text(LANE_X[laneIdx] + ENEMY_X, ENEMY_Y - 50 - dy, text, {
                fontFamily: "system-ui, sans-serif",
                fontSize: "18px",
                fontStyle: "bold",
                color,
            })
            .setOrigin(0.5);
        this.tweens.add({ targets: t, y: t.y - 40, alpha: 0, duration: 900, onComplete: () => t.destroy() });
    }

    update(_time: number, delta: number): void {
        if (this.spin > 0) {
            this.spin -= delta;
            if (this.spin <= 0) {
                this.spin = 0;
                this.resolve(false);
                this.cooldown = Math.max(0, 1000 / this.attacksPerSecond - SPIN_MS);
            }
        } else if (this.auto) {
            this.cooldown -= delta;
            if (this.cooldown <= 0) {
                if (this.attacksPerSecond > 6) {
                    const n = Math.max(1, Math.round((this.attacksPerSecond * delta) / 1000));
                    for (let i = 0; i < n; i++) this.resolve(false);
                } else this.attack();
            }
        }
        for (const l of this.lanes) l.shake = Math.max(0, l.shake - delta / 250);
        this.draw();
    }

    drawDie(x: number, y: number, value: number | string, sides: number | null, color: number, dim = false): void {
        const g = this.g;
        g.fillStyle(dim ? 0x2a2f3a : 0x262b35, 1);
        g.fillRoundedRect(x, y, DIE, DIE, 6);
        g.lineStyle(2, color, dim ? 0.4 : 1);
        g.strokeRoundedRect(x, y, DIE, DIE, 6);
        const key = `${x},${y}`;
        let t = this.dieTexts.get(key);
        if (!t) {
            t = this.add.text(x + DIE / 2, y + DIE / 2 - 2, "", { fontFamily: "system-ui, sans-serif", fontSize: "15px", color: "#e6e8eb" }).setOrigin(0.5);
            this.dieTexts.set(key, t);
        }
        t.setText(String(value));
        t.setAlpha(dim ? 0.5 : 1);
        t.setVisible(true);
        if (sides !== null) {
            let s = this.dieTexts.get(key + "s");
            if (!s) {
                s = this.add.text(x + DIE / 2, y + DIE + 2, "", { fontFamily: "system-ui, sans-serif", fontSize: "10px", color: "#8b93a3" }).setOrigin(0.5, 0);
                this.dieTexts.set(key + "s", s);
            }
            s.setText(sides === 100 ? "0–99" : `d${sides}`);
            s.setVisible(true);
        }
    }

    private dieTexts = new Map<string, Phaser.GameObjects.Text>();

    draw(): void {
        const g = this.g;
        g.clear();
        for (const t of this.dieTexts.values()) t.setVisible(false);
        const spinning = this.spin > 0;
        const rnd = () => Math.floor(Math.random() * 100);

        this.lanes.forEach((l, i) => {
            const x0 = LANE_X[i];
            const texts = this.laneTexts[i];
            g.fillStyle(0x1b1f27, 1);
            g.fillRoundedRect(x0, 26, LANE_W, WORLD_HEIGHT - 32, 6);

            texts[0].setText(l.title).setColor(i === 0 ? "#ef5350" : "#6fd48a");

            // --- hit line: green zone = rolls that hit
            const lx = x0 + LINE_X;
            g.fillStyle(0x2a2f3a, 1);
            g.fillRect(lx, LINE_Y, LINE_W, LINE_H);
            g.fillStyle(l.color, 0.8);
            g.fillRect(lx, LINE_Y, (LINE_W * this.displayed) / 100, LINE_H);
            texts[1].setText(`попадание, если ${l.twoRn ? "среднее двух" : "бросок"} < ${this.displayed}`);

            const marker = (v: number, color: number, alpha: number, size: number) => {
                const px = lx + (LINE_W * (v + 0.5)) / 100;
                g.fillStyle(color, alpha);
                g.fillTriangle(px - size, LINE_Y - 2 - size * 2, px + size, LINE_Y - 2 - size * 2, px, LINE_Y - 2);
                g.lineStyle(2, color, alpha);
                g.lineBetween(px, LINE_Y, px, LINE_Y + LINE_H);
            };
            const a = spinning ? rnd() : l.a;
            const b = spinning ? rnd() : l.b;
            if (a !== null) {
                if (l.twoRn && b !== null) {
                    marker(a, 0x8b93a3, 0.7, 4);
                    marker(b, 0x8b93a3, 0.7, 4);
                    marker((a + b) / 2, 0xffffff, 1, 6);
                } else marker(a, 0xffffff, 1, 6);
            }
            if (l.a !== null && !spinning) {
                const v = l.twoRn && l.b !== null ? (l.a + l.b) / 2 : l.a;
                texts[2].setText(
                    (l.twoRn && l.b !== null ? `(${l.a} + ${l.b}) / 2 = ${v}` : `бросок ${l.a}`) +
                        `  →  ${l.lastHit ? "попал" : "мимо"}`,
                );
            } else texts[2].setText(spinning ? "кубики крутятся…" : "");

            // --- dice row: hit dice, then damage dice
            const hitDice = l.twoRn ? 2 : 1;
            for (let d = 0; d < hitDice; d++) {
                const v = spinning ? rnd() : d === 0 ? l.a : l.b;
                this.drawDie(lx + d * (DIE + 8), DICE_Y, v ?? "?", 100, 0x8b93a3);
            }
            const dmgX = lx + 2 * (DIE + 8) + 30;
            l.damageDice.forEach((sides, d) => {
                const v = spinning ? 1 + Math.floor(Math.random() * sides) : l.damage[d];
                this.drawDie(dmgX + d * (DIE + 8), DICE_Y, v ?? "–", sides, 0xffca28, !spinning && l.lastHit === false);
            });
            texts[3].setText(l.lastHit === false && !spinning ? "урон: промах, не кидаем" : "урон");

            // --- enemy
            const shakeX = l.shake > 0 ? Math.sin(l.shake * 30) * 5 * l.shake : 0;
            const ex = x0 + ENEMY_X + shakeX;
            g.fillStyle(l.shake > 0.5 ? 0xffffff : 0x7a5a9a, 1);
            g.fillRoundedRect(ex - 24, ENEMY_Y - 32, 48, 60, 10);
            g.fillStyle(0x14181f, 1);
            g.fillCircle(ex - 9, ENEMY_Y - 12, 4);
            g.fillCircle(ex + 9, ENEMY_Y - 12, 4);
            g.fillStyle(0x2a2f3a, 1);
            g.fillRect(x0 + ENEMY_X - 40, ENEMY_Y + 34, 80, 7);
            g.fillStyle(0xef5350, 1);
            g.fillRect(x0 + ENEMY_X - 40, ENEMY_Y + 34, 80 * Math.max(0, l.hp / this.enemyHp), 7);
            texts[7].setText(`HP ${Math.max(0, l.hp)}/${this.enemyHp}`);

            // --- log of swings
            texts[4].setText("последние удары (красный — промах второй раз подряд)");
            const cw = (LANE_W - 2 * LINE_X) / LOG_N;
            l.log.forEach((r, k) => {
                g.fillStyle(r === "hit" ? l.color : r === "double" ? 0xef5350 : 0x3a4150, r === "double" ? 1 : 0.9);
                g.fillRect(lx + k * cw, LOG_Y, Math.max(1, cw - 2), 18);
            });

            // --- attacks needed per kill
            texts[5].setText("сколько ударов ушло на одного врага");
            const hist = new Array(HIST_MAX + 1).fill(0);
            for (const k of l.killAttacks) hist[Math.min(HIST_MAX, k)] += 1;
            const maxC = Math.max(1, ...hist);
            const hw = (LANE_W - 2 * LINE_X) / HIST_MAX;
            g.lineStyle(1, 0x2a2f3a, 1);
            g.strokeRect(lx, HIST_Y, LANE_W - 2 * LINE_X, HIST_H);
            for (let k = 1; k <= HIST_MAX; k++) {
                if (!hist[k]) continue;
                const h = (hist[k] / maxC) * (HIST_H - 6);
                g.fillStyle(l.color, 0.8);
                g.fillRect(lx + (k - 1) * hw + 1, HIST_Y + HIST_H - h, hw - 2, h);
            }
            const kills = l.killAttacks;
            const real = l.attacks ? ((l.hits / l.attacks) * 100).toFixed(0) : "–";
            texts[6].setText(
                `атак ${l.attacks} · реально попал ${real}% · худшая серия промахов ${l.worstMissStreak}
` +
                    (kills.length ? `врага за ${Math.min(...kills)}–${Math.max(...kills)} ударов` : "врагов пока нет"),
            );
        });
    }
}

function buildControls(root: HTMLElement, scene: DiceScene): void {
    root.innerHTML = "";
    addHeading(root, "Dice & True Hit");
    buildHowTo(
        root,
        "<b>Как пользоваться:</b> два героя бьют одинаковых врагов, на экране у обоих один и тот же шанс. Первый кубик " +
            "у них общий. Справа игра тайком кидает второй и берёт среднее, поэтому «70%» там на самом деле около 82%. " +
            "Урон 2d6 вместо 1d12 почти не даёт ударов на 1–2. Жми «Атаковать» и смотри, как второй кубик спасает промахи.",
    );
    buildLegend(root, [
        { color: "#ef5350", label: "честно" },
        { color: "#6fd48a", label: "соврали" },
        { color: "#ffffff", label: "итоговый бросок", shape: "line" },
        { color: "#8b93a3", label: "отдельные кубики 2RN", shape: "line" },
        { color: "#ffca28", label: "кубики урона", shape: "ring" },
    ]);
    const setNarrative = buildNarrative(root, "Нажми «Атаковать».");

    addButtons(root, [
        { label: "⚔ Атаковать", onClick: () => scene.attack() },
        { label: "×100 мгновенно", onClick: () => scene.burst(100) },
        { label: "Сброс", onClick: () => scene.reset() },
    ]);
    addCheckbox(root, "Автоатака", scene.auto, (v) => {
        scene.auto = v;
    });
    addSlider(root, "Скорость, атак/с", { min: 1, max: 30, step: 1, value: scene.attacksPerSecond, format: (v) => String(v) }, (v) => {
        scene.attacksPerSecond = v;
    });
    addSlider(root, "Шанс на экране", { min: 5, max: 95, step: 5, value: scene.displayed, format: (v) => `${v}%` }, (v) => {
        scene.displayed = v;
    });
    addSlider(root, "HP врага", { min: 10, max: 80, step: 5, value: scene.enemyHp, format: (v) => String(v) }, (v) => {
        scene.enemyHp = v;
        scene.reset();
    });
    addCheckbox(root, "Справа: true hit (2 броска)", scene.lieHit, (v) => {
        scene.lieHit = v;
        scene.applyLies();
    });
    addCheckbox(root, "Справа: урон 2d6 вместо 1d12", scene.lieDamage, (v) => {
        scene.lieDamage = v;
        scene.applyLies();
    });

    const set = addMetrics(root, ["Честно", "Соврали"], [
        ["shown", "На экране"],
        ["math", "По формуле"],
        ["real", "Реально попал"],
        ["double", "Двойных промахов"],
        ["worst", "Худшая серия"],
    ]);
    addNote(root, "При шансе ниже 50% true hit врёт в обратную сторону: 30% на экране — около 18% на деле. Игрок переоценивает высокие шансы и недооценивает низкие, а 2RN подыгрывает этому.");
    addFooter(root, "lie-dice-true-hit.html");

    const tick = () => {
        scene.lanes.forEach((l, col) => {
            set("shown", col, `${scene.displayed}%`);
            set("math", col, `${(realHitChance(l.twoRn ? "2rn" : "1rn", scene.displayed) * 100).toFixed(1)}%`);
            set("real", col, l.attacks ? `${((l.hits / l.attacks) * 100).toFixed(1)}%` : "-");
            set("double", col, String(l.doubleMiss));
            set("worst", col, String(l.worstMissStreak));
        });
        if (scene.narrative) setNarrative(scene.narrative);
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

const gameRoot = document.getElementById("game-root");
const controlRoot = document.getElementById("control-panel");
if (!gameRoot || !controlRoot) throw new Error("lie-dice-true-hit: expected #game-root and #control-panel");

const scene = new DiceScene();
const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: gameRoot,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    backgroundColor: "#14181f",
    scene: [scene],
});
game.events.once(Phaser.Core.Events.READY, () => buildControls(controlRoot, scene));
