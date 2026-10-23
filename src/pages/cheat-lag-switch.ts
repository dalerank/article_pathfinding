import Phaser from "phaser";
import type { Vec2 } from "@/simulation/Vec2";
import { buildHowTo, buildLegend, buildNarrative } from "@/rendering/ExplainerPanel";
import { ScrollingGraph, buildGraphRow } from "@/rendering/ScrollingGraph";

const W = 900;
const H = 600;
const AGENT_RADIUS = 14;
const MOVE_SPEED = 160;
const FIXED_DT = 1 / 30;
const GRAPH_SAMPLES = 150;

const VASIA_COLOR = 0xffca28; // Cheater
const PETYA_COLOR = 0x4fc3f7; // Honest player holding angle
const SERVER_GHOST_COLOR = 0x8b93a3;
const WALL_COLOR = 0x3a455a;
const BUFFER_COLOR = 0xef5350;

interface Packet {
    pos: Vec2;
    sent: number;
}

interface ShotRay {
    from: Vec2;
    to: Vec2;
    hit: boolean;
    accepted: boolean;
    age: number;
}

class LagSwitchScene extends Phaser.Scene {
    lagSwitchOn = false;
    rewindCapMs = 200; // max lag comp rewind window
    petyaPingMs = 50;
    autoPeek = false;
    paused = false;

    // Characters
    vasiaClientPos: Vec2 = { x: 260, y: 300 }; // Behind cover
    vasiaServerPos: Vec2 = { x: 260, y: 300 }; // Where server thinks Vasya is
    petyaPos: Vec2 = { x: 700, y: 300 };       // Holding angle

    // Cover Wall: block LOS until player moves past y > 380 or x > 440
    wall = { x: 400, y: 0, w: 40, h: 360 };

    // Networking
    packetBuffer: Packet[] = [];
    currentDesyncMs = 0;
    lagDuration = 0;

    // Stats
    totalShots = 0;
    shotsAccepted = 0;
    shotsRejected = 0;
    lastNarrative = "";

    shots: ShotRay[] = [];
    graph: ScrollingGraph | null = null;

    private elapsed = 0;
    private tickAcc = 0;
    private peekTimer = 0;
    private peekDir = 1;
    private gfx!: Phaser.GameObjects.Graphics;
    private keys!: { w: Phaser.Input.Keyboard.Key; a: Phaser.Input.Keyboard.Key; s: Phaser.Input.Keyboard.Key; d: Phaser.Input.Keyboard.Key };

    constructor() {
        super("cheat-lag-switch");
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
        this.input.keyboard?.on("keydown-SPACE", () => this.shoot());
        this.input.keyboard?.on("keydown-R", () => this.reset());
        this.reset();
    }

    reset(): void {
        this.vasiaClientPos = { x: 260, y: 250 };
        this.vasiaServerPos = { x: 260, y: 250 };
        this.petyaPos = { x: 700, y: 250 };
        this.packetBuffer = [];
        this.currentDesyncMs = 0;
        this.lagDuration = 0;
        this.lagSwitchOn = false;
        this.autoPeek = false;
        this.totalShots = 0;
        this.shotsAccepted = 0;
        this.shotsRejected = 0;
        this.lastNarrative = "";
        this.shots = [];
        this.graph?.clear();
    }

