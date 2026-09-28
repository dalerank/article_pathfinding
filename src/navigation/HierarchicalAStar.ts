// Phase 3 (spec section 9): coarse region graph + portal search, then a
// regular A* refinement only inside the regions the coarse path passes through.

import type { Vec2 } from "@/simulation/Vec2";
import type { NavCell, NavMesh } from "./NavMesh";

export interface Region {
    id: number;
    cells: NavCell[];
    neighbors: number[];
}

export function buildRegions(_navMesh: NavMesh): Region[] {
    throw new Error("HierarchicalAStar.buildRegions: not implemented yet (Phase 3)");
}

export function findHierarchicalPath(_navMesh: NavMesh, _regions: Region[], _start: Vec2, _target: Vec2): Vec2[] {
    throw new Error("HierarchicalAStar.findHierarchicalPath: not implemented yet (Phase 3)");
}
