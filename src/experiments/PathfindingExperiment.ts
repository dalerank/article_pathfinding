// Spec section 13 "A* / Hierarchical A*": visualizes explored cells,
// regions, and the final path. Hierarchical A* is still Phase 3 — for now
// this builds the plain-A* half: a small S-shaped maze that forces the path
// to bend, so it's visibly different from the straight-line seek used by
// the other example pages.

import { buildNavMesh } from "@/navigation/NavMeshBuilder";
import { buildRegionGraph } from "@/navigation/HierarchicalAStar";
import type { Simulation } from "@/simulation/Simulation";
import type { Experiment } from "./Experiment";

export interface PathfindingOptions {
    agentCount: number;
    cellSize: number;
    regionSize: number;
}

export const DEFAULT_PATHFINDING_OPTIONS: PathfindingOptions = {
    agentCount: 10,
    cellSize: 20,
    regionSize: 6,
};

export function configurePathfinding(simulation: Simulation, options: Partial<PathfindingOptions> = {}): void {
    const opts = { ...DEFAULT_PATHFINDING_OPTIONS, ...options };
    const world = simulation.world;

    world.agents.length = 0;
    world.obstacles.length = 0;
    simulation.resetClock();

    // Two staggered walls: gap at the bottom of the first, gap at the top of
    // the second, forcing an S-shaped detour instead of a straight line.
    const wallWidth = 40;
    simulation.addObstacle(world.width * 0.28, 0, wallWidth, world.height * 0.67);
    simulation.addObstacle(world.width * 0.56, world.height * 0.33, wallWidth, world.height * 0.67);

    const navMesh = buildNavMesh(world, opts.cellSize);
    simulation.setNavMesh(navMesh);
    simulation.setRegionGraph(buildRegionGraph(navMesh, opts.regionSize));

    const startX = world.width * 0.05;
    const midY = world.height / 2;
    simulation.setTarget({ x: world.width - startX, y: midY });

    for (let i = 0; i < opts.agentCount; i++) {
        const y = midY - 60 + Math.random() * 120;
        simulation.addAgent({ x: startX + Math.random() * 20, y });
    }
}

export const PathfindingExperiment: Experiment = {
    id: "pathfinding",
    label: "A* vs Hierarchical A*",
    setup(simulation: Simulation): void {
        configurePathfinding(simulation);
    },
};
