import Phaser from "phaser";
import { buildHowTo, buildLegend, buildNarrative } from "@/rendering/ExplainerPanel";
import { addButtons, addFooter, addHeading, addMetrics, addNote, addSegmented, addSlider } from "@/lies/panel";
import { ARENA_H, ARENA_W, AutoResult, BASE, DEFAULT_DIRECTOR, DirectorConfig, DirectorSim, ENEMY_R, SpawnMode, autoRun } from "@/lies/directorSim";
import { makeRng, randomSeed } from "@/lies/rng";

const WORLD_WIDTH = 900;
const WORLD_HEIGHT = 420;
const AX = 10;
const AY = 40;
const SIDE_X = 625;
const SIDE_W = 265;
const GRAPH_Y = 90;
const GRAPH_H = 100;

type PlayMode = "blind" | SpawnMode;
type RunState = "idle" | "running" | "rating" | "done";

const MODE_NAME: Record<SpawnMode, string> = { honest: "честный поток", director: "директор" };
const WAVE_COLOR = [0, 0xffca28, 0xff8a3d, 0xef5350];
const WAVE_SIZE = [0, 2, 4, 7];

interface HistoryRow {
    mode: SpawnMode;
    blind: boolean;
    hp: number;
    waves: number;
    brutal: number;
    rating: string;
}

interface ClickFx {
    x: number;
    y: number;
    hit: boolean;
    life: number;
}

class StorytellerScene extends Phaser.Scene {
    cfg: DirectorConfig = { ...DEFAULT_DIRECTOR };
    playMode: PlayMode = "blind";
    sim: DirectorSim | null = null;
    actualMode: SpawnMode = "honest";
    state: RunState = "idle";
    history: HistoryRow[] = [];
    fx: ClickFx[] = [];
    narrative = "";
    autoKps = 1.2;
    autoStats: Record<SpawnMode, AutoResult[]> = { honest: [], director: [] };
    private g!: Phaser.GameObjects.Graphics;
    private texts: Record<string, Phaser.GameObjects.Text> = {};
    private ratingButtons: Array<{ x: number; y: number; w: number; h: number; label: string }> = [];

