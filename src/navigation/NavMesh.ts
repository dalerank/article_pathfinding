// Phase 2 (spec section 7): grid-based navigation representation.
// Not implemented yet — sandbox currently uses direct seek (see Simulation.ts).

export interface NavCell {
    x: number;
    y: number;
    walkable: boolean;
    regionId: number;
}

export interface NavMesh {
    cellSize: number;
    cols: number;
    rows: number;
    cells: NavCell[];
}
