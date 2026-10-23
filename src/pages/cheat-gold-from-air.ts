import Phaser from "phaser";
import type { Vec2 } from "@/simulation/Vec2";
import { buildHowTo, buildLegend, buildNarrative } from "@/rendering/ExplainerPanel";
import { ScrollingGraph, buildGraphRow } from "@/rendering/ScrollingGraph";

const W = 900;
const H = 600;
const PLAYER_RADIUS = 14;
const GRAPH_SAMPLES = 120;

const PLAYER_COLOR = 0x4fc3f7;
const CHEST_COLOR = 0xffca28;
const MERCHANT_COLOR = 0x6fd48a;
const WALL_COLOR = 0x2a3242;
const ZONE_COLOR = 0x4fc3f7;

interface FloatingText {
    text: string;
    pos: Vec2;
    color: string;
    age: number;
    maxAge: number;
}

class GoldFromAirScene extends Phaser.Scene {
    /** true = Authoritative server validation, false = Naive client-trusting RPC */
    serverAuth = false;
    distanceTolerance = 75;
    packetBurst = 1;
    negativeQtyExploit = false;
    paused = false;

    // Game state (server authoritative truth)
    playerPos: Vec2 = { x: 450, y: 300 };
    targetPos: Vec2 = { x: 450, y: 300 };
    serverGold = 500;
    clientGold = 500;
    potionsOwned = 0;
    chestOpened = false;
    chestCooldown = 0; // seconds until respawn

    // Exploit metrics
    exploitedGold = 0;
    totalRequests = 0;
    rejectedRequests = 0;
    lastNarrative = "";

    // World objects
    chestPos: Vec2 = { x: 700, y: 180 };
    merchantPos: Vec2 = { x: 200, y: 400 };

    floatingTexts: FloatingText[] = [];
    graph: ScrollingGraph | null = null;

    private gfx!: Phaser.GameObjects.Graphics;
    private keys!: { w: Phaser.Input.Keyboard.Key; a: Phaser.Input.Keyboard.Key; s: Phaser.Input.Keyboard.Key; d: Phaser.Input.Keyboard.Key };
    private lastReplayPayload: { action: string; amount: number; nonce: number } | null = null;
    private serverNonce = 0;
    private usedNonces = new Set<number>();

