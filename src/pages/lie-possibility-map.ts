import Phaser from "phaser";
import { buildHowTo, buildLegend, buildNarrative } from "@/rendering/ExplainerPanel";
import { addButtons, addCheckbox, addFooter, addHeading, addMetrics, addNote, addSegmented } from "@/lies/panel";
import { COLS, ROWS, bfsDistances, buildWalls, cx, cy, diffuseBelief, idx, nextStep, visibleCells } from "@/lies/stealthGrid";

const WORLD_WIDTH = 900;
const WORLD_HEIGHT = 420;
const CELL = 20;
const MX = 10;
const MY = 40;
const SIDE_X = 625;

const PLAYER_STEP = 0.13;
const GUARD_STEP: Record<GuardState, number> = { patrol: 0.34, chase: 0.21, search: 0.25, look: 0.25 };
const VIEW_RANGE = 8;
const FOV = (110 * Math.PI) / 180;
const LOOK_TIME = 1.4;
const OMNI_SECONDS = 10;
const SEARCH_GIVEUP = 18;
const COIN_COUNT = 6;

type Brain = "forgetful" | "omniscient" | "possibility";
type GuardState = "patrol" | "chase" | "search" | "look";

const BRAIN_NAME: Record<Brain, string> = {
    forgetful: "забывчивый",
    omniscient: "всезнающий (читер)",
    possibility: "карта вероятностей",
};

class StealthScene extends Phaser.Scene {
    brain: Brain = "possibility";
    showThoughts = true;
    walls = buildWalls();
    playerStart = idx(2, 16);
    guardStart = idx(16, 10);
    waypoints = [idx(6, 2), idx(25, 2), idx(27, 15), idx(12, 16), idx(7, 10), idx(16, 10)];

    player = this.playerStart;
    guard = this.guardStart;
    guardFacing = 0;
    guardState: GuardState = "patrol";
    waypoint = 0;
    target = -1;
    lastSeen = -1;
    sinceSeen = 0;
    lookLeft = 0;
    belief = new Float32Array(COLS * ROWS);
    seen = new Set<number>();
    coins = new Set<number>();
    collected = 0;

    playerTimer = 0;
    guardTimer = 0;
    beliefTimer = 0;
    t = 0;
    running = false;
    won = false;
    catches = 0;
    lostYou = 0;
    suspiciousSteps = 0;
    flash = 0;
    narrative = "";

    private g!: Phaser.GameObjects.Graphics;
    private texts: Record<string, Phaser.GameObjects.Text> = {};
    private keys!: Record<string, Phaser.Input.Keyboard.Key>;

