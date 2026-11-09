import Phaser from "phaser";
import { buildHowTo, buildLegend, buildNarrative } from "@/rendering/ExplainerPanel";
import { addButtons, addCheckbox, addFooter, addHeading, addMetrics, addNote, addSegmented } from "@/lies/panel";
import { P, solveTwoBone } from "@/lies/twoBoneIk";

const WORLD_WIDTH = 900;
const WORLD_HEIGHT = 420;
const STEP_X = 10;
const N_POINTS = WORLD_WIDTH / STEP_X + 1;
const L1 = 36;
const L2 = 36;
const HIP_HEIGHT = 64; // above the capsule bottom
const CAPSULE_R = 15;
const CAPSULE_H = 120;
const STRIDE = 54;
const WALK_SPEED = 95;
const STEP_TIME = 0.2;

type Mode = "anim" | "ik";

interface Foot {
    pos: P; // where the foot is drawn
    planted: P; // IK: world point it stands on
    from: P;
    to: P;
    stepT: number; // -1 = planted
}

class FootScene extends Phaser.Scene {
    mode: Mode = "anim";
    showCapsule = true;
    autoWalk = true;
    heights: number[] = [];
    x = 120;
    dir = 1;
    phase = 0;
    hipY = 0;
    feet: Foot[] = [];
    errLog: number[] = [];
    narrative = "";
    private g!: Phaser.GameObjects.Graphics;
    private keys!: Record<string, Phaser.Input.Keyboard.Key>;
    private errText!: Phaser.GameObjects.Text;
    private painting = false;

