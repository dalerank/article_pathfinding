// Phase 4 (spec section 11 / 22): simplified RVO-style velocity obstacle
// avoidance. Not production ORCA — a readable demonstration only.

import type { Agent } from "@/simulation/Agent";
import type { Vec2 } from "@/simulation/Vec2";

export function computeVelocityObstacleAvoidance(_agent: Agent, _neighbors: Agent[]): Vec2 {
    throw new Error("RVO.computeVelocityObstacleAvoidance: not implemented yet (Phase 4)");
}