    constructor() {
        super("lie-possibility-map");
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);
        this.g = this.add.graphics();
        const font = "system-ui, sans-serif";
        const t = (key: string, x: number, y: number, size: number, color = "#e6e8eb") => {
            this.texts[key] = this.add.text(x, y, "", { fontFamily: font, fontSize: `${size}px`, color }).setDepth(5);
        };
        t("title", MX, 12, 13, "#c5cad3");
        t("state", SIDE_X, 12, 16);
        t("info", SIDE_X, 44, 12, "#c5cad3");
        t("thought", SIDE_X, 120, 12, "#ffca28");
        t("overlay", MX + (COLS * CELL) / 2, MY + (ROWS * CELL) / 2, 18, "#ffca28");
        this.texts.overlay.setOrigin(0.5).setAlign("center");
        this.texts.thought.setWordWrapWidth(260);
        this.texts.info.setWordWrapWidth(260);
        const kb = this.input.keyboard!;
        this.keys = kb.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE") as Record<string, Phaser.Input.Keyboard.Key>;
        this.input.on("pointerdown", () => {
            if (!this.running) this.restart();
        });
        this.newGame();
        this.narrative = "Кликни по карте и ходи стрелками/WASD. Собери все монеты и не попадись охраннику.";
    }

    newGame(): void {
        this.player = this.playerStart;
        this.guard = this.guardStart;
        this.guardState = "patrol";
        this.waypoint = 0;
        this.target = -1;
        this.lastSeen = -1;
        this.belief.fill(0);
        this.t = 0;
        this.catches = 0;
        this.lostYou = 0;
        this.suspiciousSteps = 0;
        this.collected = 0;
        this.won = false;
        this.coins.clear();
        const fromGuard = bfsDistances(this.walls, this.guardStart);
        const fromPlayer = bfsDistances(this.walls, this.playerStart);
        let guardRail = 0;
        while (this.coins.size < COIN_COUNT && guardRail++ < 5000) {
            const i = idx(1 + Math.floor(Math.random() * (COLS - 2)), 1 + Math.floor(Math.random() * (ROWS - 2)));
            if (this.walls[i] || fromGuard[i] < 5 || fromPlayer[i] < 6) continue;
            this.coins.add(i);
        }
        this.updateVision();
    }

    restart(): void {
        this.newGame();
        this.running = true;
        this.narrative = `Охранник: <b>${BRAIN_NAME[this.brain]}</b>. Собери ${COIN_COUNT} монет.`;
    }

    updateVision(): void {
        this.seen = visibleCells(this.walls, this.guard, this.guardFacing, VIEW_RANGE, FOV);
    }

    sees(): boolean {
        return this.seen.has(this.player);
    }

    caught(): void {
        this.catches += 1;
        this.flash = 1;
        this.player = this.playerStart;
        this.guardState = "patrol";
        this.target = -1;
        this.narrative = `Пойман! (${this.catches}) Возвращаю на старт. Охранник: ${BRAIN_NAME[this.brain]}.`;
    }

    update(_time: number, deltaMs: number): void {
        const dt = Math.min(deltaMs, 50) / 1000;
        this.flash = Math.max(0, this.flash - dt * 2);
        if (this.running) this.step(dt);
        this.draw();
    }

    step(dt: number): void {
        this.t += dt;
        const k = this.keys;

        // ---- player
        this.playerTimer -= dt;
        if (this.playerTimer <= 0) {
            let dx = 0;
            let dy = 0;
            if (k.LEFT.isDown || k.A.isDown) dx = -1;
            else if (k.RIGHT.isDown || k.D.isDown) dx = 1;
            else if (k.UP.isDown || k.W.isDown) dy = -1;
            else if (k.DOWN.isDown || k.S.isDown) dy = 1;
            if (dx || dy) {
                const nx = cx(this.player) + dx;
                const ny = cy(this.player) + dy;
                const ni = idx(nx, ny);
                if (!this.walls[ni]) this.player = ni;
                this.playerTimer = PLAYER_STEP;
                if (this.coins.delete(this.player)) {
                    this.collected += 1;
                    if (this.collected === COIN_COUNT) {
                        this.running = false;
                        this.won = true;
                        this.narrative =
                            `Все монеты за ${this.t.toFixed(0)}с, пойман ${this.catches} раз, охранник потерял тебя ${this.lostYou} раз. ` +
                            `Подозрительно точных шагов охранника вслепую: <b>${this.suspiciousSteps}</b>. Попробуй другой мозг.`;
                        return;
                    }
                }
            }
        }

        // ---- belief update runs at player speed: "every tick you could have moved one cell"
        if ((this.guardState === "search" || this.guardState === "look") && this.brain === "possibility") {
            this.beliefTimer -= dt;
            if (this.beliefTimer <= 0) {
                this.beliefTimer = PLAYER_STEP;
                diffuseBelief(this.walls, this.belief, this.seen);
            }
        }

        // ---- perception
        if (this.sees()) {
            if (this.guardState !== "chase") this.narrative = "Заметил тебя!";
            this.guardState = "chase";
            this.lastSeen = this.player;
            this.sinceSeen = 0;
        } else {
            this.sinceSeen += dt;
        }

        // ---- guard
        this.guardTimer -= dt;
        if (this.guardTimer > 0) return;
        this.guardTimer = GUARD_STEP[this.guardState];

        if (this.guardState === "chase" && !this.sees()) {
            // lost line of sight: here the three brains differ
            this.guardState = this.brain === "omniscient" ? "chase" : "search";
            if (this.brain === "possibility") {
                this.belief.fill(0);
                this.belief[this.lastSeen] = 1;
            }
            this.target = this.lastSeen;
        }

        let goal = this.guard;
        if (this.guardState === "patrol") {
            if (this.guard === this.waypoints[this.waypoint]) this.waypoint = (this.waypoint + 1) % this.waypoints.length;
            goal = this.waypoints[this.waypoint];
        } else if (this.guardState === "chase") {
            if (this.sees()) goal = this.player;
            else if (this.brain === "omniscient") {
                goal = this.player; // the cheat: knows where you are without seeing you
                if (this.sinceSeen > OMNI_SECONDS) this.giveUp();
            }
        } else if (this.guardState === "search") {
            if (this.brain === "forgetful") goal = this.lastSeen;
            else goal = this.bestBeliefCell();
            this.target = goal;
            if (this.guard === goal) {
                this.guardState = "look";
                this.lookLeft = LOOK_TIME;
            }
            if (this.sinceSeen > SEARCH_GIVEUP) this.giveUp();
        } else if (this.guardState === "look") {
            this.lookLeft -= this.guardTimer;
            this.guardFacing += Math.PI / 2;
            this.updateVision();
            if (this.lookLeft <= 0) {
                if (this.brain === "forgetful") this.giveUp();
                else this.guardState = "search";
            }
            this.checkCatch();
            return;
        }

        if (goal !== this.guard) {
            const before = bfsDistances(this.walls, this.player);
            const nxt = nextStep(this.walls, this.guard, goal);
            if (!this.sees() && this.guardState !== "patrol" && before[nxt] < before[this.guard]) this.suspiciousSteps += 1;
            const dx = cx(nxt) - cx(this.guard);
            const dy = cy(nxt) - cy(this.guard);
            if (dx || dy) this.guardFacing = Math.atan2(dy, dx);
            this.guard = nxt;
        }
        this.updateVision();
        this.checkCatch();
    }

    checkCatch(): void {
        const d = Math.abs(cx(this.guard) - cx(this.player)) + Math.abs(cy(this.guard) - cy(this.player));
        if (d === 0 || (d === 1 && this.sees())) this.caught();
    }

    giveUp(): void {
        this.guardState = "patrol";
        this.target = -1;
        this.lostYou += 1;
        this.narrative = `Охранник потерял тебя (${this.lostYou}) и вернулся к обходу.`;
    }

    bestBeliefCell(): number {
        const dist = bfsDistances(this.walls, this.guard);
        let best = this.lastSeen;
        let bestScore = -1;
        for (let i = 0; i < this.belief.length; i++) {
            const p = this.belief[i];
            if (p <= 0 || dist[i] < 0) continue;
            const score = p / (1 + 0.08 * dist[i]);
            if (score > bestScore) {
                bestScore = score;
                best = i;
            }
        }
        return best;
    }

    draw(): void {
        const g = this.g;
        g.clear();
        const px = (i: number) => MX + cx(i) * CELL;
        const py = (i: number) => MY + cy(i) * CELL;

        let maxBelief = 0;
        for (let i = 0; i < this.belief.length; i++) maxBelief = Math.max(maxBelief, this.belief[i]);

        for (let i = 0; i < COLS * ROWS; i++) {
            g.fillStyle(this.walls[i] ? 0x3a4150 : 0x1b1f27, 1);
            g.fillRect(px(i), py(i), CELL, CELL);
            if (this.walls[i]) continue;
            if (this.showThoughts && this.seen.has(i)) {
                g.fillStyle(0xffca28, 0.12);
                g.fillRect(px(i), py(i), CELL, CELL);
            }
            if (this.showThoughts && this.brain === "possibility" && this.guardState !== "patrol" && maxBelief > 0 && this.belief[i] > 0) {
                g.fillStyle(0xff8a3d, Math.min(0.85, 0.12 + (this.belief[i] / maxBelief) * 0.75));
                g.fillRect(px(i) + 1, py(i) + 1, CELL - 2, CELL - 2);
            }
        }

        for (const c of this.coins) {
            g.fillStyle(0xffd54f, 1);
            g.fillCircle(px(c) + CELL / 2, py(c) + CELL / 2, 5);
        }

        if (this.showThoughts && this.target >= 0 && this.guardState !== "patrol") {
            const tx = px(this.target) + CELL / 2;
            const ty = py(this.target) + CELL / 2;
            g.lineStyle(2, 0xef5350, 0.9);
            g.lineBetween(tx - 6, ty - 6, tx + 6, ty + 6);
            g.lineBetween(tx - 6, ty + 6, tx + 6, ty - 6);
        }
        if (this.showThoughts && this.lastSeen >= 0 && this.guardState !== "patrol") {
            g.lineStyle(1.5, 0xffffff, 0.6);
            g.strokeCircle(px(this.lastSeen) + CELL / 2, py(this.lastSeen) + CELL / 2, 8);
        }
        const omniCheat = this.brain === "omniscient" && this.guardState === "chase" && !this.sees();
        if (omniCheat) {
            g.lineStyle(2, 0xef5350, 0.6);
            g.lineBetween(px(this.guard) + CELL / 2, py(this.guard) + CELL / 2, px(this.player) + CELL / 2, py(this.player) + CELL / 2);
        }

        // guard with facing tick
        const gx = px(this.guard) + CELL / 2;
        const gy = py(this.guard) + CELL / 2;
        g.fillStyle(this.guardState === "chase" ? 0xef5350 : this.guardState === "patrol" ? 0xb57edc : 0xff8a3d, 1);
        g.fillCircle(gx, gy, 8);
        g.lineStyle(2, 0xffffff, 0.9);
        g.lineBetween(gx, gy, gx + Math.cos(this.guardFacing) * 11, gy + Math.sin(this.guardFacing) * 11);

        // player
        g.fillStyle(this.flash > 0 ? 0xef5350 : 0x4fc3f7, 1);
        g.fillRect(px(this.player) + 4, py(this.player) + 4, CELL - 8, CELL - 8);

        if (!this.running) {
            g.fillStyle(0x14181f, 0.7);
            g.fillRect(MX, MY, COLS * CELL, ROWS * CELL);
        }
        this.texts.overlay.setText(
            this.running ? "" : this.won ? `Все монеты! ${this.t.toFixed(0)}с, пойман ${this.catches}\nкликни — ещё раз` : "Кликни, чтобы начать\nходи стрелками или WASD",
        );

        this.texts.title.setText(`Охранник: ${BRAIN_NAME[this.brain]}`);
        const stateName: Record<GuardState, string> = { patrol: "обход", chase: "погоня", search: "поиск", look: "осматривается" };
        this.texts.state.setText(`Состояние: ${stateName[this.guardState]}`);
        this.texts.info.setText(`Монеты ${this.collected}/${COIN_COUNT} · пойман ${this.catches} · ${this.t.toFixed(0)}с`);

        let thought = "";
        if (!this.showThoughts) thought = "Мысли охранника скрыты — включи их в панели справа.";
        else if (this.guardState === "patrol") thought = "Хожу по маршруту. Ничего не знаю.";
        else if (this.guardState === "chase" && this.sees()) thought = "Вижу тебя. Бегу прямо к тебе.";
        else if (omniCheat)
            thought = `Не вижу тебя уже ${this.sinceSeen.toFixed(1)}с, но всё равно иду точно к тебе. Игроку это видно — и это бесит.`;
        else if (this.brain === "forgetful") thought = "Видел тебя вон там. Дойду, посмотрю — и забуду.";
        else if (this.brain === "possibility") {
            let cells = 0;
            for (const p of this.belief) if (p > 0) cells += 1;
            thought =
                `Не вижу тебя ${this.sinceSeen.toFixed(1)}с. Ты можешь быть в ${cells} клетках (оранжевые). ` +
                `Иду туда, где вероятнее всего и ближе. Всё, что я вижу, — вычёркиваю.`;
        }
        this.texts.thought.setText(thought);
    }
}

