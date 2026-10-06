// Spec: "A* Cost at Scale" — no crowd, no avoidance, just the article's raw
// claim: on a NavMesh with tens of thousands of cells, a single corner-to-corner
// findPath() call touches a large fraction of it, and firing that same query
// N times synchronously (instead of queuing it) is a real, measurable freeze.

import { createWorld } from "@/simulation/World";
import { createTarget } from "@/simulation/Target";
import type { World } from "@/simulation/World";
import { createObstacle } from "@/simulation/Obstacle";
import { buildNavMesh } from "@/navigation/NavMeshBuilder";
import type { NavMesh } from "@/navigation/NavMesh";

/** cols * rows lands close to the article's "41k polygons" — see the live cell count in the UI instead of trusting this comment. */
export const SCALE_WORLD_WIDTH = 900;
export const SCALE_WORLD_HEIGHT = 600;
export const SCALE_CELL_SIZE = 3.5;
const OBSTACLE_COUNT = 12;
const OBSTACLE_MIN_SIDE = 80;
const OBSTACLE_MAX_SIDE = 220;

export function buildScaleWorld(): World {
    return createWorld(createTarget({ x: 0, y: 0 }), SCALE_WORLD_WIDTH, SCALE_WORLD_HEIGHT);
}

/** Scatters random rectangles so a corner-to-corner path has to wind through the map instead of one straight diagonal. */
export function scatterObstacles(world: World): void {
    world.obstacles.length = 0;
    const span = OBSTACLE_MAX_SIDE - OBSTACLE_MIN_SIDE;
    for (let i = 0; i < OBSTACLE_COUNT; i++) {
        const width = OBSTACLE_MIN_SIDE + Math.random() * span;
        const height = OBSTACLE_MIN_SIDE + Math.random() * span;
        const x = Math.random() * (world.width - width);
        const y = Math.random() * (world.height - height);
        world.obstacles.push(createObstacle({ x, y, width, height }));
    }
}

export function buildScaleNavMesh(world: World): NavMesh {
    return buildNavMesh(world, SCALE_CELL_SIZE);
}
