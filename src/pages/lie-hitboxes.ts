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

const SHIP_R = 15; // what the player sees
const BULLET_R = 5;
const INVULN = 0.6;
const ROUND_SEC = 40;

type Mode = "honest" | "lied";

interface Bullet {
    x: number;
    y: number;
    vx: number;
    vy: number;
    hitSprite: boolean; // already counted against the sprite-sized box
    hitCore: boolean;
    grazed: boolean;
}

interface Pickup {
    x: number;
    y: number;
}

interface Fx {
    x: number;
    y: number;
    text: string;
    color: string;
    life: number;
}

class HitboxScene extends Phaser.Scene {
    mode: Mode = "lied";
    coreR = 3;
    pickupBonus = 18;
    showBoxes = true;
    density = 1;
    ship = { x: AW / 2, y: AH - 60 };
    pointer = { x: AW / 2, y: AH - 60 };
    bullets: Bullet[] = [];
    pickups: Pickup[] = [];
    fx: Fx[] = [];
    t = 0;
    running = false;
    spiral = 0;
    emitTimer = 0;
    aimTimer = 0;
    invuln = 0;
    hp = 5;
    // both hitboxes are evaluated on every bullet so one play-through gives both answers
    spriteHits = 0;
    coreHits = 0;
    unfair = 0; // sprite hit but core untouched — "it didn't even touch me!"
    grazes = 0;
    picked = 0;
    pickedOnlyByBonus = 0;
    narrative = "";
    private g!: Phaser.GameObjects.Graphics;
    private texts: Record<string, Phaser.GameObjects.Text> = {};
    private fxTexts: Phaser.GameObjects.Text[] = [];

