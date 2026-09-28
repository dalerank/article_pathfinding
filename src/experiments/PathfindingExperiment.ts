// Spec section 13 "A* / Hierarchical A*": visualizes explored cells,
// regions, and the final path for both algorithms side by side.

import type { Simulation } from "@/simulation/Simulation";
import type { Experiment } from "./Experiment";

export const PathfindingExperiment: Experiment = {
    id: "pathfinding",
    label: "A* vs Hierarchical A*",
    setup(_simulation: Simulation): void {
        throw new Error("PathfindingExperiment.setup: not implemented yet (Phase 7)");
    },
};
