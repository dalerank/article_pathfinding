// Phase 3 (spec section 9): coarse region graph + portal search, then a
// regular A* refinement only between consecutive portals — instead of one
// A* over the whole grid, we run a cheap search over ~dozens of regions
// plus a handful of short local A* legs between nearby points.

import type { Vec2 } from "@/simulation/Vec2";
import type { NavCell, NavMesh } from "./NavMesh";
import { cellAt, cellCenter, cellIndex, worldToCell } from "./NavMeshQuery";
import { DEFAULT_ASTAR_OPTIONS, findPath, type AStarDebugInfo } from "./AStar";

export interface Region {
    id: number;
    cells: NavCell[];
    neighbors: number[];
}

export interface RegionGraph {
    regionSize: number;
    regionCols: number;
    regionRows: number;
    regions: Region[];
    /** cell index (row * navMesh.cols + col) -> region id */
    regionIndexByCell: number[];
    /** unordered region-pair key ("a-b", a<b) -> representative portal point in world coords */
    portalPoint: Map<string, Vec2>;
}

export interface HierarchicalDebugInfo extends AStarDebugInfo {
    regionPath: number[];
}

export function buildRegionGraph(navMesh: NavMesh, regionSize = 6): RegionGraph {
    const regionCols = Math.ceil(navMesh.cols / regionSize);
    const regionRows = Math.ceil(navMesh.rows / regionSize);
    const regionCount = regionCols * regionRows;

    const regions: Region[] = Array.from({ length: regionCount }, (_, id) => ({ id, cells: [], neighbors: [] }));
    const neighborSets: Array<Set<number>> = Array.from({ length: regionCount }, () => new Set());
    const regionIndexByCell: number[] = new Array(navMesh.cells.length).fill(-1);

    const regionIdFor = (col: number, row: number): number =>
        Math.floor(row / regionSize) * regionCols + Math.floor(col / regionSize);

    for (const cell of navMesh.cells) {
        const regionId = regionIdFor(cell.x, cell.y);
        regions[regionId].cells.push(cell);
        regionIndexByCell[cellIndex(navMesh, cell.x, cell.y)] = regionId;
    }

    const portalSum = new Map<string, { x: number; y: number; count: number }>();

    const considerBorder = (cellA: NavCell, cellB: NavCell): void => {
        if (!cellA.walkable || !cellB.walkable) return;
        const regionA = regionIdFor(cellA.x, cellA.y);
        const regionB = regionIdFor(cellB.x, cellB.y);
        if (regionA === regionB) return;

        neighborSets[regionA].add(regionB);
        neighborSets[regionB].add(regionA);

        const key = pairKey(regionA, regionB);
        const mid = midpoint(navMesh, cellA, cellB);
        const entry = portalSum.get(key) ?? { x: 0, y: 0, count: 0 };
        entry.x += mid.x;
        entry.y += mid.y;
        entry.count += 1;
        portalSum.set(key, entry);
    };

    for (let row = 0; row < navMesh.rows; row++) {
        for (let col = 0; col < navMesh.cols; col++) {
            const cell = cellAt(navMesh, col, row)!;
            const right = cellAt(navMesh, col + 1, row);
            const down = cellAt(navMesh, col, row + 1);
            if (right) considerBorder(cell, right);
            if (down) considerBorder(cell, down);
        }
    }

    for (const region of regions) {
        region.neighbors = Array.from(neighborSets[region.id]);
    }

    const portalPoint = new Map<string, Vec2>();
    for (const [key, sum] of portalSum) {
        portalPoint.set(key, { x: sum.x / sum.count, y: sum.y / sum.count });
    }

    return { regionSize, regionCols, regionRows, regions, regionIndexByCell, portalPoint };
}

export function findHierarchicalPath(
    navMesh: NavMesh,
    graph: RegionGraph,
    start: Vec2,
    target: Vec2,
    debug?: HierarchicalDebugInfo,
): Vec2[] {
    const startCell = worldToCell(navMesh, start);
    const targetCell = worldToCell(navMesh, target);
    if (!startCell?.walkable || !targetCell?.walkable) return [];

    const startRegion = graph.regionIndexByCell[cellIndex(navMesh, startCell.x, startCell.y)];
    const targetRegion = graph.regionIndexByCell[cellIndex(navMesh, targetCell.x, targetCell.y)];
    if (startRegion < 0 || targetRegion < 0) return [];

    const regionPath = findRegionPath(graph, startRegion, targetRegion);
    if (regionPath.length === 0) return [];
    debug?.regionPath.push(...regionPath);

    // Agent -> portal(r0,r1) -> portal(r1,r2) -> ... -> Target (spec section 9).
    const chain: Vec2[] = [start];
    for (let i = 0; i < regionPath.length - 1; i++) {
        const portal = graph.portalPoint.get(pairKey(regionPath[i], regionPath[i + 1]));
        if (portal) chain.push(portal);
    }
    chain.push(target);

    const fullPath: Vec2[] = [];
    for (let i = 0; i < chain.length - 1; i++) {
        const leg = findPath(navMesh, chain[i], chain[i + 1], DEFAULT_ASTAR_OPTIONS, debug);
        if (leg.length === 0) return [];
        fullPath.push(...leg);
    }
    return fullPath;
}

function findRegionPath(graph: RegionGraph, startRegion: number, targetRegion: number): number[] {
    if (startRegion === targetRegion) return [startRegion];

    const queue: number[] = [startRegion];
    const cameFrom = new Map<number, number>();
    const visited = new Set<number>([startRegion]);

    while (queue.length > 0) {
        const current = queue.shift()!;
        if (current === targetRegion) break;
        for (const next of graph.regions[current].neighbors) {
            if (visited.has(next)) continue;
            visited.add(next);
            cameFrom.set(next, current);
            queue.push(next);
        }
    }

    if (!visited.has(targetRegion)) return [];

    const path: number[] = [targetRegion];
    let node = targetRegion;
    while (node !== startRegion) {
        node = cameFrom.get(node)!;
        path.push(node);
    }
    return path.reverse();
}

function pairKey(a: number, b: number): string {
    return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function midpoint(navMesh: NavMesh, a: NavCell, b: NavCell): Vec2 {
    const ca = cellCenter(navMesh, a);
    const cb = cellCenter(navMesh, b);
    return { x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2 };
}
