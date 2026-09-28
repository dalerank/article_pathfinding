// Spec section 13 "Dynamic Obstacles": draggable obstacle, counting NavMesh
// rebuilds and their cost.

import { buildNavMesh } from "@/navigation/NavMeshBuilder";
import type { Obstacle } from "@/simulation/Obstacle";
import type { Simulation } from "@/simulation/Simulation";
import type { Experiment } from "./Experiment";

export interface DynamicObstacleOptions {
    agentCount: number;
    cellSize: number;
}

export const DEFAULT_DYNAMIC_OBSTACLE_OPTIONS: DynamicObstacleOptions = {
    agentCount: 12,
    cellSize: 20,
};

/** One draggable obstacle sitting in the path between spawn and target, plus a handful of agents crossing it. */
export function configureDynamicObstacles(simulation: Simulation, options: Partial<DynamicObstacleOptions> = {}): Obstacle {
    const opts = { ...DEFAULT_DYNAMIC_OBSTACLE_OPTIONS, ...options };
    const world = simulation.world;

    world.agents.length = 0;
    world.obstacles.length = 0;
    simulation.resetClock();

    const size = 80;
    const movable = simulation.addObstacle(world.width * 0.45 - size / 2, world.height * 0.4 - size / 2, size, size);

    const navMesh = buildNavMesh(world, opts.cellSize);
    simulation.setNavMesh(navMesh);
    simulation.setTarget({ x: world.width * 0.9, y: world.height / 2 });

    for (let i = 0; i < opts.agentCount; i++) {
        const x = world.width * 0.05 + Math.random() * world.width * 0.1;
        const y = world.height * 0.3 + Math.random() * world.height * 0.4;
        simulation.addAgent({ x, y });
    }

    return movable;
}

export const DynamicObstacleExperiment: Experiment = {
    id: "dynamic-obstacles",
    label: "Dynamic Obstacles",
    setup(simulation: Simulation): void {
        configureDynamicObstacles(simulation);
    },
};
