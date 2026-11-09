import Phaser from "phaser";
import { buildHowTo, buildLegend, buildNarrative } from "@/rendering/ExplainerPanel";
import { addButtons, addFooter, addHeading, addMetrics, addNote, addSegmented, addSlider } from "@/lies/panel";
import { Point, ScatterStats, idealSpacing, poissonScatter, scatterStats, uniformScatter } from "@/lies/scatter";

const WORLD_WIDTH = 900;
const WORLD_HEIGHT = 420;
const PANEL_W = 425;
const PANEL_H = 360;
const PANEL_Y = 40;
const PANELS = [20, 455];
const MARGIN = 10;
const TREE_R = 6;

type Mode = "guess" | "place" | "build";
type Kind = "random" | "poisson" | "you";

const KIND_LABEL: Record<Kind, string> = { random: "честный рандом", poisson: "Poisson disc", you: "твоя расстановка" };

interface Panel {
    kind: Kind | null; // null = hidden (guess mode before reveal)
    points: Point[];
    stats: ScatterStats | null;
    caption: string;
}

interface Reject {
    p: Point;
    near: Point;
    life: number;
}

class PoissonScene extends Phaser.Scene {
    mode: Mode = "guess";
    count = 40;
    spacingFactor = 0.75;
    buildSpeed = 20; // candidates per second
    panels: Panel[] = [
        { kind: null, points: [], stats: null, caption: "" },
        { kind: null, points: [], stats: null, caption: "" },
    ];
    narrative = "";

    // guess mode
    guessKinds: Kind[] = ["random", "poisson"];
    revealed = false;
    guesses = 0;
    pickedPoisson = 0;

    // place mode
    placeTarget = 25;
    youStats: ScatterStats | null = null;
    randomStats: ScatterStats | null = null;
    poissonStats: ScatterStats | null = null;

    // build mode
    building = false;
    buildAcc = 0;
    attempts = 0;
    rejects: Reject[] = [];
    rejectedTotal = 0;

    private g!: Phaser.GameObjects.Graphics;
    private captions: Phaser.GameObjects.Text[] = [];
    private bigText!: Phaser.GameObjects.Text;

    constructor() {
        super("lie-poisson");
    }

    get clumpDist(): number {
        return idealSpacing(this.currentCount(), PANEL_W, PANEL_H) * 0.35;
    }

    get minDist(): number {
        return idealSpacing(this.currentCount(), PANEL_W, PANEL_H) * this.spacingFactor;
    }

