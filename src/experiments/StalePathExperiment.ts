// Spec: "Stale Path" — Path Request Budget smooths the aggregate frame-time
// spike, but it does so by making an individual agent's own repath wait its
// turn in the queue. While it waits, the agent keeps walking whatever path it
// already had. If the world changed underneath that path (a wall just went
// up), the agent doesn't freeze — it just walks into the new wall and sits
// there a few frames until its queued repath finally comes through. Same fix,
// a different and much more innocent-looking symptom.

import { buildNavMesh } from "@/navigation/NavMeshBuilder";
import type { Simulation } from "@/simulation/Simulation";
import type { Experiment } from "./Experiment";

export interface StalePathOptions {
    decoyCount: number;
    cellSize: number;
}

export const DEFAULT_STALE_PATH_OPTIONS: StalePathOptions = {
    decoyCount: 60,
    cellSize: 20,
};

/** Hero at index 0, heading across an open floor; decoys share the same destination and periodically re-request paths, competing for the same budget. */
export function configureStalePath(simulation: Simulation, options: Partial<StalePathOptions> = {}): void {
    const opts = { ...DEFAULT_STALE_PATH_OPTIONS, ...options };
    const world = simulation.world;

    world.agents.length = 0;
    world.obstacles.length = 0;
    simulation.resetClock();

    const navMesh = buildNavMesh(world, opts.cellSize);
    simulation.setNavMesh(navMesh);
    simulation.setTarget({ x: world.width - 30, y: world.height / 2 });

    simulation.addAgent({ x: 30, y: world.height / 2 });

    for (let i = 0; i < opts.decoyCount; i++) {
        const x = 20 + Math.random() * (world.width - 40);
        const y = 20 + Math.random() * (world.height - 40);
        simulation.addAgent({ x, y });
    }
}

export const StalePathExperiment: Experiment = {
    id: "stale-path",
    label: "Stale Path",
    setup(simulation: Simulation): void {
        configureStalePath(simulation);
    },
};
