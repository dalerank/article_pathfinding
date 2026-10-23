import Phaser from "phaser";
import type { Vec2 } from "@/simulation/Vec2";
import { buildHowTo, buildLegend, buildNarrative } from "@/rendering/ExplainerPanel";

const W = 900;
const H = 600;
const AGENT_RADIUS = 10;
const WALL_COLOR = 0x3a4152;
const PLAYER_COLOR = 0x4fc3f7;
const REAL_COLOR = 0x6fd48a;
const FAKE_COLOR = 0x8b93a3;
const AIM_RANGE = 30;  // px: if crosshair is within this range of a target, counts as "looking at"

interface Wall { x: number; y: number; w: number; h: number }

const WALLS: Wall[] = [
    { x: 250, y: 100, w: 15, h: 200 },
    { x: 250, y: 400, w: 15, h: 200 },
    { x: 500, y: 0,   w: 15, h: 250 },
    { x: 500, y: 400, w: 15, h: 200 },
    { x: 680, y: 200, w: 15, h: 250 },
    { x: 100, y: 350, w: 200, h: 15 },
];

function segRectIntersect(a: Vec2, b: Vec2, r: Wall): boolean {
    const dx = b.x - a.x, dy = b.y - a.y;
    let tMin = 0, tMax = 1;
    if (dx === 0) { if (a.x < r.x || a.x > r.x + r.w) return false; }
    else { let t1 = (r.x - a.x) / dx, t2 = (r.x + r.w - a.x) / dx; if (t1 > t2) [t1, t2] = [t2, t1]; tMin = Math.max(tMin, t1); tMax = Math.min(tMax, t2); if (tMin > tMax) return false; }
    if (dy === 0) { if (a.y < r.y || a.y > r.y + r.h) return false; }
    else { let t1 = (r.y - a.y) / dy, t2 = (r.y + r.h - a.y) / dy; if (t1 > t2) [t1, t2] = [t2, t1]; tMin = Math.max(tMin, t1); tMax = Math.min(tMax, t2); if (tMin > tMax) return false; }
    return true;
}

function hasLOS(a: Vec2, b: Vec2): boolean {
    for (const w of WALLS) { if (segRectIntersect(a, b, w)) return false; }
    return true;
}

function dist(a: Vec2, b: Vec2): number { return Math.hypot(a.x - b.x, a.y - b.y); }

interface Entity {
    pos: Vec2;
    vel: Vec2;
    isReal: boolean;
    /** Only fakes: is this entity visible to cheater's wallhack? (always visible if LOS) */
    wallhackOnly: boolean;
}

class HallucinationTrapScene extends Phaser.Scene {
    wallhack = false;
    fakeCount = 3;
    suspicionThreshold = 5;
    paused = false;

    playerPos: Vec2 = { x: 120, y: 300 };
    aim: Vec2 = { x: 450, y: 300 };

    entities: Entity[] = [];
    aimOnReal = 0;
    aimOnFake = 0;
    suspicionScore = 0;
    verdict: "clean" | "suspect" | "caught" = "clean";
    lastNarrative = "";

    private elapsed = 0;
    private gfx!: Phaser.GameObjects.Graphics;

