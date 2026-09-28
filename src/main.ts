import Phaser from "phaser";
import { createGame } from "@/game/Game";
import type { GameScene } from "@/game/GameScene";
import { ControlPanel } from "@/ui/ControlPanel";
import { MetricsPanel } from "@/ui/MetricsPanel";

const gameRoot = document.getElementById("game-root");
const controlRoot = document.getElementById("control-panel");
const metricsRoot = document.getElementById("metrics-panel");

if (!gameRoot || !controlRoot || !metricsRoot) {
    throw new Error("main: expected #game-root, #control-panel and #metrics-panel in index.html");
}

const game = createGame(gameRoot);

game.events.once(Phaser.Core.Events.READY, () => {
    const scene = game.scene.getScene("game") as GameScene;

    new ControlPanel(controlRoot, {
        onAgentCountChange: (count) => scene.setAgentCount(count),
        onAvoidanceToggle: (enabled) => scene.setAvoidanceEnabled(enabled),
        onPauseToggle: () => scene.simulation.togglePaused(),
        onReset: () => scene.resetScenario(),
    });

    const metricsPanel = new MetricsPanel(metricsRoot);
    const tick = () => {
        metricsPanel.update(scene.simulation.getMetrics(), game.loop.actualFps);
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
});
