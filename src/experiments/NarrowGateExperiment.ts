// Spec section 13 "Narrow Gate": two walls with an adjustable gate width,
// measuring average clearance and time-to-target for a crowd.

import type { Simulation } from "@/simulation/Simulation";
import type { Experiment } from "./Experiment";

export const NarrowGateExperiment: Experiment = {
    id: "narrow-gate",
    label: "Narrow Gate",
    setup(_simulation: Simulation): void {
        throw new Error("NarrowGateExperiment.setup: not implemented yet (Phase 7)");
    },
};
