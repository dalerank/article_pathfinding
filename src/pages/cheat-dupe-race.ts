import Phaser from "phaser";
import type { Vec2 } from "@/simulation/Vec2";
import { buildHowTo, buildLegend, buildNarrative } from "@/rendering/ExplainerPanel";

const W = 900;
const H = 600;
const AGENT_RADIUS = 18;

const VASYA_COLOR = 0xffca28; // Cheater
const PETYA_COLOR = 0x4fc3f7; // Buyer 1
const DIMA_COLOR = 0x6fd48a;  // Buyer 2
const SWORD_COLOR = 0xffd54f;
const DESK_COLOR = 0x2a3342;
const ALERT_COLOR = 0xef5350;

interface FlyingItem {
    id: number;
    from: Vec2;
    to: Vec2;
    targetName: string;
    progress: number;
    duration: number;
    isDupe: boolean;
}

interface TradeRequest {
    id: number;
    target: "Petya" | "Dima";
    elapsed: number;
    delay: number;
    stage: "db_read" | "db_delay" | "db_write" | "complete" | "rejected";
    rejectionReason?: string;
}

class DupeRaceScene extends Phaser.Scene {
    /** true = Atomic DB Transaction (SELECT FOR UPDATE), false = Naive Check-Then-Act */
    useTransactions = false;
    dbLatencyMs = 400; // ms between check and write
    requestDelayMs = 0; // ms offset between request 1 and request 2
    paused = false;

    // World positions
    vasyaPos: Vec2 = { x: 220, y: 300 };
    petyaPos: Vec2 = { x: 680, y: 190 };
    dimaPos: Vec2 = { x: 680, y: 410 };
    deskPos: Vec2 = { x: 450, y: 300 };

    // Inventory counts
    vasyaHasSword = true;
    petyaHasSword = false;
    dimaHasSword = false;

    // DB lock state (for transaction mode)
    itemLocked = false;

    // Metrics
    totalSwords = 1;
    dupeAttempts = 0;
    successfulDupes = 0;
    rejectedTrades = 0;
    lastNarrative = "";

    private flyingItems: FlyingItem[] = [];
    private activeTrades: TradeRequest[] = [];
    private nextTradeId = 0;
    private gfx!: Phaser.GameObjects.Graphics;

