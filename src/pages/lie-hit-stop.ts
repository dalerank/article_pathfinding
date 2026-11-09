import Phaser from "phaser";
import { buildHowTo, buildLegend, buildNarrative } from "@/rendering/ExplainerPanel";
import { addButtons, addFooter, addHeading, addMetrics, addNote, addSegmented, addSlider } from "@/lies/panel";

const WORLD_WIDTH = 900;
const WORLD_HEIGHT = 420;
const SIDE_W = 445;
const SIDE_X = [5, 450];
const GROUND_Y = 290;
const HERO_DX = 130;
const DUMMY_DX = 270;
const SWING = 0.3;
const IMPACT_AT = 0.22; // the moment the blade is level with the dummy
const STRIP_N = 45;

type Preset = "none" | "stop" | "full";
const PRESET_LABEL: Record<Preset, string> = { none: "Без сока", stop: "Только hit stop", full: "Полный сок" };

interface Juice {
    hitStopMs: number;
    shake: boolean;
    flash: boolean;
    knockback: boolean;
    sparks: boolean;
}

interface Spark {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
}

interface Side {
    preset: Preset;
    juice: Juice;
    swingT: number; // -1 = idle
    impacted: boolean;
    freeze: number; // seconds of hit stop left
    shake: number;
    flash: number;
    knock: number;
    knockV: number;
    sparks: Spark[];
    frames: Array<"normal" | "frozen" | "impact">;
    hits: number;
    dmgFx: Array<{ life: number }>;
}

class HitStopScene extends Phaser.Scene {
    hitStopMs = 70;
    sides: Side[] = [];
    blind = false;
    blindStopSide = 0;
    blindScore = { right: 0, total: 0 };
    narrative = "";
    private g!: Phaser.GameObjects.Graphics;
    private texts: Phaser.GameObjects.Text[][] = [];
    private dmgTexts: Phaser.GameObjects.Text[][] = [[], []];

    constructor() {
        super("lie-hit-stop");
    }

    juiceFor(preset: Preset): Juice {
        if (preset === "none") return { hitStopMs: 0, shake: false, flash: false, knockback: false, sparks: false };
        if (preset === "stop") return { hitStopMs: this.hitStopMs, shake: false, flash: false, knockback: false, sparks: false };
        return { hitStopMs: this.hitStopMs, shake: true, flash: true, knockback: true, sparks: true };
    }