    constructor() {
        super("cheat-gold-from-air");
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
                this.targetPos = { x: p.x, y: p.y };
            }
        });

        this.input.keyboard?.on("keydown-R", () => this.reset());
        this.reset();
    }

    reset(): void {
        this.playerPos = { x: 450, y: 300 };
        this.targetPos = { x: 450, y: 300 };
        this.serverGold = 500;
        this.clientGold = 500;
        this.potionsOwned = 0;
        this.chestOpened = false;
        this.chestCooldown = 0;
        this.exploitedGold = 0;
        this.totalRequests = 0;
        this.rejectedRequests = 0;
        this.lastNarrative = "";
        this.floatingTexts = [];
        this.serverNonce = 0;
        this.usedNonces.clear();
        this.lastReplayPayload = null;
        this.graph?.clear();
    }

    update(_time: number, deltaMs: number): void {
        if (this.paused) {
            this.render();
            return;
        }
        const dt = deltaMs / 1000;

        // Player movement (WASD or move towards click target)
        let moveX = 0;
        let moveY = 0;
        if (this.keys.a.isDown) moveX -= 1;
        if (this.keys.d.isDown) moveX += 1;
        if (this.keys.w.isDown) moveY -= 1;
        if (this.keys.s.isDown) moveY += 1;

        if (moveX !== 0 || moveY !== 0) {
            const len = Math.hypot(moveX, moveY);
            const speed = 180;
            this.playerPos.x += (moveX / len) * speed * dt;
            this.playerPos.y += (moveY / len) * speed * dt;
            this.targetPos = { ...this.playerPos };
        } else {
            const distToTarget = Math.hypot(this.targetPos.x - this.playerPos.x, this.targetPos.y - this.playerPos.y);
            if (distToTarget > 4) {
                const step = Math.min(distToTarget, 200 * dt);
                this.playerPos.x += ((this.targetPos.x - this.playerPos.x) / distToTarget) * step;
                this.playerPos.y += ((this.targetPos.y - this.playerPos.y) / distToTarget) * step;
            }
        }

        // Clamp player in bounds
        this.playerPos.x = Phaser.Math.Clamp(this.playerPos.x, 30, W - 30);
        this.playerPos.y = Phaser.Math.Clamp(this.playerPos.y, 30, H - 30);

        // Chest respawn timer
        if (this.chestOpened) {
            this.chestCooldown -= dt;
            if (this.chestCooldown <= 0) {
                this.chestOpened = false;
                this.addFloatingText("✨ Сундук снова полон!", this.chestPos, "#ffca28");
            }
        }

        // Floating texts update
        for (const ft of this.floatingTexts) {
            ft.age += dt;
            ft.pos.y -= 18 * dt;
        }
        this.floatingTexts = this.floatingTexts.filter((ft) => ft.age < ft.maxAge);

        this.render();
    }

    addFloatingText(text: string, pos: Vec2, color = "#ffffff"): void {
        this.floatingTexts.push({
            text,
            pos: { x: pos.x, y: pos.y - 20 },
            color,
            age: 0,
            maxAge: 1.6,
        });
    }

    /* ── Exploits and Actions ── */

    /** Cheat 1: Direct RPC `CmdAddGold(amount)` */
    sendCmdAddGold(amount = 500): void {
        for (let i = 0; i < this.packetBurst; i++) {
            this.totalRequests += 1;
            this.serverNonce += 1;
            const nonce = this.serverNonce;
            this.lastReplayPayload = { action: "CmdAddGold", amount, nonce };

            if (!this.serverAuth) {
                // Naive: server trusts client RPC!
                this.serverGold += amount;
                this.clientGold = this.serverGold;
                this.exploitedGold += amount;
                this.addFloatingText(`+${amount} 💰 (CmdAddGold)`, this.playerPos, "#ef5350");
                this.lastNarrative = `<b style="color:#ef5350">УЯЗВИМОСТЬ:</b> Сервер выполнил прямой RPC <code>CmdAddGold(${amount})</code> от клиента без проверки источника! Получено +${amount * this.packetBurst} золота из воздуха.`;
            } else {
                // Server Auth: RPC does not exist or is denied!
                this.rejectedRequests += 1;
                this.addFloatingText("❌ Ошибка: RPC запрещён!", this.playerPos, "#ffca28");
                this.lastNarrative = `<b style="color:#6fd48a">ЗАЩИТА:</b> Сервер отверг <code>CmdAddGold</code>. Клиент не имеет права начислять валюту напрямую — только выполнять валидируемые действия.`;
            }
        }
        this.graph?.push(this.exploitedGold, Math.max(this.exploitedGold, 500));
    }

    /** Cheat 2: Loot chest from afar (Tele-loot) or when empty */
    interactChest(): void {
        for (let i = 0; i < this.packetBurst; i++) {
            this.totalRequests += 1;
            const d = Math.hypot(this.playerPos.x - this.chestPos.x, this.playerPos.y - this.chestPos.y);

            if (!this.serverAuth) {
                // Naive: trusts client claims, no distance or cooldown checks
                const reward = 300;
                this.serverGold += reward;
                this.clientGold = this.serverGold;
                this.chestOpened = true;
                this.chestCooldown = 5;
                if (d > this.distanceTolerance) {
                    this.exploitedGold += reward;
                    this.addFloatingText(`+${reward} 💰 (Теле-лут!)`, this.playerPos, "#ef5350");
                    this.lastNarrative = `<b style="color:#ef5350">УЯЗВИМОСТЬ:</b> Сундук открыт через всю карту (${d.toFixed(0)}px > ${this.distanceTolerance}px)! Сервер не проверил координаты игрока.`;
                } else {
                    this.addFloatingText(`+${reward} 💰`, this.playerPos, "#6fd48a");
                    this.lastNarrative = `<b style="color:#6fd48a">Сундук открыт:</b> Получено ${reward} золота.`;
                }
            } else {
                // Server Authority: strict distance and state checks
                if (d > this.distanceTolerance) {
                    this.rejectedRequests += 1;
                    this.addFloatingText(`❌ Слишком далеко (${d.toFixed(0)}px > ${this.distanceTolerance}px)`, this.playerPos, "#ef5350");
                    this.lastNarrative = `<b style="color:#6fd48a">ЗАЩИТА:</b> Сервер отклонил взаимодействие: игрок находится в ${d.toFixed(0)}px от сундука (лимит: ${this.distanceTolerance}px).`;
                    return;
                }
                if (this.chestOpened) {
                    this.rejectedRequests += 1;
                    this.addFloatingText("❌ Сундук уже пуст!", this.playerPos, "#ffca28");
                    this.lastNarrative = `<b style="color:#6fd48a">ЗАЩИТА:</b> Сервер отклонил открытие: сундук уже опустошён на сервере (cooldown ${this.chestCooldown.toFixed(1)}s).`;
                    return;
                }
                const reward = 300;
                this.serverGold += reward;
                this.clientGold = this.serverGold;
                this.chestOpened = true;
                this.chestCooldown = 6;
                this.addFloatingText(`+${reward} 💰 (Честно)`, this.playerPos, "#6fd48a");
                this.lastNarrative = `<b style="color:#6fd48a">Успех:</b> Игрок подошёл вплотную (${d.toFixed(0)}px) и открыл сундук. Сервер начислил честные +${reward} золота.`;
            }
        }
        this.graph?.push(this.exploitedGold, Math.max(this.exploitedGold, 500));
    }

    /** Cheat 3: Buy potions (with optional negative quantity / discount) */
    buyPotion(): void {
        const itemPrice = 100;
        const qty = this.negativeQtyExploit ? -5 : 1;
        const totalCost = itemPrice * qty;

        for (let i = 0; i < this.packetBurst; i++) {
            this.totalRequests += 1;
            const d = Math.hypot(this.playerPos.x - this.merchantPos.x, this.playerPos.y - this.merchantPos.y);

            if (!this.serverAuth) {
                // Naive: trusts client price & quantity without validation
                if (qty < 0) {
                    // Exploit: "buying" negative potions gives gold!
                    const gained = Math.abs(totalCost);
                    this.serverGold += gained;
                    this.clientGold = this.serverGold;
                    this.potionsOwned += qty;
                    this.exploitedGold += gained;
                    this.addFloatingText(`+${gained} 💰 (Эксплойт: кол-во ${qty})`, this.playerPos, "#ef5350");
                    this.lastNarrative = `<b style="color:#ef5350">УЯЗВИМОСТЬ:</b> Сервер списал <code>price × (${qty}) = ${totalCost}</code>, что увеличило золото на +${gained}!`;
                } else {
                    if (this.serverGold >= totalCost) {
                        this.serverGold -= totalCost;
                        this.clientGold = this.serverGold;
                        this.potionsOwned += qty;
                        this.addFloatingText(`-${totalCost} 💰 (+1 🧪)`, this.playerPos, "#4fc3f7");
                    }
                }
            } else {
                // Server Auth: validate distance, quantity > 0, price from catalog
                if (d > this.distanceTolerance) {
                    this.rejectedRequests += 1;
                    this.addFloatingText("❌ Торговец слишком далеко!", this.playerPos, "#ef5350");
                    this.lastNarrative = `<b style="color:#6fd48a">ЗАЩИТА:</b> Торговля отклонена: игрок далеко от торговца (${d.toFixed(0)}px).`;
                    return;
                }
                if (qty <= 0) {
                    this.rejectedRequests += 1;
                    this.addFloatingText(`❌ Недопустимое кол-во (${qty})!`, this.playerPos, "#ef5350");
                    this.lastNarrative = `<b style="color:#6fd48a">ЗАЩИТА:</b> Сервер проверил <code>quantity > 0</code> и отклонил вредоносный запрос с кол-вом ${qty}.`;
                    return;
                }
                if (this.serverGold < totalCost) {
                    this.rejectedRequests += 1;
                    this.addFloatingText("❌ Недостаточно золота!", this.playerPos, "#ffca28");
                    this.lastNarrative = `<b style="color:#ffca28">Отказ:</b> Недостаточно золота (${this.serverGold} < ${totalCost}).`;
                    return;
                }
                this.serverGold -= totalCost;
                this.clientGold = this.serverGold;
                this.potionsOwned += qty;
                this.addFloatingText(`-${totalCost} 💰 (+1 🧪)`, this.playerPos, "#6fd48a");
                this.lastNarrative = `<b style="color:#6fd48a">Успех:</b> Куплено зелье за 100 золота. Баланс проверен сервером.`;
            }
        }
        this.graph?.push(this.exploitedGold, Math.max(this.exploitedGold, 500));
    }

    /** Cheat 4: Replay last packet */
    replayLastPacket(): void {
        if (!this.lastReplayPayload) {
            this.addFloatingText("Нет пакета для повтора", this.playerPos, "#8b93a3");
            return;
        }
        this.totalRequests += 1;
        const payload = this.lastReplayPayload;

        if (!this.serverAuth) {
            // Replay accepted
            this.serverGold += payload.amount;
            this.clientGold = this.serverGold;
            this.exploitedGold += payload.amount;
            this.addFloatingText(`+${payload.amount} 💰 (Replay Attack!)`, this.playerPos, "#ef5350");
            this.lastNarrative = `<b style="color:#ef5350">УЯЗВИМОСТЬ:</b> Пакет с nonce #${payload.nonce} принят повторно без проверки уникальности запроса!`;
        } else {
            // Replay detected via used nonce
            if (this.usedNonces.has(payload.nonce)) {
                this.rejectedRequests += 1;
                this.addFloatingText(`❌ Replay! Nonce #${payload.nonce} уже использован`, this.playerPos, "#ffca28");
                this.lastNarrative = `<b style="color:#6fd48a">ЗАЩИТА (Идемпотентность):</b> Сервер обнаружил повторный nonce #${payload.nonce} и отклонил replay-атаку.`;
            } else {
                this.usedNonces.add(payload.nonce);
                this.addFloatingText("Пакет обработан единожды", this.playerPos, "#6fd48a");
            }
        }
        this.graph?.push(this.exploitedGold, Math.max(this.exploitedGold, 500));
    }

    /* ── Top-Down Rendering ── */

    private render(): void {
        this.gfx.clear();

        // Arena background grid
        this.gfx.fillStyle(0x181c24, 1);
        this.gfx.fillRect(0, 0, W, H);
        this.gfx.lineStyle(1, WALL_COLOR, 0.4);
        for (let x = 0; x < W; x += 50) this.gfx.lineBetween(x, 0, x, H);
        for (let y = 0; y < H; y += 50) this.gfx.lineBetween(0, y, W, y);

        // Arena outer walls
        this.gfx.lineStyle(3, 0x3a455a, 1);
        this.gfx.strokeRect(10, 10, W - 20, H - 20);

        // Decorative stone pillars
        this.gfx.fillStyle(0x28303f, 1);
        this.gfx.fillRect(380, 100, 40, 40);
        this.gfx.fillRect(380, 460, 40, 40);

        // 1. Treasure Chest Zone & Object
        const distToChest = Math.hypot(this.playerPos.x - this.chestPos.x, this.playerPos.y - this.chestPos.y);
        const inChestRange = distToChest <= this.distanceTolerance;

        // Interaction radius circle
        this.gfx.lineStyle(1, CHEST_COLOR, inChestRange ? 0.7 : 0.25);
        this.gfx.strokeCircle(this.chestPos.x, this.chestPos.y, this.distanceTolerance);
        if (inChestRange) {
            this.gfx.fillStyle(CHEST_COLOR, 0.08);
            this.gfx.fillCircle(this.chestPos.x, this.chestPos.y, this.distanceTolerance);
        }

        // Draw Chest Body
        this.gfx.fillStyle(this.chestOpened ? 0x5a5240 : CHEST_COLOR, 1);
        this.gfx.fillRoundedRect(this.chestPos.x - 22, this.chestPos.y - 16, 44, 32, 4);
        this.gfx.lineStyle(2, 0x1b1f27, 1);
        this.gfx.strokeRoundedRect(this.chestPos.x - 22, this.chestPos.y - 16, 44, 32, 4);
        // Chest lock / band
        this.gfx.fillStyle(0x1b1f27, 1);
        this.gfx.fillRect(this.chestPos.x - 5, this.chestPos.y - 4, 10, 10);

        // 2. Merchant Stall & Object
        const distToMerchant = Math.hypot(this.playerPos.x - this.merchantPos.x, this.playerPos.y - this.merchantPos.y);
        const inMerchantRange = distToMerchant <= this.distanceTolerance;

        // Merchant zone
        this.gfx.lineStyle(1, MERCHANT_COLOR, inMerchantRange ? 0.7 : 0.25);
        this.gfx.strokeCircle(this.merchantPos.x, this.merchantPos.y, this.distanceTolerance);
        if (inMerchantRange) {
            this.gfx.fillStyle(MERCHANT_COLOR, 0.08);
            this.gfx.fillCircle(this.merchantPos.x, this.merchantPos.y, this.distanceTolerance);
        }

        // Draw Merchant
        this.gfx.fillStyle(MERCHANT_COLOR, 1);
        this.gfx.fillCircle(this.merchantPos.x, this.merchantPos.y, 16);
        this.gfx.lineStyle(2, 0x1b1f27, 1);
        this.gfx.strokeCircle(this.merchantPos.x, this.merchantPos.y, 16);
        // Merchant canopy/stall
        this.gfx.fillStyle(0x2f6040, 0.8);
        this.gfx.fillRect(this.merchantPos.x - 25, this.merchantPos.y - 32, 50, 12);

        // Line to target click destination
        if (Math.hypot(this.targetPos.x - this.playerPos.x, this.targetPos.y - this.playerPos.y) > 8) {
            this.gfx.lineStyle(1, ZONE_COLOR, 0.35);
            this.gfx.lineBetween(this.playerPos.x, this.playerPos.y, this.targetPos.x, this.targetPos.y);
            this.gfx.strokeCircle(this.targetPos.x, this.targetPos.y, 4);
        }

        // 3. Player Character
        this.gfx.fillStyle(PLAYER_COLOR, 1);
        this.gfx.fillCircle(this.playerPos.x, this.playerPos.y, PLAYER_RADIUS);
        this.gfx.lineStyle(2, 0xffffff, 0.8);
        this.gfx.strokeCircle(this.playerPos.x, this.playerPos.y, PLAYER_RADIUS);

        // Direction sight arrow
        const angle = Math.atan2(this.targetPos.y - this.playerPos.y, this.targetPos.x - this.playerPos.x);
        this.gfx.lineStyle(2, 0xffffff, 0.9);
        this.gfx.lineBetween(
            this.playerPos.x,
            this.playerPos.y,
            this.playerPos.x + Math.cos(angle) * (PLAYER_RADIUS + 8),
            this.playerPos.y + Math.sin(angle) * (PLAYER_RADIUS + 8)
        );

        // Player HUD above head: Gold & Potions
        this.gfx.fillStyle(0x14181f, 0.85);
        this.gfx.fillRoundedRect(this.playerPos.x - 55, this.playerPos.y - 38, 110, 18, 4);
        this.gfx.lineStyle(1, 0x3a455a, 0.8);
        this.gfx.strokeRoundedRect(this.playerPos.x - 55, this.playerPos.y - 38, 110, 18, 4);
    }
}

