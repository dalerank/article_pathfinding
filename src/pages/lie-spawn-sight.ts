import Phaser from "phaser";
import { buildHowTo, buildLegend, buildNarrative } from "@/rendering/ExplainerPanel";
import { addButtons, addCheckbox, addFooter, addHeading, addMetrics, addNote, addSegmented, addSlider } from "@/lies/panel";
import { Rect, Segment, Vec, circleHitsRect, pointInPolygon, rectSegments, visibilityPolygon } from "@/lies/visibility";

const WORLD_WIDTH = 900;
const WORLD_HEIGHT = 420;
const AX = 10;
const AY = 30;
const AW = 600;
const AH = 380;
const SIDE_X = 625;

const PLAYER_R = 10;
const PLAYER_SPEED = 160;
const ENEMY_R = 9;
const ENEMY_SPEED = 38;
const MIN_SPAWN_DIST = 110;

type SpawnRule = "anywhere" | "hidden";

const WALLS: Rect[] = [
    { x: 90, y: 60, w: 30, h: 130 },
    { x: 90, y: 250, w: 140, h: 26 },
    { x: 220, y: 70, w: 120, h: 26 },
    { x: 300, y: 160, w: 26, h: 120 },
    { x: 400, y: 40, w: 26, h: 140 },
    { x: 420, y: 250, w: 120, h: 26 },
    { x: 500, y: 110, w: 60, h: 60 },
    { x: 170, y: 150, w: 50, h: 50 },
];

interface Enemy {
    x: number;
    y: number;
    age: number;
}

interface Burst {
    x: number;
    y: number;
    life: number;
    text: string;
    color: number;
}

class SpawnScene extends Phaser.Scene {
    rule: SpawnRule = "anywhere";
    xray = false;
    spawnEvery = 1.1;
    maxEnemies = 9;
    player: Vec = { x: 40, y: 340 };
    enemies: Enemy[] = [];
    bursts: Burst[] = [];
    poly: Vec[] = [];
    spawnTimer = 0;
    running = false;
    t = 0;
    spawned = 0;
    poppedInView = 0;
    vanishedInView = 0;
    skipped = 0;
    caughtBy = 0;
    narrative = "";
    private segments: Segment[] = [];
    private g!: Phaser.GameObjects.Graphics;
    private texts: Record<string, Phaser.GameObjects.Text> = {};
    private burstTexts: Phaser.GameObjects.Text[] = [];
    private pointer: Vec = { x: 40, y: 340 };

