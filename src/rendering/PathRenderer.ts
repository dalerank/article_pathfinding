// Phase 2 (spec section 8): draws Agent.path as a polyline. Not implemented
// yet since pathfinding itself (AStar.ts) is still a stub.

import type Phaser from "phaser";
import type { Agent } from "@/simulation/Agent";

export class PathRenderer {
    constructor(_scene: Phaser.Scene) {}

    render(_agents: Agent[]): void {
        // TODO(Phase 2): draw agent.path polylines once AStar produces paths.
    }

    destroy(): void {}
}
