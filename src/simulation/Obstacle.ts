export interface Obstacle {
    id: number;
    x: number;
    y: number;
    width: number;
    height: number;
    movable: boolean;
    affectsNavMesh: boolean;
}

let nextObstacleId = 1;

export function createObstacle(overrides: Partial<Obstacle> & Pick<Obstacle, "x" | "y" | "width" | "height">): Obstacle {
    return {
        id: nextObstacleId++,
        movable: true,
        affectsNavMesh: true,
        ...overrides,
    };
}
