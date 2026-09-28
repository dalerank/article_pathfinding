import type { Vec2 } from "./Vec2";

export interface Target {
    position: Vec2;
}

export function createTarget(position: Vec2): Target {
    return { position: { ...position } };
}
