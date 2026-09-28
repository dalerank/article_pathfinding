// Phase 2 (spec section 7): point <-> cell lookups and "snap to nearest
// walkable cell" queries (article: NavMesh.SamplePosition equivalent).

import { distance, type Vec2 } from "@/simulation/Vec2";
import type { NavCell, NavMesh } from "./NavMesh";

export function cellIndex(navMesh: NavMesh, col: number, row: number): number {
    return row * navMesh.cols + col;
}

export function cellAt(navMesh: NavMesh, col: number, row: number): NavCell | null {
    if (col < 0 || row < 0 || col >= navMesh.cols || row >= navMesh.rows) return null;
    return navMesh.cells[cellIndex(navMesh, col, row)];
}

export function cellCenter(navMesh: NavMesh, cell: Pick<NavCell, "x" | "y">): Vec2 {
    return { x: (cell.x + 0.5) * navMesh.cellSize, y: (cell.y + 0.5) * navMesh.cellSize };
}

export function worldToCell(navMesh: NavMesh, point: Vec2): NavCell | null {
    return cellAt(navMesh, Math.floor(point.x / navMesh.cellSize), Math.floor(point.y / navMesh.cellSize));
}

/** Article's NavMesh.SamplePosition equivalent: nearest walkable cell center within maxRadius, or null. */
export function findNearestWalkable(navMesh: NavMesh, point: Vec2, maxRadius: number): Vec2 | null {
    const origin = worldToCell(navMesh, point);
    if (origin?.walkable) return cellCenter(navMesh, origin);

    const originCol = Math.floor(point.x / navMesh.cellSize);
    const originRow = Math.floor(point.y / navMesh.cellSize);
    const maxRing = Math.ceil(maxRadius / navMesh.cellSize);

    for (let ring = 1; ring <= maxRing; ring++) {
        let best: Vec2 | null = null;
        let bestDist = Infinity;

        for (let dx = -ring; dx <= ring; dx++) {
            for (let dy = -ring; dy <= ring; dy++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue; // only this ring's border
                const cell = cellAt(navMesh, originCol + dx, originRow + dy);
                if (!cell?.walkable) continue;
                const center = cellCenter(navMesh, cell);
                const d = distance(center, point);
                if (d <= maxRadius && d < bestDist) {
                    bestDist = d;
                    best = center;
                }
            }
        }

        if (best) return best;
    }

    return null;
}
