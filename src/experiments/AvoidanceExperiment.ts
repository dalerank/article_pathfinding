// Spec section 13 "Local Avoidance" and "Avoidance Priority": toggling
// avoidance on/off, and comparing uniform vs. randomized avoidancePriority.

import type { Simulation } from "@/simulation/Simulation";
import type { Experiment } from "./Experiment";
import { configureNarrowGate } from "./NarrowGateExperiment";
import { assignPriorities, type PriorityMode } from "@/avoidance/AvoidancePriority";

export const LocalAvoidanceExperiment: Experiment = {
    id: "avoidance",
    label: "Local Avoidance",
    setup(_simulation: Simulation): void {
        throw new Error("LocalAvoidanceExperiment.setup: not implemented yet (Phase 7)");
    },
};

export interface AvoidancePriorityOptions {
    gateWidth: number;
    agentCount: number;
    mode: PriorityMode;
}

export const DEFAULT_AVOIDANCE_PRIORITY_OPTIONS: AvoidancePriorityOptions = {
    gateWidth: 60,
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
