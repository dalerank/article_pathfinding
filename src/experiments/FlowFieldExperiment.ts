// Spec section 13 "A* / Flow Field": 200-500 agents sharing one target,
// comparing independent A* searches against one shared flow field.

import type { Simulation } from "@/simulation/Simulation";
import type { Experiment } from "./Experiment";

export const FlowFieldExperiment: Experiment = {
    id: "flow-field",
    label: "A* vs Flow Field",
    setup(_simulation: Simulation): void {
        throw new Error("FlowFieldExperiment.setup: not implemented yet (Phase 7)");
    },
};
