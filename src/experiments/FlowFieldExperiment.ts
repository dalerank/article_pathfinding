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
    /** Side length of each square pillar — independently sized. */
    pillar1Size: number;
    pillar2Size: number;
}

export const DEFAULT_FLOW_FIELD_OPTIONS: FlowFieldOptions = {
    agentCount: 200,
    cellSize: 20,
    algorithm: "flow-field",
    pillar1Size: 80,
    pillar2Size: 80,
};

/** Two free-standing square pillars, each independently sized, so the field visibly bends around them instead of a single straight corridor. */
export function configureFlowField(simulation: Simulation, options: Partial<FlowFieldOptions> = {}): void {
    const opts = { ...DEFAULT_FLOW_FIELD_OPTIONS, ...options };
    simulation.pathfindingAlgorithm = opts.algorithm;

    const world = simulation.world;
    world.agents.length = 0;
    world.obstacles.length = 0;
    simulation.resetClock();

    const pillarCenterX = world.width * 0.5;
    const pillar1CenterY = world.height * 0.28;
    const pillar2CenterY = world.height * 0.72;

    simulation.addObstacle(
        pillarCenterX - opts.pillar1Size / 2,
        pillar1CenterY - opts.pillar1Size / 2,
        opts.pillar1Size,
        opts.pillar1Size,
    );
    simulation.addObstacle(
        pillarCenterX - opts.pillar2Size / 2,
        pillar2CenterY - opts.pillar2Size / 2,
        opts.pillar2Size,
        opts.pillar2Size,
    );

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
