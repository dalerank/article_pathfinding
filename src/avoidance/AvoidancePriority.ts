// Phase 4 (spec section 12): compares symmetric priority (all = 50) against
// randomized priority (0..99 via seeded random) to demonstrate how breaking
// symmetry reduces congestion at bottlenecks.

import type { Agent } from "@/simulation/Agent";

export type PriorityMode = "uniform" | "random";

export function assignPriorities(agents: Agent[], mode: PriorityMode, random: () => number = Math.random): void {
    for (const agent of agents) {
        agent.avoidancePriority = mode === "uniform" ? 50 : Math.floor(random() * 100);
    }
}
