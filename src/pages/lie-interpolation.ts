import Phaser from "phaser";
import { buildHowTo, buildLegend, buildNarrative } from "@/rendering/ExplainerPanel";
import { addButtons, addCheckbox, addFooter, addHeading, addMetrics, addNote, addSlider } from "@/lies/panel";

const WORLD_WIDTH = 900;
const WORLD_HEIGHT = 420;
const LANE_X = 10;
const LANE_W = 880;
const LANE_H = 118;
const LANE_Y = [30, 160, 290];
const BALL_R = 11;
const GRAVITY = 900;
const RESTITUTION = 0.82;

interface State {
    x: number;
    y: number; // height above the floor, px
    vx: number;
    vy: number;
}

const LANE_TITLE = [
    "Без интерполяции: рисуем последнее состояние физики",
    "Интерполяция: рисуем между двумя последними тиками (на 1 тик в прошлом)",
    "Экстраполяция: угадываем вперёд по скорости",
];
const LANE_COLOR = [0xef5350, 0x6fd48a, 0xffca28];

class InterpScene extends Phaser.Scene {
    hz = 10;
    timeScale = 1;
    showTicks = true;
    prev: State = { x: 200, y: 60, vx: 0, vy: 0 };
    curr: State = { x: 200, y: 60, vx: 0, vy: 0 };
    acc = 0;
    target = 200;
    mouseIdle = 0;
    tickTrail: State[] = [];
    renderTrails: Array<Array<{ x: number; y: number }>> = [[], [], []];
    maxBelowFloor = 0;
    stepsPerFrameLog: number[] = [];
    kicks = 0;
    narrative = "";
    private g!: Phaser.GameObjects.Graphics;
    private t = 0;

    constructor() {
        super("lie-interpolation");
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);
        this.g = this.add.graphics();
        LANE_Y.forEach((y, i) => {
            this.add.text(LANE_X + 8, y - 18, LANE_TITLE[i], {
                fontFamily: "system-ui, sans-serif",
                fontSize: "12px",
                color: `#${LANE_COLOR[i].toString(16)}`,
            });
        });
        this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
            this.target = Phaser.Math.Clamp(p.x - LANE_X, BALL_R, LANE_W - BALL_R);
            this.mouseIdle = 0;
        });
        this.input.on("pointerdown", () => this.kick());
        this.narrative =
            "Води мышкой — мяч бежит за курсором, клик — подбросить. Все три дорожки показывают <b>одну и ту же</b> физику, " +
            `которая считается всего ${this.hz} раз в секунду. Разница только в том, как её рисуют на 60 fps.`;
    }

    kick(): void {
        this.curr.vy = 520;
        this.kicks += 1;
    }

    physicsStep(dt: number): void {
        this.prev = { ...this.curr };
        const s = this.curr;
        // spring towards the target on x, ballistic bounce on y
        const ax = (this.target - s.x) * 14 - s.vx * 5;
        s.vx += ax * dt;
        s.x += s.vx * dt;
        s.vy -= GRAVITY * dt;
        s.y += s.vy * dt;
        if (s.y < 0) {
            s.y = -s.y * RESTITUTION;
            s.vy = -s.vy * RESTITUTION;
            if (Math.abs(s.vy) < 60) {
                s.y = 0;
                s.vy = 0;
            }
        }
        this.tickTrail.push({ ...s });
        if (this.tickTrail.length > 40) this.tickTrail.shift();
    }

    update(_time: number, deltaMs: number): void {
        const frameDt = (Math.min(deltaMs, 50) / 1000) * this.timeScale;
        this.t += frameDt;
        this.mouseIdle += frameDt;
        if (this.mouseIdle > 2.5) {
            // demo mode: if the reader is not moving the mouse, wander and hop by itself
            this.target = LANE_W / 2 + Math.sin(this.t * 0.9) * (LANE_W / 2 - 60);
            if (this.curr.y === 0 && Math.random() < frameDt * 0.8) this.curr.vy = 420;
        }
        const dt = 1 / this.hz;
        this.acc += frameDt;
        let steps = 0;
        while (this.acc >= dt) {
            this.physicsStep(dt);
            this.acc -= dt;
            steps += 1;
        }
        this.stepsPerFrameLog.push(steps);
        if (this.stepsPerFrameLog.length > 60) this.stepsPerFrameLog.shift();
        const alpha = this.acc / dt;

        const renders = [
            { x: this.curr.x, y: this.curr.y },
            { x: Phaser.Math.Linear(this.prev.x, this.curr.x, alpha), y: Phaser.Math.Linear(this.prev.y, this.curr.y, alpha) },
            { x: this.curr.x + this.curr.vx * this.acc, y: this.curr.y + this.curr.vy * this.acc - 0.5 * GRAVITY * this.acc * this.acc },
        ];
        this.maxBelowFloor = Math.max(this.maxBelowFloor * 0.995, -renders[2].y);
        renders.forEach((r, i) => {
            this.renderTrails[i].push(r);
            if (this.renderTrails[i].length > 50) this.renderTrails[i].shift();
        });
        this.draw(renders);
    }

    draw(renders: Array<{ x: number; y: number }>): void {
        const g = this.g;
        g.clear();
        LANE_Y.forEach((ly, i) => {
            const floor = ly + LANE_H - 8;
            g.fillStyle(0x1b1f27, 1);
            g.fillRect(LANE_X, ly, LANE_W, LANE_H);
            g.lineStyle(2, 0x3a4150, 1);
            g.lineBetween(LANE_X, floor, LANE_X + LANE_W, floor);
            const py = (h: number) => floor - BALL_R - h * 0.55;

            if (this.showTicks) {
                for (const s of this.tickTrail) {
                    g.fillStyle(0x8b93a3, 0.5);
                    g.fillRect(LANE_X + s.x - 2, py(s.y) - 2, 4, 4);
                }
            }
            const trail = this.renderTrails[i];
            if (trail.length > 1) {
                g.lineStyle(2, LANE_COLOR[i], 0.35);
                g.beginPath();
                trail.forEach((p, k) => {
                    if (k === 0) g.moveTo(LANE_X + p.x, py(p.y));
                    else g.lineTo(LANE_X + p.x, py(p.y));
                });
                g.strokePath();
            }
            const r = renders[i];
            g.fillStyle(LANE_COLOR[i], 1);
            g.fillCircle(LANE_X + r.x, py(r.y), BALL_R);
            if (i === 2 && r.y < 0) {
                g.lineStyle(2, 0xef5350, 1);
                g.strokeCircle(LANE_X + r.x, py(r.y), BALL_R + 4);
            }
            g.lineStyle(1, 0x4fc3f7, 0.5);
            g.lineBetween(LANE_X + this.target, ly + 4, LANE_X + this.target, ly + 14);
        });
    }
}

