import type { Agent } from "./Agent";
import type { Obstacle } from "./Obstacle";
import type { Target } from "./Target";

export const WORLD_WIDTH = 1200;
export const WORLD_HEIGHT = 700;

export interface World {
    width: number;
    height: number;
    obstacles: Obstacle[];
    agents: Agent[];
    target: Target;
}

export function createWorld(target: Target): World {
    return {
        width: WORLD_WIDTH,
        height: WORLD_HEIGHT,
        obstacles: [],
        agents: [],
        target,
    };
}
