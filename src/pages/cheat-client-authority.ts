import Phaser from "phaser";
import type { Vec2 } from "@/simulation/Vec2";
import { buildHowTo, buildLegend, buildNarrative } from "@/rendering/ExplainerPanel";

const W = 900;
const H = 600;
const AGENT_RADIUS = 16;
const NORMAL_SPEED = 160; // px/s
const SERVER_TICK_RATE = 30; // Hz
const SERVER_DT = 1 / SERVER_TICK_RATE;

// Colors
const VASIA_CLIENT_COLOR = 0xffca28; // Cheater client
const VASIA_SERVER_COLOR = 0x8b93a3; // Server truth ghost
const VASILY_COLOR = 0x6fd48a;       // Honest defender
const WALL_COLOR = 0x333f52;
const WALL_BORDER_COLOR = 0x4e5d78;
const FLAG_COLOR = 0xff5252;
const RUBBER_COLOR = 0xef5350;

interface WallRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

// Thick dividing fortress wall with a single doorway at the bottom
const FORTRESS_WALLS: WallRect[] = [
    // Top segment of central wall
    { x: 440, y: 0, w: 40, h: 420 },
    // Bottom segment of central wall
    { x: 440, y: 520, w: 40, h: 80 },
    // Doorway opening is between y: 420 and y: 520 (height: 100px)
];

function circleIntersectsRect(cx: number, cy: number, r: number, rect: WallRect): boolean {
    const closestX = Phaser.Math.Clamp(cx, rect.x, rect.x + rect.w);
    const closestY = Phaser.Math.Clamp(cy, rect.y, rect.y + rect.h);
    const distX = cx - closestX;
    const distY = cy - closestY;
    return distX * distX + distY * distY < r * r;
}

function lineIntersectsWall(a: Vec2, b: Vec2, rect: WallRect): boolean {
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);

    if (maxX < rect.x || minX > rect.x + rect.w || maxY < rect.y || minY > rect.y + rect.h) {
        return false;
    }

    // Vertical line intersection test
    const dx = b.x - a.x;
    if (Math.abs(dx) > 0.001) {
        const t1 = (rect.x - a.x) / dx;
        const t2 = (rect.x + rect.w - a.x) / dx;
        const [tStart, tEnd] = t1 < t2 ? [t1, t2] : [t2, t1];
        const tClampedStart = Math.max(0, tStart);
        const tClampedEnd = Math.min(1, tEnd);
        if (tClampedStart <= tClampedEnd) {
            const yAtStart = a.y + (b.y - a.y) * tClampedStart;
            if (yAtStart >= rect.y && yAtStart <= rect.y + rect.h) return true;
        }
    }
    return false;
}

function hitsAnyWall(pos: Vec2, radius = AGENT_RADIUS): boolean {
    for (const w of FORTRESS_WALLS) {
        if (circleIntersectsRect(pos.x, pos.y, radius, w)) return true;
    }
    return false;
}

function pathCrossesAnyWall(from: Vec2, to: Vec2): boolean {
    for (const w of FORTRESS_WALLS) {
        if (lineIntersectsWall(from, to, w)) return true;
    }
    return false;
}

class ClientAuthorityScene extends Phaser.Scene {
    /** true = Server-Authority, false = Client-Authority */
    serverAuth = false;
    speedhackMultiplier = 1.0;
    autoRun = false;
    serverTolerance = 50; // px threshold before rubber-band triggers
    paused = false;

    // Characters
    vasiaClientPos: Vec2 = { x: 200, y: 250 };
    vasiaServerPos: Vec2 = { x: 200, y: 250 };
    vasilyPos: Vec2 = { x: 740, y: 250 };
    flagPos: Vec2 = { x: 800, y: 250 };

    flagStolen = false;

    // Metrics & logs
    rubberBandEvents = 0;
    teleportAttempts = 0;
    lastNarrative = "";

    // Visual effects
    private rubberSnapLine: { from: Vec2; to: Vec2; age: number } | null = null;
    private trailClient: Vec2[] = [];
    private trailServer: Vec2[] = [];
    private elapsed = 0;
    private serverTickAcc = 0;
    private keys!: { w: Phaser.Input.Keyboard.Key; a: Phaser.Input.Keyboard.Key; s: Phaser.Input.Keyboard.Key; d: Phaser.Input.Keyboard.Key };
    private gfx!: Phaser.GameObjects.Graphics;

