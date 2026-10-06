// Spec: "Target Snapping" — a hero agent whose destination you click, plus a
// sealed room with no door (walkable on the NavMesh, but disconnected from
// everything else). Demonstrates the article's two distinct "NPC looks stuck"
// causes: a click that never lands on the NavMesh at all (SetDestination's
// false, usually ignored), and a click on a perfectly valid but unreachable
// cell (findPath() runs and finds nothing — or, in "partial" mode, stops at
// the nearest reachable point instead of giving up).

import { buildNavMesh } from "@/navigation/NavMeshBuilder";
import { findNearestWalkable } from "@/navigation/NavMeshQuery";
import { DEFAULT_AGENT_RADIUS } from "@/simulation/Agent";
import type { Simulation } from "@/simulation/Simulation";
import type { Vec2 } from "@/simulation/Vec2";
import type { Experiment } from "./Experiment";

export const CELL_SIZE = 20;
export const SEALED_ROOM = { x: 620, y: 60, width: 180, height: 120 };
const WALL_THICKNESS = 16;

export function configureTargetSnapping(simulation: Simulation): void {
    const world = simulation.world;

    world.agents.length = 0;
    world.obstacles.length = 0;
    simulation.resetClock();

    const { x, y, width, height } = SEALED_ROOM;
    // Four walls, no gap anywhere — the interior is walkable NavMesh, but
    // topologically disconnected from the rest of the floor.
    simulation.addObstacle(x - WALL_THICKNESS, y - WALL_THICKNESS, width + 2 * WALL_THICKNESS, WALL_THICKNESS);
    simulation.addObstacle(x - WALL_THICKNESS, y + height, width + 2 * WALL_THICKNESS, WALL_THICKNESS);
    simulation.addObstacle(x - WALL_THICKNESS, y - WALL_THICKNESS, WALL_THICKNESS, height + 2 * WALL_THICKNESS);
    simulation.addObstacle(x + width, y - WALL_THICKNESS, WALL_THICKNESS, height + 2 * WALL_THICKNESS);

    const navMesh = buildNavMesh(world, CELL_SIZE);
    simulation.setNavMesh(navMesh);

    const start = { x: 40, y: world.height / 2 };
    simulation.setTarget(start);
    const hero = simulation.addAgent(start);
    // Frozen until the user actually clicks somewhere — addAgent() above requested a
    // (trivial, same-point) path toward the placeholder target above; discard it.
    hero.destination = null;
    hero.path = [];
    hero.pathIndex = 0;
}

/** Scatters `count` agents across the full world rect — some will land inside obstacles. */
export function scatterSpawn(simulation: Simulation, count: number, snapToNavMesh: boolean): void {
    const world = simulation.world;
    const navMesh = simulation.navMesh;

    for (let i = 0; i < count; i++) {
        const point: Vec2 = {
            x: DEFAULT_AGENT_RADIUS + Math.random() * (world.width - 2 * DEFAULT_AGENT_RADIUS),
            y: DEFAULT_AGENT_RADIUS + Math.random() * (world.height - 2 * DEFAULT_AGENT_RADIUS),
        };

        let spawnAt = point;
        if (snapToNavMesh && navMesh) {
            const snapped = findNearestWalkable(navMesh, point, 120);
            if (snapped) spawnAt = snapped;
        }

        const agent = simulation.addAgent(spawnAt);
        // These are spawn-point props, not path-seeking agents — addAgent() above
        // requested a path toward the hero's placeholder target; discard it.
        agent.destination = null;
        agent.path = [];
        agent.pathIndex = 0;
    }
}

export const TargetSnappingExperiment: Experiment = {
    id: "target-snapping",
    label: "Target Snapping",
    setup(simulation: Simulation): void {
        configureTargetSnapping(simulation);
    },
};