    makeSide(preset: Preset): Side {
        return {
            preset,
            juice: this.juiceFor(preset),
            swingT: -1,
            impacted: false,
            freeze: 0,
            shake: 0,
            flash: 0,
            knock: 0,
            knockV: 0,
            sparks: [],
            frames: [],
            hits: 0,
            dmgFx: [],
        };
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);
        this.g = this.add.graphics();
        this.sides = [this.makeSide("none"), this.makeSide("full")];
        const font = "system-ui, sans-serif";
        SIDE_X.forEach((x) => {
            this.texts.push([
                this.add.text(x + 16, 14, "", { fontFamily: font, fontSize: "14px", color: "#e6e8eb" }),
                this.add.text(x + 16, 36, "", { fontFamily: font, fontSize: "11px", color: "#8b93a3" }),
                this.add.text(x + 16, 344, "", { fontFamily: font, fontSize: "11px", color: "#8b93a3" }),
                this.add.text(x + SIDE_W / 2, GROUND_Y + 22, "", { fontFamily: font, fontSize: "12px", color: "#8b93a3" }).setOrigin(0.5, 0),
            ]);
        });
        this.input.on("pointerdown", (p: Phaser.Input.Pointer) => this.swing(p.x < 450 ? 0 : 1));
        this.input.keyboard?.on("keydown", (e: KeyboardEvent) => {
            if (e.code === "KeyA" || e.code === "ArrowLeft") this.swing(0);
            if (e.code === "KeyD" || e.code === "ArrowRight" || e.code === "KeyL") this.swing(1);
        });
        this.narrative = "Кликай по левой и правой половине (или A / D). Урон одинаковый — разный только «сок».";
    }

    setPreset(i: number, p: Preset): void {
        this.blind = false;
        this.sides[i].preset = p;
        this.sides[i].juice = this.juiceFor(p);
    }

    refreshJuice(): void {
        if (this.blind) {
            this.sides.forEach((s, i) => (s.juice = { ...this.juiceFor("none"), hitStopMs: i === this.blindStopSide ? this.hitStopMs : 0 }));
        } else this.sides.forEach((s) => (s.juice = this.juiceFor(s.preset)));
    }

    startBlind(): void {
        this.blind = true;
        this.blindStopSide = Math.random() < 0.5 ? 0 : 1;
        this.refreshJuice();
        this.narrative =
            `<b>Слепой тест.</b> Ни тряски, ни вспышек: у одного из манекенов при ударе игра замирает на ${this.hitStopMs}мс, у другого — нет. ` +
            "Постучи по обоим и нажми, какой удар ощущается тяжелее.";
    }

    answerBlind(side: number): void {
        if (!this.blind) return;
        const correct = side === this.blindStopSide;
        this.blindScore.total += 1;
        if (correct) this.blindScore.right += 1;
        this.narrative =
            `Hit stop был у <b>${this.blindStopSide === 0 ? "левого" : "правого"}</b>. ` +
            (correct ? "Ты угадал — " : "Не угадал — ") +
            `счёт ${this.blindScore.right} из ${this.blindScore.total}. ` +
            `${this.hitStopMs}мс — это ${Math.round(this.hitStopMs / 16.7)} кадров, которых игрок не замечает глазами, но чувствует руками. ` +
            "Жми «Слепой тест» ещё раз или уменьши задержку.";
        this.blind = false;
        this.refreshJuice();
    }

    swing(i: number): void {
        const s = this.sides[i];
        if (s.swingT >= 0) return;
        s.swingT = 0;
        s.impacted = false;
    }

    update(_time: number, deltaMs: number): void {
        const realDt = Math.min(deltaMs, 50) / 1000;
        this.sides.forEach((s) => {
            let frame: "normal" | "frozen" | "impact" = "normal";
            // hit stop = this side's clock stops; real time keeps going for everything else
            let dt = realDt;
            if (s.freeze > 0) {
                s.freeze -= realDt;
                dt = 0;
                frame = "frozen";
            }
            if (s.swingT >= 0) {
                s.swingT += dt;
                if (!s.impacted && s.swingT >= IMPACT_AT) {
                    s.impacted = true;
                    s.hits += 1;
                    frame = "impact";
                    s.freeze = s.juice.hitStopMs / 1000;
                    if (s.juice.shake) s.shake = 1;
                    if (s.juice.flash) s.flash = 1;
                    if (s.juice.knockback) s.knockV = 260;
                    if (s.juice.sparks) {
                        for (let k = 0; k < 10; k++) {
                            const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
                            const v = 120 + Math.random() * 180;
                            s.sparks.push({ x: DUMMY_DX - 18, y: GROUND_Y - 70, vx: Math.cos(a) * v - 40, vy: Math.sin(a) * v, life: 1 });
                        }
                    }
                    s.dmgFx.push({ life: 1 });
                }
                if (s.swingT >= SWING) s.swingT = -1;
            }
            // shake/flash decay in real time so they are visible during the freeze
            s.shake = Math.max(0, s.shake - realDt * 7);
            s.flash = Math.max(0, s.flash - realDt * 12);
            s.knock += s.knockV * dt;
            s.knockV += (-s.knock * 120 - s.knockV * 14) * dt;
            for (const sp of s.sparks) {
                sp.x += sp.vx * dt;
                sp.y += sp.vy * dt;
                sp.vy += 500 * dt;
                sp.life -= dt * 2;
            }
            s.sparks = s.sparks.filter((sp) => sp.life > 0);
            for (const d of s.dmgFx) d.life -= realDt * 1.4;
            s.dmgFx = s.dmgFx.filter((d) => d.life > 0);
            if (s.swingT >= 0 || s.freeze > 0 || frame !== "normal") s.frames.push(frame);
            else if (s.frames.length && s.frames[s.frames.length - 1] !== "normal") s.frames.push("normal");
            while (s.frames.length > STRIP_N) s.frames.shift();
        });
        this.draw();
    }

    draw(): void {
        const g = this.g;
        g.clear();
        this.sides.forEach((s, i) => {
            const x0 = SIDE_X[i];
            const ox = x0 + (s.shake > 0 ? (Math.random() - 0.5) * 12 * s.shake : 0);
            const oy = s.shake > 0 ? (Math.random() - 0.5) * 8 * s.shake : 0;
            g.fillStyle(0x1b1f27, 1);
            g.fillRoundedRect(x0, 6, SIDE_W, 408, 6);
            g.fillStyle(0x2a2f3a, 1);
            g.fillRect(x0 + 10, GROUND_Y + oy, SIDE_W - 20, 4);

            // hero + sword
            const hx = ox + HERO_DX;
            const hy = GROUND_Y + oy;
            g.fillStyle(0x4fc3f7, 1);
            g.fillRoundedRect(hx - 16, hy - 70, 32, 70, 8);
            g.fillCircle(hx, hy - 84, 13);
            let ang = -2.2; // idle: sword up and back
            if (s.swingT >= 0) {
                const k = Math.min(1, s.swingT / SWING);
                ang = k < 0.25 ? -2.2 - k * 1.2 : -2.5 + ((k - 0.25) / 0.75) * 3.3;
            }
            const sx = hx + 12;
            const sy = hy - 50;
            g.lineStyle(5, 0xe6e8eb, 1);
            g.lineBetween(sx, sy, sx + Math.cos(ang) * 95, sy + Math.sin(ang) * 95);

            // dummy
            const dx = ox + DUMMY_DX + s.knock * 0.08;
            g.fillStyle(0x6b4f2a, 1);
            g.fillRect(dx - 3, hy - 20, 6, 20);
            g.fillStyle(s.flash > 0 ? 0xffffff : 0xb57edc, 1);
            g.fillRoundedRect(dx - 24, hy - 110, 48, 92, 14);
            g.fillStyle(0x14181f, 1);
            g.fillCircle(dx - 8, hy - 86, 3);
            g.fillCircle(dx + 8, hy - 86, 3);

            for (const sp of s.sparks) {
                g.fillStyle(0xffca28, sp.life);
                g.fillRect(ox + sp.x - 2, oy + sp.y - 2, 4, 4);
            }

            // damage numbers (identical on both sides)
            while (this.dmgTexts[i].length < s.dmgFx.length) {
                this.dmgTexts[i].push(this.add.text(0, 0, "-10", { fontFamily: "system-ui, sans-serif", fontSize: "18px", fontStyle: "bold", color: "#ffca28" }).setOrigin(0.5));
            }
            this.dmgTexts[i].forEach((t, k) => {
                const d = s.dmgFx[k];
                if (!d) return void t.setVisible(false);
                t.setVisible(true).setAlpha(d.life).setPosition(x0 + DUMMY_DX, GROUND_Y - 130 - (1 - d.life) * 30);
            });

            // frame strip
            const cw = (SIDE_W - 32) / STRIP_N;
            s.frames.forEach((f, k) => {
                g.fillStyle(f === "impact" ? 0xef5350 : f === "frozen" ? 0xffca28 : 0x3a4150, 1);
                g.fillRect(x0 + 16 + k * cw, 362, Math.max(1, cw - 1), 18);
            });

            const t = this.texts[i];
            const label = this.blind ? `Манекен ${i === 0 ? "A" : "B"}` : PRESET_LABEL[s.preset];
            t[0].setText(label);
            const j = s.juice;
            t[1].setText(
                this.blind
                    ? "настройки скрыты"
                    : `hit stop ${j.hitStopMs}мс · ${[j.shake && "тряска", j.flash && "вспышка", j.knockback && "отброс", j.sparks && "искры"].filter(Boolean).join(" · ") || "больше ничего"}`,
            );
            t[2].setText("кадры удара: серый — обычный, красный — попадание, жёлтый — заморожен");
            t[3].setText(`ударов: ${s.hits} · урон каждого: 10 · клик сюда или ${i === 0 ? "A" : "D"}`);
        });
    }
}

