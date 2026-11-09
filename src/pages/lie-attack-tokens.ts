import Phaser from "phaser";
import { buildHowTo, buildLegend, buildNarrative } from "@/rendering/ExplainerPanel";
import { addButtons, addCheckbox, addFooter, addHeading, addMetrics, addNote, addSegmented, addSlider } from "@/lies/panel";

const WORLD_WIDTH = 900;
const WORLD_HEIGHT = 420;
const AX = 10;
const AY = 30;
const AW = 600;
const AH = 380;
const SIDE_X = 625;
const SIDE_W = 265;

const HERO_R = 12;
const HERO_SPEED = 150;
const HERO_HP = 100;
const HERO_ATTACK_RANGE = 44;
const HERO_ATTACK_EVERY = 0.4;
const ENEMY_R = 11;
const ENEMY_HP = 3;
const ENEMY_SPEED = 80;
const ENEMY_REACH = 34;
const WINDUP = 0.5;
const RECOVER = 0.9;
const ENEMY_DAMAGE = 7;
const RING_RADIUS = 115;

type Mode = "honest" | "tokens";
type EnemyState = "approach" | "windup" | "recover" | "wait";

interface Enemy {
    x: number;
    y: number;
    hp: number;
    state: EnemyState;
    timer: number;
    hasToken: boolean;
    waitedFor: number;
    slotAngle: number;
    flash: number;
}

interface RunRecord {
    mode: Mode;
    tokens: number;
    time: number;
    kills: number;
    won: boolean;
    peak: number;
}

class TokensScene extends Phaser.Scene {
    mode: Mode = "honest";
    tokenCount = 2;
    enemyCount = 8;
    bot = false;
    hero = { x: AW / 2, y: AH / 2, hp: HERO_HP, cooldown: 0, flash: 0 };
    enemies: Enemy[] = [];
    t = 0;
    kills = 0;
    over: "" | "dead" | "won" = "";
    started = false;
    damageLog: number[] = []; // per 0.5s bucket
    attackersLog: number[] = [];
    peakAttackers = 0;
    history: RunRecord[] = [];
    narrative = "";
    private g!: Phaser.GameObjects.Graphics;
    private texts: Record<string, Phaser.GameObjects.Text> = {};
    private pointer = { x: AW / 2, y: AH / 2, inside: false };
    private bucket = 0;
    private bucketDamage = 0;