    update(_time: number, deltaMs: number): void {
        if (this.paused) {
            this.render();
            return;
        }
        const dt = deltaMs / 1000;
        this.elapsed += dt;

        // Auto-peek logic
        let dx = 0;
        let dy = 0;

        if (this.autoPeek) {
            this.peekTimer += dt * this.peekDir;
            if (this.peekTimer > 1.8) {
                this.peekDir = -1;
            } else if (this.peekTimer < 0) {
                this.peekDir = 1;
            }
            // Peeks around the wall corner (down and right)
            const targetX = this.peekTimer > 0.8 ? 500 : 260;
            const targetY = this.peekTimer > 0.8 ? 420 : 250;
            const distToTarget = Math.hypot(targetX - this.vasiaClientPos.x, targetY - this.vasiaClientPos.y);
            if (distToTarget > 4) {
                dx = (targetX - this.vasiaClientPos.x) / distToTarget;
                dy = (targetY - this.vasiaClientPos.y) / distToTarget;
            }
        } else {
            // Manual WASD
            if (this.keys.a.isDown) dx -= 1;
            if (this.keys.d.isDown) dx += 1;
            if (this.keys.w.isDown) dy -= 1;
            if (this.keys.s.isDown) dy += 1;
            const len = Math.hypot(dx, dy);
            if (len > 0) {
                dx /= len;
                dy /= len;
            }
        }

        // Move Vasya on his client
        this.vasiaClientPos.x += dx * MOVE_SPEED * dt;
        this.vasiaClientPos.y += dy * MOVE_SPEED * dt;

        // Wall collision for Vasya
        if (
            this.vasiaClientPos.x + AGENT_RADIUS > this.wall.x &&
            this.vasiaClientPos.x - AGENT_RADIUS < this.wall.x + this.wall.w &&
            this.vasiaClientPos.y + AGENT_RADIUS > this.wall.y &&
            this.vasiaClientPos.y - AGENT_RADIUS < this.wall.y + this.wall.h
        ) {
            this.vasiaClientPos.x = this.wall.x - AGENT_RADIUS;
        }

        // Clamp in arena
        this.vasiaClientPos.x = Phaser.Math.Clamp(this.vasiaClientPos.x, 30, W - 30);
        this.vasiaClientPos.y = Phaser.Math.Clamp(this.vasiaClientPos.y, 30, H - 30);

        // Network packet generation
        this.tickAcc += dt;
        while (this.tickAcc >= FIXED_DT) {
            this.tickAcc -= FIXED_DT;
            const packet: Packet = { pos: { ...this.vasiaClientPos }, sent: this.elapsed };

            if (this.lagSwitchOn) {
                // DROP / BUFFER OUTGOING PACKETS (Lag switch active)
                this.packetBuffer.push(packet);
                this.lagDuration += FIXED_DT;
                this.currentDesyncMs = this.lagDuration * 1000;
            } else {
                // NORMAL: Packets reach server
                if (this.packetBuffer.length > 0) {
                    // FLUSH: Lag switch released! Burst of delayed packets arrives at server
                    this.processFlushedPackets();
                    this.packetBuffer = [];
                }
                this.vasiaServerPos = { ...this.vasiaClientPos };
                this.currentDesyncMs = 0;
                this.lagDuration = 0;
            }
        }

        // Update shot trails
        for (const s of this.shots) s.age += dt;
        this.shots = this.shots.filter((s) => s.age < 1.2);

        this.graph?.push(this.currentDesyncMs, Math.max(this.currentDesyncMs, 1000));
        this.render();
    }

    private processFlushedPackets(): void {
        const desyncTimeMs = this.lagDuration * 1000;
        if (desyncTimeMs > this.rewindCapMs) {
            this.lastNarrative = `<b style="color:#6fd48a">REWIND CAP ЗАЩИТИЛ:</b> Читер включил лаг-свитч на ${desyncTimeMs.toFixed(0)}мс. Сервер ограничил откат лимитом ${this.rewindCapMs}мс и отбросил устаревшие пакеты.`;
        } else {
            this.lastNarrative = `<b style="color:#ffca28">Пакеты доставлены:</b> Задержка была ${desyncTimeMs.toFixed(0)}мс (в пределах лимита ${this.rewindCapMs}мс).`;
        }
        this.vasiaServerPos = { ...this.vasiaClientPos };
    }

