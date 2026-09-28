// Phase 2 (spec section 7): draws NavMesh grid cells. Only blocked cells are
// drawn — the tint around an obstacle's solid rectangle is exactly the extra
// margin the agent radius carves out (article: NavMesh != the visible floor).

import type Phaser from "phaser";
import type { NavMesh } from "@/navigation/NavMesh";

const BLOCKED_COLOR = 0xef5350;
const BLOCKED_ALPHA = 0.15;

export class NavMeshRenderer {
    private readonly graphics: Phaser.GameObjects.Graphics;

    constructor(scene: Phaser.Scene) {
        this.graphics = scene.add.graphics();
    }

    render(navMesh: NavMesh | null): void {
        this.graphics.clear();
        if (!navMesh) return;

        this.graphics.fillStyle(BLOCKED_COLOR, BLOCKED_ALPHA);
        for (const cell of navMesh.cells) {
            if (cell.walkable) continue;
            this.graphics.fillRect(cell.x * navMesh.cellSize, cell.y * navMesh.cellSize, navMesh.cellSize, navMesh.cellSize);
        }
    }

    destroy(): void {
        this.graphics.destroy();
    }
}
