// Spec section 13 "Path Request Budget" + "Repath Jitter", article section
// "Number of requests": a budget on how many path requests get processed
// per frame, and a per-agent repath interval + jitter so agents spawned at
// the same time don't all wake up and re-request on the same frame.

import { buildNavMesh } from "@/navigation/NavMeshBuilder";
import type { Simulation } from "@/simulation/Simulation";
import type { Experiment } from "./Experiment";

export interface PathRequestOptions {
    agentCount: number;
    cellSize: number;
}

export const DEFAULT_PATH_REQUEST_OPTIONS: PathRequestOptions = {
    agentCount: 120,
    cellSize: 20,
};

/** One modest obstacle so each findPath() has real, non-trivial cost — a burst of requests should be felt. */
export function configurePathRequests(simulation: Simulation, options: Partial<PathRequestOptions> = {}): void {
    const opts = { ...DEFAULT_PATH_REQUEST_OPTIONS, ...options };
    const world = simulation.world;

    world.agents.length = 0;
    world.obstacles.length = 0;
    simulation.resetClock();

    simulation.addObstacle(world.width * 0.45 - 40, world.height * 0.35, 80, world.height * 0.3);

    const navMesh = buildNavMesh(world, opts.cellSize);
    simulation.setNavMesh(navMesh);
    simulation.setTarget({ x: world.width * 0.9, y: world.height / 2 });

    for (let i = 0; i < opts.agentCount; i++) {
        const x = world.width * 0.05 + Math.random() * world.width * 0.15;
        const y = 20 + Math.random() * (world.height - 40);
        simulation.addAgent({ x, y });
    }
}

export const PathRequestExperiment: Experiment = {
    id: "path-request-budget",
    label: "Path Request Budget",
    setup(simulation: Simulation): void {
        configurePathRequests(simulation);
    },
};