    constructor() {
        super("lie-foot-ik");
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);
        this.g = this.add.graphics();
        this.errText = this.add.text(12, 10, "", { fontFamily: "system-ui, sans-serif", fontSize: "13px", color: "#e6e8eb" });
        this.add.text(12, 30, "Тяни мышкой по земле, чтобы нарисовать рельеф. A / D или стрелки — идти.", {
            fontFamily: "system-ui, sans-serif",
            fontSize: "11px",
            color: "#8b93a3",
        });
        this.setTerrain("stairs");
        this.keys = this.input.keyboard!.addKeys("A,D,LEFT,RIGHT") as Record<string, Phaser.Input.Keyboard.Key>;
        this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
            this.painting = true;
            this.paint(p.x, p.y);
        });
        this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
            if (this.painting && p.isDown) this.paint(p.x, p.y);
        });
        this.input.on("pointerup", () => (this.painting = false));
        this.resetFeet();
    }

    setTerrain(kind: "flat" | "stairs" | "slope" | "bumps"): void {
        this.heights = [];
        for (let i = 0; i < N_POINTS; i++) {
            const x = i * STEP_X;
            let y = 340;
            if (kind === "stairs") y = 370 - Math.min(6, Math.max(0, Math.floor((x - 220) / 60))) * 18 + (x > 640 ? Math.floor((x - 640) / 60) * 22 : 0);
            if (kind === "slope") y = 380 - Math.max(0, Math.min(400, x - 200)) * 0.33;
            if (kind === "bumps") y = 340 + Math.sin(x / 47) * 22 + Math.sin(x / 13) * 5;
            this.heights.push(Math.max(180, Math.min(400, y)));
        }
        this.resetFeet();
    }

    paint(px: number, py: number): void {
        const target = Math.max(180, Math.min(405, py));
        for (let i = 0; i < N_POINTS; i++) {
            const d = Math.abs(i * STEP_X - px);
            if (d > 36) continue;
            const w = 1 - d / 36;
            this.heights[i] += (target - this.heights[i]) * w * 0.5;
        }
    }

    ground(x: number): number {
        const fx = Math.max(0, Math.min(WORLD_WIDTH, x)) / STEP_X;
        const i = Math.floor(fx);
        const t = fx - i;
        const a = this.heights[Math.min(i, N_POINTS - 1)];
        const b = this.heights[Math.min(i + 1, N_POINTS - 1)];
        return a + (b - a) * t;
    }

    /** The character controller: the capsule rests on the highest ground under its radius. It never tilts. */
    capsuleBottom(): number {
        let top = Infinity;
        for (let dx = -CAPSULE_R; dx <= CAPSULE_R; dx += 3) top = Math.min(top, this.ground(this.x + dx));
        return top;
    }

    resetFeet(): void {
        const cb = this.heights.length ? this.capsuleBottom() : 340;
        this.hipY = cb - HIP_HEIGHT;
        this.feet = [-1, 1].map((s) => {
            const x = this.x + s * 10;
            const p = { x, y: this.heights.length ? this.ground(x) : 340 };
            return { pos: { ...p }, planted: { ...p }, from: { ...p }, to: { ...p }, stepT: -1 };
        });
        this.errLog = [];
    }

    update(_time: number, deltaMs: number): void {
        const dt = Math.min(deltaMs, 50) / 1000;
        const k = this.keys;
        let move = 0;
        if (k.LEFT.isDown || k.A.isDown) move = -1;
        else if (k.RIGHT.isDown || k.D.isDown) move = 1;
        else if (this.autoWalk) {
            move = this.dir;
            if (this.x > WORLD_WIDTH - 60) this.dir = -1;
            if (this.x < 60) this.dir = 1;
            move = this.dir;
        }
        if (move) this.dir = move;
        this.x = Phaser.Math.Clamp(this.x + move * WALK_SPEED * dt, 30, WORLD_WIDTH - 30);
        const moving = move !== 0;
        if (moving) this.phase += (WALK_SPEED * dt) / STRIDE * Math.PI;

        const cb = this.capsuleBottom();
        if (this.mode === "anim") this.updateAnim(cb, moving);
        else this.updateIk(cb, dt, moving);
        this.draw(cb);
    }

    /** Authored walk cycle: feet move on an imaginary flat floor at the capsule's bottom. */
    updateAnim(cb: number, moving: boolean): void {
        this.hipY = cb - HIP_HEIGHT;
        let err = 0;
        let stance = 0;
        this.feet.forEach((f, i) => {
            const ph = this.phase + i * Math.PI;
            const swing = moving ? Math.max(0, Math.sin(ph)) : 0;
            // swing (sin > 0): foot is lifted and travels back→front; stance (sin < 0): planted, slides front→back under the body
            f.pos = { x: this.x + (moving ? -Math.cos(ph) * STRIDE * 0.5 * this.dir : i ? 8 : -8), y: cb - swing * 16 };
            if (swing < 0.05) {
                err += f.pos.y - this.ground(f.pos.x); // <0: hanging in the air, >0: inside the ground
                stance += 1;
            }
        });
        this.logError(stance ? err / stance : 0);
    }

    /** IK: feet stay planted where they touched the ground and step only when they must; the hip drops to reach. */
    updateIk(cb: number, dt: number, moving: boolean): void {
        this.feet.forEach((f, i) => {
            if (f.stepT >= 0) {
                f.stepT += dt / STEP_TIME;
                const t = Math.min(1, f.stepT);
                const arc = Math.sin(t * Math.PI) * 18;
                f.pos = { x: f.from.x + (f.to.x - f.from.x) * t, y: f.from.y + (f.to.y - f.from.y) * t - arc };
                if (t >= 1) {
                    f.stepT = -1;
                    f.planted = { ...f.to };
                    f.pos = { ...f.to };
                }
                return;
            }
            // keep the planted point but re-snap it if the reader repainted the ground under it
            f.planted.y = this.ground(f.planted.x);
            f.pos = { ...f.planted };
            const restX = this.x + (i ? 8 : -8);
            const behind = (this.x - f.planted.x) * this.dir;
            const needStep = moving ? behind > STRIDE * 0.5 : Math.abs(f.planted.x - restX) > 6;
            if (needStep && !this.feet.some((o) => o.stepT >= 0)) {
                // aim a bit ahead of the hip, accounting for how far the body moves during the step
                const tx = moving ? this.x + this.dir * (STRIDE * 0.45 + WALK_SPEED * STEP_TIME * 0.5) : restX;
                f.from = { ...f.planted };
                f.to = { x: tx, y: this.ground(tx) };
                f.stepT = 0;
            }
        });
        // hip: as high as the capsule allows, but low enough that both feet can reach their targets
        let hip = cb - HIP_HEIGHT;
        const reach = (L1 + L2) * 0.97;
        for (const f of this.feet) {
            const target = f.stepT >= 0 ? f.to : f.planted;
            const dx = target.x - this.x;
            if (Math.abs(dx) < reach) hip = Math.max(hip, target.y - Math.sqrt(reach * reach - dx * dx));
        }
        this.hipY += (hip - this.hipY) * Math.min(1, dt * 14);
        let err = 0;
        let stance = 0;
        for (const f of this.feet) {
            if (f.stepT >= 0) continue;
            const solved = solveTwoBone({ x: this.x, y: this.hipY }, f.pos, L1, L2, this.dir);
            err += solved.foot.y - this.ground(solved.foot.x);
            stance += 1;
        }
        this.logError(stance ? err / stance : 0);
    }

    logError(e: number): void {
        this.errLog.push(e);
        if (this.errLog.length > 120) this.errLog.shift();
    }

    get avgError(): { air: number; ground: number } {
        const air = this.errLog.filter((e) => e < -0.5);
        const gr = this.errLog.filter((e) => e > 0.5);
        const n = Math.max(1, this.errLog.length);
        return { air: air.reduce((a, b) => a - b, 0) / n, ground: gr.reduce((a, b) => a + b, 0) / n };
    }

    draw(cb: number): void {
        const g = this.g;
        g.clear();
        // ground
        g.fillStyle(0x2a3a2a, 1);
        g.beginPath();
        g.moveTo(0, WORLD_HEIGHT);
        for (let i = 0; i < N_POINTS; i++) g.lineTo(i * STEP_X, this.heights[i]);
        g.lineTo(WORLD_WIDTH, WORLD_HEIGHT);
        g.closePath();
        g.fillPath();
        g.lineStyle(2, 0x6fd48a, 0.8);
        g.beginPath();
        for (let i = 0; i < N_POINTS; i++) {
            if (i === 0) g.moveTo(0, this.heights[0]);
            else g.lineTo(i * STEP_X, this.heights[i]);
        }
        g.strokePath();

        if (this.showCapsule) {
            g.lineStyle(2, 0x4fc3f7, 0.8);
            g.strokeRoundedRect(this.x - CAPSULE_R, cb - CAPSULE_H, CAPSULE_R * 2, CAPSULE_H, CAPSULE_R);
            g.lineStyle(1, 0x4fc3f7, 0.5);
            g.lineBetween(this.x - 40, cb, this.x + 40, cb);
        }

        const hip = { x: this.x, y: this.hipY };
        // legs: back leg darker
        this.feet.forEach((f, i) => {
            const s = solveTwoBone(hip, f.pos, L1, L2, this.dir);
            const color = i === 0 ? 0x9aa3b5 : 0xe6e8eb;
            g.lineStyle(7, color, 1);
            g.lineBetween(hip.x, hip.y, s.knee.x, s.knee.y);
            g.lineBetween(s.knee.x, s.knee.y, s.foot.x, s.foot.y);
            g.fillStyle(color, 1);
            // heel slightly behind the ankle, toes pointing in the walking direction
            g.fillRect(this.dir > 0 ? s.foot.x - 3 : s.foot.x - 11, s.foot.y - 4, 14, 5);
            const gy = this.ground(s.foot.x);
            const e = s.foot.y - gy;
            if (Math.abs(e) > 3 && (this.mode === "anim" ? true : f.stepT < 0)) {
                g.lineStyle(2, e < 0 ? 0xffca28 : 0xef5350, 1);
                g.lineBetween(s.foot.x, s.foot.y, s.foot.x, gy);
            }
            if (this.mode === "ik" && this.showCapsule) {
                g.lineStyle(1, 0xff8a3d, 0.7);
                const tgt = f.stepT >= 0 ? f.to : f.planted;
                g.strokeCircle(tgt.x, tgt.y, 4);
            }
        });
        // torso + head
        g.lineStyle(9, 0xb57edc, 1);
        g.lineBetween(hip.x, hip.y, hip.x + this.dir * 4, hip.y - 44);
        g.fillStyle(0xb57edc, 1);
        g.fillCircle(hip.x + this.dir * 5, hip.y - 58, 11);

        const { air, ground } = this.avgError;
        this.errText.setText(
            this.mode === "anim"
                ? `Анимация без IK · нога в воздухе ~${air.toFixed(1)}px · в земле ~${ground.toFixed(1)}px`
                : `Foot IK · нога в воздухе ~${air.toFixed(1)}px · в земле ~${ground.toFixed(1)}px`,
        );
    }
}

