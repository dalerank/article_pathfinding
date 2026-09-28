// Phase 4 (spec section 11): blends desired velocity (from global navigation)
// with an avoidance vector computed from nearby agents.
// finalVelocity = desiredVelocity * desiredWeight + avoidanceVelocity * avoidanceWeight
//
// This is a minimal steering-based separation, not RVO/ORCA (spec section 22):
// each neighbor within range pushes the agent away, proportional to how much
// personal space is violated. Readable > accurate, per spec section 24.

import type { Agent } from "@/simulation/Agent";
import { distance, length, normalize, scale, sub, type Vec2 } from "@/simulation/Vec2";

export interface AvoidanceWeights {
    desiredWeight: number;
    avoidanceWeight: number;
}

export const DEFAULT_AVOIDANCE_WEIGHTS: AvoidanceWeights = {
    desiredWeight: 0.7,
    avoidanceWeight: 0.3,
};

/** Neighbors start to matter within this many multiples of the two agents' combined radius. */
const NEIGHBOR_RANGE_FACTOR = 4;

/**
 * How much `self` yields to `other` (spec section 12: avoidancePriority 0..99).
 * A neighbor with higher priority pushes `self` away harder (self yields more);
 * a neighbor with lower priority barely moves `self` at all (self yields less).
 * Equal priority (e.g. the default 50/50) is the symmetric case — everyone
 * yields the same amount, which is exactly what makes bottlenecks jam.
 */
function priorityYieldFactor(self: Agent, other: Agent): number {
    const diff = other.avoidancePriority - self.avoidancePriority; // -99..99
    return Math.min(2, Math.max(0, 1 + diff / 99));
}

export function computeAvoidanceVelocity(agent: Agent, allAgents: Agent[]): Vec2 {
    let push: Vec2 = { x: 0, y: 0 };

    for (const other of allAgents) {
        if (other === agent) continue;

        const range = (agent.radius + other.radius) * NEIGHBOR_RANGE_FACTOR;
        const dist = distance(agent.position, other.position);
        if (dist >= range || dist <= 0) continue;

        const away = normalize(sub(agent.position, other.position));
        const overlap = ((range - dist) / range) * priorityYieldFactor(agent, other);
        push = { x: push.x + away.x * overlap, y: push.y + away.y * overlap };
    }

    if (length(push) === 0) return push;
    return scale(normalize(push), agent.maxSpeed);
}

export function blendVelocities(
    desired: Vec2,
    avoidance: Vec2,
    weights: AvoidanceWeights = DEFAULT_AVOIDANCE_WEIGHTS,
): Vec2 {
    return {
        x: desired.x * weights.desiredWeight + avoidance.x * weights.avoidanceWeight,
        y: desired.y * weights.desiredWeight + avoidance.y * weights.avoidanceWeight,
    };
}
