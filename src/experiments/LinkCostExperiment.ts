// Article section "Ещё один способ заставить A* не искать" (OffMeshLink costOverride):
// a short link and a longer, wider detour. At cost 1.0 almost everyone prefers the cheap
// link and jams it; raising costOverride redistributes agents onto the detour — not because
// the algorithm changed, but because the model of the world now says the link is expensive.

import { buildNavMesh } from "@/navigation/NavMeshBuilder";
import { cellCenter } from "@/navigation/NavMeshQuery";
import type { NavMesh } from "@/navigation/NavMesh";
import type { Simulation } from "@/simulation/Simulation";
import type { Experiment } from "./Experiment";

export interface LinkCostOptions {
    agentCount: number;
    cellSize: number;
    linkCost: number;
}

export const DEFAULT_LINK_COST_OPTIONS: LinkCostOptions = {
    agentCount: 120,
    cellSize: 20,
    linkCost: 1,
};

export interface LinkZone {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

/** Returns the link's screen-space rectangle for a world of this size (used for rendering + classification too). */
export function linkZoneFor(world: { width: number; height: number }): LinkZone {
    const wallX = world.width * 0.45;
    const wallWidth = 40;
    const gapY = world.height * 0.35;
    const gapHeight = 40;
    return { x0: wallX - 30, y0: gapY - 10, x1: wallX + wallWidth + 30, y1: gapY + gapHeight + 10 };
}

export function configureLinkCost(simulation: Simulation, options: Partial<LinkCostOptions> = {}): void {
    const opts = { ...DEFAULT_LINK_COST_OPTIONS, ...options };
    const world = simulation.world;

    world.agents.length = 0;
    world.obstacles.length = 0;
    simulation.resetClock();

    const wallX = world.width * 0.45;
    const wallWidth = 40;
    const gapY = world.height * 0.35;
    const gapHeight = 40;
    const wallBottom = world.height * 0.7; // below this stays fully open — the detour

    simulation.addObstacle(wallX, 0, wallWidth, gapY);
    simulation.addObstacle(wallX, gapY + gapHeight, wallWidth, wallBottom - (gapY + gapHeight));

    const navMesh = buildNavMesh(world, opts.cellSize);
    applyLinkCost(navMesh, linkZoneFor(world), opts.linkCost);
    simulation.setNavMesh(navMesh);
    simulation.setTarget({ x: world.width * 0.9, y: gapY + gapHeight / 2 });

    for (let i = 0; i < opts.agentCount; i++) {
        const x = world.width * 0.05 + Math.random() * world.width * 0.1;
        const y = world.height * 0.1 + Math.random() * world.height * 0.5;
        simulation.addAgent({ x, y });
    }
}

function applyLinkCost(navMesh: NavMesh, zone: LinkZone, cost: number): void {
    for (const cell of navMesh.cells) {
        const center = cellCenter(navMesh, cell);
        if (center.x >= zone.x0 && center.x <= zone.x1 && center.y >= zone.y0 && center.y <= zone.y1) {
            cell.cost = cost;
        }
    }
}

export const LinkCostExperiment: Experiment = {
    id: "link-cost",
    label: "Link Cost Override",
    setup(simulation: Simulation): void {
        configureLinkCost(simulation);
    },
};