function buildControls(root: HTMLElement, scene: HitStopScene): void {
    root.innerHTML = "";
    addHeading(root, "Hit Stop");
    buildHowTo(
        root,
        "<b>Как пользоваться:</b> кликай по левой или правой половине (клавиши A / D). Удар и урон одинаковые. " +
            "Hit stop на несколько кадров останавливает и меч, и манекен в момент попадания. Тряска, вспышка и " +
            "отброс добавляются сверху. Потом пройди слепой тест: остаётся только hit stop, и неизвестно, у кого он.",
    );
    buildLegend(root, [
        { color: "#ef5350", label: "кадр попадания" },
        { color: "#ffca28", label: "замороженный кадр" },
        { color: "#3a4150", label: "обычный кадр" },
    ]);
    const setNarrative = buildNarrative(root, "");

    const presets = (["none", "stop", "full"] as Preset[]).map((p) => ({ value: p, label: PRESET_LABEL[p] }));
    addSegmented(root, "Левый манекен", presets, "none", (p) => scene.setPreset(0, p));
    addSegmented(root, "Правый манекен", presets, "full", (p) => scene.setPreset(1, p));
    addSlider(root, "Hit stop", { min: 0, max: 200, step: 10, value: scene.hitStopMs, format: (v) => `${v}мс` }, (v) => {
        scene.hitStopMs = v;
        scene.refreshJuice();
    });
    addButtons(root, [{ label: "🙈 Слепой тест", onClick: () => scene.startBlind() }]);
    addButtons(root, [
        { label: "Левый тяжелее", onClick: () => scene.answerBlind(0) },
        { label: "Правый тяжелее", onClick: () => scene.answerBlind(1) },
    ]);

    const set = addMetrics(root, [""], [
        ["frames", "Hit stop в кадрах (60 fps)"],
        ["score", "Слепой тест угадан"],
    ]);
    addNote(root, "Удар длится 18 кадров. Заморозка на 4–6 кадров почти не удлиняет бой, но мозг читает паузу как сопротивление: «меч во что-то упёрся».");
    addFooter(root, "lie-hit-stop.html");

    let last = "";
    const tick = () => {
        set("frames", 0, `${Math.round(scene.hitStopMs / 16.7)}`);
        set("score", 0, scene.blindScore.total ? `${scene.blindScore.right}/${scene.blindScore.total}` : "-");
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
if (!gameRoot || !controlRoot) throw new Error("lie-hit-stop: expected #game-root and #control-panel");

const scene = new HitStopScene();
const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: gameRoot,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    backgroundColor: "#14181f",
    scene: [scene],
});
game.events.once(Phaser.Core.Events.READY, () => buildControls(controlRoot, scene));