    constructor() {
        super("cheat-client-authority");
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);
        this.gfx = this.add.graphics();

        this.keys = {
            w: this.input.keyboard!.addKey("W"),
            a: this.input.keyboard!.addKey("A"),
            s: this.input.keyboard!.addKey("S"),
            d: this.input.keyboard!.addKey("D"),
        };

        this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
            if (p.x <= W && p.y <= H) {
                this.handlePointerClick({ x: p.x, y: p.y });
            }
        });

        this.input.keyboard?.on("keydown-R", () => this.reset());
        this.reset();
    }

    reset(): void {
        this.vasiaClientPos = { x: 200, y: 250 };
        this.vasiaServerPos = { x: 200, y: 250 };
        this.vasilyPos = { x: 740, y: 250 };
        this.flagStolen = false;
        this.rubberBandEvents = 0;
        this.teleportAttempts = 0;
        this.trailClient = [];
        this.trailServer = [];
        this.rubberSnapLine = null;
        this.lastNarrative = "";
    }

    update(_time: number, deltaMs: number): void {
        if (this.paused) {
            this.render();
            return;
        }
        const dt = deltaMs / 1000;
        this.elapsed += dt;

        // Vasya's intentional movement direction
        let inputDx = 0;
        let inputDy = 0;

        if (this.keys.a.isDown) inputDx -= 1;
        if (this.keys.d.isDown) inputDx += 1;
        if (this.keys.w.isDown) inputDy -= 1;
        if (this.keys.s.isDown) inputDy += 1;

        if (inputDx === 0 && inputDy === 0 && this.autoRun && !this.flagStolen) {
            // Auto-run directly towards the flag across the wall
            const target = this.flagPos;
            const dist = Math.hypot(target.x - this.vasiaClientPos.x, target.y - this.vasiaClientPos.y);
            if (dist > 5) {
                inputDx = (target.x - this.vasiaClientPos.x) / dist;
                inputDy = (target.y - this.vasiaClientPos.y) / dist;
            }
        }

        const inputLen = Math.hypot(inputDx, inputDy);
        if (inputLen > 0) {
            inputDx /= inputLen;
            inputDy /= inputLen;
        }

        const clientSpeed = NORMAL_SPEED * this.speedhackMultiplier;

        if (!this.serverAuth) {
            // ==========================================
            // 🔴 CLIENT AUTHORITY: Client dictates position
            // ==========================================
            // Client moves (even ignoring wall collisions if cheating)
            const moveDist = clientSpeed * dt * (inputLen > 0 ? 1 : 0);
            this.vasiaClientPos.x += inputDx * moveDist;
            this.vasiaClientPos.y += inputDy * moveDist;

            // Server blindly trusts whatever client coordinates say:
            this.vasiaServerPos = { ...this.vasiaClientPos };

            // Check if flag reached
            if (Math.hypot(this.vasiaClientPos.x - this.flagPos.x, this.vasiaClientPos.y - this.flagPos.y) < 30) {
                if (!this.flagStolen) {
                    this.flagStolen = true;
                    this.lastNarrative = `<b style="color:#ef5350">УЯЗВИМОСТЬ:</b> Вася зашёл сквозь стену и украл флаг! Сервер принял координаты клиента без проверки столкновений.`;
                }
            }
        } else {
            // ==========================================
            // 🟢 SERVER AUTHORITY: Server simulates physics
            // ==========================================
            // Client prediction moves with speedhack:
            const moveDist = clientSpeed * dt * (inputLen > 0 ? 1 : 0);
            const proposedClientPos = {
                x: this.vasiaClientPos.x + inputDx * moveDist,
                y: this.vasiaClientPos.y + inputDy * moveDist,
            };

            // Server tick accumulation
            this.serverTickAcc += dt;
            while (this.serverTickAcc >= SERVER_DT) {
                this.serverTickAcc -= SERVER_DT;

                // Server calculates allowed step from normal speed and enforces wall collision
                const serverStep = NORMAL_SPEED * SERVER_DT * (inputLen > 0 ? 1 : 0);
                const nextServerX = this.vasiaServerPos.x + inputDx * serverStep;
                const nextServerY = this.vasiaServerPos.y + inputDy * serverStep;

                // Server blocks walls
                if (!hitsAnyWall({ x: nextServerX, y: this.vasiaServerPos.y })) {
                    this.vasiaServerPos.x = nextServerX;
                }
                if (!hitsAnyWall({ x: this.vasiaServerPos.x, y: nextServerY })) {
                    this.vasiaServerPos.y = nextServerY;
                }
            }

            // Client also simulates wall collision locally (unless noclip)
            if (this.speedhackMultiplier <= 1.0 && !hitsAnyWall(proposedClientPos)) {
                this.vasiaClientPos = proposedClientPos;
            } else {
                this.vasiaClientPos = proposedClientPos;
            }

            // Rubber-band validation: server checks gap between client and authoritative server truth
            const gap = Math.hypot(this.vasiaClientPos.x - this.vasiaServerPos.x, this.vasiaClientPos.y - this.vasiaServerPos.y);

            // Also check if client phase-shifted through wall
            const wallViolated = pathCrossesAnyWall(this.vasiaServerPos, this.vasiaClientPos);

            if (gap > this.serverTolerance || wallViolated) {
                this.rubberBandEvents += 1;
                this.rubberSnapLine = {
                    from: { ...this.vasiaClientPos },
                    to: { ...this.vasiaServerPos },
                    age: 0,
                };
                // Snap client position back to server truth!
                this.vasiaClientPos = { ...this.vasiaServerPos };

                if (wallViolated) {
                    this.lastNarrative = `<b style="color:#6fd48a">ОТКАТ (RUBBER-BAND):</b> Сервер зафиксировал попытку пройти сквозь стену! Координаты сброшены к серверной позиции.`;
                } else {
                    this.lastNarrative = `<b style="color:#6fd48a">ОТКАТ (RUBBER-BAND):</b> Разрыв клиента и сервера (${gap.toFixed(0)}px > ${this.serverTolerance}px). Спидхак подавлен.`;
                }
            }
        }

        // Clamp Vasya in world bounds
        this.vasiaClientPos.x = Phaser.Math.Clamp(this.vasiaClientPos.x, AGENT_RADIUS, W - AGENT_RADIUS);
        this.vasiaClientPos.y = Phaser.Math.Clamp(this.vasiaClientPos.y, AGENT_RADIUS, H - AGENT_RADIUS);

        // Update trails
        this.trailClient.push({ ...this.vasiaClientPos });
        this.trailServer.push({ ...this.vasiaServerPos });
        if (this.trailClient.length > 25) this.trailClient.shift();
        if (this.trailServer.length > 25) this.trailServer.shift();

        // Update snap line animation
        if (this.rubberSnapLine) {
            this.rubberSnapLine.age += dt;
            if (this.rubberSnapLine.age > 0.6) this.rubberSnapLine = null;
        }

        this.render();
    }

    /** Teleport cheat directly across the fortress wall next to the flag */
    teleportBehindWall(): void {
        this.teleportAttempts += 1;
        const dest: Vec2 = { x: 720, y: 250 }; // Right behind the wall near Vasily

        if (!this.serverAuth) {
            // Client Authority: server accepts teleport!
            this.vasiaClientPos = { ...dest };
            this.vasiaServerPos = { ...dest };
            this.lastNarrative = `<b style="color:#ef5350">ЧИТ СРАБОТАЛ:</b> Вася нажал «Телепорт за стену» — сервер доверяет координатам и моментально перенёс Васю прямо к флагу!`;
        } else {
            // Server Authority: server rejects the leap!
            this.rubberBandEvents += 1;
            this.rubberSnapLine = {
                from: { ...dest },
                to: { ...this.vasiaServerPos },
                age: 0,
            };
            this.vasiaClientPos = { ...this.vasiaServerPos };
            this.lastNarrative = `<b style="color:#6fd48a">ЗАЩИТА СЕРВЕРА:</b> Вася попытался телепортироваться за стену. Сервер проверил валидность перемещения ($V > V_{max}$, пересечение со стеной) и вернул клиента назад.`;
        }
    }

    /** Honest run through the doorway */
    runThroughDoor(): void {
        this.vasiaClientPos = { x: 460, y: 470 }; // Inside doorway
        this.vasiaServerPos = { x: 460, y: 470 };
        this.lastNarrative = `Вася честно идёт через открытую дверь в стене (y: 420..520).`;
    }

    private handlePointerClick(target: Vec2): void {
        if (!this.serverAuth) {
            // In Client Authority, clicking anywhere teleports or walks directly through walls
            this.vasiaClientPos = { ...target };
            this.vasiaServerPos = { ...target };
            this.lastNarrative = `Клик переместил клиента в (${target.x.toFixed(0)}, ${target.y.toFixed(0)}). Сервер принял без проверки.`;
        } else {
            // In Server Authority, check if ray hits wall
            if (pathCrossesAnyWall(this.vasiaServerPos, target)) {
                this.rubberBandEvents += 1;
                this.rubberSnapLine = { from: { ...target }, to: { ...this.vasiaServerPos }, age: 0 };
                this.lastNarrative = `<b style="color:#6fd48a">Сервер заблокировал клик сквозь стену!</b> Используй проход внизу.`;
            } else {
                this.vasiaClientPos = { ...target };
                this.vasiaServerPos = { ...target };
            }
        }
    }

    /* ── Top-Down Rendering ── */

    private render(): void {
        this.gfx.clear();

        // 1. Arena Floor with Grid
        this.gfx.fillStyle(0x181c24, 1);
        this.gfx.fillRect(0, 0, W, H);

        this.gfx.lineStyle(1, 0x272f3e, 0.4);
        for (let x = 0; x < W; x += 50) this.gfx.lineBetween(x, 0, x, H);
        for (let y = 0; y < H; y += 50) this.gfx.lineBetween(0, y, W, y);

        // Zone labels on the floor
        this.gfx.lineStyle(2, 0x333f52, 0.5);
        this.gfx.strokeRect(15, 15, W - 30, H - 30);

        // 2. Fortress Walls (Dividing the arena)
        for (const w of FORTRESS_WALLS) {
            this.gfx.fillStyle(WALL_COLOR, 1);
            this.gfx.fillRect(w.x, w.y, w.w, w.h);
            this.gfx.lineStyle(2, WALL_BORDER_COLOR, 1);
            this.gfx.strokeRect(w.x, w.y, w.w, w.h);

            // Brick pattern accents
            this.gfx.lineStyle(1, 0x222a38, 0.6);
            for (let y = w.y + 20; y < w.y + w.h; y += 30) {
                this.gfx.lineBetween(w.x, y, w.x + w.w, y);
            }
        }

        // Doorway indicator label
        this.gfx.lineStyle(1, 0x6fd48a, 0.3);
        this.gfx.strokeRect(440, 420, 40, 100);

        // 3. Goal / Flag Base (Right side)
        this.gfx.fillStyle(FLAG_COLOR, 0.15);
        this.gfx.fillCircle(this.flagPos.x, this.flagPos.y, 40);
        this.gfx.lineStyle(2, FLAG_COLOR, 0.8);
        this.gfx.strokeCircle(this.flagPos.x, this.flagPos.y, 40);

        // Draw Flagpole & Pennant
        this.gfx.lineStyle(3, 0xffffff, 1);
        this.gfx.lineBetween(this.flagPos.x - 10, this.flagPos.y + 15, this.flagPos.x - 10, this.flagPos.y - 20);
        this.gfx.fillStyle(this.flagStolen ? 0x8b93a3 : FLAG_COLOR, 1);
        this.gfx.fillTriangle(
            this.flagPos.x - 10, this.flagPos.y - 20,
            this.flagPos.x + 12, this.flagPos.y - 12,
            this.flagPos.x - 10, this.flagPos.y - 4
        );

        // 4. Honest Defender (Василий)
        this.gfx.fillStyle(VASILY_COLOR, 1);
        this.gfx.fillCircle(this.vasilyPos.x, this.vasilyPos.y, AGENT_RADIUS);
        this.gfx.lineStyle(2, 0xffffff, 0.9);
        this.gfx.strokeCircle(this.vasilyPos.x, this.vasilyPos.y, AGENT_RADIUS);
        // Defender shield visor
        this.gfx.lineStyle(3, 0x1b1f27, 1);
        this.gfx.lineBetween(this.vasilyPos.x - 10, this.vasilyPos.y - 4, this.vasilyPos.x - 10, this.vasilyPos.y + 4);

        // 5. Server Truth Ghost (Where server thinks Vasya is)
        const gap = Math.hypot(this.vasiaClientPos.x - this.vasiaServerPos.x, this.vasiaClientPos.y - this.vasiaServerPos.y);
        if (gap > 4) {
            // Draw ghost position
            this.gfx.fillStyle(VASIA_SERVER_COLOR, 0.35);
            this.gfx.fillCircle(this.vasiaServerPos.x, this.vasiaServerPos.y, AGENT_RADIUS);
            this.gfx.lineStyle(2, VASIA_SERVER_COLOR, 0.7);
            this.gfx.strokeCircle(this.vasiaServerPos.x, this.vasiaServerPos.y, AGENT_RADIUS);

            // Elastic connector between client and server
            this.gfx.lineStyle(2, RUBBER_COLOR, 0.6);
            this.gfx.lineBetween(this.vasiaClientPos.x, this.vasiaClientPos.y, this.vasiaServerPos.x, this.vasiaServerPos.y);
        }

        // 6. Vasya (Cheater Client Position)
        this.gfx.fillStyle(VASIA_CLIENT_COLOR, 1);
        this.gfx.fillCircle(this.vasiaClientPos.x, this.vasiaClientPos.y, AGENT_RADIUS);
        this.gfx.lineStyle(2, 0xffffff, 0.9);
        this.gfx.strokeCircle(this.vasiaClientPos.x, this.vasiaClientPos.y, AGENT_RADIUS);

        // Sight arrow
        this.gfx.lineStyle(2, 0x1b1f27, 1);
        this.gfx.lineBetween(this.vasiaClientPos.x, this.vasiaClientPos.y, this.vasiaClientPos.x + 12, this.vasiaClientPos.y);

        // 7. Rubber-band Snap Flash
        if (this.rubberSnapLine) {
            const alpha = 1 - this.rubberSnapLine.age / 0.6;
            this.gfx.lineStyle(4, RUBBER_COLOR, alpha);
            this.gfx.lineBetween(this.rubberSnapLine.from.x, this.rubberSnapLine.from.y, this.rubberSnapLine.to.x, this.rubberSnapLine.to.y);
            this.gfx.fillStyle(RUBBER_COLOR, alpha * 0.5);
            this.gfx.fillCircle(this.rubberSnapLine.from.x, this.rubberSnapLine.from.y, 25 * (1 - alpha));
        }

        // 8. On-screen Status Badges (HUD)
        // Top Left: Network Mode
        this.gfx.fillStyle(0x181c24, 0.85);
        this.gfx.fillRoundedRect(25, 25, 380, 48, 6);
        this.gfx.lineStyle(2, this.serverAuth ? 0x6fd48a : 0xef5350, 0.8);
        this.gfx.strokeRoundedRect(25, 25, 380, 48, 6);

        // Top Right: Target Flag Status
        this.gfx.fillStyle(0x181c24, 0.85);
        this.gfx.fillRoundedRect(W - 325, 25, 300, 48, 6);
        this.gfx.lineStyle(2, this.flagStolen ? 0xef5350 : 0x6fd48a, 0.8);
        this.gfx.strokeRoundedRect(W - 325, 25, 300, 48, 6);
    }
}

