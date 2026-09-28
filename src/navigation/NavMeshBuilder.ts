// Phase 2 (spec section 7): builds a NavMesh grid from World obstacles.
// TODO: mark cells covered by obstacles (inflated by agent radius) as not walkable.

import type { World } from "@/simulation/World";
import type { NavMesh } from "./NavMesh";

export function buildNavMesh(_world: World, _cellSize = 16): NavMesh {
    throw new Error("NavMeshBuilder.buildNavMesh: not implemented yet (Phase 2)");
}
