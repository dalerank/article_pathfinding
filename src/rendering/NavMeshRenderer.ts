// Phase 2 (spec section 7): draws NavMesh grid cells (walkable / regions).

import type Phaser from "phaser";
import type { NavMesh } from "@/navigation/NavMesh";

export class NavMeshRenderer {
    constructor(_scene: Phaser.Scene) {}

    render(_navMesh: NavMesh | null): void {
        // TODO(Phase 2): draw walkable/non-walkable cells and region colors.
    }

    destroy(): void {}
}