/* ── DOM Controls & Explanation ── */

function buildControls(root: HTMLElement, scene: ClientAuthorityScene): void {
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "Client Authority Flaw";
    heading.style.margin = "0 0 6px";
    root.appendChild(heading);

    buildHowTo(
        root,
        "<b>В чём суть проблемы:</b><br>" +
        "• В <b>Client-Authority</b> клиент шлёт готовые координаты <code>{ x, y }</code>. Сервер не считает физику и верит всему: читер нажимает кнопку и оказывается за стеной!<br>" +
        "• В <b>Server-Authority</b> клиент шлёт только инпут <code>{ клавиша D }</code>. Сервер сам двигает персонажа и проверяет стены. При попытке подделать позицию сервер отбрасывает читера обратно (<b>Rubber-band</b>)."
    );

    buildLegend(root, [
        { color: "#ffca28", label: "Вася (клиент читера)", shape: "dot" },
        { color: "#8b93a3", label: "Истина сервера (призрак)", shape: "ring" },
        { color: "#6fd48a", label: "Василий (честный охранник)", shape: "dot" },
        { color: "#ff5252", label: "Целевой флаг (🚩)", shape: "dot" },
        { color: "#333f52", label: "Монолитная стена (с дверью внизу)", shape: "dot" },
        { color: "#ef5350", label: "Откат сервера (Rubber-band)", shape: "line" },
    ]);

    const setNarrative = buildNarrative(
        root,
        "Выбери режим сервера и нажми <b>«Телепорт за стену»</b> или включи <b>Авто-бег</b>."
    );

    // Network Architecture Selector
    const modeBox = document.createElement("div");
    modeBox.style.background = "#1b1f27";
    modeBox.style.border = "1px solid #2a2f3a";
    modeBox.style.borderRadius = "6px";
    modeBox.style.padding = "10px";
    modeBox.style.margin = "0 0 12px";

    const modeTitle = document.createElement("div");
    modeTitle.textContent = "Сетевая модель игры:";
    modeTitle.style.fontSize = "12px";
    modeTitle.style.fontWeight = "bold";
    modeTitle.style.marginBottom = "8px";
    modeBox.appendChild(modeTitle);

    const labelClient = document.createElement("label");
    labelClient.style.display = "flex";
    labelClient.style.alignItems = "center";
    labelClient.style.gap = "8px";
    labelClient.style.cursor = "pointer";
    labelClient.style.fontSize = "12px";
    labelClient.style.color = "#ef5350";
    labelClient.style.marginBottom = "6px";

    const radioClient = document.createElement("input");
    radioClient.type = "radio";
    radioClient.name = "authMode";
    radioClient.checked = !scene.serverAuth;
    radioClient.onchange = () => {
        scene.serverAuth = false;
        scene.reset();
        updateUI();
    };
    labelClient.append(radioClient, document.createTextNode("🔴 Client Authority (Сервер слепо верит координатам)"));
    modeBox.appendChild(labelClient);

    const labelServer = document.createElement("label");
    labelServer.style.display = "flex";
    labelServer.style.alignItems = "center";
    labelServer.style.gap = "8px";
    labelServer.style.cursor = "pointer";
    labelServer.style.fontSize = "12px";
    labelServer.style.color = "#6fd48a";

    const radioServer = document.createElement("input");
    radioServer.type = "radio";
    radioServer.name = "authMode";
    radioServer.checked = scene.serverAuth;
    radioServer.onchange = () => {
        scene.serverAuth = true;
        scene.reset();
        updateUI();
    };
    labelServer.append(radioServer, document.createTextNode("🟢 Server Authority (Сервер проверяет инпут и стены)"));
    modeBox.appendChild(labelServer);

    root.appendChild(modeBox);

    // Cheat Action Buttons
    const btnSection = document.createElement("div");
    btnSection.style.display = "flex";
    btnSection.style.flexDirection = "column";
    btnSection.style.gap = "6px";
    btnSection.style.margin = "0 0 14px";

    const btnTeleport = document.createElement("button");
    btnTeleport.className = "btn danger";
    btnTeleport.textContent = "⚡ Эксплойт: Телепорт сквозь стену к флагу";
    btnTeleport.onclick = () => {
        scene.teleportBehindWall();
        updateUI();
    };
    btnSection.appendChild(btnTeleport);

    const btnDoor = document.createElement("button");
    btnDoor.className = "btn";
    btnDoor.textContent = "🚪 Честный путь: Пройти через нижнюю дверь";
    btnDoor.onclick = () => {
        scene.runThroughDoor();
        updateUI();
    };
    btnSection.appendChild(btnDoor);

    root.appendChild(btnSection);

    // Sliders & Toggles Box
    const controlsBox = document.createElement("div");
    controlsBox.style.display = "flex";
    controlsBox.style.flexDirection = "column";
    controlsBox.style.gap = "8px";
    controlsBox.style.margin = "0 0 14px";

    // Auto-run checkbox
    const autoLabel = document.createElement("label");
    autoLabel.style.display = "flex";
    autoLabel.style.alignItems = "center";
    autoLabel.style.gap = "8px";
    autoLabel.style.fontSize = "12px";
    autoLabel.style.color = "#c5cad3";
    autoLabel.style.cursor = "pointer";
    const autoCheck = document.createElement("input");
    autoCheck.type = "checkbox";
    autoCheck.checked = scene.autoRun;
    autoCheck.onchange = () => {
        scene.autoRun = autoCheck.checked;
    };
    autoLabel.append(autoCheck, document.createTextNode("🚶 Авто-бег читера напрямую к флагу (Auto-patrol)"));
    controlsBox.appendChild(autoLabel);

    // Speedhack slider
    const speedRow = document.createElement("div");
    const speedLabel = document.createElement("div");
    speedLabel.style.fontSize = "12px";
    speedLabel.style.color = "#c5cad3";
    speedLabel.textContent = `Множитель читерской скорости: ×${scene.speedhackMultiplier.toFixed(1)}`;
    const speedSlider = document.createElement("input");
    speedSlider.type = "range";
    speedSlider.min = "1.0";
    speedSlider.max = "6.0";
    speedSlider.step = "0.5";
    speedSlider.value = String(scene.speedhackMultiplier);
    speedSlider.oninput = () => {
        scene.speedhackMultiplier = Number(speedSlider.value);
        speedLabel.textContent = `Множитель читерской скорости: ×${scene.speedhackMultiplier.toFixed(1)}`;
    };
    speedRow.append(speedLabel, speedSlider);
    controlsBox.appendChild(speedRow);

    // Server Tolerance slider
    const tolRow = document.createElement("div");
    const tolLabel = document.createElement("div");
    tolLabel.style.fontSize = "12px";
    tolLabel.style.color = "#c5cad3";
    tolLabel.textContent = `Допуск отката сервера (Rubber threshold): ${scene.serverTolerance} px`;
    const tolSlider = document.createElement("input");
    tolSlider.type = "range";
    tolSlider.min = "20";
    tolSlider.max = "150";
    tolSlider.step = "5";
    tolSlider.value = String(scene.serverTolerance);
    tolSlider.oninput = () => {
        scene.serverTolerance = Number(tolSlider.value);
        tolLabel.textContent = `Допуск отката сервера (Rubber threshold): ${scene.serverTolerance} px`;
    };
    tolRow.append(tolLabel, tolSlider);
    controlsBox.appendChild(tolRow);

    root.appendChild(controlsBox);

    // Live Metrics panel
    const metricsBox = document.createElement("div");
    metricsBox.style.background = "#181c24";
    metricsBox.style.border = "1px solid #2a2f3a";
    metricsBox.style.borderRadius = "6px";
    metricsBox.style.padding = "10px";
    metricsBox.style.fontSize = "12px";
    metricsBox.style.lineHeight = "1.6";
    metricsBox.style.margin = "0 0 12px";
    root.appendChild(metricsBox);

    // Reset button
    const btnReset = document.createElement("button");
    btnReset.className = "btn";
    btnReset.textContent = "Сброс сценария (R)";
    btnReset.onclick = () => {
        scene.reset();
        updateUI();
    };
    root.appendChild(btnReset);

    function updateUI(): void {
        const gap = Math.hypot(scene.vasiaClientPos.x - scene.vasiaServerPos.x, scene.vasiaClientPos.y - scene.vasiaServerPos.y);
        const flagStatus = scene.flagStolen
            ? `<span style="color:#ef5350;font-weight:bold">🚨 УКРАДЕН ВАСЕЙ!</span>`
            : `<span style="color:#6fd48a">В безопасности</span>`;

        metricsBox.innerHTML =
            `<div><b>Статус флага:</b> ${flagStatus}</div>` +
            `<div><b>Разрыв клиент↔сервер:</b> <span style="color:${gap > scene.serverTolerance ? "#ef5350" : "#6fd48a"}">${gap.toFixed(0)} px</span></div>` +
            `<div><b>Откатов (Rubber-bands):</b> <span style="color:#ef5350;font-weight:bold">${scene.rubberBandEvents}</span></div>` +
            `<div><b>Попыток телепорта:</b> ${scene.teleportAttempts}</div>`;

        if (scene.lastNarrative) {
            setNarrative(scene.lastNarrative);
        }
    }

    updateUI();
    setInterval(updateUI, 200);
}

/* ── Bootstrap ── */

const gameRoot = document.getElementById("game-root");
const controlRoot = document.getElementById("control-panel");
if (!gameRoot || !controlRoot) throw new Error("cheat-client-authority: expected #game-root and #control-panel");

const scene = new ClientAuthorityScene();
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
