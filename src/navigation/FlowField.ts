// Phase 5 (spec section 10): shared integration field + direction field for
// crowds converging on a single target. Rebuilt on target/obstacle change,
// read by every agent instead of running independent A* per agent.

import type { Vec2 } from "@/simulation/Vec2";
import type { NavMesh } from "./NavMesh";

export interface FlowField {
    cols: number;
    rows: number;
    cellSize: number;
    integration: Float32Array;
    direction: Vec2[];
}

export function buildFlowField(_navMesh: NavMesh, _target: Vec2): FlowField {
    throw new Error("FlowField.buildFlowField: not implemented yet (Phase 5)");
}

export function sampleDirection(_field: FlowField, _point: Vec2): Vec2 {
    throw new Error("FlowField.sampleDirection: not implemented yet (Phase 5)");
}
