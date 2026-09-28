// Spec section 13 "Narrow Gate": two walls with an adjustable gate width,
// measuring average clearance and time-to-target for a crowd.

import type { Simulation } from "@/simulation/Simulation";
import type { Experiment } from "./Experiment";

export interface NarrowGateOptions {
    gateWidth: number;
    wallThickness: number;
    agentCount: number;
}

export const DEFAULT_NARROW_GATE_OPTIONS: NarrowGateOptions = {
    gateWidth: 80,
    wallThickness: 40,
    agentCount: 60,
};

/** Builds a vertical wall with a gap (the gate) and spawns agents on the left, target on the right. */
export function configureNarrowGate(simulation: Simulation, options: Partial<NarrowGateOptions> = {}): void {
    const opts = { ...DEFAULT_NARROW_GATE_OPTIONS, ...options };
    const world = simulation.world;

    world.agents.length = 0;
    world.obstacles.length = 0;

    const midX = world.width / 2;
    const midY = world.height / 2;
    const gapTop = midY - opts.gateWidth / 2;
    const gapBottom = midY + opts.gateWidth / 2;

    if (gapTop > 0) {
        simulation.addObstacle(midX - opts.wallThickness / 2, 0, opts.wallThickness, gapTop);
    }
    if (gapBottom < world.height) {
        simulation.addObstacle(midX - opts.wallThickness / 2, gapBottom, opts.wallThickness, world.height - gapBottom);
    }

    simulation.setTarget({ x: world.width - 40, y: midY });
    simulation.resetClock();

    const spawnMaxX = Math.max(30, midX - opts.wallThickness / 2 - 30);
    for (let i = 0; i < opts.agentCount; i++) {
        const x = 15 + Math.random() * (spawnMaxX - 15);
        const y = 15 + Math.random() * (world.height - 30);
        simulation.addAgent({ x, y });
    }
}

export const NarrowGateExperiment: Experiment = {
    id: "narrow-gate",
    label: "Narrow Gate",
    setup(simulation: Simulation): void {
        configureNarrowGate(simulation);
    },
};
