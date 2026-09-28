// Phase 5 (spec section 10): draws one direction arrow per walkable cell.

import type Phaser from "phaser";
import type { FlowField } from "@/navigation/FlowField";

const ARROW_COLOR = 0x4fc3f7;
const ARROW_ALPHA = 0.45;

export class FlowFieldRenderer {
    private readonly graphics: Phaser.GameObjects.Graphics;

    constructor(scene: Phaser.Scene) {
        this.graphics = scene.add.graphics();
    }

    render(field: FlowField | null): void {
        this.graphics.clear();
        if (!field) return;

        this.graphics.lineStyle(1, ARROW_COLOR, ARROW_ALPHA);
        const len = field.cellSize * 0.35;
        const headLen = len * 0.4;

        for (let row = 0; row < field.rows; row++) {
            for (let col = 0; col < field.cols; col++) {
                const dir = field.direction[row * field.cols + col];
                if (dir.x === 0 && dir.y === 0) continue;

                const cx = (col + 0.5) * field.cellSize;
                const cy = (row + 0.5) * field.cellSize;
                const ex = cx + dir.x * len;
                const ey = cy + dir.y * len;

                this.graphics.lineBetween(cx, cy, ex, ey);
                const angle = Math.atan2(dir.y, dir.x);
                this.graphics.lineBetween(ex, ey, ex - headLen * Math.cos(angle - 0.4), ey - headLen * Math.sin(angle - 0.4));
                this.graphics.lineBetween(ex, ey, ex - headLen * Math.cos(angle + 0.4), ey - headLen * Math.sin(angle + 0.4));
            }
        }
    }

    destroy(): void {
        this.graphics.destroy();
    }
}
