// Spec section 13 "A* / Flow Field": 200-500 agents sharing one target,
// comparing independent A* searches against one shared flow field.

import { buildNavMesh } from "@/navigation/NavMeshBuilder";
import type { Simulation, PathfindingAlgorithm } from "@/simulation/Simulation";
import type { Experiment } from "./Experiment";

export interface FlowFieldOptions {
    agentCount: number;
    cellSize: number;
    /** Only "astar" and "flow-field" are meaningful here; "hierarchical" behaves like "astar" for this experiment. */
    algorithm: PathfindingAlgorithm;
}

export const DEFAULT_FLOW_FIELD_OPTIONS: FlowFieldOptions = {
    agentCount: 200,
    cellSize: 20,
    algorithm: "flow-field",
};

/** Two free-standing pillars so the field visibly bends around them instead of a single straight corridor. */
export function configureFlowField(simulation: Simulation, options: Partial<FlowFieldOptions> = {}): void {
    const opts = { ...DEFAULT_FLOW_FIELD_OPTIONS, ...options };
    simulation.pathfindingAlgorithm = opts.algorithm;

    const world = simulation.world;
    world.agents.length = 0;
    world.obstacles.length = 0;
    simulation.resetClock();

    const pillarWidth = 50;
    simulation.addObstacle(world.width * 0.45, world.height * 0.15, pillarWidth, world.height * 0.25);
    simulation.addObstacle(world.width * 0.45, world.height * 0.6, pillarWidth, world.height * 0.25);

    const navMesh = buildNavMesh(world, opts.cellSize);
    simulation.setNavMesh(navMesh);
    simulation.setTarget({ x: world.width * 0.9, y: world.height / 2 });

    for (let i = 0; i < opts.agentCount; i++) {
        const x = world.width * 0.05 + Math.random() * world.width * 0.2;
        const y = 20 + Math.random() * (world.height - 40);
        simulation.addAgent({ x, y });
    }
}

export const FlowFieldExperiment: Experiment = {
    id: "flow-field",
    label: "A* vs Flow Field",
    setup(simulation: Simulation): void {
        configureFlowField(simulation);
    },
};
