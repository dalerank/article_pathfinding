// Phase 5 (spec section 10): shared integration field + direction field for
// crowds converging on a single target. Rebuilt on target/obstacle change,
// read by every agent instead of running independent A* per agent.

import { normalize, sub, type Vec2 } from "@/simulation/Vec2";
import type { NavMesh } from "./NavMesh";
import { cellAt, cellCenter, cellIndex, worldToCell } from "./NavMeshQuery";

export interface FlowField {
    cols: number;
    rows: number;
    cellSize: number;
    integration: Float32Array;
    direction: Vec2[];
}

interface Offset {
    dx: number;
    dy: number;
    cost: number;
}

const NEIGHBOR_OFFSETS: Offset[] = [
    { dx: 1, dy: 0, cost: 1 },
    { dx: -1, dy: 0, cost: 1 },
    { dx: 0, dy: 1, cost: 1 },
    { dx: 0, dy: -1, cost: 1 },
    { dx: 1, dy: 1, cost: Math.SQRT2 },
    { dx: 1, dy: -1, cost: Math.SQRT2 },
    { dx: -1, dy: 1, cost: Math.SQRT2 },
    { dx: -1, dy: -1, cost: Math.SQRT2 },
];

/** Dijkstra from the target outward over every walkable cell, then a direction toward each cell's cheapest neighbor. */
export function buildFlowField(navMesh: NavMesh, target: Vec2): FlowField {
    const cellCount = navMesh.cells.length;
    const integration = new Float32Array(cellCount).fill(Infinity);
    const direction: Vec2[] = new Array(cellCount);
    for (let i = 0; i < cellCount; i++) direction[i] = { x: 0, y: 0 };

    const field: FlowField = { cols: navMesh.cols, rows: navMesh.rows, cellSize: navMesh.cellSize, integration, direction };

    const targetCell = worldToCell(navMesh, target);
    if (!targetCell?.walkable) return field;

    const targetIndex = cellIndex(navMesh, targetCell.x, targetCell.y);
    integration[targetIndex] = 0;

    const visited = new Uint8Array(cellCount);
    const open: number[] = [targetIndex];

    while (open.length > 0) {
        let bestPos = 0;
        for (let i = 1; i < open.length; i++) {
            if (integration[open[i]] < integration[open[bestPos]]) bestPos = i;
        }
        const currentIndex = open.splice(bestPos, 1)[0];
        if (visited[currentIndex]) continue;
        visited[currentIndex] = 1;

        const col = currentIndex % navMesh.cols;
        const row = Math.floor(currentIndex / navMesh.cols);

        for (const { dx, dy, cost } of NEIGHBOR_OFFSETS) {
            const neighbor = cellAt(navMesh, col + dx, row + dy);
            if (!neighbor?.walkable) continue;
            if (dx !== 0 && dy !== 0) {
                // Don't let the field flow through a wall corner.
                const sideA = cellAt(navMesh, col + dx, row);
                const sideB = cellAt(navMesh, col, row + dy);
                if (!sideA?.walkable || !sideB?.walkable) continue;
            }

            const neighborIndex = cellIndex(navMesh, neighbor.x, neighbor.y);
            if (visited[neighborIndex]) continue;

            const newCost = integration[currentIndex] + cost;
            if (newCost < integration[neighborIndex]) {
                integration[neighborIndex] = newCost;
                open.push(neighborIndex);
            }
        }
    }

    for (let row = 0; row < navMesh.rows; row++) {
        for (let col = 0; col < navMesh.cols; col++) {
            const index = row * navMesh.cols + col;
            if (index === targetIndex || !Number.isFinite(integration[index])) continue;

            let bestNeighborIndex = -1;
            let bestCost = integration[index];
            for (const { dx, dy } of NEIGHBOR_OFFSETS) {
                const neighbor = cellAt(navMesh, col + dx, row + dy);
                if (!neighbor?.walkable) continue;
                const neighborIndex = cellIndex(navMesh, neighbor.x, neighbor.y);
                if (integration[neighborIndex] < bestCost) {
                    bestCost = integration[neighborIndex];
                    bestNeighborIndex = neighborIndex;
                }
            }

            if (bestNeighborIndex >= 0) {
                const from = cellCenter(navMesh, { x: col, y: row });
                const to = cellCenter(navMesh, { x: bestNeighborIndex % navMesh.cols, y: Math.floor(bestNeighborIndex / navMesh.cols) });
                direction[index] = normalize(sub(to, from));
            }
        }
    }

    return field;
}

export function sampleDirection(field: FlowField, point: Vec2): Vec2 {
    const col = Math.floor(point.x / field.cellSize);
    const row = Math.floor(point.y / field.cellSize);
    if (col < 0 || row < 0 || col >= field.cols || row >= field.rows) return { x: 0, y: 0 };
    return field.direction[row * field.cols + col];
}