    constructor() {
        super("lie-hitboxes");
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);
        this.g = this.add.graphics();
        const font = "system-ui, sans-serif";
        const t = (key: string, x: number, y: number, size: number, color = "#e6e8eb") => {
            this.texts[key] = this.add.text(x, y, "", { fontFamily: font, fontSize: `${size}px`, color }).setDepth(5);
        };
        t("title", AX, 8, 13, "#c5cad3");
        t("hp", SIDE_X, 8, 14);
        t("cmpCap", SIDE_X, 40, 11, "#8b93a3");
        t("sprite", SIDE_X, 58, 26, "#ef5350");
        t("spriteCap", SIDE_X + 60, 66, 11, "#c5cad3");
        t("core", SIDE_X, 96, 26, "#6fd48a");
        t("coreCap", SIDE_X + 60, 104, 11, "#c5cad3");
        t("explain", SIDE_X, 146, 12, "#c5cad3");
        t("overlay", AX + AW / 2, AY + AH / 2, 18, "#ffca28");
        this.texts.overlay.setOrigin(0.5).setAlign("center");
        this.texts.explain.setWordWrapWidth(260);
        this.texts.cmpCap.setText("за этот забег тебя «убил» бы:");
        this.texts.spriteCap.setText("хитбокс по картинке");
        this.texts.coreCap.setText("маленькое ядро");
        this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
            this.pointer = { x: p.x - AX, y: p.y - AY };
        });
        this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
            this.pointer = { x: p.x - AX, y: p.y - AY };
            if (!this.running) this.restart();
        });
        this.narrative = "Кликни по полю и уворачивайся, водя мышкой. Собирай жёлтые монеты. Каждое касание проверяется сразу двумя хитбоксами.";
    }

    get activeR(): number {
        return this.mode === "honest" ? SHIP_R : this.coreR;
    }

    get pickupR(): number {
        return SHIP_R + (this.mode === "lied" ? this.pickupBonus : 0);
    }

    restart(): void {
        this.bullets = [];
        this.pickups = [];
        this.fx = [];
        this.t = 0;
        this.hp = 5;
        this.invuln = 0;
        this.spriteHits = this.coreHits = this.unfair = this.grazes = this.picked = this.pickedOnlyByBonus = 0;
        this.running = true;
        this.narrative =
            this.mode === "honest"
                ? "Хитбокс равен картинке корабля. Честно — и очень обидно."
                : `Хитбокс — точка ${this.coreR * 2}px в центре, а монеты притягиваются с ${this.pickupBonus}px дальше. Игрок думает, что он гений уклонения.`;
    }

    addFx(x: number, y: number, text: string, color: string): void {
        this.fx.push({ x, y, text, color, life: 1 });
    }

    update(_time: number, deltaMs: number): void {
        const dt = Math.min(deltaMs, 50) / 1000;
        if (this.running) this.step(dt);
        for (const f of this.fx) f.life -= dt * 1.2;
        this.fx = this.fx.filter((f) => f.life > 0);
        this.draw();
    }

    step(dt: number): void {
        this.t += dt;
        this.invuln = Math.max(0, this.invuln - dt);
        // ship follows mouse quickly (bullet-hell style, precise)
        const s = this.ship;
        s.x += (Phaser.Math.Clamp(this.pointer.x, SHIP_R, AW - SHIP_R) - s.x) * Math.min(1, dt * 18);
        s.y += (Phaser.Math.Clamp(this.pointer.y, SHIP_R, AH - SHIP_R) - s.y) * Math.min(1, dt * 18);

        // emitters: a rotating spiral from the top and aimed fans
        const ex = AW / 2;
        const ey = 50;
        this.emitTimer -= dt;
        if (this.emitTimer <= 0) {
            this.emitTimer = 0.09 / this.density;
            this.spiral += 0.37;
            for (let k = 0; k < 3; k++) {
                const a = this.spiral + (k * Math.PI * 2) / 3;
                this.bullets.push({ x: ex, y: ey, vx: Math.cos(a) * 120, vy: Math.sin(a) * 120 + 40, hitSprite: false, hitCore: false, grazed: false });
            }
        }
        this.aimTimer -= dt;
        if (this.aimTimer <= 0) {
            this.aimTimer = 1.3 / this.density;
            const base = Math.atan2(s.y - ey, s.x - ex);
            for (let k = -3; k <= 3; k++) {
                const a = base + k * 0.11;
                this.bullets.push({ x: ex, y: ey, vx: Math.cos(a) * 190, vy: Math.sin(a) * 190, hitSprite: false, hitCore: false, grazed: false });
            }
        }
        if (this.pickups.length < 3 && Math.random() < dt * 0.8) {
            this.pickups.push({ x: 40 + Math.random() * (AW - 80), y: 120 + Math.random() * (AH - 160) });
        }

        for (const b of this.bullets) {
            b.x += b.vx * dt;
            b.y += b.vy * dt;
            const d = Math.hypot(b.x - s.x, b.y - s.y);
            const touchesSprite = d < SHIP_R + BULLET_R;
            const touchesCore = d < this.coreR + BULLET_R;
            if (touchesSprite && !b.hitSprite) {
                b.hitSprite = true;
                this.spriteHits += 1;
            }
            if (touchesCore && !b.hitCore) {
                b.hitCore = true;
                this.coreHits += 1;
            }
            if (touchesSprite && !touchesCore && !b.grazed && d < SHIP_R + BULLET_R - 2) b.grazed = true;
            // apply damage according to the ACTIVE hitbox
            if (this.invuln <= 0 && d < this.activeR + BULLET_R) {
                this.hp -= 1;
                this.invuln = INVULN;
                if (this.mode === "honest" && !touchesCore) {
                    this.unfair += 1;
                    this.addFx(s.x, s.y - 24, "не задело же!", "#ef5350");
                } else this.addFx(s.x, s.y - 24, "попал", "#ef5350");
            }
        }
        // grazes: bullet left the sprite without ever touching the core
        for (const b of this.bullets) {
            if (b.grazed && Math.hypot(b.x - s.x, b.y - s.y) > SHIP_R + BULLET_R + 2) {
                b.grazed = false;
                if (!b.hitCore) {
                    this.grazes += 1;
                    if (this.mode === "lied") this.addFx(s.x + 20, s.y - 10, "впритирку!", "#6fd48a");
                }
            }
        }
        this.bullets = this.bullets.filter((b) => b.x > -20 && b.y > -20 && b.x < AW + 20 && b.y < AH + 20);

        this.pickups = this.pickups.filter((p) => {
            const d = Math.hypot(p.x - s.x, p.y - s.y);
            if (d < this.pickupR) {
                this.picked += 1;
                if (d > SHIP_R + 6) {
                    this.pickedOnlyByBonus += 1;
                    this.addFx(p.x, p.y - 12, "+1 (магнит)", "#ffca28");
                } else this.addFx(p.x, p.y - 12, "+1", "#ffca28");
                return false;
            }
            return true;
        });

        if (this.hp <= 0 || this.t >= ROUND_SEC) {
            this.running = false;
            this.narrative =
                (this.hp <= 0 ? `Корабль сбит на ${this.t.toFixed(0)}с. ` : `Выжил ${ROUND_SEC}с! `) +
                `Хитбокс по картинке поймал <b>${this.spriteHits}</b> пуль, ядро — <b>${this.coreHits}</b>. ` +
                `«Впритирку» пролетело ${this.grazes} пуль: на экране они задели корабль. ` +
                (this.mode === "lied"
                    ? `${this.pickedOnlyByBonus} из ${this.picked} монет ты на самом деле не достал — их притянуло.`
                    : `${this.unfair} раз тебя убила пуля, которая не задела центр корабля.`);
        }
    }

    draw(): void {
        const g = this.g;
        g.clear();
        g.fillStyle(0x0f1219, 1);
        g.fillRect(AX, AY, AW, AH);
        g.lineStyle(1, 0x2a2f3a, 1);
        g.strokeRect(AX, AY, AW, AH);

        g.fillStyle(0xb57edc, 1);
        g.fillCircle(AX + AW / 2, AY + 50, 16);

        for (const p of this.pickups) {
            g.fillStyle(0xffd54f, 1);
            g.fillCircle(AX + p.x, AY + p.y, 6);
            if (this.showBoxes && this.mode === "lied") {
                g.lineStyle(1, 0xffd54f, 0.3);
                g.strokeCircle(AX + p.x, AY + p.y, this.pickupBonus);
            }
        }

        for (const b of this.bullets) {
            g.fillStyle(0xff6b6b, 1);
            g.fillCircle(AX + b.x, AY + b.y, BULLET_R);
            g.fillStyle(0xffffff, 0.9);
            g.fillCircle(AX + b.x, AY + b.y, 2);
        }

        const s = this.ship;
        const blink = this.invuln > 0 && Math.floor(this.invuln * 20) % 2 === 0;
        if (!blink) {
            g.fillStyle(0x4fc3f7, 1);
            g.fillTriangle(AX + s.x, AY + s.y - SHIP_R - 3, AX + s.x - SHIP_R, AY + s.y + SHIP_R, AX + s.x + SHIP_R, AY + s.y + SHIP_R);
            g.fillStyle(0x2a6f8f, 1);
            g.fillCircle(AX + s.x, AY + s.y + 4, 5);
        }
        if (this.showBoxes) {
            g.lineStyle(1.5, 0xef5350, this.mode === "honest" ? 0.95 : 0.35);
            g.strokeCircle(AX + s.x, AY + s.y, SHIP_R);
            g.fillStyle(0x6fd48a, this.mode === "lied" ? 1 : 0.4);
            g.fillCircle(AX + s.x, AY + s.y, this.coreR);
        }

        while (this.fxTexts.length < this.fx.length) {
            this.fxTexts.push(this.add.text(0, 0, "", { fontFamily: "system-ui, sans-serif", fontSize: "13px", fontStyle: "bold" }).setOrigin(0.5).setDepth(6));
        }
        this.fxTexts.forEach((t, i) => {
            const f = this.fx[i];
            if (!f) return void t.setVisible(false);
            t.setVisible(true)
                .setText(f.text)
                .setColor(f.color)
                .setAlpha(f.life)
                .setPosition(AX + f.x, AY + f.y - (1 - f.life) * 20);
        });

        if (!this.running) {
            g.fillStyle(0x14181f, 0.7);
            g.fillRect(AX, AY, AW, AH);
        }
        this.texts.overlay.setText(this.running ? "" : "Кликни, чтобы начать\nкорабль идёт за мышкой");
        this.texts.title.setText(
            this.mode === "honest" ? "Хитбокс = картинка (честно)" : `Хитбокс = ядро ${this.coreR * 2}px, магнит монет +${this.pickupBonus}px`,
        );
        this.texts.hp.setText(`HP ${"♥".repeat(Math.max(0, this.hp))} · ${this.t.toFixed(0)}/${ROUND_SEC}с · монет ${this.picked}`);
        this.texts.sprite.setText(String(this.spriteHits));
        this.texts.core.setText(String(this.coreHits));
        this.texts.explain.setText(
            `Пуль «впритирку» (задели картинку, но не ядро): ${this.grazes}.\n\n` +
                (this.mode === "honest"
                    ? `Нечестных смертей: ${this.unfair}. Игрок видел, что пуля прошла по краю крыла, — и умер.`
                    : `Монет, взятых только магнитом: ${this.pickedOnlyByBonus} из ${this.picked}. Игрок уверен, что дотянулся.`),
        );
    }
}

