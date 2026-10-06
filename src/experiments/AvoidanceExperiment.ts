// Spec section 13 "Local Avoidance" and "Avoidance Priority": toggling
// avoidance on/off, and comparing uniform vs. randomized avoidancePriority.

import type { Simulation } from "@/simulation/Simulation";
import type { Experiment } from "./Experiment";
import { configureNarrowGate } from "./NarrowGateExperiment";
import { assignPriorities, type PriorityMode } from "@/avoidance/AvoidancePriority";

export interface LocalAvoidanceOptions {
    agentCount: number;
    circleRadius: number;
}

export const DEFAULT_LOCAL_AVOIDANCE_OPTIONS: LocalAvoidanceOptions = {
    agentCount: 20,
    circleRadius: 220,
};

/**
 * Agents placed evenly on a circle, each one's destination is the
 * diametrically opposite point — everyone has to cross through the center
 * at once, which is the classic way to show what local avoidance alone
 * (no global path) actually does.
 */
export function configureLocalAvoidance(simulation: Simulation, options: Partial<LocalAvoidanceOptions> = {}): void {
    const opts = { ...DEFAULT_LOCAL_AVOIDANCE_OPTIONS, ...options };
    const world = simulation.world;

    world.agents.length = 0;
    world.obstacles.length = 0;
    simulation.resetClock();

    const center = { x: world.width / 2, y: world.height / 2 };
    for (let i = 0; i < opts.agentCount; i++) {
        const angle = (i / opts.agentCount) * Math.PI * 2;
        const start = {
            x: center.x + Math.cos(angle) * opts.circleRadius,
            y: center.y + Math.sin(angle) * opts.circleRadius,
        };
        const destination = {
            x: center.x - Math.cos(angle) * opts.circleRadius,
            y: center.y - Math.sin(angle) * opts.circleRadius,
        };
        simulation.addAgent(start, { destination });
    }
}

export const LocalAvoidanceExperiment: Experiment = {
    id: "avoidance",
    label: "Local Avoidance",
    setup(simulation: Simulation): void {
        configureLocalAvoidance(simulation);
    },
};

export interface AvoidancePriorityOptions {
    gateWidth: number;
    agentCount: number;
    mode: PriorityMode;
}

export const DEFAULT_AVOIDANCE_PRIORITY_OPTIONS: AvoidancePriorityOptions = {
    // Single-file width (article/Effective Width math: 1.6 m gate, 0.5 m radius -> ~0.6 m
    // left for the center). Wide enough for ~2-3 agents abreast and priority stops mattering
    // — nobody has to take turns, so Uniform and Random clear at about the same rate.
    gateWidth: 26,
    agentCount: 80,
    mode: "uniform",
};

/** Same narrow-gate bottleneck as NarrowGateExperiment, plus assigned avoidancePriority. */
export function configureAvoidancePriority(
    simulation: Simulation,
    options: Partial<AvoidancePriorityOptions> = {},
): void {
    const opts = { ...DEFAULT_AVOIDANCE_PRIORITY_OPTIONS, ...options };
    configureNarrowGate(simulation, { gateWidth: opts.gateWidth, agentCount: opts.agentCount });
    assignPriorities(simulation.world.agents, opts.mode);
}

export const AvoidancePriorityExperiment: Experiment = {
    id: "avoidance-priority",
    label: "Avoidance Priority",
    setup(simulation: Simulation): void {
        configureAvoidancePriority(simulation);
    },
};
