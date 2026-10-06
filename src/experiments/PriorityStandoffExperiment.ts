// Spec: "Priority Standoff" — the symmetric-priority problem from the article,
// stripped down to exactly two agents instead of a sixty-strong crowd: A and B
// swap places through a single-file gate. With equal avoidancePriority the
// steering math is genuinely symmetric (no randomness breaks the tie), so both
// agents are "smart enough not to collide, not pushy enough to go first" —
// visible as a real stall, not an inferred one. A priority gap lets one of
// them simply bulldoze through.

import type { Simulation } from "@/simulation/Simulation";
import type { Experiment } from "./Experiment";

/** Same 1.6 m / 0.5 m radius math as Effective Width: ~0.6 m left for the center — single file only. */
const GATE_WIDTH_PX = 26;
const WALL_THICKNESS = 40;

export type PriorityMode = "uniform" | "asymmetric";

export interface PriorityStandoffOptions {
    mode: PriorityMode;
}

export const DEFAULT_PRIORITY_STANDOFF_OPTIONS: PriorityStandoffOptions = {
    mode: "uniform",
};

/** Agent A (index 0) starts left heading right, Agent B (index 1) starts right heading left — mirrored, same y. */
export function configurePriorityStandoff(simulation: Simulation, options: Partial<PriorityStandoffOptions> = {}): void {
    const opts = { ...DEFAULT_PRIORITY_STANDOFF_OPTIONS, ...options };
    const world = simulation.world;

    world.agents.length = 0;
    world.obstacles.length = 0;
    simulation.resetClock();

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

    const [priorityA, priorityB] = opts.mode === "uniform" ? [50, 50] : [90, 10];

    simulation.addAgent(
        { x: 40, y: midY },
        { avoidancePriority: priorityA, destination: { x: world.width - 40, y: midY } },
    );
    simulation.addAgent(
        { x: world.width - 40, y: midY },
        { avoidancePriority: priorityB, destination: { x: 40, y: midY } },
    );
}

export const PriorityStandoffExperiment: Experiment = {
    id: "priority-standoff",
    label: "Priority Standoff",
    setup(simulation: Simulation): void {
        configurePriorityStandoff(simulation);
    },
};
