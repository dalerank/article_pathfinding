// Spec: "Effective Width" pins the gate to the article's exact numbers (1.6 m
// visual width, 0.5 m agent radius -> 0.6 m of room left for the agent's
// center) and varies only the agent count, to demonstrate: one agent passes
// cleanly, two already interfere at the opening, and two hundred jam —
// even though the NavMesh honestly reports a path exists the whole time.

import type { Simulation } from "@/simulation/Simulation";
import type { Experiment } from "./Experiment";
import { DEFAULT_AGENT_RADIUS } from "@/simulation/Agent";

/** 1 m = 16 px, so that DEFAULT_AGENT_RADIUS (8 px) is exactly the article's 0.5 m. */
export const METERS_TO_PX = DEFAULT_AGENT_RADIUS / 0.5;

export const GATE_WIDTH_M = 1.6;
export const GATE_WIDTH_PX = GATE_WIDTH_M * METERS_TO_PX;
export const WALL_THICKNESS = 40;

export interface EffectiveWidthOptions {
    agentCount: number;
}

export const DEFAULT_EFFECTIVE_WIDTH_OPTIONS: EffectiveWidthOptions = {
    agentCount: 1,
};

/** Builds the fixed 1.6 m gate and spawns agentCount agents on the left, target on the right. */
export function configureEffectiveWidth(simulation: Simulation, options: Partial<EffectiveWidthOptions> = {}): void {
    const opts = { ...DEFAULT_EFFECTIVE_WIDTH_OPTIONS, ...options };
    const world = simulation.world;

    world.agents.length = 0;
    world.obstacles.length = 0;

    const midX = world.width / 2;
    const midY = world.height / 2;
    const gapTop = midY - GATE_WIDTH_PX / 2;
    const gapBottom = midY + GATE_WIDTH_PX / 2;

    if (gapTop > 0) {
        simulation.addObstacle(midX - WALL_THICKNESS / 2, 0, WALL_THICKNESS, gapTop);
    }
    if (gapBottom < world.height) {
        simulation.addObstacle(midX - WALL_THICKNESS / 2, gapBottom, WALL_THICKNESS, world.height - gapBottom);
    }

    simulation.setTarget({ x: world.width - 40, y: midY });
    simulation.resetClock();

    const spawnMaxX = Math.max(30, midX - WALL_THICKNESS / 2 - 30);
    for (let i = 0; i < opts.agentCount; i++) {
        const x = 15 + Math.random() * (spawnMaxX - 15);
        const y = 15 + Math.random() * (world.height - 30);
        simulation.addAgent({ x, y });
    }
}

export const EffectiveWidthExperiment: Experiment = {
    id: "effective-width",
    label: "Effective Width",
    setup(simulation: Simulation): void {
        configureEffectiveWidth(simulation);
    },
};
