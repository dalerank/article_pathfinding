import Phaser from "phaser";
import type { Agent } from "@/simulation/Agent";

const FILL_COLOR = 0x4fc3f7;
const SELECTED_COLOR = 0xffca28;

/** Draws agents as circles, reusing one Graphics object per frame (Phase 1). */
export class AgentRenderer {
    private readonly graphics: Phaser.GameObjects.Graphics;
    selectedAgentId: number | null = null;

    constructor(scene: Phaser.Scene) {
        this.graphics = scene.add.graphics();
    }

    /** `colorFor`, when given, overrides the fill color for non-selected agents (e.g. by avoidancePriority). */
    render(agents: Agent[], colorFor?: (agent: Agent) => number): void {
        this.graphics.clear();

        for (const agent of agents) {
            const isSelected = agent.id === this.selectedAgentId;
            const color = isSelected ? SELECTED_COLOR : (colorFor?.(agent) ?? FILL_COLOR);
            this.graphics.fillStyle(color, 1);
            this.graphics.fillCircle(agent.position.x, agent.position.y, agent.radius);

            if (agent.velocity.x !== 0 || agent.velocity.y !== 0) {
                const dirX = agent.position.x + (agent.velocity.x / agent.maxSpeed) * agent.radius * 1.6;
                const dirY = agent.position.y + (agent.velocity.y / agent.maxSpeed) * agent.radius * 1.6;
                this.graphics.lineStyle(1.5, 0xffffff, 0.8);
                this.graphics.lineBetween(agent.position.x, agent.position.y, dirX, dirY);
            }
        }
    }

    destroy(): void {
        this.graphics.destroy();
    }
}
