// Phase 2 (spec section 7): point <-> cell lookups and "snap to nearest
// walkable cell" queries (article: NavMesh.SamplePosition equivalent).

import type { Vec2 } from "@/simulation/Vec2";
import type { NavCell, NavMesh } from "./NavMesh";

export function worldToCell(_navMesh: NavMesh, _point: Vec2): NavCell | null {
    throw new Error("NavMeshQuery.worldToCell: not implemented yet (Phase 2)");
}

export function findNearestWalkable(_navMesh: NavMesh, _point: Vec2, _maxRadius: number): Vec2 | null {
    throw new Error("NavMeshQuery.findNearestWalkable: not implemented yet (Phase 2)");
}
