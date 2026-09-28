// Phase 5 (spec section 10): draws direction-field arrows over the grid.

import type Phaser from "phaser";
import type { FlowField } from "@/navigation/FlowField";

export class FlowFieldRenderer {
    constructor(_scene: Phaser.Scene) {}

    render(_field: FlowField | null): void {
        // TODO(Phase 5): draw one arrow per cell along field.direction.
    }

    destroy(): void {}
}