function buildControls(root: HTMLElement, scene: InterpScene): void {
    root.innerHTML = "";
    addHeading(root, "Interpolation");
    buildHowTo(
        root,
        "<b>Как пользоваться:</b> води мышкой над дорожками — мяч бежит за курсором, клик — подбросить. " +
            "Серые квадраты — где мяч был на самом деле, в тиках физики. Опусти частоту физики до 5–10 Гц: без " +
            "интерполяции мяч скачет рывками, с интерполяцией плавный, но опаздывает, экстраполяция плавная и " +
            "свежая, но на отскоке проваливается в пол.",
    );
    buildLegend(root, [
        { color: "#8b93a3", label: "тики физики" },
        { color: "#ef5350", label: "без интерполяции" },
        { color: "#6fd48a", label: "интерполяция" },
        { color: "#ffca28", label: "экстраполяция" },
        { color: "#4fc3f7", label: "курсор", shape: "line" },
    ]);
    const setNarrative = buildNarrative(root, "");

    addSlider(root, "Частота физики", { min: 4, max: 60, step: 1, value: scene.hz, format: (v) => `${v} Гц` }, (v) => {
        scene.hz = v;
    });
    addSlider(root, "Замедление", { min: 0.1, max: 1, step: 0.05, value: scene.timeScale, format: (v) => `×${v.toFixed(2)}` }, (v) => {
        scene.timeScale = v;
    });
    addCheckbox(root, "Показать тики физики", scene.showTicks, (v) => {
        scene.showTicks = v;
    });
    addButtons(root, [
        { label: "Подбросить", onClick: () => scene.kick() },
        { label: "5 Гц", onClick: () => (scene.hz = 5) },
        { label: "30 Гц", onClick: () => (scene.hz = 30) },
    ]);

    const set = addMetrics(root, ["Без", "Интерп.", "Экстр."], [
        ["lag", "Задержка картинки"],
        ["smooth", "Плавно"],
        ["floor", "Провал в пол"],
    ]);
    addNote(
        root,
        "Задержка — насколько нарисованный мяч в среднем старше настоящего. Интерполяция всегда платит одним тиком, " +
            "поэтому шутеры с 20–30 Гц сервера рисуют чужих игроков в прошлом.",
    );
    addFooter(root, "lie-interpolation.html");

    let last = "";
    const tick = () => {
        const tickMs = 1000 / scene.hz;
        set("lag", 0, `~${(tickMs / 2).toFixed(0)} мс`);
        set("lag", 1, `${tickMs.toFixed(0)} мс`);
        set("lag", 2, "~0 мс");
        const smooth = scene.hz >= 50 ? "да" : "нет";
        set("smooth", 0, smooth);
        set("smooth", 1, "да");
        set("smooth", 2, "да, но врёт");
        set("floor", 0, "0");
        set("floor", 1, "0");
        set("floor", 2, `${(scene.maxBelowFloor * 0.55).toFixed(0)} px`);
        const n = `Физика ${scene.hz} Гц = новый тик раз в ${tickMs.toFixed(0)} мс, а кадр рисуется каждые 17 мс. ` +
            (scene.hz < 30
                ? `Красный мяч стоит на месте ${Math.max(0, Math.round(60 / scene.hz) - 1)} кадров из ${Math.round(60 / scene.hz)} — отсюда рывки. Зелёный плавный, но это <b>ложь о прошлом</b>. Жёлтый — <b>ложь о будущем</b>, она ломается на отскоках.`
                : "На такой частоте разница почти незаметна — опусти ползунок.");
        if (n !== last) {
            last = n;
            setNarrative(n);
        }
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

const gameRoot = document.getElementById("game-root");
const controlRoot = document.getElementById("control-panel");
if (!gameRoot || !controlRoot) throw new Error("lie-interpolation: expected #game-root and #control-panel");

const scene = new InterpScene();
const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: gameRoot,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    backgroundColor: "#14181f",
    scene: [scene],
});
game.events.once(Phaser.Core.Events.READY, () => buildControls(controlRoot, scene));
