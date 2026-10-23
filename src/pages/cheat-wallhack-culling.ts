import Phaser from "phaser";
import type { Vec2 } from "@/simulation/Vec2";
import { buildHowTo, buildLegend, buildNarrative } from "@/rendering/ExplainerPanel";

const W = 900;
const H = 600;
const AGENT_RADIUS = 10;
const WALL_COLOR = 0x3a4152;
const PLAYER_COLOR = 0x4fc3f7;
const ENEMY_COLOR = 0xef5350;
const ENEMY_HIDDEN_COLOR = 0x8b93a3;
const CULLED_COLOR = 0x3a4152;
const MARGIN_COLOR = 0x6fd48a;

interface Wall { x1: number; y1: number; x2: number; y2: number; thick: number }

const WALLS: Wall[] = [
    { x1: 300, y1: 0,   x2: 300, y2: 250, thick: 10 },
    { x1: 300, y1: 350, x2: 300, y2: 600, thick: 10 },
    { x1: 550, y1: 0,   x2: 550, y2: 200, thick: 10 },
    { x1: 550, y1: 350, x2: 550, y2: 600, thick: 10 },
    { x1: 150, y1: 400, x2: 400, y2: 400, thick: 10 },
    { x1: 600, y1: 180, x2: 800, y2: 180, thick: 10 },
];

function wallRect(w: Wall): { x: number; y: number; w: number; h: number } {
    const minX = Math.min(w.x1, w.x2);
    const minY = Math.min(w.y1, w.y2);
    const maxX = Math.max(w.x1, w.x2);
    const maxY = Math.max(w.y1, w.y2);
    return { x: minX - w.thick / 2, y: minY - w.thick / 2, w: maxX - minX + w.thick, h: maxY - minY + w.thick };
}

/** Simple segment–AABB intersection for LOS check */
function segmentHitsWall(a: Vec2, b: Vec2): boolean {
    for (const wall of WALLS) {
        const r = wallRect(wall);
        if (segRectIntersect(a, b, r.x, r.y, r.w, r.h)) return true;
    }
    return false;
}

function segRectIntersect(a: Vec2, b: Vec2, rx: number, ry: number, rw: number, rh: number): boolean {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    let tMin = 0, tMax = 1;
    if (dx === 0) { if (a.x < rx || a.x > rx + rw) return false; }
    else {
        let t1 = (rx - a.x) / dx, t2 = (rx + rw - a.x) / dx;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tMin = Math.max(tMin, t1); tMax = Math.min(tMax, t2);
        if (tMin > tMax) return false;
    }
    if (dy === 0) { if (a.y < ry || a.y > ry + rh) return false; }
    else {
        let t1 = (ry - a.y) / dy, t2 = (ry + rh - a.y) / dy;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tMin = Math.max(tMin, t1); tMax = Math.min(tMax, t2);
        if (tMin > tMax) return false;
    }
    return true;
}

function dist(a: Vec2, b: Vec2): number { return Math.hypot(a.x - b.x, a.y - b.y); }

type CullingMode = "none" | "distance" | "los";

interface Enemy {
    pos: Vec2;
    vel: Vec2;
    /** Is server sending this enemy's data to the player's client? */
    sentToClient: boolean;
    /** Was visible last frame — used to detect pop-in */
    wasVisible: boolean;
}

class WallhackCullingScene extends Phaser.Scene {
    cullingMode: CullingMode = "none";
    cullingRadius = 350;
    guardMarginMs = 80;
    showWallhack = false;
    paused = false;

    playerPos: Vec2 = { x: 150, y: 300 };

    enemies: Enemy[] = [];
    packetsSent = 0;
    popInEvents = 0;
    enemiesSent = 0;

    lastNarrative = "";

    private elapsed = 0;
    private gfx!: Phaser.GameObjects.Graphics;
    private losGfx!: Phaser.GameObjects.Graphics;