    constructor() { super("cheat-hallucination-trap"); }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);
        this.gfx = this.add.graphics();

        this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
            this.aim = { x: Phaser.Math.Clamp(p.x, 0, W), y: Phaser.Math.Clamp(p.y, 0, H) };
            this.checkAim();
        });
        this.input.keyboard?.on("keydown-R", () => this.reset());
        this.reset();
    }

    update(_time: number, deltaMs: number): void {
        if (this.paused) { this.render(); return; }
        const dt = deltaMs / 1000;
        this.elapsed += dt;

        // Move entities
        for (const e of this.entities) {
            e.pos.x += e.vel.x * dt;
            e.pos.y += e.vel.y * dt;
            if (e.pos.x < AGENT_RADIUS || e.pos.x > W - AGENT_RADIUS) e.vel.x *= -1;
            if (e.pos.y < AGENT_RADIUS || e.pos.y > H - AGENT_RADIUS) e.vel.y *= -1;
            e.pos.x = Phaser.Math.Clamp(e.pos.x, AGENT_RADIUS, W - AGENT_RADIUS);
            e.pos.y = Phaser.Math.Clamp(e.pos.y, AGENT_RADIUS, H - AGENT_RADIUS);

            // Update wallhack visibility
            e.wallhackOnly = !e.isReal && !hasLOS(this.playerPos, e.pos);
        }

        // Update verdict
        if (this.suspicionScore >= this.suspicionThreshold) {
            this.verdict = "caught";
        } else if (this.suspicionScore >= Math.ceil(this.suspicionThreshold / 2)) {
            this.verdict = "suspect";
        } else {
            this.verdict = "clean";
        }

        this.render();
    }

    reset(): void {
        this.elapsed = 0;
        this.aimOnReal = 0;
        this.aimOnFake = 0;
        this.suspicionScore = 0;
        this.verdict = "clean";
        this.lastNarrative = "";
        this.spawnEntities();
    }

    togglePaused(): void { this.paused = !this.paused; }

    private spawnEntities(): void {
        this.entities = [];

        // Real enemies
        const realSpawns: Vec2[] = [
            { x: 400, y: 200 }, { x: 700, y: 150 }, { x: 600, y: 450 },
        ];
        for (const s of realSpawns) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 30 + Math.random() * 40;
            this.entities.push({
                pos: { ...s },
                vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
                isReal: true,
                wallhackOnly: false,
            });
        }

        // Fake "hallucination" entities — placed deliberately behind walls
        const fakeSpawns: Vec2[] = [
            { x: 350, y: 180 }, { x: 550, y: 300 }, { x: 750, y: 350 },
            { x: 350, y: 500 }, { x: 800, y: 100 },
        ];
        for (let i = 0; i < Math.min(this.fakeCount, fakeSpawns.length); i++) {
            const s = fakeSpawns[i];
            const angle = Math.random() * Math.PI * 2;
            const speed = 15 + Math.random() * 25;
            this.entities.push({
                pos: { ...s },
                vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
                isReal: false,
                wallhackOnly: true,
            });
        }
    }

    private checkAim(): void {
        for (const e of this.entities) {
            const d = dist(this.aim, e.pos);
            if (d > AIM_RANGE) continue;

            const los = hasLOS(this.playerPos, e.pos);

            if (e.isReal) {
                if (los) this.aimOnReal += 1;
            } else {
                // Aiming at a hallucination
                if (!los) {
                    // Behind wall — only wallhack would know about this
                    this.aimOnFake += 1;
                    this.suspicionScore += 1;
                    this.lastNarrative =
                        `<b style="color:#ef5350">Подозрение!</b> Прицел наведён на галлюцинацию за стеной. ` +
                        `Честный клиент эту цель не видит. Suspicion: ${this.suspicionScore}/${this.suspicionThreshold}.`;
                }
            }
        }
    }

    private render(): void {
        this.gfx.clear();

        // Background
        this.gfx.fillStyle(0x1b1f27, 1);
        this.gfx.fillRect(0, 0, W, H);

        // Walls
        for (const w of WALLS) {
            this.gfx.fillStyle(WALL_COLOR, 1);
            this.gfx.fillRect(w.x, w.y, w.w, w.h);
        }

        // Entities
        for (const e of this.entities) {
            const los = hasLOS(this.playerPos, e.pos);

            if (e.isReal) {
                if (los) {
                    // Visible real enemy
                    this.gfx.fillStyle(REAL_COLOR, 1);
                    this.gfx.fillCircle(e.pos.x, e.pos.y, AGENT_RADIUS);
                } else if (this.wallhack) {
                    // Real behind wall, wallhack shows
                    this.gfx.fillStyle(REAL_COLOR, 0.5);
                    this.gfx.fillCircle(e.pos.x, e.pos.y, AGENT_RADIUS);
                }
            } else {
                // Hallucination — NEVER visible without wallhack
                if (this.wallhack) {
                    // Show hallucination (looks identical to real enemy through wallhack)
                    if (los) {
                        this.gfx.fillStyle(REAL_COLOR, 0.8);
                    } else {
                        this.gfx.fillStyle(REAL_COLOR, 0.5);
                    }
                    this.gfx.fillCircle(e.pos.x, e.pos.y, AGENT_RADIUS);
                    // Subtle difference: tiny ring (invisible to cheater normally)
                    // In production this wouldn't be shown, but for demo clarity:
                    this.gfx.lineStyle(1, FAKE_COLOR, 0.15);
                    this.gfx.strokeCircle(e.pos.x, e.pos.y, AGENT_RADIUS + 3);
                }
            }
        }

        // Player
        this.gfx.fillStyle(PLAYER_COLOR, 1);
        this.gfx.fillCircle(this.playerPos.x, this.playerPos.y, AGENT_RADIUS + 2);

        // Crosshair
        this.gfx.lineStyle(1.5, 0xffca28, 0.8);
        this.gfx.strokeCircle(this.aim.x, this.aim.y, 8);
        this.gfx.lineBetween(this.aim.x - 12, this.aim.y, this.aim.x + 12, this.aim.y);
        this.gfx.lineBetween(this.aim.x, this.aim.y - 12, this.aim.x, this.aim.y + 12);

        // Aim line
        this.gfx.lineStyle(1, 0xffca28, 0.2);
        this.gfx.lineBetween(this.playerPos.x, this.playerPos.y, this.aim.x, this.aim.y);

        // Suspicion bar at top
        const barW = W - 40, barH = 6, barX = 20, barY = 10;
        this.gfx.fillStyle(0x2a2f3a, 1);
        this.gfx.fillRect(barX, barY, barW, barH);
        const fill = Math.min(1, this.suspicionScore / this.suspicionThreshold);
        const barColor = fill >= 1 ? 0xef5350 : fill >= 0.5 ? 0xffca28 : 0x6fd48a;
        this.gfx.fillStyle(barColor, 0.8);
        this.gfx.fillRect(barX, barY, barW * fill, barH);
    }
}