    constructor() {
        super("cheat-dupe-race");
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);
        this.gfx = this.add.graphics();
        this.input.keyboard?.on("keydown-R", () => this.reset());
        this.reset();
    }

    reset(): void {
        this.vasyaHasSword = true;
        this.petyaHasSword = false;
        this.dimaHasSword = false;
        this.totalSwords = 1;
        this.itemLocked = false;
        this.flyingItems = [];
        this.activeTrades = [];
        this.dupeAttempts = 0;
        this.successfulDupes = 0;
        this.rejectedTrades = 0;
        this.lastNarrative = "";
    }

    update(_time: number, deltaMs: number): void {
        if (this.paused) {
            this.render();
            return;
        }
        const dt = deltaMs / 1000;

        // Progress flying item animations
        for (const item of this.flyingItems) {
            item.progress += dt / item.duration;
            if (item.progress >= 1) {
                item.progress = 1;
                if (item.targetName === "Petya") this.petyaHasSword = true;
                if (item.targetName === "Dima") this.dimaHasSword = true;
            }
        }
        this.flyingItems = this.flyingItems.filter((i) => i.progress < 1);

        // Process asynchronous server trade requests (simulating DB latency)
        const dbLatencySec = this.dbLatencyMs / 1000;
        for (const trade of this.activeTrades) {
            if (trade.stage === "complete" || trade.stage === "rejected") continue;

            trade.elapsed += dt;

            // Stage 1: Initial read
            if (trade.stage === "db_read") {
                if (trade.elapsed < trade.delay / 1000) continue; // wait for request skew

                if (this.useTransactions) {
                    // ATOMIC: Check and acquire lock immediately
                    if (!this.vasyaHasSword || this.itemLocked) {
                        trade.stage = "rejected";
                        trade.rejectionReason = "Item locked / already owned";
                        this.rejectedTrades += 1;
                        this.lastNarrative = `<b style="color:#6fd48a">ТРАНЗАКЦИЯ ЗАЩИТИЛА:</b> Запрос к ${trade.target} отклонён: запись <code>item_id</code> заблокирована транзакцией другого запроса.`;
                        continue;
                    }
                    this.itemLocked = true;
                    trade.stage = "db_delay";
                } else {
                    // NAIVE: Check without locking!
                    // If Vasya has sword at this instant, read succeeds
                    if (!this.vasyaHasSword) {
                        trade.stage = "rejected";
                        trade.rejectionReason = "Vasya does not have sword";
                        this.rejectedTrades += 1;
                        continue;
                    }
                    // Both concurrent requests read vasyaHasSword = true!
                    trade.stage = "db_delay";
                }
            } else if (trade.stage === "db_delay") {
                // Simulating database write latency
                if (trade.elapsed >= trade.delay / 1000 + dbLatencySec) {
                    trade.stage = "db_write";

                    // Stage 3: Write transfer
                    if (this.useTransactions) {
                        this.vasyaHasSword = false;
                        this.itemLocked = false;
                        trade.stage = "complete";
                        this.spawnFlyingSword(trade.target, false);
                    } else {
                        // In naive mode: both writes commit!
                        this.vasyaHasSword = false; // set to false, but other write also delivers sword!
                        trade.stage = "complete";
                        const isDupe = this.petyaHasSword || this.flyingItems.some((f) => f.targetName === "Petya");
                        this.spawnFlyingSword(trade.target, isDupe);
                    }
                }
            }
        }

        // Recalculate total swords in world
        const flyingCount = this.flyingItems.length;
        const heldCount = (this.vasyaHasSword ? 1 : 0) + (this.petyaHasSword ? 1 : 0) + (this.dimaHasSword ? 1 : 0);
        this.totalSwords = heldCount + flyingCount;

        if (this.totalSwords > 1 && !this.lastNarrative.includes("ДЮП")) {
            this.successfulDupes += 1;
            this.lastNarrative = `<b style="color:#ef5350">ДЮП СРАБОТАЛ:</b> В мире появилось ${this.totalSwords} меча! Из-за отсутствия блокировки оба запроса прошли проверку одновременно в окне ${this.dbLatencyMs}мс.`;
        }

        this.render();
    }

    private spawnFlyingSword(targetName: "Petya" | "Dima", isDupe: boolean): void {
        const dest = targetName === "Petya" ? this.petyaPos : this.dimaPos;
        this.flyingItems.push({
            id: ++this.nextTradeId,
            from: { ...this.vasyaPos },
            to: { ...dest },
            targetName,
            progress: 0,
            duration: 0.6,
            isDupe,
        });
    }

    /* ── Actions ── */

    /** Honest single trade to Petya */
    tradeToPetya(): void {
        if (!this.vasyaHasSword) {
            this.lastNarrative = `<b style="color:#ffca28">У Васи нет меча!</b> Сначала верни меч Васе.`;
            return;
        }
        this.activeTrades.push({
            id: ++this.nextTradeId,
            target: "Petya",
            elapsed: 0,
            delay: 0,
            stage: "db_read",
        });
        this.lastNarrative = `Отправлен честный запрос на передачу меча Пете.`;
    }

    /** Cheat: Race condition dupe exploit */
    triggerDupeRace(): void {
        if (!this.vasyaHasSword) {
            this.lastNarrative = `<b style="color:#ffca28">У Васи нет меча!</b> Сначала нажми «Вернуть меч Васе».`;
            return;
        }
        this.dupeAttempts += 1;

        // Send two concurrent transfer requests with slight skew
        this.activeTrades.push({
            id: ++this.nextTradeId,
            target: "Petya",
            elapsed: 0,
            delay: 0,
            stage: "db_read",
        });

        this.activeTrades.push({
            id: ++this.nextTradeId,
            target: "Dima",
            elapsed: 0,
            delay: this.requestDelayMs,
            stage: "db_read",
        });

        this.lastNarrative = `Отправлены 2 параллельных запроса (Пете и Диме)! Окно гонки БД: ${this.dbLatencyMs}мс.`;
    }

    giveSwordToVasya(): void {
        this.vasyaHasSword = true;
        this.petyaHasSword = false;
        this.dimaHasSword = false;
        this.itemLocked = false;
        this.flyingItems = [];
        this.activeTrades = [];
        this.totalSwords = 1;
        this.lastNarrative = `Меч возвращен Васе. Состояние сброшено к честному 1 предмету.`;
    }

    /* ── Top-Down Rendering ── */

    private render(): void {
        this.gfx.clear();

        // Floor tiles
        this.gfx.fillStyle(0x181c24, 1);
        this.gfx.fillRect(0, 0, W, H);
        this.gfx.lineStyle(1, 0x272f3e, 0.4);
        for (let x = 0; x < W; x += 50) this.gfx.lineBetween(x, 0, x, H);
        for (let y = 0; y < H; y += 50) this.gfx.lineBetween(0, y, W, y);

        // Room walls
        this.gfx.lineStyle(3, 0x3a455a, 1);
        this.gfx.strokeRect(20, 20, W - 40, H - 40);

        // Center Trade Counter / Desk
        this.gfx.fillStyle(DESK_COLOR, 1);
        this.gfx.fillRoundedRect(this.deskPos.x - 70, this.deskPos.y - 120, 140, 240, 8);
        this.gfx.lineStyle(2, 0x475569, 0.9);
        this.gfx.strokeRoundedRect(this.deskPos.x - 70, this.deskPos.y - 120, 140, 240, 8);

        // Database Lock Indicator on the desk
        if (this.itemLocked) {
            this.gfx.fillStyle(0xef5350, 0.25);
            this.gfx.fillRoundedRect(this.deskPos.x - 60, this.deskPos.y - 30, 120, 60, 4);
            this.gfx.lineStyle(2, 0xef5350, 1);
            this.gfx.strokeRoundedRect(this.deskPos.x - 60, this.deskPos.y - 30, 120, 60, 4);
        }

        // Connection lines between players and counter
        this.gfx.lineStyle(2, 0x3a455a, 0.5);
        this.gfx.lineBetween(this.vasyaPos.x, this.vasyaPos.y, this.deskPos.x - 70, this.deskPos.y);
        this.gfx.lineBetween(this.deskPos.x + 70, this.deskPos.y - 60, this.petyaPos.x, this.petyaPos.y);
        this.gfx.lineBetween(this.deskPos.x + 70, this.deskPos.y + 60, this.dimaPos.x, this.dimaPos.y);

        // 1. Vasya (Cheater)
        this.gfx.fillStyle(VASYA_COLOR, 1);
        this.gfx.fillCircle(this.vasyaPos.x, this.vasyaPos.y, AGENT_RADIUS);
        this.gfx.lineStyle(2, 0xffffff, 0.8);
        this.gfx.strokeCircle(this.vasyaPos.x, this.vasyaPos.y, AGENT_RADIUS);

        // 2. Petya (Buyer 1)
        this.gfx.fillStyle(PETYA_COLOR, 1);
        this.gfx.fillCircle(this.petyaPos.x, this.petyaPos.y, AGENT_RADIUS);
        this.gfx.lineStyle(2, 0xffffff, 0.8);
        this.gfx.strokeCircle(this.petyaPos.x, this.petyaPos.y, AGENT_RADIUS);

        // 3. Dima (Buyer 2)
        this.gfx.fillStyle(DIMA_COLOR, 1);
        this.gfx.fillCircle(this.dimaPos.x, this.dimaPos.y, AGENT_RADIUS);
        this.gfx.lineStyle(2, 0xffffff, 0.8);
        this.gfx.strokeCircle(this.dimaPos.x, this.dimaPos.y, AGENT_RADIUS);

        // Draw swords held by characters
        if (this.vasyaHasSword) {
            this.drawSwordIcon(this.vasyaPos.x + 22, this.vasyaPos.y - 12);
        }
        if (this.petyaHasSword) {
            this.drawSwordIcon(this.petyaPos.x - 22, this.petyaPos.y - 12);
        }
        if (this.dimaHasSword) {
            this.drawSwordIcon(this.dimaPos.x - 22, this.dimaPos.y - 12);
        }

        // Draw flying swords in transit
        for (const item of this.flyingItems) {
            const curX = item.from.x + (item.to.x - item.from.x) * item.progress;
            const curY = item.from.y + (item.to.y - item.from.y) * item.progress;
            // Arc curve
            const arcY = Math.sin(item.progress * Math.PI) * -50;
            this.drawSwordIcon(curX, curY + arcY, item.isDupe);
        }

        // Dupe Alert Banner on screen if duplicated
        if (this.totalSwords > 1) {
            this.gfx.fillStyle(ALERT_COLOR, 0.15);
            this.gfx.fillRect(0, 40, W, 50);
            this.gfx.lineStyle(2, ALERT_COLOR, 0.9);
            this.gfx.lineBetween(0, 40, W, 40);
            this.gfx.lineBetween(0, 90, W, 90);
        }
    }

    private drawSwordIcon(x: number, y: number, isDupe = false): void {
        this.gfx.fillStyle(isDupe ? 0xff1744 : SWORD_COLOR, 1);
        this.gfx.fillCircle(x, y, 9);
        this.gfx.lineStyle(2, 0x1b1f27, 1);
        this.gfx.strokeCircle(x, y, 9);
        // Small sword blade
        this.gfx.lineStyle(2, 0xffffff, 1);
        this.gfx.lineBetween(x - 4, y + 4, x + 4, y - 4);
    }
}