function buildControls(root: HTMLElement, scene: HitboxScene): void {
    root.innerHTML = "";
    addHeading(root, "Hitboxes");
    buildHowTo(
        root,
        "<b>Как пользоваться:</b> кликни по полю и уворачивайся, водя мышкой, — 40 секунд. Каждая пуля проверяется " +
            "сразу двумя хитбоксами: по размеру картинки и маленьким ядром. Урон наносит тот, что выбран, но счёт " +
            "ведётся для обоих — так за один забег видно, сколько раз честный хитбокс убил бы тебя.",
    );
    buildLegend(root, [
        { color: "#4fc3f7", label: "корабль (картинка)" },
        { color: "#ef5350", label: "хитбокс по картинке", shape: "ring" },
        { color: "#6fd48a", label: "ядро" },
        { color: "#ffd54f", label: "монета / магнит", shape: "ring" },
    ]);
    const setNarrative = buildNarrative(root, "");

    addSegmented(
        root,
        "Урон наносит",
        [
            { value: "honest" as Mode, label: "Картинка (честно)" },
            { value: "lied" as Mode, label: "Ядро + магнит" },
        ],
        scene.mode,
        (m) => {
            scene.mode = m;
            scene.running = false;
        },
    );
    addSlider(root, "Радиус ядра", { min: 1, max: 15, step: 1, value: scene.coreR, format: (v) => `${v}px` }, (v) => {
        scene.coreR = v;
    });
    addSlider(root, "Магнит монет", { min: 0, max: 40, step: 2, value: scene.pickupBonus, format: (v) => `+${v}px` }, (v) => {
        scene.pickupBonus = v;
    });
    addSlider(root, "Плотность пуль", { min: 0.5, max: 2, step: 0.1, value: scene.density, format: (v) => `×${v.toFixed(1)}` }, (v) => {
        scene.density = v;
    });
    addCheckbox(root, "Показать хитбоксы", scene.showBoxes, (v) => {
        scene.showBoxes = v;
    });
    addButtons(root, [{ label: "Заново", onClick: () => scene.restart() }]);

    const set = addMetrics(root, [""], [
        ["sprite", "Попаданий по картинке"],
        ["core", "Попаданий по ядру"],
        ["graze", "Впритирку"],
        ["magnet", "Монет магнитом"],
    ]);
    addNote(root, "В bullet hell ядро в 2–6px — норма жанра. Игрок не знает точного размера, он знает только, что «еле увернулся», — и это лучшее ощущение в игре.");
    addFooter(root, "lie-hitboxes.html");

    let last = "";
    const tick = () => {
        set("sprite", 0, String(scene.spriteHits));
        set("core", 0, String(scene.coreHits));
        set("graze", 0, String(scene.grazes));
        set("magnet", 0, `${scene.pickedOnlyByBonus}/${scene.picked}`);
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
if (!gameRoot || !controlRoot) throw new Error("lie-hitboxes: expected #game-root and #control-panel");

const scene = new HitboxScene();
const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: gameRoot,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    backgroundColor: "#14181f",
    scene: [scene],
});
game.events.once(Phaser.Core.Events.READY, () => buildControls(controlRoot, scene));
