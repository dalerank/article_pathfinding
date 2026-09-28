// Phase 8 (spec section 15): debug overlays toggled independently
// (open/closed set, velocity vectors, avoidance radius, ...).

import type Phaser from "phaser";

export interface DebugToggles {
    agents: boolean;
    paths: boolean;
    navMesh: boolean;
    regions: boolean;
    openClosedSet: boolean;
    flowField: boolean;
    velocity: boolean;
    avoidanceRadius: boolean;
    target: boolean;
    obstacles: boolean;
}

export const DEFAULT_DEBUG_TOGGLES: DebugToggles = {
    agents: true,
    paths: true,
    navMesh: false,
    regions: false,
    openClosedSet: false,
    flowField: false,
    velocity: false,
    avoidanceRadius: false,
    target: false,
    obstacles: false,
};

export class DebugRenderer {
    constructor(_scene: Phaser.Scene) {}

    render(_toggles: DebugToggles): void {
        // TODO(Phase 8): render open/closed set, avoidance radius, etc.
    }

    destroy(): void {}
}