    constructor() { super("cheat-wallhack-culling"); }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);
        this.gfx = this.add.graphics();
        this.losGfx = this.add.graphics();

        this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
            this.playerPos = { x: Phaser.Math.Clamp(p.x, AGENT_RADIUS, W - AGENT_RADIUS), y: Phaser.Math.Clamp(p.y, AGENT_RADIUS, H - AGENT_RADIUS) };
        });
        this.input.keyboard?.on("keydown-R", () => this.reset());

        this.reset();
    }

    update(_time: number, deltaMs: number): void {
        if (this.paused) { this.render(); return; }
        const dt = deltaMs / 1000;
        this.elapsed += dt;

        // Move enemies on patrol paths
        for (const e of this.enemies) {
            e.pos.x += e.vel.x * dt;
            e.pos.y += e.vel.y * dt;
            if (e.pos.x < AGENT_RADIUS || e.pos.x > W - AGENT_RADIUS) e.vel.x *= -1;
            if (e.pos.y < AGENT_RADIUS || e.pos.y > H - AGENT_RADIUS) e.vel.y *= -1;
            e.pos.x = Phaser.Math.Clamp(e.pos.x, AGENT_RADIUS, W - AGENT_RADIUS);
            e.pos.y = Phaser.Math.Clamp(e.pos.y, AGENT_RADIUS, H - AGENT_RADIUS);
        }

        // Server culling decision
        const guardPx = (this.guardMarginMs / 1000) * 200; // rough velocity estimate for guard zone
        let sentCount = 0;
        for (const e of this.enemies) {
            const d = dist(this.playerPos, e.pos);
            const hasLOS = !segmentHitsWall(this.playerPos, e.pos);
            const wasVisible = e.sentToClient;

            let send = true;
            if (this.cullingMode === "distance") {
                send = d <= this.cullingRadius + guardPx;
            } else if (this.cullingMode === "los") {
                // LOS + distance
                const inRange = d <= this.cullingRadius + guardPx;
                send = inRange && (hasLOS || d <= guardPx * 2);
            }

            e.sentToClient = send;
            if (send) sentCount += 1;

            // Pop-in detection: was hidden last frame, now suddenly visible and close
            if (!wasVisible && send && hasLOS && d < this.cullingRadius) {
                this.popInEvents += 1;
            }
            e.wasVisible = send;
        }

        this.enemiesSent = sentCount;
        this.packetsSent += sentCount;

        this.render();
    }

    reset(): void {
        this.elapsed = 0;
        this.packetsSent = 0;
        this.popInEvents = 0;
        this.enemiesSent = 0;
        this.lastNarrative = "";

        // Spawn enemies
        this.enemies = [];
        const spawns: Vec2[] = [
            { x: 450, y: 150 }, { x: 700, y: 100 }, { x: 750, y: 450 },
            { x: 500, y: 500 }, { x: 200, y: 500 }, { x: 400, y: 300 },
            { x: 650, y: 300 }, { x: 820, y: 550 },
        ];
        for (const s of spawns) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 40 + Math.random() * 60;
            this.enemies.push({
                pos: { ...s },
                vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
                sentToClient: true,
                wasVisible: true,
            });
        }
    }

    togglePaused(): void { this.paused = !this.paused; }

    private render(): void {
        this.gfx.clear();
        this.losGfx.clear();

        // Background
        this.gfx.fillStyle(0x1b1f27, 1);
        this.gfx.fillRect(0, 0, W, H);

        // Walls
        for (const wall of WALLS) {
            const r = wallRect(wall);
            this.gfx.fillStyle(WALL_COLOR, 1);
            this.gfx.fillRect(r.x, r.y, r.w, r.h);
        }

        // Culling radius (visual)
        if (this.cullingMode !== "none") {
            this.losGfx.lineStyle(1, MARGIN_COLOR, 0.2);
            this.losGfx.strokeCircle(this.playerPos.x, this.playerPos.y, this.cullingRadius);
            const guardPx = (this.guardMarginMs / 1000) * 200;
            if (guardPx > 0) {
                this.losGfx.lineStyle(1, MARGIN_COLOR, 0.1);
                this.losGfx.strokeCircle(this.playerPos.x, this.playerPos.y, this.cullingRadius + guardPx);
            }
        }

        // Enemies
        for (const e of this.enemies) {
            const hasLOS = !segmentHitsWall(this.playerPos, e.pos);

            if (e.sentToClient) {
                // Sent to client — visible normally (or through wallhack)
                if (hasLOS) {
                    this.gfx.fillStyle(ENEMY_COLOR, 1);
                    this.gfx.fillCircle(e.pos.x, e.pos.y, AGENT_RADIUS);
                } else {
                    // Behind wall but sent — wallhack opportunity!
                    if (this.showWallhack) {
                        this.gfx.fillStyle(ENEMY_COLOR, 0.6);
                        this.gfx.fillCircle(e.pos.x, e.pos.y, AGENT_RADIUS);
                        this.gfx.lineStyle(1, 0xffca28, 0.5);
                        this.gfx.strokeCircle(e.pos.x, e.pos.y, AGENT_RADIUS + 4);
                    } else {
                        // Normally hidden by wall rendering
                        this.gfx.fillStyle(ENEMY_HIDDEN_COLOR, 0.2);
                        this.gfx.fillCircle(e.pos.x, e.pos.y, AGENT_RADIUS);
                    }
                }
            } else {
                // Not sent to client
                if (this.showWallhack) {
                    // Wallhack wants to show, but data isn't there!
                    this.gfx.lineStyle(1, CULLED_COLOR, 0.3);
                    this.gfx.strokeCircle(e.pos.x, e.pos.y, AGENT_RADIUS);
                    // X mark
                    this.gfx.lineBetween(e.pos.x - 5, e.pos.y - 5, e.pos.x + 5, e.pos.y + 5);
                    this.gfx.lineBetween(e.pos.x + 5, e.pos.y - 5, e.pos.x - 5, e.pos.y + 5);
                }
                // else: truly invisible — nothing drawn
            }
        }

        // Player
        this.gfx.fillStyle(PLAYER_COLOR, 1);
        this.gfx.fillCircle(this.playerPos.x, this.playerPos.y, AGENT_RADIUS + 2);

        // Update narrative
        const culledCount = this.enemies.filter(e => !e.sentToClient).length;
        const wallhackUseful = this.enemies.filter(e => e.sentToClient && segmentHitsWall(this.playerPos, e.pos)).length;
        if (this.cullingMode === "none") {
            this.lastNarrative = `<b>Нет culling.</b> Все ${this.enemies.length} противников отправляются клиенту. ` +
                `Wallhack видит ${wallhackUseful} за стенами.`;
        } else {
            this.lastNarrative = `<b>Culling: ${this.cullingMode}.</b> Отправлено: ${this.enemiesSent}/${this.enemies.length}. ` +
                `Скрыто от wallhack: ${culledCount}. Pop-in: ${this.popInEvents}.`;
        }
    }
}

