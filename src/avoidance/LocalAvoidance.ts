// Phase 4 (spec section 11): blends desired velocity (from global navigation)
// with an avoidance vector computed from nearby agents.
// finalVelocity = desiredVelocity * desiredWeight + avoidanceVelocity * avoidanceWeight

import type { Agent } from "@/simulation/Agent";
import type { Vec2 } from "@/simulation/Vec2";

export interface AvoidanceWeights {
    desiredWeight: number;
    avoidanceWeight: number;
}

export const DEFAULT_AVOIDANCE_WEIGHTS: AvoidanceWeights = {
    desiredWeight: 0.7,
    avoidanceWeight: 0.3,
};

export function computeAvoidanceVelocity(_agent: Agent, _neighbors: Agent[]): Vec2 {
    throw new Error("LocalAvoidance.computeAvoidanceVelocity: not implemented yet (Phase 4)");
}
