// Phase 2 (spec section 8): plain A* over the NavMesh grid, 4/8-directional,
// Manhattan/Euclidean heuristic. Debug mode should expose open/closed sets.

import type { Vec2 } from "@/simulation/Vec2";
import type { NavMesh } from "./NavMesh";

export interface AStarOptions {
    diagonal: boolean;
    heuristic: "manhattan" | "euclidean";
}

export interface AStarDebugInfo {
    openSet: Vec2[];
    closedSet: Vec2[];
    visited: Vec2[];
}

export function findPath(
    _navMesh: NavMesh,
    _start: Vec2,
    _target: Vec2,
    _options: AStarOptions = { diagonal: true, heuristic: "euclidean" },
    _debug?: AStarDebugInfo,
): Vec2[] {
    throw new Error("AStar.findPath: not implemented yet (Phase 2)");
}
