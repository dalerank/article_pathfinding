// Spec section 13 "Dynamic Obstacles": draggable obstacle, counting NavMesh
// rebuilds and their cost.

import type { Simulation } from "@/simulation/Simulation";
import type { Experiment } from "./Experiment";

export const DynamicObstacleExperiment: Experiment = {
    id: "dynamic-obstacles",
    label: "Dynamic Obstacles",
    setup(_simulation: Simulation): void {
        throw new Error("DynamicObstacleExperiment.setup: not implemented yet (Phase 7)");
    },
};