    constructor() {
        super("lie-storyteller");
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);
        this.g = this.add.graphics();
        const font = "system-ui, sans-serif";
        const t = (key: string, x: number, y: number, size: number, color = "#e6e8eb") => {
            this.texts[key] = this.add.text(x, y, "", { fontFamily: font, fontSize: `${size}px`, color }).setDepth(3);
        };
        t("title", AX, 12, 14, "#c5cad3");
        t("time", SIDE_X, 12, 14);
        t("hp", SIDE_X, 50, 12, "#c5cad3");
        t("graphCap", SIDE_X, GRAPH_Y - 15, 11, "#8b93a3");
        t("phase", SIDE_X, GRAPH_Y + GRAPH_H + 8, 12, "#4fc3f7");
        t("hist", SIDE_X, 262, 11, "#c5cad3");
        t("overlay", AX + ARENA_W / 2, AY + ARENA_H / 2 - 60, 18, "#ffca28");
        this.texts.overlay.setOrigin(0.5).setAlign("center").setDepth(6);
        t("overlay2", AX + ARENA_W / 2, AY + ARENA_H / 2 - 20, 13, "#e6e8eb");
        this.texts.overlay2.setOrigin(0.5).setAlign("center").setDepth(6);
        this.texts.graphCap.setText("напряжение (то, что видит директор)");
        this.texts.phase.setWordWrapWidth(SIDE_W);
        this.ratingButtons = ["😡 Нечестно", "😐 Нормально", "🥱 Скучно"].map((label, i) => ({
            x: AX + ARENA_W / 2 - 210 + i * 145,
            y: AY + ARENA_H / 2 + 20,
            w: 130,
            h: 40,
            label,
        }));
        this.ratingButtons.forEach((b) => {
            this.texts[`rb_${b.label}`] = this.add
                .text(b.x + b.w / 2, b.y + b.h / 2, b.label, { fontFamily: font, fontSize: "14px", color: "#e6e8eb" })
                .setOrigin(0.5)
                .setDepth(7);
        });
        this.input.on("pointerdown", (p: Phaser.Input.Pointer) => this.onClick(p.x, p.y));
        this.narrative = "Выбери режим (по умолчанию — вслепую) и кликни по полю, чтобы начать. Кликай по врагам, пока они не дошли до базы.";
    }

    start(): void {
        this.actualMode = this.playMode === "blind" ? (Math.random() < 0.5 ? "honest" : "director") : this.playMode;
        this.sim = new DirectorSim(this.actualMode, this.cfg, makeRng(randomSeed()));
        this.state = "running";
        this.fx = [];
        this.narrative =
            this.playMode === "blind"
                ? "Играешь вслепую: режим выбран случайно и скрыт. В конце спросим, как ощущалось."
                : `Режим: <b>${MODE_NAME[this.actualMode]}</b>.`;
    }

    finish(): void {
        if (!this.sim) return;
        if (this.playMode === "blind") {
            this.state = "rating";
            this.narrative = "Забег окончен. Прежде чем узнать режим — как это ощущалось?";
        } else {
            this.record("—");
            this.state = "done";
        }
    }

    record(rating: string): void {
        const s = this.sim!;
        this.history.unshift({ mode: this.actualMode, blind: this.playMode === "blind", hp: s.hp, waves: s.waves.length, brutal: s.brutalMoments, rating });
        this.history = this.history.slice(0, 6);
        const rated = this.history.filter((h) => h.blind && h.rating !== "—");
        const unfairHonest = rated.filter((h) => h.mode === "honest" && h.rating.includes("Нечестно")).length;
        const unfairDirector = rated.filter((h) => h.mode === "director" && h.rating.includes("Нечестно")).length;
        this.narrative =
            `Это был <b>${MODE_NAME[this.actualMode]}</b>. HP ${s.hp}, волн ${s.waves.length}, врагов ${s.spawnedEnemies}, ` +
            `жёстких моментов (4+ врага у базы за 5с) — ${s.brutalMoments}, самое долгое затишье ${s.longestCalm.toFixed(0)}с.` +
            (rated.length >= 2 ? ` «Нечестно» ты сказал честному потоку ${unfairHonest} раз, директору — ${unfairDirector}.` : "") +
            " Кликни по полю — ещё забег.";
    }

    onClick(x: number, y: number): void {
        const inArena = x >= AX && x <= AX + ARENA_W && y >= AY && y <= AY + ARENA_H;
        if (this.state === "rating") {
            const b = this.ratingButtons.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
            if (b) {
                this.record(b.label);
                this.state = "done";
            }
            return;
        }
        if (!inArena) return;
        if (this.state === "idle" || this.state === "done") {
            this.start();
            return;
        }
        if (this.state === "running" && this.sim) {
            const hit = this.sim.killAt(x - AX, y - AY);
            this.fx.push({ x, y, hit, life: 1 });
        }
    }

    runAutopilot(n: number): void {
        for (const mode of ["honest", "director"] as SpawnMode[]) {
            for (let i = 0; i < n; i++) this.autoStats[mode].push(autoRun(mode, this.cfg, makeRng(randomSeed()), this.autoKps));
        }
        const dead = (m: SpawnMode) => this.autoStats[m].filter((r) => !r.survived).length;
        const h = this.autoStats.honest.length;
        this.narrative =
            `Автопилот (убивает ${this.autoKps.toFixed(1)} врага/с) сыграл по ${h} забегов в каждом режиме. ` +
            `База пала: честно — ${dead("honest")}, директор — ${dead("director")}. ` +
            `Директор раздаёт не меньше волн, разница в том, <b>когда</b> они приходят.`;
    }

    update(_t: number, delta: number): void {
        if (this.state === "running" && this.sim) {
            this.sim.step(Math.min(delta, 50) / 1000);
            if (this.sim.finished) this.finish();
        }
        for (const f of this.fx) f.life -= delta / 400;
        this.fx = this.fx.filter((f) => f.life > 0);
        this.draw();
    }

    draw(): void {
        const g = this.g;
        g.clear();
        const s = this.sim;
        const hidden = this.playMode === "blind" && this.state !== "done";

        // --- arena
        g.fillStyle(0x1b1f27, 1);
        g.fillRect(AX, AY, ARENA_W, ARENA_H);
        g.lineStyle(1, 0x2a2f3a, 1);
        g.strokeRect(AX, AY, ARENA_W, ARENA_H);
        g.fillStyle(0x4fc3f7, 0.9);
        g.fillRect(AX + BASE.x - BASE.r, AY + BASE.y - BASE.r, BASE.r * 2, BASE.r * 2);
        if (s) {
            g.fillStyle(0x14181f, 1);
            g.fillRect(AX + BASE.x - BASE.r + 4, AY + BASE.y - BASE.r + 4, (BASE.r * 2 - 8) * (1 - s.hp / 100), BASE.r * 2 - 8);
            // enemies are pushed wave by wave, so cumulative wave sizes tell which wave an enemy belongs to
            const severityOf: number[] = [];
            for (const w of s.waves) for (let k = 0; k < WAVE_SIZE[w.severity]; k++) severityOf.push(w.severity);
            s.enemies.forEach((e, idx) => {
                if (!e.alive || e.spawnAt > s.t) return;
                g.fillStyle(WAVE_COLOR[severityOf[idx] ?? 1], 1);
                g.fillCircle(AX + e.x, AY + e.y, ENEMY_R);
                g.fillStyle(0x14181f, 1);
                g.fillCircle(AX + e.x - 3, AY + e.y - 2, 2);
                g.fillCircle(AX + e.x + 3, AY + e.y - 2, 2);
            });
        }
        for (const f of this.fx) {
            g.lineStyle(2, f.hit ? 0x6fd48a : 0x8b93a3, f.life);
            g.strokeCircle(f.x, f.y, 6 + (1 - f.life) * 14);
        }

        this.texts.title.setText(
            this.state === "running" ? (hidden ? "Режим: ??? (вслепую)" : `Режим: ${MODE_NAME[this.actualMode]}`) : "Защити базу: кликай по врагам",
        );

        // --- overlays
        let o1 = "";
        let o2 = "";
        if (this.state === "idle") {
            o1 = "Кликни, чтобы начать";
            o2 = `${this.cfg.durationSec} секунд, режим: ${this.playMode === "blind" ? "вслепую" : MODE_NAME[this.playMode]}`;
        } else if (this.state === "rating") {
            o1 = s && s.hp <= 0 ? "База пала" : "Выстоял!";
            o2 = "Как ощущался этот забег?";
        } else if (this.state === "done" && s) {
            o1 = `Это был: ${MODE_NAME[this.actualMode]}`;
            o2 = `HP ${s.hp} · волн ${s.waves.length} · жёстких моментов ${s.brutalMoments}\nкликни — ещё забег`;
        }
        if (o1) {
            g.fillStyle(0x14181f, 0.75);
            g.fillRect(AX, AY, ARENA_W, ARENA_H);
        }
        this.texts.overlay.setText(o1);
        this.texts.overlay2.setText(o2);
        this.ratingButtons.forEach((b) => {
            const show = this.state === "rating";
            this.texts[`rb_${b.label}`].setVisible(show);
            if (!show) return;
            g.fillStyle(0x262b35, 1);
            g.fillRoundedRect(b.x, b.y, b.w, b.h, 8);
            g.lineStyle(2, 0xffca28, 0.8);
            g.strokeRoundedRect(b.x, b.y, b.w, b.h, 8);
        });

        // --- side: time, hp
        this.texts.time.setText(`Время ${s ? Math.min(s.t, this.cfg.durationSec).toFixed(0) : 0} / ${this.cfg.durationSec}с`);
        const hp = s ? s.hp : 100;
        g.fillStyle(0x2a2f3a, 1);
        g.fillRect(SIDE_X, 34, SIDE_W, 10);
        g.fillStyle(hp > 50 ? 0x6fd48a : hp > 25 ? 0xffca28 : 0xef5350, 1);
        g.fillRect(SIDE_X, 34, (SIDE_W * hp) / 100, 10);
        this.texts.hp.setText(s ? `HP базы ${s.hp} · убито ${s.kills} · волн ${s.waves.length}` : "HP базы 100");

        // --- tension graph
        g.fillStyle(0x1b1f27, 1);
        g.fillRect(SIDE_X, GRAPH_Y, SIDE_W, GRAPH_H);
        g.lineStyle(1, 0x2a2f3a, 1);
        g.strokeRect(SIDE_X, GRAPH_Y, SIDE_W, GRAPH_H);
        const maxT = this.cfg.peakTension * 2;
        const gx = (sec: number) => SIDE_X + (sec / this.cfg.durationSec) * SIDE_W;
        const gy = (v: number) => GRAPH_Y + GRAPH_H - (Math.min(v, maxT) / maxT) * (GRAPH_H - 14);
        if (!hidden) {
            g.lineStyle(1, 0x4fc3f7, 0.6);
            g.lineBetween(SIDE_X, gy(this.cfg.peakTension), SIDE_X + SIDE_W, gy(this.cfg.peakTension));
        }
        if (s && s.tensionLog.length > 1) {
            g.fillStyle(0x8b93a3, 0.35);
            g.beginPath();
            g.moveTo(gx(0), GRAPH_Y + GRAPH_H);
            s.tensionLog.forEach((v, i) => g.lineTo(gx(i), gy(v)));
            g.lineTo(gx(s.tensionLog.length - 1), GRAPH_Y + GRAPH_H);
            g.closePath();
            g.fillPath();
            for (const w of s.waves) {
                g.fillStyle(WAVE_COLOR[w.severity], 1);
                g.fillCircle(gx(w.t), GRAPH_Y + 7, 2 + w.severity);
            }
        }

        // --- director's reasoning (the part the player never sees)
        let phase = "";
        if (s && this.state === "running") {
            if (hidden) phase = "Мысли директора скрыты (вслепую)";
            else if (this.actualMode === "honest")
                phase = `Честный поток: каждую секунду волна с шансом ${((this.cfg.wavesPerMinute / 60) * 100).toFixed(0)}%. Ему всё равно, как ты.`;
            else phase = `Директор: ${s.phase === "relax" ? "ПЕРЕДЫШКА" : s.phase === "forced" ? "ПОДКИНУЛ" : "наращивает"}\n${s.phaseReason}`;
        }
        this.texts.phase.setText(phase);

        // --- history
        const rows = this.history.map(
            (h) =>
                `${h.blind ? "🙈 " : ""}${h.mode === "honest" ? "честно" : "директор"} · HP ${h.hp} · жёстк. ${h.brutal}` +
                (h.rating !== "—" ? ` · ${h.rating}` : ""),
        );
        this.texts.hist.setText(rows.length ? "Твои забеги:\n" + rows.join("\n") : "Твои забеги появятся здесь");
    }
}

