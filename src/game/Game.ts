import Phaser from "phaser";
import { WORLD_HEIGHT, WORLD_WIDTH } from "@/simulation/World";
import { GameScene } from "./GameScene";

export function createGame(parent: HTMLElement): Phaser.Game {
    return new Phaser.Game({
        type: Phaser.AUTO,
        parent,
        width: WORLD_WIDTH,
        height: WORLD_HEIGHT,
        backgroundColor: "#14181f",
        scene: [GameScene],
        fps: {
            target: 60,
        },
    });
}