function buildControls(root: HTMLElement, scene: FootScene): void {
    root.innerHTML = "";
    addHeading(root, "Foot IK");
    buildHowTo(
        root,
        "<b>Как пользоваться:</b> персонаж ходит сам (или A / D). <b>Тяни мышкой по полю</b>, чтобы поднять или " +
            "опустить землю. Голубая капсула — то, чем персонаж на самом деле сталкивается с миром, и она всегда " +
            "прямая. Без IK анимация ходит по воображаемому полу, с IK ноги ставятся на настоящую землю, а таз опускается.",
    );
    buildLegend(root, [
        { color: "#4fc3f7", label: "капсула (физика)", shape: "ring" },
        { color: "#ffca28", label: "нога висит в воздухе", shape: "line" },
        { color: "#ef5350", label: "нога в земле", shape: "line" },
        { color: "#ff8a3d", label: "цель IK", shape: "ring" },
    ]);
    const setNarrative = buildNarrative(root, "");

    addSegmented(
        root,
        "Ноги",
        [
            { value: "anim" as Mode, label: "Только анимация" },
            { value: "ik" as Mode, label: "Foot IK" },
        ],
        scene.mode,
        (m) => {
            scene.mode = m;
            scene.resetFeet();
        },
    );
    addCheckbox(root, "Идти самому по кругу", scene.autoWalk, (v) => {
        scene.autoWalk = v;
    });
    addCheckbox(root, "Показать капсулу и цели", scene.showCapsule, (v) => {
        scene.showCapsule = v;
    });
    addButtons(root, [
        { label: "Ступени", onClick: () => scene.setTerrain("stairs") },
        { label: "Склон", onClick: () => scene.setTerrain("slope") },
        { label: "Кочки", onClick: () => scene.setTerrain("bumps") },
        { label: "Ровно", onClick: () => scene.setTerrain("flat") },
    ]);

    const set = addMetrics(root, [""], [
        ["air", "Нога в воздухе (сред.)"],
        ["ground", "Нога в земле (сред.)"],
    ]);
    addNote(
        root,
        "Капсула и физика в обоих режимах одинаковые. IK ничего не меняет в том, как персонаж сталкивается с миром — " +
            "он врёт только о том, куда смотрит игрок: на ступни.",
    );
    addFooter(root, "lie-foot-ik.html");

    let last = "";
    const tick = () => {
        const { air, ground } = scene.avgError;
        set("air", 0, `${air.toFixed(1)} px`);
        set("ground", 0, `${ground.toFixed(1)} px`);
        const n =
            scene.mode === "anim"
                ? "Анимация ходьбы нарисована для ровного пола. Капсула стоит на самой высокой точке под собой, " +
                  "поэтому на ступенях одна нога висит в воздухе, а на склоне другая уходит в землю."
                : "Каждая ступня стоит на реальной земле и не скользит, пока не придётся шагнуть. Таз опускается, " +
                  "чтобы дотянуться до нижней ноги. Капсула при этом всё так же едет ровно — физика не изменилась.";
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
if (!gameRoot || !controlRoot) throw new Error("lie-foot-ik: expected #game-root and #control-panel");

const scene = new FootScene();
const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: gameRoot,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    backgroundColor: "#14181f",
    scene: [scene],
});
game.events.once(Phaser.Core.Events.READY, () => buildControls(controlRoot, scene));
