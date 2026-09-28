// Spec section 13 "Local Avoidance" and "Avoidance Priority": toggling
// avoidance on/off, and comparing uniform vs. randomized avoidancePriority.

import type { Simulation } from "@/simulation/Simulation";
import type { Experiment } from "./Experiment";

export const LocalAvoidanceExperiment: Experiment = {
    id: "avoidance",
    label: "Local Avoidance",
    setup(_simulation: Simulation): void {
        throw new Error("LocalAvoidanceExperiment.setup: not implemented yet (Phase 7)");
    },
};

export const AvoidancePriorityExperiment: Experiment = {
    id: "avoidance-priority",
    label: "Avoidance Priority",
    setup(_simulation: Simulation): void {
        throw new Error("AvoidancePriorityExperiment.setup: not implemented yet (Phase 7)");
    },
};