/* ── DOM Controls & Explanation ── */

function buildControls(root: HTMLElement, scene: GoldFromAirScene): void {
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "Gold From Thin Air";
    heading.style.margin = "0 0 6px";
    root.appendChild(heading);

    buildHowTo(
        root,
        "<b>Как тестировать:</b><br>" +
        "1. Кликай по полю для перемещения персонажа (или ходи на <b>WASD</b>).<br>" +
        "2. Переключай режим между <b>Доверием клиенту (RPC)</b> и <b>Авторитетным сервером</b>.<br>" +
        "3. Нажимай кнопки эксплойтов: начисление золота из ниоткуда, ограбление сундука через всю карту, покупку отрицательного количества зелий!"
    );

    buildLegend(root, [
        { color: "#4fc3f7", label: "Игрок Вася", shape: "dot" },
        { color: "#ffca28", label: "Сундук с золотом (+300 💰)", shape: "dot" },
        { color: "#6fd48a", label: "Торговец зельями (100 💰)", shape: "dot" },
        { color: "#ef5350", label: "Эксплойт / Читерство", shape: "ring" },
    ]);

    const setNarrative = buildNarrative(
        root,
        "Попробуй нажать <b>«Эксплойт: CmdAddGold»</b> или ограбить сундук, стоя в противоположном конце комнаты."
    );

    // Mode Selector (Radio / Toggle)
    const modeBox = document.createElement("div");
    modeBox.style.background = "#1b1f27";
    modeBox.style.border = "1px solid #2a2f3a";
    modeBox.style.borderRadius = "6px";
    modeBox.style.padding = "10px";
    modeBox.style.margin = "0 0 12px";

    const modeTitle = document.createElement("div");
    modeTitle.textContent = "Архитектура сервера:";
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
    radioNaive.name = "serverMode";
    radioNaive.checked = !scene.serverAuth;
    radioNaive.onchange = () => {
        scene.serverAuth = false;
        updateUI();
    };
    labelNaive.append(radioNaive, document.createTextNode("🔴 Доверие RPC клиента (Уязвимо)"));
    modeBox.appendChild(labelNaive);

    const labelAuth = document.createElement("label");
    labelAuth.style.display = "flex";
    labelAuth.style.alignItems = "center";
    labelAuth.style.gap = "8px";
    labelAuth.style.cursor = "pointer";
    labelAuth.style.fontSize = "12px";
    labelAuth.style.color = "#6fd48a";

    const radioAuth = document.createElement("input");
    radioAuth.type = "radio";
    radioAuth.name = "serverMode";
    radioAuth.checked = scene.serverAuth;
    radioAuth.onchange = () => {
        scene.serverAuth = true;
        updateUI();
    };
    labelAuth.append(radioAuth, document.createTextNode("🟢 Авторитетные действия сервера (Защищено)"));
    modeBox.appendChild(labelAuth);

    root.appendChild(modeBox);

    // Exploit Action Buttons
    const btnSection = document.createElement("div");
    btnSection.style.display = "flex";
    btnSection.style.flexDirection = "column";
    btnSection.style.gap = "6px";
    btnSection.style.margin = "0 0 14px";

    const btnAddGold = document.createElement("button");
    btnAddGold.className = "btn danger";
    btnAddGold.textContent = "💰 Эксплойт: Вызвать CmdAddGold(+500)";
    btnAddGold.onclick = () => {
        scene.sendCmdAddGold(500);
        updateUI();
    };
    btnSection.appendChild(btnAddGold);

    const btnLootChest = document.createElement("button");
    btnLootChest.className = "btn";
    btnLootChest.textContent = "📦 Открыть сундук (Дистанционно / Вблизи)";
    btnLootChest.onclick = () => {
        scene.interactChest();
        updateUI();
    };
    btnSection.appendChild(btnLootChest);

    const btnBuyPotion = document.createElement("button");
    btnBuyPotion.className = "btn";
    btnBuyPotion.textContent = "🧪 Купить зелье у торговца";
    btnBuyPotion.onclick = () => {
        scene.buyPotion();
        updateUI();
    };
    btnSection.appendChild(btnBuyPotion);

    const btnReplay = document.createElement("button");
    btnReplay.className = "btn";
    btnReplay.textContent = "🔄 Повторить последний пакет (Replay Attack)";
    btnReplay.onclick = () => {
        scene.replayLastPacket();
        updateUI();
    };
    btnSection.appendChild(btnReplay);

    root.appendChild(btnSection);

    // Sliders & Checkboxes for Parameters
    const controlsBox = document.createElement("div");
    controlsBox.style.display = "flex";
    controlsBox.style.flexDirection = "column";
    controlsBox.style.gap = "8px";
    controlsBox.style.margin = "0 0 14px";

    // Distance tolerance slider
    const distRow = document.createElement("div");
    const distLabel = document.createElement("div");
    distLabel.style.fontSize = "12px";
    distLabel.style.color = "#c5cad3";
    distLabel.textContent = `Радиус взаимодействия: ${scene.distanceTolerance} px`;
    const distSlider = document.createElement("input");
    distSlider.type = "range";
    distSlider.min = "40";
    distSlider.max = "200";
    distSlider.value = String(scene.distanceTolerance);
    distSlider.oninput = () => {
        scene.distanceTolerance = Number(distSlider.value);
        distLabel.textContent = `Радиус взаимодействия: ${scene.distanceTolerance} px`;
    };
    distRow.append(distLabel, distSlider);
    controlsBox.appendChild(distRow);

    // Burst packet count slider
    const burstRow = document.createElement("div");
    const burstLabel = document.createElement("div");
    burstLabel.style.fontSize = "12px";
    burstLabel.style.color = "#c5cad3";
    burstLabel.textContent = `Пакетный спам: ${scene.packetBurst} запросов за раз`;
    const burstSlider = document.createElement("input");
    burstSlider.type = "range";
    burstSlider.min = "1";
    burstSlider.max = "10";
    burstSlider.value = String(scene.packetBurst);
    burstSlider.oninput = () => {
        scene.packetBurst = Number(burstSlider.value);
        burstLabel.textContent = `Пакетный спам: ${scene.packetBurst} запросов за раз`;
    };
    burstRow.append(burstLabel, burstSlider);
    controlsBox.appendChild(burstRow);

    // Negative quantity exploit checkbox
    const negLabel = document.createElement("label");
    negLabel.style.display = "flex";
    negLabel.style.alignItems = "center";
    negLabel.style.gap = "8px";
    negLabel.style.fontSize = "12px";
    negLabel.style.color = "#c5cad3";
    negLabel.style.cursor = "pointer";
    const negCheck = document.createElement("input");
    negCheck.type = "checkbox";
    negCheck.checked = scene.negativeQtyExploit;
    negCheck.onchange = () => {
        scene.negativeQtyExploit = negCheck.checked;
    };
    negLabel.append(negCheck, document.createTextNode("Эксплойт: Покупать отрицательное кол-во (-5 шт)"));
    controlsBox.appendChild(negLabel);

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
        buildGraphRow(root, "Украденное золото (Exploited Gold)", "#ef5350", GRAPH_SAMPLES),
        GRAPH_SAMPLES,
        "#ef5350"
    );

    // Reset button
    const btnReset = document.createElement("button");
    btnReset.className = "btn";
    btnReset.style.marginTop = "8px";
    btnReset.textContent = "Сброс сценария (R)";
    btnReset.onclick = () => {
        scene.reset();
        updateUI();
    };
    root.appendChild(btnReset);

    function updateUI(): void {
        metricsBox.innerHTML =
            `<div><b>Серверное золото:</b> <span style="color:#ffca28">${scene.serverGold} 💰</span></div>` +
            `<div><b>Зельев в сумке:</b> ${scene.potionsOwned} 🧪</div>` +
            `<div><b>Украдено читами:</b> <span style="color:#ef5350;font-weight:bold">${scene.exploitedGold} 💰</span></div>` +
            `<div><b>Всего запросов:</b> ${scene.totalRequests} | <b>Отклонено:</b> ${scene.rejectedRequests}</div>`;
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
    scene: GoldFromAirScene,
});

const controlsRoot = document.getElementById("control-panel");
if (controlsRoot) {
    const scene = game.scene.getScene("cheat-gold-from-air") as GoldFromAirScene;
    if (scene) {
        buildControls(controlsRoot, scene);
    } else {
        game.events.once("ready", () => {
            const readyScene = game.scene.getScene("cheat-gold-from-air") as GoldFromAirScene;
            buildControls(controlsRoot, readyScene);
        });
    }
}