/* ── Controls ── */

function buildControls(root: HTMLElement, scene: HallucinationTrapScene): void {
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "Hallucination Trap";
    root.appendChild(heading);

    buildHowTo(
        root,
        "<b>Как пользоваться:</b> двигай прицел мышью. Без wallhack видишь только реальных противников в " +
        "прямой видимости. Включи wallhack — увидишь цели за стенами, но среди них есть <b>галлюцинации</b> " +
        "(ловушки сервера). Наведи прицел на фейк за стеной — suspicion растёт. Честный игрок никогда не наведёт.",
    );
    buildLegend(root, [
        { color: "#4fc3f7", label: "ты (Василий)" },
        { color: "#6fd48a", label: "реальный противник" },
        { color: "#8b93a3", label: "галлюцинация (ловушка)", shape: "ring" },
        { color: "#ffca28", label: "прицел", shape: "ring" },
    ]);
    const setNarrative = buildNarrative(root, "Включи wallhack и двигай прицел — следи за полоской suspicion.");

    // Wallhack toggle
    const whRow = document.createElement("div");
    whRow.className = "control-row";
    const whLabel = document.createElement("label");
    whLabel.textContent = "👁 Wallhack";
    const whCheck = document.createElement("input");
    whCheck.type = "checkbox";
    whCheck.checked = scene.wallhack;
    whCheck.addEventListener("change", () => { scene.wallhack = whCheck.checked; });
    whRow.append(whLabel, whCheck);
    root.appendChild(whRow);

    // Fake count
    const fakeRow = document.createElement("div");
    fakeRow.className = "control-row";
    const fakeLabel = document.createElement("label");
    fakeLabel.textContent = "Галлюцинаций";
    const fakeInput = document.createElement("input");
    fakeInput.type = "range";
    fakeInput.min = "0";
    fakeInput.max = "5";
    fakeInput.step = "1";
    fakeInput.value = String(scene.fakeCount);
    const fakeValue = document.createElement("span");
    fakeValue.textContent = String(scene.fakeCount);
    fakeInput.addEventListener("input", () => {
        scene.fakeCount = Number(fakeInput.value);
        fakeValue.textContent = String(scene.fakeCount);
        scene.reset();
    });
    fakeRow.append(fakeLabel, fakeInput, fakeValue);
    root.appendChild(fakeRow);

    // Threshold
    const thRow = document.createElement("div");
    thRow.className = "control-row";
    const thLabel = document.createElement("label");
    thLabel.textContent = "Порог подозрения";
    const thInput = document.createElement("input");
    thInput.type = "range";
    thInput.min = "1";
    thInput.max = "15";
    thInput.step = "1";
    thInput.value = String(scene.suspicionThreshold);
    const thValue = document.createElement("span");
    thValue.textContent = String(scene.suspicionThreshold);
    thInput.addEventListener("input", () => {
        scene.suspicionThreshold = Number(thInput.value);
        thValue.textContent = String(scene.suspicionThreshold);
    });
    thRow.append(thLabel, thInput, thValue);
    root.appendChild(thRow);

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
        ["real", "Наведений на реальных"],
        ["fake", "Наведений на ловушки"],
        ["score", "Suspicion"],
        ["verdict", "Вердикт"],
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
        '<a href="cheat-wallhack-culling.html" style="color:#4fc3f7">Wallhack Culling</a> &middot; ' +
        '<a href="cheat-aimbot-stats.html" style="color:#4fc3f7">Aimbot Stats</a>';
    root.appendChild(hint);

    const tick = () => {
        cells.real.textContent = String(scene.aimOnReal);
        cells.fake.textContent = String(scene.aimOnFake);
        cells.fake.style.color = scene.aimOnFake > 0 ? "#ef5350" : "#6fd48a";
        cells.score.textContent = `${scene.suspicionScore} / ${scene.suspicionThreshold}`;
        cells.score.style.color = scene.suspicionScore >= scene.suspicionThreshold ? "#ef5350" : scene.suspicionScore > 0 ? "#ffca28" : "#6fd48a";

        const verdictMap = { clean: ["✅ Чисто", "#6fd48a"], suspect: ["⚠ Подозрение", "#ffca28"], caught: ["🚫 Пойман!", "#ef5350"] };
        const [text, color] = verdictMap[scene.verdict];
        cells.verdict.textContent = text;
        cells.verdict.style.color = color;

        if (scene.lastNarrative) setNarrative(scene.lastNarrative);
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

/* ── Boot ── */

const gameRoot = document.getElementById("game-root");
const controlRoot = document.getElementById("control-panel");
if (!gameRoot || !controlRoot) throw new Error("cheat-hallucination-trap: expected #game-root and #control-panel");

const scene = new HallucinationTrapScene();
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
