// Phase 2 (spec section 8): plain A* over the NavMesh grid, 4/8-directional,
// Manhattan/Euclidean heuristic. Debug mode exposes open/closed sets for
// visualization. Open list is a linear scan, not a heap — the sandbox's
// grids are small enough that readability wins (spec section 24).

import type { Vec2 } from "@/simulation/Vec2";
import type { NavMesh } from "./NavMesh";
import { cellAt, cellCenter, cellIndex, worldToCell } from "./NavMeshQuery";

export interface AStarOptions {
    diagonal: boolean;
    heuristic: "manhattan" | "euclidean";
}

export const DEFAULT_ASTAR_OPTIONS: AStarOptions = { diagonal: true, heuristic: "euclidean" };

export interface AStarDebugInfo {
    openSet: Vec2[];
    closedSet: Vec2[];
}

interface NodeRecord {
    col: number;
    row: number;
    g: number;
    f: number;
    parent: NodeRecord | null;
}

export function findPath(
    navMesh: NavMesh,
    start: Vec2,
    target: Vec2,
    options: AStarOptions = DEFAULT_ASTAR_OPTIONS,
    debug?: AStarDebugInfo,
): Vec2[] {
    const startCell = worldToCell(navMesh, start);
    const targetCell = worldToCell(navMesh, target);
    if (!startCell?.walkable || !targetCell?.walkable) return [];

    const targetIndex = cellIndex(navMesh, targetCell.x, targetCell.y);
    if (cellIndex(navMesh, startCell.x, startCell.y) === targetIndex) return [target];

    const open: NodeRecord[] = [
        {
            col: startCell.x,
            row: startCell.y,
            g: 0,
            f: heuristic(startCell.x, startCell.y, targetCell.x, targetCell.y, options.heuristic),
            parent: null,
        },
    ];
    const bestG = new Map<number, number>([[cellIndex(navMesh, startCell.x, startCell.y), 0]]);
    const closed = new Set<number>();

    while (open.length > 0) {
        let bestIdx = 0;
        for (let i = 1; i < open.length; i++) {
            if (open[i].f < open[bestIdx].f) bestIdx = i;
        }
        const current = open.splice(bestIdx, 1)[0];
        const currentIndex = cellIndex(navMesh, current.col, current.row);
        if (closed.has(currentIndex)) continue;
        closed.add(currentIndex);
        debug?.closedSet.push(cellCenter(navMesh, { x: current.col, y: current.row }));

        if (currentIndex === targetIndex) {
            return reconstructPath(navMesh, current, target);
        }

        for (const neighbor of neighbors(navMesh, current, options.diagonal)) {
            const neighborIndex = cellIndex(navMesh, neighbor.col, neighbor.row);
            if (closed.has(neighborIndex)) continue;

            const g = current.g + neighbor.cost;
            if ((bestG.get(neighborIndex) ?? Infinity) <= g) continue;

            bestG.set(neighborIndex, g);
            open.push({
                col: neighbor.col,
                row: neighbor.row,
                g,
                f: g + heuristic(neighbor.col, neighbor.row, targetCell.x, targetCell.y, options.heuristic),
                parent: current,
            });
            debug?.openSet.push(cellCenter(navMesh, { x: neighbor.col, y: neighbor.row }));
        }
    }

    return [];
}

function heuristic(col: number, row: number, targetCol: number, targetRow: number, mode: AStarOptions["heuristic"]): number {
    const dx = Math.abs(col - targetCol);
    const dy = Math.abs(row - targetRow);
    return mode === "manhattan" ? dx + dy : Math.sqrt(dx * dx + dy * dy);
}

interface Neighbor {
    col: number;
    row: number;
    cost: number;
}

const ORTHOGONAL: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
];
const DIAGONAL: Array<[number, number]> = [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
];

function neighbors(navMesh: NavMesh, node: NodeRecord, diagonal: boolean): Neighbor[] {
    const result: Neighbor[] = [];

    for (const [dx, dy] of ORTHOGONAL) {
        const cell = cellAt(navMesh, node.col + dx, node.row + dy);
        if (cell?.walkable) result.push({ col: cell.x, row: cell.y, cost: 1 * cell.cost });
    }

    if (diagonal) {
        for (const [dx, dy] of DIAGONAL) {
            const cell = cellAt(navMesh, node.col + dx, node.row + dy);
            if (!cell?.walkable) continue;
            // Don't let the path cut through a wall corner.
            const sideA = cellAt(navMesh, node.col + dx, node.row);
            const sideB = cellAt(navMesh, node.col, node.row + dy);
            if (!sideA?.walkable || !sideB?.walkable) continue;
            result.push({ col: cell.x, row: cell.y, cost: Math.SQRT2 * cell.cost });
        }
    }

    return result;
}

function reconstructPath(navMesh: NavMesh, endRecord: NodeRecord, target: Vec2): Vec2[] {
    const chain: NodeRecord[] = [];
    let node: NodeRecord | null = endRecord;
    while (node) {
        chain.push(node);
        node = node.parent;
    }
    chain.reverse();

    const waypoints = chain.slice(1).map((n) => cellCenter(navMesh, { x: n.col, y: n.row }));
    waypoints.push(target);
    return waypoints;
}
