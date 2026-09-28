import type Phaser from "phaser";

/** Fits the world into the viewport. Free camera pan/zoom is not needed yet. */
export class CameraController {
    constructor(scene: Phaser.Scene, worldWidth: number, worldHeight: number) {
        scene.cameras.main.setBounds(0, 0, worldWidth, worldHeight);
        scene.cameras.main.setBackgroundColor(0x14181f);
    }
}