    constructor() {
        super("lie-spawn-sight");
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);
        this.g = this.add.graphics();
        this.segments = [...rectSegments({ x: 0, y: 0, w: AW, h: AH }), ...WALLS.flatMap(rectSegments)];
        const font = "system-ui, sans-serif";
        const t = (key: string, x: number, y: number, size: number, color = "#e6e8eb") => {
            this.texts[key] = this.add.text(x, y, "", { fontFamily: font, fontSize: `${size}px`, color }).setDepth(5);
        };
        t("title", AX, 8, 13, "#c5cad3");
        t("big", SIDE_X, 12, 13);
        t("pop", SIDE_X, 50, 30, "#ef5350");
        t("popCap", SIDE_X, 86, 11, "#8b93a3");
        t("van", SIDE_X, 120, 30, "#ff8a3d");
        t("vanCap", SIDE_X, 156, 11, "#8b93a3");
        t("explain", SIDE_X, 196, 12, "#c5cad3");
        t("overlay", AX + AW / 2, AY + AH / 2, 18, "#ffca28");
        this.texts.overlay.setOrigin(0.5).setAlign("center");
        this.texts.explain.setWordWrapWidth(260);
        this.texts.popCap.setText("враг появился у тебя на глазах");
        this.texts.vanCap.setText("враг исчез у тебя на глазах");
        this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
            this.pointer = { x: p.x - AX, y: p.y - AY };
        });
        this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
            this.pointer = { x: p.x - AX, y: p.y - AY };
            if (!this.running) this.restart();
        });
        this.reset();
        this.narrative = "Кликни по карте и води мышкой — герой идёт за курсором. Видно только то, что в прямой видимости. Враги появляются, пока их не больше " + this.maxEnemies + ".";
    }

    reset(): void {
        this.player = { x: 40, y: 340 };
        this.enemies = [];
        this.bursts = [];
        this.t = 0;
        this.spawned = 0;
        this.poppedInView = 0;
        this.vanishedInView = 0;
        this.skipped = 0;
        this.caughtBy = 0;
        this.spawnTimer = 0.5;
        this.poly = visibilityPolygon(this.player, this.segments);
    }

    restart(): void {
        this.reset();
        this.running = true;
        this.narrative =
            this.rule === "anywhere"
                ? "Спавн где угодно: точка выбирается случайно по всей карте. Смотри на счётчик слева сверху."
                : "Спавн вне поля зрения: точка выбирается только там, куда ты сейчас не смотришь, и не ближе " + MIN_SPAWN_DIST + "px.";
    }

    visible(p: Vec): boolean {
        return pointInPolygon(p, this.poly);
    }

    freeSpot(p: Vec, r: number): boolean {
        if (p.x < r || p.y < r || p.x > AW - r || p.y > AH - r) return false;
        return !WALLS.some((w) => circleHitsRect(p, r, w));
    }

    trySpawn(): void {
        if (this.enemies.length >= this.maxEnemies) {
            // make room: the honest rule removes any enemy, the lying one removes one you can't see
            const pool = this.rule === "anywhere" ? this.enemies : this.enemies.filter((e) => !this.visible(e));
            if (!pool.length) {
                this.skipped += 1;
                return;
            }
            const victim = this.rule === "anywhere" ? pool[Math.floor(Math.random() * pool.length)] : pool.reduce((a, b) => (a.age > b.age ? a : b));
            if (this.visible(victim)) {
                this.vanishedInView += 1;
                this.burst(victim, "исчез!", 0xff8a3d);
            }
            this.enemies = this.enemies.filter((e) => e !== victim);
        }
        for (let attempt = 0; attempt < 60; attempt++) {
            const p = { x: ENEMY_R + Math.random() * (AW - 2 * ENEMY_R), y: ENEMY_R + Math.random() * (AH - 2 * ENEMY_R) };
            if (!this.freeSpot(p, ENEMY_R)) continue;
            if (this.rule === "hidden") {
                if (this.visible(p)) continue;
                if (Math.hypot(p.x - this.player.x, p.y - this.player.y) < MIN_SPAWN_DIST) continue;
            }
            this.enemies.push({ ...p, age: 0 });
            this.spawned += 1;
            if (this.visible(p)) {
                this.poppedInView += 1;
                this.burst(p, "ПУФ!", 0xef5350);
            }
            return;
        }
        this.skipped += 1;
    }

    burst(p: Vec, text: string, color: number): void {
        this.bursts.push({ x: p.x, y: p.y, life: 1, text, color });
    }

    moveCircle(pos: Vec, dx: number, dy: number, r: number): void {
        const nx = { x: pos.x + dx, y: pos.y };
        if (this.freeSpot(nx, r)) pos.x = nx.x;
        const ny = { x: pos.x, y: pos.y + dy };
        if (this.freeSpot(ny, r)) pos.y = ny.y;
    }

    update(_time: number, deltaMs: number): void {
        const dt = Math.min(deltaMs, 50) / 1000;
        if (this.running) this.step(dt);
        for (const b of this.bursts) b.life -= dt;
        this.bursts = this.bursts.filter((b) => b.life > 0);
        this.draw();
    }

    step(dt: number): void {
        this.t += dt;
        const dx = this.pointer.x - this.player.x;
        const dy = this.pointer.y - this.player.y;
        const d = Math.hypot(dx, dy);
        if (d > 3) {
            const s = Math.min(d, PLAYER_SPEED * dt);
            this.moveCircle(this.player, (dx / d) * s, (dy / d) * s, PLAYER_R);
        }
        this.poly = visibilityPolygon(this.player, this.segments);

        for (const e of this.enemies) {
            e.age += dt;
            const ex = this.player.x - e.x;
            const ey = this.player.y - e.y;
            const ed = Math.hypot(ex, ey);
            if (ed > 1) this.moveCircle(e, (ex / ed) * ENEMY_SPEED * dt, (ey / ed) * ENEMY_SPEED * dt, ENEMY_R);
        }
        const before = this.enemies.length;
        this.enemies = this.enemies.filter((e) => Math.hypot(e.x - this.player.x, e.y - this.player.y) > PLAYER_R + ENEMY_R);
        this.caughtBy += before - this.enemies.length;

        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
            this.spawnTimer = this.spawnEvery;
            this.trySpawn();
        }
    }

    draw(): void {
        const g = this.g;
        g.clear();
        // fog everywhere, then the visible area on top
        g.fillStyle(0x0d1015, 1);
        g.fillRect(AX, AY, AW, AH);
        if (this.poly.length > 2) {
            g.fillStyle(0x232a35, 1);
            g.beginPath();
            g.moveTo(AX + this.poly[0].x, AY + this.poly[0].y);
            for (const p of this.poly) g.lineTo(AX + p.x, AY + p.y);
            g.closePath();
            g.fillPath();
        }
        for (const w of WALLS) {
            g.fillStyle(0x4a5262, 1);
            g.fillRect(AX + w.x, AY + w.y, w.w, w.h);
        }
        g.lineStyle(1, 0x2a2f3a, 1);
        g.strokeRect(AX, AY, AW, AH);

        for (const e of this.enemies) {
            const vis = this.visible(e);
            if (!vis && !this.xray) continue;
            g.fillStyle(0xb57edc, vis ? 1 : 0.3);
            g.fillCircle(AX + e.x, AY + e.y, ENEMY_R);
            if (!vis) {
                g.lineStyle(1, 0xb57edc, 0.5);
                g.strokeCircle(AX + e.x, AY + e.y, ENEMY_R + 3);
            }
        }

        g.fillStyle(0x4fc3f7, 1);
        g.fillCircle(AX + this.player.x, AY + this.player.y, PLAYER_R);

        while (this.burstTexts.length < this.bursts.length) {
            this.burstTexts.push(
                this.add.text(0, 0, "", { fontFamily: "system-ui, sans-serif", fontSize: "14px", fontStyle: "bold", color: "#ffffff" }).setOrigin(0.5).setDepth(6),
            );
        }
        this.burstTexts.forEach((t, i) => {
            const b = this.bursts[i];
            if (!b) {
                t.setVisible(false);
                return;
            }
            g.lineStyle(3, b.color, b.life);
            g.strokeCircle(AX + b.x, AY + b.y, ENEMY_R + (1 - b.life) * 26);
            t.setVisible(true)
                .setPosition(AX + b.x, AY + b.y - 18 - (1 - b.life) * 14)
                .setText(b.text)
                .setColor(`#${b.color.toString(16).padStart(6, "0")}`)
                .setAlpha(b.life);
        });

        if (!this.running) {
            g.fillStyle(0x14181f, 0.7);
            g.fillRect(AX, AY, AW, AH);
        }
        this.texts.overlay.setText(this.running ? "" : "Кликни, чтобы начать\nгерой идёт за мышкой");
        this.texts.title.setText(this.rule === "anywhere" ? "Спавн: где угодно (честно)" : "Спавн: только вне поля зрения");
        this.texts.big.setText(`${this.t.toFixed(0)}с · появилось ${this.spawned} · догнали тебя ${this.caughtBy}`);
        this.texts.pop.setText(String(this.poppedInView));
        this.texts.van.setText(String(this.vanishedInView));
        const share = this.spawned ? (this.poppedInView / this.spawned) * 100 : 0;
        this.texts.explain.setText(
            this.rule === "anywhere"
                ? `${share.toFixed(0)}% врагов родились прямо в поле зрения. Каждый такой — маленький разрыв: игрок видит, что мир собирается вокруг него.`
                : `Те же враги, тот же темп. Генератор просто не ставит их туда, куда ты смотришь, и убирает только тех, кого ты не видишь. Пропущено спавнов (некуда спрятать): ${this.skipped}.`,
        );
    }
}