    /** Vasya shoots at Petya */
    shoot(): void {
        this.totalShots += 1;
        const vasiaClientHasLOS = !this.lineHitsWall(this.vasiaClientPos, this.petyaPos);
        const vasiaServerHasLOS = !this.lineHitsWall(this.vasiaServerPos, this.petyaPos);

        const desyncMs = this.lagDuration * 1000;

        let accepted = false;
        let hit = false;

        if (this.rewindCapMs > 0 && desyncMs > this.rewindCapMs) {
            // REWIND CAP EXCEEDED: Server refuses to compensate shot from the distant past!
            accepted = false;
            hit = false;
            this.shotsRejected += 1;
            this.lastNarrative = `<b style="color:#6fd48a">ВЫСТРЕЛ ОТКЛОНЁН СЕРВЕРОМ:</b> Задержка пакета выстрела (${desyncMs.toFixed(0)}мс) превысила Max Rewind Cap (${this.rewindCapMs}мс). Сервер не стал перематывать время! Петя спасён.`;
        } else {
            // SERVER EVALUATES SHOT:
            if (!vasiaServerHasLOS && vasiaClientHasLOS && this.lagSwitchOn) {
                // Cheater saw Petya on his screen, but on SERVER Vasya is STILL BEHIND THE WALL!
                if (this.rewindCapMs === 0 || desyncMs <= this.rewindCapMs) {
                    // Naive unlimited rewind: Server blindly rolls back and accepts!
                    accepted = true;
                    hit = true;
                    this.shotsAccepted += 1;
                    this.lastNarrative = `<b style="color:#ef5350">УЯЗВИМОСТЬ (Без лимита отката):</b> Читер вышел под лаг-свитчем, убил Петю и отпустил сеть. Петя умер, даже не увидев Васю из-за стены!`;
                }
            } else if (vasiaClientHasLOS) {
                accepted = true;
                hit = true;
                this.shotsAccepted += 1;
                this.lastNarrative = `<b style="color:#6fd48a">Попадание:</b> Честный выстрел с прямой видимостью.`;
            } else {
                accepted = true;
                hit = false;
                this.lastNarrative = `<b style="color:#8b93a3">Мимо:</b> Выстрел попал в стену укрытия.`;
            }
        }

        this.shots.push({
            from: { ...this.vasiaClientPos },
            to: hit ? { ...this.petyaPos } : { x: this.wall.x, y: this.vasiaClientPos.y },
            hit,
            accepted,
            age: 0,
        });
    }

    private lineHitsWall(a: Vec2, b: Vec2): boolean {
        const left = this.wall.x;
        const right = this.wall.x + this.wall.w;
        const top = this.wall.y;
        const bottom = this.wall.y + this.wall.h;

        // Bounding box segment intersect
        const minX = Math.min(a.x, b.x);
        const maxX = Math.max(a.x, b.x);
        if (maxX < left || minX > right) return false;

        // Check intersection with vertical line of wall
        const t = (left - a.x) / (b.x - a.x);
        if (t >= 0 && t <= 1) {
            const hitY = a.y + (b.y - a.y) * t;
            if (hitY >= top && hitY <= bottom) return true;
        }
        return false;
    }

    /* ── Top-Down Rendering ── */

    private render(): void {
        this.gfx.clear();

        // Floor grid
        this.gfx.fillStyle(0x181c24, 1);
        this.gfx.fillRect(0, 0, W, H);
        this.gfx.lineStyle(1, 0x252e3d, 0.4);
        for (let x = 0; x < W; x += 50) this.gfx.lineBetween(x, 0, x, H);
        for (let y = 0; y < H; y += 50) this.gfx.lineBetween(0, y, W, y);

        // Arena border
        this.gfx.lineStyle(3, 0x3a455a, 1);
        this.gfx.strokeRect(15, 15, W - 30, H - 30);

        // Solid Cover Wall
        this.gfx.fillStyle(WALL_COLOR, 1);
        this.gfx.fillRect(this.wall.x, this.wall.y, this.wall.w, this.wall.h);
        this.gfx.lineStyle(2, 0x5a6a85, 1);
        this.gfx.strokeRect(this.wall.x, this.wall.y, this.wall.w, this.wall.h);

        // Corner peek angle line (Petya's Line of Sight across the corner)
        this.gfx.lineStyle(1, 0xef5350, 0.25);
        this.gfx.lineBetween(this.petyaPos.x, this.petyaPos.y, this.wall.x + this.wall.w, this.wall.y + this.wall.h);

        // Server Ghost Position of Vasya (Where the server & Petya think Vasya is)
        const gap = Math.hypot(this.vasiaClientPos.x - this.vasiaServerPos.x, this.vasiaClientPos.y - this.vasiaServerPos.y);
        if (gap > 6) {
            this.gfx.fillStyle(SERVER_GHOST_COLOR, 0.4);
            this.gfx.fillCircle(this.vasiaServerPos.x, this.vasiaServerPos.y, AGENT_RADIUS);
            this.gfx.lineStyle(1, SERVER_GHOST_COLOR, 0.6);
            this.gfx.strokeCircle(this.vasiaServerPos.x, this.vasiaServerPos.y, AGENT_RADIUS);
            this.gfx.lineBetween(this.vasiaClientPos.x, this.vasiaClientPos.y, this.vasiaServerPos.x, this.vasiaServerPos.y);
        }

        // Petya (Honest player holding angle)
        this.gfx.fillStyle(PETYA_COLOR, 1);
        this.gfx.fillCircle(this.petyaPos.x, this.petyaPos.y, AGENT_RADIUS);
        this.gfx.lineStyle(2, 0xffffff, 0.8);
        this.gfx.strokeCircle(this.petyaPos.x, this.petyaPos.y, AGENT_RADIUS);

        // Vasya (Client position)
        this.gfx.fillStyle(VASIA_COLOR, 1);
        this.gfx.fillCircle(this.vasiaClientPos.x, this.vasiaClientPos.y, AGENT_RADIUS);
        this.gfx.lineStyle(2, 0xffffff, 0.8);
        this.gfx.strokeCircle(this.vasiaClientPos.x, this.vasiaClientPos.y, AGENT_RADIUS);

        // Lag Switch Active Aura
        if (this.lagSwitchOn) {
            const pulse = Math.sin(this.elapsed * 10) * 4;
            this.gfx.lineStyle(2, BUFFER_COLOR, 0.8);
            this.gfx.strokeCircle(this.vasiaClientPos.x, this.vasiaClientPos.y, AGENT_RADIUS + 8 + pulse);
        }

        // Render Shots
        for (const s of this.shots) {
            const alpha = 1 - s.age / 1.2;
            const color = s.accepted && s.hit ? 0xffeb3b : 0xef5350;
            this.gfx.lineStyle(2, color, alpha);
            this.gfx.lineBetween(s.from.x, s.from.y, s.to.x, s.to.y);
            this.gfx.fillStyle(color, alpha);
            this.gfx.fillCircle(s.to.x, s.to.y, 6);
        }
    }
}