/* ── DOM Controls ── */

function buildControls(root: HTMLElement, scene: DupeRaceScene): void {
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "Dupe Exploit & Race Condition";
    heading.style.margin = "0 0 6px";
    root.appendChild(heading);

    buildHowTo(
        root,
        "<b>Как работает гонка:</b><br>" +
        "1. В наивном коде проверка владения и списание разнесены по времени (DB latency).<br>" +
        "2. Нажми <b>«Параллельный дюп»</b>: читер шлёт два запроса одновременно.<br>" +
        "3. Без транзакции оба запроса увидят, что меч у Васи, и оба продублируют его!<br>" +
        "4. Включи <b>Атомарные транзакции</b> (SELECT FOR UPDATE / Redis Lock), чтобы увидеть защиту."
    );

    buildLegend(root, [
        { color: "#ffd54f", label: "Легендарный меч (⚔️)", shape: "dot" },
        { color: "#ffca28", label: "Читер Вася", shape: "dot" },
        { color: "#4fc3f7", label: "Покупатель Петя", shape: "dot" },
        { color: "#6fd48a", label: "Покупатель Дима", shape: "dot" },
        { color: "#ef5350", label: "Дюп / Заблокировано", shape: "ring" },
    ]);

    const setNarrative = buildNarrative(
        root,
        "Нажми <b>«Параллельный дюп»</b>, чтобы размножить меч через race condition."
    );

    // Mode Selector (Radio)
    const modeBox = document.createElement("div");
    modeBox.style.background = "#1b1f27";
    modeBox.style.border = "1px solid #2a2f3a";
    modeBox.style.borderRadius = "6px";
    modeBox.style.padding = "10px";
    modeBox.style.margin = "0 0 12px";

    const modeTitle = document.createElement("div");
    modeTitle.textContent = "Режим базы данных:";
    modeTitle.style.fontSize = "12px";
    modeTitle.style.fontWeight = "bold";
    modeTitle.style.marginBottom = "8px";
    modeBox.appendChild(modeTitle);

    const labelNaive = document.createElement("label");
    labelNaive.style.display = "flex";
    labelNaive.style.alignItems = "center";
    labelNaive.style.gap = "8px";
    labelNaive.style.cursor = "pointer";
    labelNaive.style.fontSize = "12px";
    labelNaive.style.color = "#ef5350";
    labelNaive.style.marginBottom = "6px";

    const radioNaive = document.createElement("input");
    radioNaive.type = "radio";
    radioNaive.name = "dupeMode";
    radioNaive.checked = !scene.useTransactions;
    radioNaive.onchange = () => {
        scene.useTransactions = false;
        updateUI();
    };
    labelNaive.append(radioNaive, document.createTextNode("🔴 Наивный Check-Then-Act (Уязвим к дюпу)"));
    modeBox.appendChild(labelNaive);

    const labelTx = document.createElement("label");
    labelTx.style.display = "flex";
    labelTx.style.alignItems = "center";
    labelTx.style.gap = "8px";
    labelTx.style.cursor = "pointer";
    labelTx.style.fontSize = "12px";
    labelTx.style.color = "#6fd48a";

    const radioTx = document.createElement("input");
    radioTx.type = "radio";
    radioTx.name = "dupeMode";
    radioTx.checked = scene.useTransactions;
    radioTx.onchange = () => {
        scene.useTransactions = true;
        updateUI();
    };
    labelTx.append(radioTx, document.createTextNode("🟢 Атомарная транзакция (SELECT FOR UPDATE)"));
    modeBox.appendChild(labelTx);

    root.appendChild(modeBox);

    // Exploit Action Buttons
    const btnSection = document.createElement("div");
    btnSection.style.display = "flex";
    btnSection.style.flexDirection = "column";
    btnSection.style.gap = "6px";
    btnSection.style.margin = "0 0 14px";

    const btnDupe = document.createElement("button");
    btnDupe.className = "btn danger";
    btnDupe.textContent = "💥 Эксплойт: Параллельный дюп (Пете и Диме)";
    btnDupe.onclick = () => {
        scene.triggerDupeRace();
        updateUI();
    };
    btnSection.appendChild(btnDupe);

    const btnSingleTrade = document.createElement("button");
    btnSingleTrade.className = "btn";
    btnSingleTrade.textContent = "⚔️ Одиночная честная передача (только Пете)";
    btnSingleTrade.onclick = () => {
        scene.tradeToPetya();
        updateUI();
    };
    btnSection.appendChild(btnSingleTrade);

    const btnResetSword = document.createElement("button");
    btnResetSword.className = "btn";
    btnResetSword.textContent = "🔄 Вернуть меч Васе";
    btnResetSword.onclick = () => {
        scene.giveSwordToVasya();
        updateUI();
    };
    btnSection.appendChild(btnResetSword);

    root.appendChild(btnSection);

    // Sliders for Parameters
    const controlsBox = document.createElement("div");
    controlsBox.style.display = "flex";
    controlsBox.style.flexDirection = "column";
    controlsBox.style.gap = "8px";
    controlsBox.style.margin = "0 0 14px";

    // DB Latency slider
    const latRow = document.createElement("div");
    const latLabel = document.createElement("div");
    latLabel.style.fontSize = "12px";
    latLabel.style.color = "#c5cad3";
    latLabel.textContent = `Задержка базы данных (Окно гонки): ${scene.dbLatencyMs} мс`;
    const latSlider = document.createElement("input");
    latSlider.type = "range";
    latSlider.min = "50";
    latSlider.max = "1000";
    latSlider.step = "50";
    latSlider.value = String(scene.dbLatencyMs);
    latSlider.oninput = () => {
        scene.dbLatencyMs = Number(latSlider.value);
        latLabel.textContent = `Задержка базы данных (Окно гонки): ${scene.dbLatencyMs} мс`;
    };
    latRow.append(latLabel, latSlider);
    controlsBox.appendChild(latRow);

    // Skew delay slider
    const skewRow = document.createElement("div");
    const skewLabel = document.createElement("div");
    skewLabel.style.fontSize = "12px";
    skewLabel.style.color = "#c5cad3";
    skewLabel.textContent = `Сдвиг между пакетами: ${scene.requestDelayMs} мс`;
    const skewSlider = document.createElement("input");
    skewSlider.type = "range";
    skewSlider.min = "0";
    skewSlider.max = "300";
    skewSlider.step = "10";
    skewSlider.value = String(scene.requestDelayMs);
    skewSlider.oninput = () => {
        scene.requestDelayMs = Number(skewSlider.value);
        skewLabel.textContent = `Сдвиг между пакетами: ${scene.requestDelayMs} мс`;
    };
    skewRow.append(skewLabel, skewSlider);
    controlsBox.appendChild(skewRow);

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
        const dupeHighlight = scene.totalSwords > 1 ? `color:#ef5350;font-weight:bold;font-size:14px;` : `color:#6fd48a;`;
        metricsBox.innerHTML =
            `<div><b>Всего мечей в мире:</b> <span style="${dupeHighlight}">${scene.totalSwords} шт (норма: 1)</span></div>` +
            `<div><b>Меч у Васи:</b> ${scene.vasyaHasSword ? "Да (⚔️)" : "Нет"} | <b>Петя:</b> ${scene.petyaHasSword ? "Да (⚔️)" : "Нет"} | <b>Дима:</b> ${scene.dimaHasSword ? "Да (⚔️)" : "Нет"}</div>` +
            `<div><b>Попыток эксплойта:</b> ${scene.dupeAttempts} | <b>Успешных дюпов:</b> ${scene.successfulDupes}</div>` +
            `<div><b>Отклонено сервером:</b> ${scene.rejectedTrades}</div>`;
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
    scene: DupeRaceScene,
});

const controlsRoot = document.getElementById("control-panel");
if (controlsRoot) {
    const scene = game.scene.getScene("cheat-dupe-race") as DupeRaceScene;
    if (scene) {
        buildControls(controlsRoot, scene);
    } else {
        game.events.once("ready", () => {
            const readyScene = game.scene.getScene("cheat-dupe-race") as DupeRaceScene;
            buildControls(controlsRoot, readyScene);
        });
    }
}
