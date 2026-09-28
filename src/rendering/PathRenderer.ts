// Phase 2 (spec section 8): draws each agent's Agent.path as a polyline,
// from its current position through the remaining unvisited waypoints.

import type Phaser from "phaser";
import type { Agent } from "@/simulation/Agent";

const PATH_COLOR = 0x66bb6a;
const PATH_ALPHA = 0.6;

export class PathRenderer {
    private readonly graphics: Phaser.GameObjects.Graphics;

    constructor(scene: Phaser.Scene) {
        this.graphics = scene.add.graphics();
    }

    render(agents: Agent[]): void {
        this.graphics.clear();
        this.graphics.lineStyle(1.5, PATH_COLOR, PATH_ALPHA);

        for (const agent of agents) {
            if (agent.path.length === 0) continue;

            this.graphics.beginPath();
            this.graphics.moveTo(agent.position.x, agent.position.y);
            for (let i = agent.pathIndex; i < agent.path.length; i++) {
                this.graphics.lineTo(agent.path[i].x, agent.path[i].y);
            }
            this.graphics.strokePath();
        }
    }

    destroy(): void {
        this.graphics.destroy();
    }
}