    currentCount(): number {
        return this.mode === "place" ? this.placeTarget : this.count;
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);
        this.g = this.add.graphics();
        const style = { fontFamily: "system-ui, sans-serif", fontSize: "13px", color: "#c5cad3" };
        this.captions = PANELS.map((x) => this.add.text(x, PANEL_Y - 22, "", style));
        this.bigText = this.add
            .text(0, 0, "", { fontFamily: "system-ui, sans-serif", fontSize: "20px", color: "#ffca28", fontStyle: "bold" })
            .setOrigin(0.5)
            .setDepth(5);
        this.input.on("pointerdown", (p: Phaser.Input.Pointer) => this.onClick(p.x, p.y, p.rightButtonDown()));
        this.input.mouse?.disableContextMenu();
        this.setMode("guess");
    }

    setMode(mode: Mode): void {
        this.mode = mode;
        this.building = false;
        this.rejects = [];
        if (mode === "guess") this.newGuess();
        if (mode === "place") this.startPlacing();
        if (mode === "build") this.startBuild();
    }

    // ---------------- guess
    newGuess(): void {
        const n = this.count;
        const random = uniformScatter(n, PANEL_W, PANEL_H, MARGIN, Math.random);
        const poisson = poissonScatter(n, PANEL_W, PANEL_H, MARGIN, this.minDist, Math.random);
        this.guessKinds = Math.random() < 0.5 ? ["random", "poisson"] : ["poisson", "random"];
        this.guessKinds.forEach((k, i) => {
            const pts = k === "random" ? random : poisson;
            this.panels[i] = { kind: k, points: pts, stats: scatterStats(pts, PANEL_W, PANEL_H, MARGIN, this.clumpDist), caption: i === 0 ? "Лес A" : "Лес B" };
        });
        this.revealed = false;
        this.narrative = "Какой лес <b>выглядит случайнее</b>? Кликни по нему. Не думай долго — игрок тоже не думает.";
    }

    guess(panelIdx: number): void {
        if (this.revealed) {
            this.newGuess();
            return;
        }
        this.revealed = true;
        this.guesses += 1;
        const picked = this.guessKinds[panelIdx];
        if (picked === "poisson") this.pickedPoisson += 1;
        this.panels.forEach((p) => (p.caption = `${p.caption} — ${KIND_LABEL[p.kind as Kind]}`));
        const [r] = this.panels.filter((p) => p.kind === "random");
        this.narrative =
            (picked === "poisson"
                ? `Ты выбрал <b>Poisson</b> — тот, где случайности как раз меньше. `
                : `Ты выбрал <b>честный рандом</b>. Редкость! `) +
            `В честном лесу ${r.stats?.clumpPairs.length ?? 0} пар деревьев слиплись и есть дыра радиусом ${r.stats?.biggestHole.toFixed(0)}px. ` +
            `Счёт: «случайнее» выглядел Poisson в <b>${this.pickedPoisson} из ${this.guesses}</b>. Кликни ещё раз — новая пара.`;
    }

    // ---------------- place
    startPlacing(): void {
        this.panels[0] = { kind: "you", points: [], stats: null, caption: `Твой лес: кликай, ставь ${this.placeTarget} деревьев «как попало»` };
        this.panels[1] = { kind: null, points: [], stats: null, caption: "Здесь появится честный рандом" };
        this.youStats = this.randomStats = this.poissonStats = null;
        this.narrative =
            `Представь, что ты генератор случайных чисел. Расставь кликами ${this.placeTarget} деревьев в левом поле ` +
            `случайно. Правый клик — убрать последнее.`;
    }

    place(x: number, y: number): void {
        const you = this.panels[0];
        if (you.points.length >= this.placeTarget) return;
        you.points.push({ x, y });
        you.caption = `Твой лес: ${you.points.length} / ${this.placeTarget}`;
        if (you.points.length === this.placeTarget) this.finishPlacing();
    }

    unplace(): void {
        const you = this.panels[0];
        if (you.points.length === 0 || you.points.length >= this.placeTarget) return;
        you.points.pop();
        you.caption = `Твой лес: ${you.points.length} / ${this.placeTarget}`;
    }

    finishPlacing(): void {
        const n = this.placeTarget;
        const you = this.panels[0];
        const random = uniformScatter(n, PANEL_W, PANEL_H, MARGIN, Math.random);
        const poisson = poissonScatter(n, PANEL_W, PANEL_H, MARGIN, this.minDist, Math.random);
        this.youStats = scatterStats(you.points, PANEL_W, PANEL_H, MARGIN, this.clumpDist);
        this.randomStats = scatterStats(random, PANEL_W, PANEL_H, MARGIN, this.clumpDist);
        this.poissonStats = scatterStats(poisson, PANEL_W, PANEL_H, MARGIN, this.clumpDist);
        you.stats = this.youStats;
        this.panels[1] = { kind: "random", points: random, stats: this.randomStats, caption: `А вот так выглядит честный рандом из ${n}` };
        const y = this.youStats;
        const r = this.randomStats;
        const p = this.poissonStats;
        const closerTo = Math.abs(y.minNearest - p.minNearest) < Math.abs(y.minNearest - r.minNearest) ? "Poisson" : "честному рандому";
        this.narrative =
            `У тебя ${y.clumpPairs.length} слипшихся пар и ближайшие соседи не ближе ${y.minNearest.toFixed(0)}px. ` +
            `У честного рандома — ${r.clumpPairs.length} пар и ${r.minNearest.toFixed(0)}px. ` +
            `По расстоянию до соседа ты ближе к <b>${closerTo}</b>. Люди, изображая случайность, почти всегда ` +
            `рисуют Poisson — поэтому игры и раздают «случайное» именно так.`;
    }

    // ---------------- build
    startBuild(): void {
        this.panels[0] = { kind: "random", points: [], stats: null, caption: "Честный рандом: каждое дерево — куда упало" };
        this.panels[1] = { kind: "poisson", points: [], stats: null, caption: "Poisson: слишком близко к соседу — выкидываем" };
        this.attempts = 0;
        this.rejectedTotal = 0;
        this.rejects = [];
        this.building = true;
        this.buildAcc = 0;
        this.narrative = "Деревья падают по одному. Справа кандидат, попавший в круг соседа, отбрасывается (красный крест).";
    }

    buildStep(): void {
        const [rp, pp] = this.panels;
        const cand = { x: MARGIN + Math.random() * (PANEL_W - 2 * MARGIN), y: MARGIN + Math.random() * (PANEL_H - 2 * MARGIN) };
        // same candidate goes to both forests; random always accepts it
        if (rp.points.length < this.count) rp.points.push(cand);
        if (pp.points.length < this.count) {
            this.attempts += 1;
            let near: Point | null = null;
            for (const p of pp.points) {
                if (Math.hypot(p.x - cand.x, p.y - cand.y) < this.minDist) {
                    near = p;
                    break;
                }
            }
            if (near) {
                this.rejectedTotal += 1;
                this.rejects.push({ p: cand, near, life: 1 });
            } else pp.points.push(cand);
        }
        const done = rp.points.length >= this.count && (pp.points.length >= this.count || this.attempts > 20000);
        if (done) {
            this.building = false;
            rp.stats = scatterStats(rp.points, PANEL_W, PANEL_H, MARGIN, this.clumpDist);
            pp.stats = scatterStats(pp.points, PANEL_W, PANEL_H, MARGIN, this.clumpDist);
            this.narrative =
                `Готово. Poisson выкинул ${this.rejectedTotal} кандидатов из ${this.attempts}, чтобы ни одно дерево не встало ` +
                `ближе ${this.minDist.toFixed(0)}px к соседу. Честный рандом за то же время слепил ${rp.stats.clumpPairs.length} пар.`;
        }
    }

    // ---------------- input
    onClick(x: number, y: number, right: boolean): void {
        const idx = PANELS.findIndex((px) => x >= px && x <= px + PANEL_W && y >= PANEL_Y && y <= PANEL_Y + PANEL_H);
        if (this.mode === "guess" && idx >= 0) this.guess(idx);
        if (this.mode === "place" && idx === 0) {
            if (right) this.unplace();
            else this.place(x - PANELS[0], y - PANEL_Y);
        }
    }

    update(_time: number, delta: number): void {
        if (this.mode === "build" && this.building) {
            this.buildAcc += (this.buildSpeed * delta) / 1000;
            while (this.buildAcc >= 1 && this.building) {
                this.buildAcc -= 1;
                this.buildStep();
            }
        }
        for (const r of this.rejects) r.life -= delta / 900;
        this.rejects = this.rejects.filter((r) => r.life > 0);
        this.draw();
    }

    draw(): void {
        const g = this.g;
        g.clear();
        this.bigText.setText("");
        this.panels.forEach((panel, i) => {
            const ox = PANELS[i];
            const oy = PANEL_Y;
            this.captions[i].setText(panel.caption);
            g.fillStyle(0x1d2a20, 1);
            g.fillRect(ox, oy, PANEL_W, PANEL_H);
            g.lineStyle(1, 0x2a2f3a, 1);
            g.strokeRect(ox, oy, PANEL_W, PANEL_H);

            const showDiag = panel.stats !== null && (this.mode !== "guess" || this.revealed);
            const clumped = new Set<number>();
            if (showDiag && panel.stats) {
                for (const [a, b] of panel.stats.clumpPairs) {
                    clumped.add(a);
                    clumped.add(b);
                }
                g.lineStyle(1.5, 0xffca28, 0.8);
                g.strokeCircle(ox + panel.stats.holeCenter.x, oy + panel.stats.holeCenter.y, panel.stats.biggestHole);
            }
            if (this.mode === "build" && panel.kind === "poisson") {
                g.lineStyle(1, 0x4fc3f7, 0.15);
                for (const p of panel.points) g.strokeCircle(ox + p.x, oy + p.y, this.minDist);
            }
            panel.points.forEach((p, idx) => {
                const isYou = panel.kind === "you";
                g.fillStyle(clumped.has(idx) ? 0xef5350 : isYou ? 0x4fc3f7 : 0x6fd48a, 1);
                g.fillCircle(ox + p.x, oy + p.y, TREE_R);
                g.fillStyle(0x3b2a1a, 1);
                g.fillRect(ox + p.x - 1, oy + p.y + TREE_R - 2, 2, 4);
            });
            if (showDiag && panel.stats) {
                g.lineStyle(2, 0xef5350, 0.9);
                for (const [a, b] of panel.stats.clumpPairs) {
                    g.lineBetween(ox + panel.points[a].x, oy + panel.points[a].y, ox + panel.points[b].x, oy + panel.points[b].y);
                }
            }
            if (this.mode === "build" && panel.kind === "poisson") {
                for (const r of this.rejects) {
                    g.lineStyle(2, 0xef5350, r.life);
                    g.strokeCircle(ox + r.near.x, oy + r.near.y, this.minDist);
                    const cx = ox + r.p.x;
                    const cy = oy + r.p.y;
                    g.lineBetween(cx - 6, cy - 6, cx + 6, cy + 6);
                    g.lineBetween(cx - 6, cy + 6, cx + 6, cy - 6);
                }
            }
            if (this.mode === "guess" && !this.revealed) {
                g.lineStyle(2, 0xffca28, 0.35);
                g.strokeRect(ox + 2, oy + 2, PANEL_W - 4, PANEL_H - 4);
            }
        });
        if (this.mode === "guess" && !this.revealed) {
            this.bigText.setPosition(WORLD_WIDTH / 2, PANEL_Y + PANEL_H + 4 + 8).setText("кликни лес, который выглядит случайнее");
            this.bigText.setFontSize(14);
        }
    }
}

