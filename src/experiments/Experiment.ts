// Phase 7 (spec sections 13, 17, 21): preset experiments reset the world into
// a prepared state and are addressable via ?experiment=<id>.

import type { Simulation } from "@/simulation/Simulation";

export interface Experiment {
    id: string;
    label: string;
    setup(simulation: Simulation): void;
}