function buildControls(root: HTMLElement, scene: StealthScene): void {
    root.innerHTML = "";
    addHeading(root, "Possibility Map");
    buildHowTo(
        root,
        "<b>Как пользоваться:</b> кликни по карте, ходи <b>стрелками/WASD</b>, собери монеты. Охранник видит конусом. " +
            "Когда он теряет тебя из виду, всё решает его «мозг»: забывчивый сходит на последнее место и сдастся, " +
            "всезнающий читерит и идёт прямо к тебе сквозь стены, карта вероятностей честно гадает, где ты можешь быть.",
    );
    buildLegend(root, [
        { color: "#4fc3f7", label: "ты" },
        { color: "#ef5350", label: "охранник / его цель" },
        { color: "#ffca28", label: "что видит охранник" },
        { color: "#ff8a3d", label: "где ты можешь быть" },
        { color: "#ffffff", label: "где видел последний раз", shape: "ring" },
    ]);
    const setNarrative = buildNarrative(root, "");

    addSegmented(
        root,
        "Мозг охранника",
        [
            { value: "forgetful" as Brain, label: "Забывчивый" },
            { value: "omniscient" as Brain, label: "Всезнающий" },
            { value: "possibility" as Brain, label: "Карта вероятностей" },
        ],
        scene.brain,
        (b) => {
            scene.brain = b;
            scene.running = false;
            scene.newGame();
        },
    );
    addCheckbox(root, "Показать мысли охранника", scene.showThoughts, (v) => {
        scene.showThoughts = v;
    });
    addButtons(root, [{ label: "Заново", onClick: () => scene.restart() }]);

    const set = addMetrics(root, [""], [
        ["catches", "Пойман"],
        ["lost", "Охранник потерял тебя"],
        ["sus", "Точных шагов вслепую"],
    ]);
    addNote(
        root,
        "«Точный шаг вслепую» — охранник не видит тебя, но шагнул ближе к тебе. Всезнающий набирает их десятками, " +
            "карта вероятностей — только когда угадала, забывчивый — почти никогда.",
    );
    addFooter(root, "lie-possibility-map.html");

    let last = "";
    const tick = () => {
        set("catches", 0, String(scene.catches));
        set("lost", 0, String(scene.lostYou));
        set("sus", 0, String(scene.suspiciousSteps));
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
if (!gameRoot || !controlRoot) throw new Error("lie-possibility-map: expected #game-root and #control-panel");

const scene = new StealthScene();
const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: gameRoot,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    backgroundColor: "#14181f",
    scene: [scene],
});
game.events.once(Phaser.Core.Events.READY, () => buildControls(controlRoot, scene));