    constructor() {
        super("lie-attack-tokens");
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);
        this.g = this.add.graphics();
        const font = "system-ui, sans-serif";
        const t = (key: string, x: number, y: number, size: number, color = "#e6e8eb") => {
            this.texts[key] = this.add.text(x, y, "", { fontFamily: font, fontSize: `${size}px`, color }).setDepth(5);
        };
        t("title", AX, 8, 13, "#c5cad3");
        t("hp", SIDE_X, 8, 13);
        t("now", SIDE_X, 44, 22, "#ef5350");
        t("nowCap", SIDE_X, 72, 11, "#8b93a3");
        t("graphCap", SIDE_X, 98, 11, "#8b93a3");
        t("lanch", SIDE_X, 228, 11, "#c5cad3");
        t("hist", SIDE_X, 300, 11, "#c5cad3");
        t("overlay", AX + AW / 2, AY + AH / 2 - 20, 20, "#ffca28");
        this.texts.overlay.setOrigin(0.5).setAlign("center");
        this.texts.lanch.setWordWrapWidth(SIDE_W);
        this.texts.graphCap.setText("урон по герою (каждые 0.5с)");
        this.input.on("pointermove", (p: Phaser.Input.Pointer) => this.trackPointer(p));
        this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
            this.trackPointer(p);
            if (!this.started || this.over) {
                if (this.pointer.inside) this.restart();
            }
        });
        this.reset();
        this.narrative = "Кликни по полю, чтобы начать. Герой идёт за мышкой и сам бьёт ближайшего врага. Уходи от красных замахов.";
    }

    trackPointer(p: Phaser.Input.Pointer): void {
        this.pointer.x = p.x - AX;
        this.pointer.y = p.y - AY;
        this.pointer.inside = p.x >= AX && p.x <= AX + AW && p.y >= AY && p.y <= AY + AH;
    }

    reset(): void {
        this.hero = { x: AW / 2, y: AH / 2, hp: HERO_HP, cooldown: 0, flash: 0 };
        this.enemies = [];
        for (let i = 0; i < this.enemyCount; i++) {
            const a = (i / this.enemyCount) * Math.PI * 2;
            this.enemies.push({
                x: AW / 2 + Math.cos(a) * 170,
                y: AH / 2 + Math.sin(a) * 160,
                hp: ENEMY_HP,
                state: "approach",
                timer: 0,
                hasToken: false,
                waitedFor: Math.random(),
                slotAngle: a,
                flash: 0,
            });
        }
        this.t = 0;
        this.kills = 0;
        this.over = "";
        this.started = false;
        this.damageLog = [];
        this.attackersLog = [];
        this.peakAttackers = 0;
        this.bucket = 0;
        this.bucketDamage = 0;
    }

    restart(): void {
        this.reset();
        this.started = true;
        this.narrative =
            this.mode === "honest"
                ? "Честно: каждый враг, который дошёл, бьёт. Попробуй продержаться."
                : `Токены: одновременно бить могут только ${this.tokenCount}. Остальные ходят кругом и ждут очереди — со стороны это выглядит как «драка», на деле очередь.`;
    }

    finish(result: "dead" | "won"): void {
        this.over = result;
        this.history.unshift({ mode: this.mode, tokens: this.tokenCount, time: this.t, kills: this.kills, won: result === "won", peak: this.peakAttackers });
        this.history = this.history.slice(0, 6);
        const avgDps = this.damageLog.length ? (this.damageLog.reduce((a, b) => a + b, 0) / this.damageLog.length) * 2 : 0;
        this.narrative =
            (result === "won" ? `Победа за ${this.t.toFixed(1)}с` : `Герой пал на ${this.t.toFixed(1)}с, убив ${this.kills} из ${this.enemyCount}`) +
            `. Пик одновременных атакующих — <b>${this.peakAttackers}</b>, средний входящий урон ${avgDps.toFixed(1)}/с. ` +
            (this.mode === "honest"
                ? "Это закон Ланчестера: сила толпы растёт как квадрат её размера — один герой против восьми честно не выживает."
                : "Враги те же, урон тот же — изменилась только очередь. Кликни, чтобы сыграть ещё.");
    }

    /** Engaged = currently allowed to hit (token holder, or anyone in honest mode) and close. */
    private canAttack(e: Enemy): boolean {
        return this.mode === "honest" || e.hasToken;
    }

    private assignTokens(dt: number): void {
        if (this.mode === "honest") return;
        const alive = this.enemies.filter((e) => e.hp > 0);
        let holders = alive.filter((e) => e.hasToken).length;
        for (const e of alive) if (!e.hasToken) e.waitedFor += dt;
        // longest-waiting gets the next token: everyone gets a turn, nobody hogs the fight
        const waiting = alive.filter((e) => !e.hasToken).sort((a, b) => b.waitedFor - a.waitedFor);
        while (holders < this.tokenCount && waiting.length) {
            const e = waiting.shift()!;
            e.hasToken = true;
            e.waitedFor = 0;
            e.state = "approach";
            holders += 1;
        }
    }

    update(_time: number, deltaMs: number): void {
        const dt = Math.min(deltaMs, 50) / 1000;
        if (this.started && !this.over) this.step(dt);
        this.hero.flash = Math.max(0, this.hero.flash - dt * 4);
        for (const e of this.enemies) e.flash = Math.max(0, e.flash - dt * 5);
        this.draw();
    }

    step(dt: number): void {
        this.t += dt;
        const h = this.hero;

        // hero movement: follow pointer, or bot stands in the middle
        const target = this.bot ? { x: AW / 2, y: AH / 2 } : this.pointer;
        const dx = target.x - h.x;
        const dy = target.y - h.y;
        const d = Math.hypot(dx, dy);
        if (d > 3) {
            const s = Math.min(d, HERO_SPEED * dt);
            h.x = Phaser.Math.Clamp(h.x + (dx / d) * s, HERO_R, AW - HERO_R);
            h.y = Phaser.Math.Clamp(h.y + (dy / d) * s, HERO_R, AH - HERO_R);
        }

        // hero auto-attack
        h.cooldown -= dt;
        if (h.cooldown <= 0) {
            const alive = this.enemies.filter((e) => e.hp > 0);
            let best: Enemy | null = null;
            let bestD = HERO_ATTACK_RANGE;
            for (const e of alive) {
                const de = Math.hypot(e.x - h.x, e.y - h.y);
                if (de < bestD) {
                    bestD = de;
                    best = e;
                }
            }
            if (best) {
                best.hp -= 1;
                best.flash = 1;
                h.cooldown = HERO_ATTACK_EVERY;
                const kx = (best.x - h.x) / Math.max(1, bestD);
                const ky = (best.y - h.y) / Math.max(1, bestD);
                best.x += kx * 14;
                best.y += ky * 14;
                if (best.hp <= 0) {
                    this.kills += 1;
                    best.hasToken = false;
                }
            }
        }

        this.assignTokens(dt);

        // enemies
        const alive = this.enemies.filter((e) => e.hp > 0);
        alive.forEach((e, idx) => {
            const ex = h.x - e.x;
            const ey = h.y - e.y;
            const dist = Math.hypot(ex, ey);
            if (!this.canAttack(e)) {
                // circle around the hero at a respectful distance, slowly orbiting
                e.state = "wait";
                e.slotAngle += dt * 0.35 * (idx % 2 ? 1 : -1);
                const tx = h.x + Math.cos(e.slotAngle) * RING_RADIUS;
                const ty = h.y + Math.sin(e.slotAngle) * RING_RADIUS;
                this.moveTo(e, tx, ty, ENEMY_SPEED * 0.8 * dt);
                return;
            }
            if (e.state === "wait") e.state = "approach";
            if (e.state === "approach") {
                if (dist > ENEMY_REACH) this.moveTo(e, h.x, h.y, ENEMY_SPEED * dt, ENEMY_REACH - 4);
                else {
                    e.state = "windup";
                    e.timer = WINDUP;
                }
            } else if (e.state === "windup") {
                e.timer -= dt;
                if (e.timer <= 0) {
                    if (dist <= ENEMY_REACH + 10) {
                        h.hp = Math.max(0, h.hp - ENEMY_DAMAGE);
                        h.flash = 1;
                        this.bucketDamage += ENEMY_DAMAGE;
                    }
                    e.state = "recover";
                    e.timer = RECOVER;
                }
            } else if (e.state === "recover") {
                e.timer -= dt;
                if (e.timer <= 0) {
                    e.state = "approach";
                    if (this.mode === "tokens") {
                        // hand the token back after one swing and step back into the ring
                        e.hasToken = false;
                        e.slotAngle = Math.atan2(e.y - h.y, e.x - h.x);
                    }
                }
            }
        });

        // simple separation so they don't stack into one blob
        for (let i = 0; i < alive.length; i++) {
            for (let j = i + 1; j < alive.length; j++) {
                const a = alive[i];
                const b = alive[j];
                const sx = b.x - a.x;
                const sy = b.y - a.y;
                const sd = Math.hypot(sx, sy) || 0.01;
                if (sd < ENEMY_R * 2.2) {
                    const push = (ENEMY_R * 2.2 - sd) / 2;
                    a.x -= (sx / sd) * push;
                    a.y -= (sy / sd) * push;
                    b.x += (sx / sd) * push;
                    b.y += (sy / sd) * push;
                }
            }
        }

        const attackingNow = alive.filter((e) => e.state === "windup").length;
        this.peakAttackers = Math.max(this.peakAttackers, attackingNow);

        this.bucket += dt;
        if (this.bucket >= 0.5) {
            this.bucket -= 0.5;
            this.damageLog.push(this.bucketDamage);
            this.attackersLog.push(attackingNow);
            this.bucketDamage = 0;
        }

        if (h.hp <= 0) this.finish("dead");
        else if (alive.length === 0) this.finish("won");
    }

    private moveTo(e: Enemy, tx: number, ty: number, step: number, stopAt = 0): void {
        const dx = tx - e.x;
        const dy = ty - e.y;
        const d = Math.hypot(dx, dy);
        if (d <= stopAt || d < 0.5) return;
        const s = Math.min(step, d - stopAt);
        e.x = Phaser.Math.Clamp(e.x + (dx / d) * s, ENEMY_R, AW - ENEMY_R);
        e.y = Phaser.Math.Clamp(e.y + (dy / d) * s, ENEMY_R, AH - ENEMY_R);
    }

    draw(): void {
        const g = this.g;
        g.clear();
        g.fillStyle(0x1b1f27, 1);
        g.fillRect(AX, AY, AW, AH);
        g.lineStyle(1, 0x2a2f3a, 1);
        g.strokeRect(AX, AY, AW, AH);
        const h = this.hero;

        if (this.mode === "tokens") {
            g.lineStyle(1, 0x4fc3f7, 0.18);
            g.strokeCircle(AX + h.x, AY + h.y, RING_RADIUS);
        }

        for (const e of this.enemies) {
            if (e.hp <= 0) continue;
            const x = AX + e.x;
            const y = AY + e.y;
            if (e.state === "windup") {
                const k = 1 - e.timer / WINDUP;
                g.lineStyle(3, 0xef5350, 0.4 + 0.6 * k);
                g.strokeCircle(x, y, ENEMY_R + 4 + k * 8);
                g.lineStyle(2, 0xef5350, 0.6);
                g.lineBetween(x, y, AX + h.x, AY + h.y);
            }
            const color = e.flash > 0 ? 0xffffff : e.state === "wait" ? 0x6b5a80 : 0xb57edc;
            g.fillStyle(color, 1);
            g.fillCircle(x, y, ENEMY_R);
            if (e.hasToken) {
                g.fillStyle(0xffca28, 1);
                g.fillCircle(x, y - ENEMY_R - 5, 4);
            }
            for (let k = 0; k < e.hp; k++) {
                g.fillStyle(0xef5350, 1);
                g.fillRect(x - 8 + k * 6, y + ENEMY_R + 3, 4, 3);
            }
        }

        g.lineStyle(1, 0x6fd48a, 0.25);
        g.strokeCircle(AX + h.x, AY + h.y, HERO_ATTACK_RANGE);
        g.fillStyle(h.flash > 0 ? 0xef5350 : 0x4fc3f7, 1);
        g.fillCircle(AX + h.x, AY + h.y, HERO_R);

        if (!this.started || this.over) {
            g.fillStyle(0x14181f, 0.7);
            g.fillRect(AX, AY, AW, AH);
        }
        this.texts.overlay.setText(
            !this.started
                ? "Кликни, чтобы начать\n(герой идёт за мышкой)"
                : this.over === "dead"
                  ? `Герой пал · ${this.t.toFixed(1)}с\nкликни — ещё раз`
                  : this.over === "won"
                    ? `Победа · ${this.t.toFixed(1)}с\nкликни — ещё раз`
                    : "",
        );

        this.texts.title.setText(
            this.mode === "honest" ? `Честно: бьют все ${this.enemyCount}` : `Attack tokens: одновременно бьют максимум ${this.tokenCount}`,
        );

        // side panel
        g.fillStyle(0x2a2f3a, 1);
        g.fillRect(SIDE_X, 28, SIDE_W, 10);
        g.fillStyle(h.hp > 50 ? 0x6fd48a : h.hp > 25 ? 0xffca28 : 0xef5350, 1);
        g.fillRect(SIDE_X, 28, (SIDE_W * h.hp) / HERO_HP, 10);
        this.texts.hp.setText(`HP героя ${h.hp} · ${this.t.toFixed(1)}с · убито ${this.kills}/${this.enemyCount}`);
        const attackingNow = this.enemies.filter((e) => e.hp > 0 && e.state === "windup").length;
        this.texts.now.setText(`замахиваются: ${attackingNow}`);
        this.texts.nowCap.setText(`пик за забег: ${this.peakAttackers}`);

        const gy = 114;
        const gh = 100;
        g.fillStyle(0x1b1f27, 1);
        g.fillRect(SIDE_X, gy, SIDE_W, gh);
        g.lineStyle(1, 0x2a2f3a, 1);
        g.strokeRect(SIDE_X, gy, SIDE_W, gh);
        const maxD = ENEMY_DAMAGE * 6;
        const n = 60;
        const log = this.damageLog.slice(-n);
        const bw = SIDE_W / n;
        log.forEach((v, i) => {
            const bh = (Math.min(v, maxD) / maxD) * (gh - 4);
            g.fillStyle(v >= ENEMY_DAMAGE * 3 ? 0xef5350 : 0xff8a3d, 0.9);
            g.fillRect(SIDE_X + i * bw, gy + gh - bh, Math.max(1, bw - 1), bh);
        });

        const allDps = (this.enemyCount * ENEMY_DAMAGE) / (WINDUP + RECOVER);
        const tokDps = (Math.min(this.tokenCount, this.enemyCount) * ENEMY_DAMAGE) / (WINDUP + RECOVER);
        this.texts.lanch.setText(
            `Потолок урона, если бьют все ${this.enemyCount}: ${allDps.toFixed(0)}/с.\n` +
                `С ${this.tokenCount} токенами: ${tokDps.toFixed(0)}/с. HP героя ${HERO_HP} — посчитай сам.`,
        );

        const rows = this.history.map(
            (r) =>
                `${r.mode === "honest" ? "честно " : `токены ${r.tokens}`} · ${r.won ? "победа" : "пал"} ${r.time.toFixed(0)}с · убил ${r.kills} · пик ${r.peak}`,
        );
        this.texts.hist.setText(rows.length ? "Забеги:\n" + rows.join("\n") : "");
    }
}