function buildControls(root: HTMLElement, scene: SpawnScene): void {
    root.innerHTML = "";
    addHeading(root, "Spawn Out of Sight");
    buildHowTo(
        root,
        "<b>Как пользоваться:</b> кликни по карте и води мышкой — герой идёт за курсором. Светлая зона — то, что " +
            "ты видишь, тёмная — туман. Враги рождаются и идут к тебе. В честном режиме точка спавна любая, и " +
            "время от времени враг возникает прямо перед носом. Переключи режим и пройди тот же маршрут.",
    );
    buildLegend(root, [
        { color: "#4fc3f7", label: "ты" },
        { color: "#b57edc", label: "враг" },
        { color: "#ef5350", label: "появился на глазах", shape: "ring" },
        { color: "#ff8a3d", label: "исчез на глазах", shape: "ring" },
    ]);
    const setNarrative = buildNarrative(root, "");

    addSegmented(
        root,
        "Где спавнить",
        [
            { value: "anywhere" as SpawnRule, label: "Где угодно" },
            { value: "hidden" as SpawnRule, label: "Вне поля зрения" },
        ],
        scene.rule,
        (r) => {
            scene.rule = r;
            scene.restart();
        },
    );
    addCheckbox(root, "Рентген: показать врагов в тумане", scene.xray, (v) => {
        scene.xray = v;
    });
    addSlider(root, "Спавн каждые", { min: 0.3, max: 3, step: 0.1, value: scene.spawnEvery, format: (v) => `${v.toFixed(1)}с` }, (v) => {
        scene.spawnEvery = v;
    });
    addSlider(root, "Макс. врагов", { min: 3, max: 20, step: 1, value: scene.maxEnemies, format: (v) => String(v) }, (v) => {
        scene.maxEnemies = v;
    });
    addButtons(root, [{ label: "Заново", onClick: () => scene.restart() }]);

    const set = addMetrics(root, [""], [
        ["spawned", "Появилось"],
        ["pop", "На глазах"],
        ["van", "Исчезло на глазах"],
        ["skip", "Пропущено спавнов"],
    ]);
    addNote(root, "Когда врагов уже максимум, игра убирает одного. Честный режим убирает случайного — иногда того, на кого ты смотришь.");
    addFooter(root, "lie-spawn-sight.html");

    let last = "";
    const tick = () => {
        set("spawned", 0, String(scene.spawned));
        set("pop", 0, String(scene.poppedInView));
        set("van", 0, String(scene.vanishedInView));
        set("skip", 0, String(scene.skipped));
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
if (!gameRoot || !controlRoot) throw new Error("lie-spawn-sight: expected #game-root and #control-panel");

const scene = new SpawnScene();
const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: gameRoot,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    backgroundColor: "#14181f",
    scene: [scene],
});
game.events.once(Phaser.Core.Events.READY, () => buildControls(controlRoot, scene));