/* ── Controls ── */

function buildControls(root: HTMLElement, scene: WallhackCullingScene): void {
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "Wallhack Culling";
    root.appendChild(heading);

    buildHowTo(
        root,
        "<b>Как пользоваться:</b> двигай мышью — это Василий. Красные точки — противники за стенами. " +
        "Без culling сервер отправляет все позиции и wallhack видит всё. Переключи на «LOS + Distance» — " +
        "данные скрытых противников не отправляются, и wallhack бесполезен.",
    );
    buildLegend(root, [
        { color: "#4fc3f7", label: "Василий (ты)" },
        { color: "#ef5350", label: "противник (видимый)" },
        { color: "#8b93a3", label: "противник (за стеной, данные есть)" },
        { color: "#6fd48a", label: "радиус culling", shape: "ring" },
    ]);
    const setNarrative = buildNarrative(root, "Двигай мышью и переключай режим culling.");

    // Culling mode
    const modeRow = document.createElement("div");
    modeRow.className = "control-row";
    const modeLabel = document.createElement("label");
    modeLabel.textContent = "Culling mode";
    const modeSelect = document.createElement("select");
    modeSelect.style.flex = "1";
    for (const [val, text] of [["none", "None — всё рассылается"], ["distance", "Distance — по радиусу"], ["los", "LOS + Distance"]] as const) {
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = text;
        modeSelect.appendChild(opt);
    }
    modeSelect.value = scene.cullingMode;
    modeSelect.addEventListener("change", () => { scene.cullingMode = modeSelect.value as CullingMode; });
    modeRow.append(modeLabel, modeSelect);
    root.appendChild(modeRow);

    // Radius
    const radRow = document.createElement("div");
    radRow.className = "control-row";
    const radLabel = document.createElement("label");
    radLabel.textContent = "Радиус culling";
    const radInput = document.createElement("input");
    radInput.type = "range";
    radInput.min = "100";
    radInput.max = "600";
    radInput.step = "10";
    radInput.value = String(scene.cullingRadius);
    const radValue = document.createElement("span");
    radValue.textContent = `${scene.cullingRadius}px`;
    radInput.addEventListener("input", () => {
        scene.cullingRadius = Number(radInput.value);
        radValue.textContent = `${scene.cullingRadius}px`;
    });
    radRow.append(radLabel, radInput, radValue);
    root.appendChild(radRow);

    // Guard margin
    const guardRow = document.createElement("div");
    guardRow.className = "control-row";
    const guardLabel = document.createElement("label");
    guardLabel.textContent = "Guard margin";
    const guardInput = document.createElement("input");
    guardInput.type = "range";
    guardInput.min = "0";
    guardInput.max = "300";
    guardInput.step = "10";
    guardInput.value = String(scene.guardMarginMs);
    const guardValue = document.createElement("span");
    guardValue.textContent = `${scene.guardMarginMs}ms`;
    guardInput.addEventListener("input", () => {
        scene.guardMarginMs = Number(guardInput.value);
        guardValue.textContent = `${scene.guardMarginMs}ms`;
    });
    guardRow.append(guardLabel, guardInput, guardValue);
    root.appendChild(guardRow);

    // Wallhack toggle
    const whRow = document.createElement("div");
    whRow.className = "control-row";
    const whLabel = document.createElement("label");
    whLabel.textContent = "Показать wallhack";
    const whCheck = document.createElement("input");
    whCheck.type = "checkbox";
    whCheck.checked = scene.showWallhack;
    whCheck.addEventListener("change", () => { scene.showWallhack = whCheck.checked; });
    whRow.append(whLabel, whCheck);
    root.appendChild(whRow);

    // Pause / Reset
    const btnRow = document.createElement("div");
    btnRow.className = "control-row";
    const pauseBtn = document.createElement("button");
    pauseBtn.textContent = "Пауза";
    pauseBtn.addEventListener("click", () => scene.togglePaused());
    const resetBtn = document.createElement("button");
    resetBtn.textContent = "Reset (R)";
    resetBtn.addEventListener("click", () => scene.reset());
    btnRow.append(pauseBtn, resetBtn);
    root.appendChild(btnRow);

    // Metrics
    const table = document.createElement("table");
    table.className = "metrics-table";
    const metricsKeys: Array<[string, string]> = [
        ["sent", "Объектов отправлено"],
        ["total", "Всего противников"],
        ["popin", "Pop-in событий"],
    ];
    const cells: Record<string, HTMLTableCellElement> = {};
    for (const [key, label] of metricsKeys) {
        const tr = document.createElement("tr");
        const th = document.createElement("td");
        th.textContent = label;
        const td = document.createElement("td");
        td.textContent = "-";
        cells[key] = td;
        tr.append(th, td);
        table.appendChild(tr);
    }
    root.appendChild(table);

    // Links
    const hint = document.createElement("p");
    hint.style.color = "#8b93a3";
    hint.innerHTML =
        'Часть примеров к статье «Как немножко обмануть сервер». ' +
        '<a href="../index.html" style="color:#4fc3f7">&larr; Все примеры</a> &middot; ' +
        '<a href="cheat-client-authority.html" style="color:#4fc3f7">Client Authority</a> &middot; ' +
        '<a href="cheat-hallucination-trap.html" style="color:#4fc3f7">Hallucination Trap</a>';
    root.appendChild(hint);

    const tick = () => {
        cells.sent.textContent = `${scene.enemiesSent}`;
        cells.sent.style.color = scene.enemiesSent < scene.enemies.length ? "#6fd48a" : "#ffca28";
        cells.total.textContent = `${scene.enemies.length}`;
        cells.popin.textContent = `${scene.popInEvents}`;
        if (scene.lastNarrative) setNarrative(scene.lastNarrative);
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

/* ── Boot ── */

const gameRoot = document.getElementById("game-root");
const controlRoot = document.getElementById("control-panel");
if (!gameRoot || !controlRoot) throw new Error("cheat-wallhack-culling: expected #game-root and #control-panel");

const scene = new WallhackCullingScene();
const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: gameRoot,
    width: W,
    height: H,
    backgroundColor: "#14181f",
    scene: [scene],
    fps: { target: 60 },
});

game.events.once(Phaser.Core.Events.READY, () => buildControls(controlRoot, scene));