/* ── DOM Controls ── */

function buildControls(root: HTMLElement, scene: LagSwitchScene): void {
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "Lag Switch & Desync";
    heading.style.margin = "0 0 6px";
    root.appendChild(heading);

    buildHowTo(
        root,
        "<b>Тактический сценарий (Corner Peek):</b><br>" +
        "1. Вася прячется за стеной (вне видимости Пети).<br>" +
        "2. Включи <b>«Lag Switch»</b>: Вася выходит из укрытия на своём экране, но для сервера он всё ещё за стеной!<br>" +
        "3. Нажми <b>«Выстрелить»</b> (или Пробел).<br>" +
        "4. Выключи Lag Switch: сервер проверяет <b>Max Rewind Cap</b> (лимит отката времени). Сравни поведение при лимите 200мс и без лимита!"
    );

    buildLegend(root, [
        { color: "#ffca28", label: "Вася (клиент читера)", shape: "dot" },
        { color: "#8b93a3", label: "Вася (позиция на сервере)", shape: "ring" },
        { color: "#4fc3f7", label: "Петя (честный игрок)", shape: "dot" },
        { color: "#3a455a", label: "Стена укрытия", shape: "dot" },
        { color: "#ef5350", label: "Лаг-свитч активен", shape: "ring" },
    ]);

    const setNarrative = buildNarrative(
        root,
        "Включи Lag Switch, выйди из-за угла и выстрели в Петю."
    );

    // Primary Action Buttons
    const btnSection = document.createElement("div");
    btnSection.style.display = "flex";
    btnSection.style.flexDirection = "column";
    btnSection.style.gap = "6px";
    btnSection.style.margin = "0 0 14px";

    const btnLagSwitch = document.createElement("button");
    btnLagSwitch.className = "btn danger";
    btnLagSwitch.textContent = "⚡ Включить Lag Switch (Заморозить сеть)";
    btnLagSwitch.onclick = () => {
        scene.lagSwitchOn = !scene.lagSwitchOn;
        btnLagSwitch.textContent = scene.lagSwitchOn
            ? "🛑 Выключить Lag Switch (Отправить пачку пакетов)"
            : "⚡ Включить Lag Switch (Заморозить сеть)";
        btnLagSwitch.style.background = scene.lagSwitchOn ? "#ef5350" : "";
        updateUI();
    };
    btnSection.appendChild(btnLagSwitch);

    const btnShoot = document.createElement("button");
    btnShoot.className = "btn";
    btnShoot.textContent = "🎯 Выстрелить в Петю (Space)";
    btnShoot.onclick = () => {
        scene.shoot();
        updateUI();
    };
    btnSection.appendChild(btnShoot);

    const btnAutoPeek = document.createElement("button");
    btnAutoPeek.className = "btn";
    btnAutoPeek.textContent = "🚶 Авто-выход из-за угла (Auto-Peek)";
    btnAutoPeek.onclick = () => {
        scene.autoPeek = !scene.autoPeek;
        btnAutoPeek.textContent = scene.autoPeek
            ? "🛑 Остановить авто-выход"
            : "🚶 Авто-выход из-за угла (Auto-Peek)";
        updateUI();
    };
    btnSection.appendChild(btnAutoPeek);

    root.appendChild(btnSection);

    // Sliders & Settings
    const controlsBox = document.createElement("div");
    controlsBox.style.display = "flex";
    controlsBox.style.flexDirection = "column";
    controlsBox.style.gap = "8px";
    controlsBox.style.margin = "0 0 14px";

    // Rewind Cap Slider
    const capRow = document.createElement("div");
    const capLabel = document.createElement("div");
    capLabel.style.fontSize = "12px";
    capLabel.style.color = "#c5cad3";
    capLabel.textContent = `Server Max Rewind Cap: ${scene.rewindCapMs === 0 ? "Без лимита (Уязвимо)" : scene.rewindCapMs + " мс"}`;
    const capSlider = document.createElement("input");
    capSlider.type = "range";
    capSlider.min = "0";
    capSlider.max = "1000";
    capSlider.step = "50";
    capSlider.value = String(scene.rewindCapMs);
    capSlider.oninput = () => {
        scene.rewindCapMs = Number(capSlider.value);
        capLabel.textContent = `Server Max Rewind Cap: ${scene.rewindCapMs === 0 ? "Без лимита (Уязвимо)" : scene.rewindCapMs + " мс"}`;
    };
    capRow.append(capLabel, capSlider);
    controlsBox.appendChild(capRow);

    root.appendChild(controlsBox);

    // Metrics panel
    const metricsBox = document.createElement("div");
    metricsBox.style.background = "#181c24";
    metricsBox.style.border = "1px solid #2a2f3a";
    metricsBox.style.borderRadius = "6px";
    metricsBox.style.padding = "10px";
    metricsBox.style.fontSize = "12px";
    metricsBox.style.lineHeight = "1.6";
    metricsBox.style.margin = "0 0 12px";
    root.appendChild(metricsBox);

    // Graph
    scene.graph = new ScrollingGraph(
        buildGraphRow(root, "Рассинхрон сети (Desync Duration, ms)", "#ef5350", GRAPH_SAMPLES),
        GRAPH_SAMPLES,
        "#ef5350"
    );

    // Reset button
    const btnReset = document.createElement("button");
    btnReset.className = "btn";
    btnReset.textContent = "Сброс сценария (R)";
    btnReset.onclick = () => {
        scene.reset();
        btnLagSwitch.textContent = "⚡ Включить Lag Switch (Заморозить сеть)";
        btnLagSwitch.style.background = "";
        btnAutoPeek.textContent = "🚶 Авто-выход из-за угла (Auto-Peek)";
        updateUI();
    };
    root.appendChild(btnReset);

    function updateUI(): void {
        metricsBox.innerHTML =
            `<div><b>Текущий рассинхрон:</b> <span style="color:${scene.currentDesyncMs > scene.rewindCapMs ? "#ef5350" : "#6fd48a"}">${scene.currentDesyncMs.toFixed(0)} мс</span> (буфер пакетов: ${scene.packetBuffer.length})</div>` +
            `<div><b>Max Rewind Cap:</b> ${scene.rewindCapMs === 0 ? "Отключен" : scene.rewindCapMs + " мс"}</div>` +
            `<div><b>Всего выстрелов:</b> ${scene.totalShots} | <b>Принято:</b> ${scene.shotsAccepted} | <b>Отклонено:</b> ${scene.shotsRejected}</div>`;
        if (scene.lastNarrative) {
            setNarrative(scene.lastNarrative);
        }
    }

    updateUI();
    setInterval(updateUI, 250);
}

/* ── Bootstrap ── */

const game = new Phaser.Game({
    type: Phaser.AUTO,
    width: W,
    height: H,
    parent: "game-root",
    backgroundColor: "#14181f",
    scene: LagSwitchScene,
});

const controlsRoot = document.getElementById("control-panel");
if (controlsRoot) {
    const scene = game.scene.getScene("cheat-lag-switch") as LagSwitchScene;
    if (scene) {
        buildControls(controlsRoot, scene);
    } else {
        game.events.once("ready", () => {
            const readyScene = game.scene.getScene("cheat-lag-switch") as LagSwitchScene;
            buildControls(controlsRoot, readyScene);
        });
    }
}