function buildControls(root: HTMLElement, scene: StorytellerScene): void {
    root.innerHTML = "";
    addHeading(root, "Storyteller");
    buildHowTo(
        root,
        "<b>Как пользоваться:</b> кликни по полю и защищай базу 60 секунд — кликай по врагам. Волны раздаёт либо " +
            "честный случайный поток, либо директор, который следит за тобой: сколько врагов живо, сколько урона " +
            "ты только что получил. Сыграй пару раз <b>вслепую</b> и оцени ощущения до того, как узнаешь режим.",
    );
    buildLegend(root, [
        { color: "#ffca28", label: "малая волна" },
        { color: "#ff8a3d", label: "средняя" },
        { color: "#ef5350", label: "большая" },
        { color: "#4fc3f7", label: "база / порог пика" },
    ]);
    const setNarrative = buildNarrative(root, "");

    addSegmented(
        root,
        "Режим",
        [
            { value: "blind" as PlayMode, label: "🙈 Вслепую" },
            { value: "honest" as PlayMode, label: "Честно" },
            { value: "director" as PlayMode, label: "Директор" },
        ],
        scene.playMode,
        (m) => {
            scene.playMode = m;
            if (scene.state !== "running") scene.state = "idle";
        },
    );
    addSlider(root, "Волн в минуту", { min: 6, max: 30, step: 1, value: scene.cfg.wavesPerMinute, format: (v) => String(v) }, (v) => {
        scene.cfg.wavesPerMinute = v;
    });
    addSlider(root, "Порог пика директора", { min: 20, max: 140, step: 5, value: scene.cfg.peakTension, format: (v) => String(v) }, (v) => {
        scene.cfg.peakTension = v;
    });
    addSlider(root, "Автопилот, убийств/с", { min: 0.6, max: 2.5, step: 0.1, value: scene.autoKps, format: (v) => v.toFixed(1) }, (v) => {
        scene.autoKps = v;
        scene.autoStats = { honest: [], director: [] };
    });
    addButtons(root, [
        { label: "🤖 Автопилот ×20", onClick: () => scene.runAutopilot(20) },
        {
            label: "Сброс статистики",
            onClick: () => {
                scene.autoStats = { honest: [], director: [] };
                scene.history = [];
            },
        },
    ]);

    const set = addMetrics(root, ["Честно", "Директор"], [
        ["runs", "Забегов автопилота"],
        ["dead", "База пала"],
        ["hp", "Среднее HP"],
        ["waves", "Волн за забег"],
        ["brutal", "Жёстких моментов"],
        ["calm", "Самое долгое затишье"],
    ]);
    addNote(root, "Жёсткий момент — 4+ врага дошли до базы за 5 секунд. Автопилот бьёт ближайшего к базе с фиксированной скоростью — как не очень быстрый игрок.");
    addFooter(root, "lie-storyteller.html");

    let last = "";
    const tick = () => {
        (["honest", "director"] as SpawnMode[]).forEach((m, col) => {
            const rs = scene.autoStats[m];
            const n = rs.length;
            const avg = (f: (r: AutoResult) => number) => rs.reduce((a, r) => a + f(r), 0) / n;
            set("runs", col, String(n));
            set("dead", col, n ? String(rs.filter((r) => !r.survived).length) : "-");
            set("hp", col, n ? avg((r) => r.hp).toFixed(0) : "-");
            set("waves", col, n ? avg((r) => r.waves).toFixed(1) : "-");
            set("brutal", col, n ? avg((r) => r.brutal).toFixed(2) : "-");
            set("calm", col, n ? `${avg((r) => r.longestCalm).toFixed(0)}с` : "-");
        });
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
if (!gameRoot || !controlRoot) throw new Error("lie-storyteller: expected #game-root and #control-panel");

const scene = new StorytellerScene();
const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: gameRoot,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    backgroundColor: "#14181f",
    scene: [scene],
});
game.events.once(Phaser.Core.Events.READY, () => buildControls(controlRoot, scene));
