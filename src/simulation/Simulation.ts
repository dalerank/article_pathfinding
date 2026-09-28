import type { World } from "./World";
import type { Agent } from "./Agent";
import { createAgent } from "./Agent";
import { createObstacle, type Obstacle } from "./Obstacle";
import { distance, normalize, scale, sub, type Vec2 } from "./Vec2";

/**
 * Fixed timestep, see spec section 18 (Simulation Loop).
 * Phase 1 only wires world/agents/obstacles/target + movement + metrics.
 * Navigation (A*, Hierarchical A*, Flow Field) and avoidance are added
 * in later phases and plug into `step()` without changing this shape.
 */
export const SIMULATION_HZ = 60;
export const FIXED_DT = 1 / SIMULATION_HZ;

export interface SimulationMetrics {
    frameTime: number;
    simulationTime: number;
    pathfindingTime: number;
    avoidanceTime: number;
    renderingTime: number;
    agentCount: number;
    activeAgentCount: number;
}

export class Simulation {
    readonly world: World;
    private accumulator = 0;
    private paused = false;
    private lastMetrics: SimulationMetrics = {
        frameTime: 0,
        simulationTime: 0,
        pathfindingTime: 0,
        avoidanceTime: 0,
        renderingTime: 0,
        agentCount: 0,
        activeAgentCount: 0,
    };

    constructor(world: World) {
        this.world = world;
    }

    get isPaused(): boolean {
        return this.paused;
    }

    setPaused(paused: boolean): void {
        this.paused = paused;
    }

    togglePaused(): void {
        this.paused = !this.paused;
    }

    addAgent(position: Vec2, overrides: Partial<Agent> = {}): Agent {
        const agent = createAgent(position, {
            destination: { ...this.world.target.position },
            ...overrides,
        });
        this.world.agents.push(agent);
        return agent;
    }

    addObstacle(x: number, y: number, width: number, height: number): Obstacle {
        const obstacle = createObstacle({ x, y, width, height });
        this.world.obstacles.push(obstacle);
        return obstacle;
    }

    setTarget(position: Vec2): void {
        this.world.target.position = { ...position };
        for (const agent of this.world.agents) {
            agent.destination = { ...position };
        }
    }

    /** Advances the fixed-timestep simulation by `deltaMs` of wall-clock time. */
    update(deltaMs: number): void {
        const frameStart = performance.now();
        if (this.paused) {
            this.lastMetrics.frameTime = performance.now() - frameStart;
            return;
        }

        this.accumulator += deltaMs / 1000;
        const simStart = performance.now();
        let steps = 0;
        while (this.accumulator >= FIXED_DT) {
            this.step(FIXED_DT);
            this.accumulator -= FIXED_DT;
            steps++;
            if (steps > 5) {
                // Avoid spiral of death if the tab was backgrounded.
                this.accumulator = 0;
                break;
            }
        }
        const simulationTime = performance.now() - simStart;

        this.lastMetrics = {
            frameTime: performance.now() - frameStart,
            simulationTime,
            pathfindingTime: 0,
            avoidanceTime: 0,
            renderingTime: 0,
            agentCount: this.world.agents.length,
            activeAgentCount: this.world.agents.filter((a) => a.path.length > 0 || a.destination !== null).length,
        };
    }

    getMetrics(): SimulationMetrics {
        return this.lastMetrics;
    }

    /** One fixed-timestep tick. Straight-line seek toward destination (Phase 1). */
    private step(dt: number): void {
        for (const agent of this.world.agents) {
            if (!agent.destination) continue;

            const toTarget = sub(agent.destination, agent.position);
            const dist = distance(agent.position, agent.destination);

            if (dist < 1) {
                agent.velocity = { x: 0, y: 0 };
                continue;
            }

            const desired = scale(normalize(toTarget), agent.maxSpeed);
            agent.velocity = desired;

            const step = scale(agent.velocity, dt);
            if (length2(step) > dist * dist) {
                agent.position = { ...agent.destination };
            } else {
                agent.position = { x: agent.position.x + step.x, y: agent.position.y + step.y };
            }
        }
    }
}

function length2(v: Vec2): number {
    return v.x * v.x + v.y * v.y;
}