function buildControls(root: HTMLElement, scene: PoissonScene): void {
    root.innerHTML = "";
    addHeading(root, "Poisson vs Random");
    buildHowTo(
        root,
        "<b>Три упражнения.</b> «Угадай» — выбери лес, который выглядит случайнее. «Расставь сам» — притворись " +
            "генератором случайных чисел и расставь деревья кликами. «Как строится» — смотри, как Poisson " +
            "выбрасывает кандидатов, которые встали слишком близко к соседу.",
    );
    buildLegend(root, [
        { color: "#6fd48a", label: "дерево" },
        { color: "#4fc3f7", label: "твоё дерево" },
        { color: "#ef5350", label: "слиплись / отброшено" },
        { color: "#ffca28", label: "самая большая дыра", shape: "ring" },
    ]);
    const setNarrative = buildNarrative(root, "");

    addSegmented(
        root,
        "Упражнение",
        [
            { value: "guess" as Mode, label: "Угадай" },
            { value: "place" as Mode, label: "Расставь сам" },
            { value: "build" as Mode, label: "Как строится" },
        ],
        scene.mode,
        (m) => scene.setMode(m),
    );
    addButtons(root, [
        {
            label: "Заново",
            onClick: () => scene.setMode(scene.mode),
        },
    ]);
    addSlider(root, "Деревьев (угадай / строится)", { min: 15, max: 120, step: 5, value: scene.count, format: (v) => String(v) }, (v) => {
        scene.count = v;
    });
    addSlider(root, "Деревьев (расставь сам)", { min: 10, max: 40, step: 5, value: scene.placeTarget, format: (v) => String(v) }, (v) => {
        scene.placeTarget = v;
        if (scene.mode === "place") scene.startPlacing();
    });
    addSlider(root, "Poisson: мин. расстояние", { min: 0.3, max: 1.0, step: 0.05, value: scene.spacingFactor, format: (v) => `×${v.toFixed(2)}` }, (v) => {
        scene.spacingFactor = v;
    });
    addSlider(root, "Скорость постройки", { min: 2, max: 200, step: 2, value: scene.buildSpeed, format: (v) => `${v}/с` }, (v) => {
        scene.buildSpeed = v;
    });

    const set = addMetrics(root, ["Ты", "Random", "Poisson"], [
        ["clumps", "Слипшихся пар"],
        ["min", "Мин. до соседа"],
        ["hole", "Самая большая дыра"],
    ]);
    addNote(root, "Метрики заполняются в «Расставь сам» после последнего дерева. Слиплись — ближе 35% от идеального шага сетки, расстояния в пикселях.");
    addFooter(root, "lie-poisson.html");

    let lastNarrative = "";
    const tick = () => {
        const cols = [scene.youStats, scene.randomStats, scene.poissonStats];
        cols.forEach((st, col) => {
            set("clumps", col, st ? String(st.clumpPairs.length) : "-");
            set("min", col, st ? st.minNearest.toFixed(0) : "-");
            set("hole", col, st ? `r=${st.biggestHole.toFixed(0)}` : "-");
        });
        if (scene.narrative !== lastNarrative) {
            lastNarrative = scene.narrative;
            setNarrative(scene.narrative);
        }
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

const gameRoot = document.getElementById("game-root");
const controlRoot = document.getElementById("control-panel");
if (!gameRoot || !controlRoot) throw new Error("lie-poisson: expected #game-root and #control-panel");

const scene = new PoissonScene();
const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: gameRoot,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    backgroundColor: "#14181f",
    scene: [scene],
});
game.events.once(Phaser.Core.Events.READY, () => buildControls(controlRoot, scene));
