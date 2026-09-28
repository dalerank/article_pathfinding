import type { Vec2 } from "./Vec2";

export interface Agent {
    id: number;
    position: Vec2;
    velocity: Vec2;
    radius: number;
    maxSpeed: number;
    destination: Vec2 | null;
    path: Vec2[];
    pathIndex: number;
    avoidanceEnabled: boolean;
    avoidancePriority: number;
}

export const DEFAULT_AGENT_RADIUS = 8;
export const DEFAULT_AGENT_MAX_SPEED = 80;

let nextAgentId = 1;

export function createAgent(position: Vec2, overrides: Partial<Agent> = {}): Agent {
    return {
        id: nextAgentId++,
        position: { ...position },
        velocity: { x: 0, y: 0 },
        radius: DEFAULT_AGENT_RADIUS,
        maxSpeed: DEFAULT_AGENT_MAX_SPEED,
        destination: null,
        path: [],
        pathIndex: 0,
        avoidanceEnabled: true,
        avoidancePriority: 50,
        ...overrides,
    };
}
