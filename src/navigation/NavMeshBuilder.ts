// Phase 2 (spec section 7): builds a NavMesh grid from World obstacles.
// Cells within `agentRadius` of an obstacle are marked not walkable — the
// article's point about NavMesh being a separate, radius-inflated geometry,
// not the floor the player sees.

import type { Obstacle } from "@/simulation/Obstacle";
import { DEFAULT_AGENT_RADIUS } from "@/simulation/Agent";
import type { World } from "@/simulation/World";
import type { NavCell, NavMesh } from "./NavMesh";

export function buildNavMesh(world: World, cellSize = 16, agentRadius = DEFAULT_AGENT_RADIUS): NavMesh {
    const cols = Math.ceil(world.width / cellSize);
    const rows = Math.ceil(world.height / cellSize);
    const cells: NavCell[] = [];

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            cells.push({ x: col, y: row, walkable: true, regionId: -1 });
        }
    }

    const navMesh: NavMesh = { cellSize, cols, rows, cells };
    for (const obstacle of world.obstacles) {
        markUnwalkable(navMesh, obstacle, agentRadius);
    }
    return navMesh;
}

function markUnwalkable(navMesh: NavMesh, obstacle: Obstacle, agentRadius: number): void {
    const minCol = Math.max(0, Math.floor((obstacle.x - agentRadius) / navMesh.cellSize));
    const minRow = Math.max(0, Math.floor((obstacle.y - agentRadius) / navMesh.cellSize));
    const maxCol = Math.min(navMesh.cols - 1, Math.floor((obstacle.x + obstacle.width + agentRadius) / navMesh.cellSize));
    const maxRow = Math.min(navMesh.rows - 1, Math.floor((obstacle.y + obstacle.height + agentRadius) / navMesh.cellSize));

    for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
            navMesh.cells[row * navMesh.cols + col].walkable = false;
        }
    }
}