function buildControls(root: HTMLElement, scene: TokensScene): void {
    root.innerHTML = "";
    addHeading(root, "Attack Tokens");
    buildHowTo(
        root,
        "<b>Как пользоваться:</b> кликни по полю — бой начнётся. Герой идёт за курсором и сам бьёт ближайшего врага. " +
            "Красный круг — замах: успей отойти. В честном режиме бьют все, в режиме токенов — только враги с жёлтой " +
            "меткой, остальные кружат рядом и изображают угрозу.",
    );
    buildLegend(root, [
        { color: "#4fc3f7", label: "герой" },
        { color: "#b57edc", label: "враг в атаке" },
        { color: "#6b5a80", label: "враг ждёт очереди" },
        { color: "#ffca28", label: "токен атаки" },
        { color: "#ef5350", label: "замах", shape: "ring" },
    ]);
    const setNarrative = buildNarrative(root, "");

    addSegmented(
        root,
        "Режим",
        [
            { value: "honest" as Mode, label: "Честно" },
            { value: "tokens" as Mode, label: "Attack tokens" },
        ],
        scene.mode,
        (m) => {
            scene.mode = m;
            scene.reset();
        },
    );
    addSlider(root, "Токенов", { min: 1, max: 8, step: 1, value: scene.tokenCount, format: (v) => String(v) }, (v) => {
        scene.tokenCount = v;
    });
    addSlider(root, "Врагов", { min: 2, max: 14, step: 1, value: scene.enemyCount, format: (v) => String(v) }, (v) => {
        scene.enemyCount = v;
        scene.reset();
    });
    addCheckbox(root, "Бот вместо меня (стоит в центре)", scene.bot, (v) => {
        scene.bot = v;
    });
    addButtons(root, [{ label: "Заново", onClick: () => scene.restart() }]);

    const set = addMetrics(root, [""], [
        ["time", "Время"],
        ["kills", "Убито"],
        ["peak", "Пик одновременных замахов"],
        ["dps", "Средний входящий урон/с"],
    ]);
    addNote(root, "Урон, скорость и HP врагов одинаковы в обоих режимах. Токены меняют только то, сколько из них имеют право бить прямо сейчас.");
    addFooter(root, "lie-attack-tokens.html");

    let last = "";
    const tick = () => {
        set("time", 0, `${scene.t.toFixed(1)}с`);
        set("kills", 0, `${scene.kills}/${scene.enemyCount}`);
        set("peak", 0, String(scene.peakAttackers));
        const n = scene.damageLog.length;
        set("dps", 0, n ? ((scene.damageLog.reduce((a, b) => a + b, 0) / n) * 2).toFixed(1) : "-");
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
if (!gameRoot || !controlRoot) throw new Error("lie-attack-tokens: expected #game-root and #control-panel");

const scene = new TokensScene();
const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: gameRoot,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    backgroundColor: "#14181f",
    scene: [scene],
});
game.events.once(Phaser.Core.Events.READY, () => buildControls(controlRoot, scene));
