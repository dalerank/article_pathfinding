import type { World } from "./World";
import type { Agent } from "./Agent";
import { createAgent } from "./Agent";
import { createObstacle, type Obstacle } from "./Obstacle";
import { distance, length, normalize, scale, sub, type Vec2 } from "./Vec2";
import { blendVelocities, computeAvoidanceVelocity } from "@/avoidance/LocalAvoidance";
import { findPath } from "@/navigation/AStar";
import { findHierarchicalPath, type RegionGraph } from "@/navigation/HierarchicalAStar";
import { buildFlowField, sampleDirection, type FlowField } from "@/navigation/FlowField";
import type { NavMesh } from "@/navigation/NavMesh";

export type PathfindingAlgorithm = "astar" | "hierarchical" | "flow-field";

/**
 * Fixed timestep, see spec section 18 (Simulation Loop).
 * With no NavMesh set, agents seek their destination directly (Phase 1
 * behavior). With a NavMesh set (`setNavMesh`), agents follow a computed
 * Agent.path waypoint by waypoint (A* or Hierarchical A*, section 8/9) —
 * except in "flow-field" mode, where every agent instead samples one shared
 * direction field each tick (section 10) and Agent.path stays empty. Either
 * way the seek velocity is blended with local avoidance (section 11) and
 * clamped against obstacles.
 */
export const SIMULATION_HZ = 60;
export const FIXED_DT = 1 / SIMULATION_HZ;

/** How close to a waypoint counts as "arrived" before advancing to the next one. */
const WAYPOINT_ARRIVE_RADIUS = 10;

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
    navMesh: NavMesh | null = null;
    regionGraph: RegionGraph | null = null;
    flowField: FlowField | null = null;
    pathfindingAlgorithm: PathfindingAlgorithm = "astar";
    /** Spec section 13 "Path Request Budget": max entries processPathRequestQueue() drains per update(). Infinity = unbounded. */
    maxPathRequestsPerFrame = Infinity;
    /** How many queued requests processPathRequestQueue() actually processed on the last update() call. */
    lastFrameRequestsProcessed = 0;
    private accumulator = 0;
    private paused = false;
    private elapsedSeconds = 0;
    private avoidanceTimeAccumulator = 0;
    private pathfindingTimeAccumulator = 0;
    private pathRequestQueue: Agent[] = [];
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

    getElapsedSeconds(): number {
        return this.elapsedSeconds;
    }

    resetClock(): void {
        this.elapsedSeconds = 0;
        this.accumulator = 0;
    }

    addAgent(position: Vec2, overrides: Partial<Agent> = {}): Agent {
        const agent = createAgent(position, {
            destination: { ...this.world.target.position },
            ...overrides,
        });
        this.world.agents.push(agent);
        if (this.navMesh && this.pathfindingAlgorithm !== "flow-field") this.requestPath(agent);
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

        if (this.pathfindingAlgorithm === "flow-field") {
            this.rebuildFlowField();
        } else if (this.navMesh) {
            for (const agent of this.world.agents) this.requestPath(agent);
        }
    }

    setNavMesh(navMesh: NavMesh | null): void {
        this.navMesh = navMesh;
    }

    setRegionGraph(regionGraph: RegionGraph | null): void {
        this.regionGraph = regionGraph;
    }

    /**
     * Queues a path request instead of computing it immediately — processPathRequestQueue()
     * (called once per update()) drains up to maxPathRequestsPerFrame of these. Lets a page
     * simulate many agents "waking up" at once without freezing the frame (spec section 13).
     */
    enqueuePathRequest(agent: Agent): void {
        if (!this.pathRequestQueue.includes(agent)) {
            this.pathRequestQueue.push(agent);
        }
    }

    get pendingPathRequests(): number {
        return this.pathRequestQueue.length;
    }

    private processPathRequestQueue(): void {
        let processed = 0;
        while (this.pathRequestQueue.length > 0 && processed < this.maxPathRequestsPerFrame) {
            const agent = this.pathRequestQueue.shift()!;
            this.requestPath(agent);
            processed++;
        }
        this.lastFrameRequestsProcessed = processed;
    }

    /** Synchronously computes Agent.path right now. Bypasses the queue/budget above. */
    requestPath(agent: Agent): void {
        if (!this.navMesh || !agent.destination) {
            agent.path = [];
            agent.pathIndex = 0;
            return;
        }
        const start = performance.now();
        agent.path =
            this.pathfindingAlgorithm === "hierarchical" && this.regionGraph
                ? findHierarchicalPath(this.navMesh, this.regionGraph, agent.position, agent.destination)
                : findPath(this.navMesh, agent.position, agent.destination);
        agent.pathIndex = 0;
        this.pathfindingTimeAccumulator += performance.now() - start;
    }

    /** Rebuilds the shared direction field once for the current target — every agent reads it, no per-agent search. */
    rebuildFlowField(): void {
        if (!this.navMesh) {
            this.flowField = null;
            return;
        }
        const start = performance.now();
        this.flowField = buildFlowField(this.navMesh, this.world.target.position);
        this.pathfindingTimeAccumulator += performance.now() - start;
    }

    /** Advances the fixed-timestep simulation by `deltaMs` of wall-clock time. */
    update(deltaMs: number): void {
        const frameStart = performance.now();
        if (this.paused) {
            this.lastMetrics.frameTime = performance.now() - frameStart;
            return;
        }

        this.processPathRequestQueue();

        this.accumulator += deltaMs / 1000;
        const simStart = performance.now();
        this.avoidanceTimeAccumulator = 0;
        let steps = 0;
        while (this.accumulator >= FIXED_DT) {
            this.step(FIXED_DT);
            this.accumulator -= FIXED_DT;
            this.elapsedSeconds += FIXED_DT;
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
            pathfindingTime: this.pathfindingTimeAccumulator,
            avoidanceTime: this.avoidanceTimeAccumulator,
            renderingTime: 0,
            agentCount: this.world.agents.length,
            activeAgentCount: this.world.agents.filter((a) => a.path.length > 0 || a.destination !== null).length,
        };
        // Reported above, then cleared — a burst of requestPath calls between
        // frames (e.g. many agents added at once) shows up on the very next one.
        this.pathfindingTimeAccumulator = 0;
    }

    getMetrics(): SimulationMetrics {
        return this.lastMetrics;
    }

    /** One fixed-timestep tick: seek (flow field, waypoint, or direct) + local avoidance + obstacle collision. */
    private step(dt: number): void {
        for (const agent of this.world.agents) {
            if (!agent.destination) continue;

            const dist = distance(agent.position, agent.destination);
            if (dist < 1) {
                agent.velocity = { x: 0, y: 0 };
                continue;
            }

            const desired = this.seekVelocity(agent);

            let candidate = desired;
            if (agent.avoidanceEnabled) {
                const avoidanceStart = performance.now();
                const avoidance = computeAvoidanceVelocity(agent, this.world.agents);
                this.avoidanceTimeAccumulator += performance.now() - avoidanceStart;
                candidate = blendVelocities(desired, avoidance);
            }

            const speed = length(candidate);
            if (speed > agent.maxSpeed) {
                candidate = scale(normalize(candidate), agent.maxSpeed);
            }
            agent.velocity = candidate;

            let next: Vec2 = {
                x: agent.position.x + agent.velocity.x * dt,
                y: agent.position.y + agent.velocity.y * dt,
            };

            for (const obstacle of this.world.obstacles) {
                next = resolveCircleRectCollision(next, agent.radius, obstacle);
            }

            next.x = clamp(next.x, agent.radius, this.world.width - agent.radius);
            next.y = clamp(next.y, agent.radius, this.world.height - agent.radius);

            agent.position = next;
        }
    }

    /** Desired velocity before avoidance: flow field sample, next path waypoint, or a direct line to the destination. */
    private seekVelocity(agent: Agent): Vec2 {
        const destination = agent.destination!;

        if (this.pathfindingAlgorithm === "flow-field" && this.flowField) {
            const fieldDir = sampleDirection(this.flowField, agent.position);
            if (length(fieldDir) > 0) return scale(fieldDir, agent.maxSpeed);
            // Target cell (zero vector by construction) or an unreachable one: finish the approach directly.
        } else if (agent.path.length > 0) {
            if (agent.pathIndex < agent.path.length - 1) {
                if (distance(agent.position, agent.path[agent.pathIndex]) < WAYPOINT_ARRIVE_RADIUS) {
                    agent.pathIndex++;
                }
            }
            return scale(normalize(sub(agent.path[agent.pathIndex], agent.position)), agent.maxSpeed);
        }

        return scale(normalize(sub(destination, agent.position)), agent.maxSpeed);
    }
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

/** Pushes a circle out of an axis-aligned rectangle it would otherwise penetrate. */
export function resolveCircleRectCollision(position: Vec2, radius: number, rect: Obstacle): Vec2 {
    const closestX = clamp(position.x, rect.x, rect.x + rect.width);
    const closestY = clamp(position.y, rect.y, rect.y + rect.height);
    const dx = position.x - closestX;
    const dy = position.y - closestY;
    const distSq = dx * dx + dy * dy;

    if (distSq >= radius * radius) return position;

    if (distSq === 0) {
        const toLeft = position.x - rect.x;
        const toRight = rect.x + rect.width - position.x;
        const toTop = position.y - rect.y;
        const toBottom = rect.y + rect.height - position.y;
        const min = Math.min(toLeft, toRight, toTop, toBottom);

        if (min === toLeft) return { x: rect.x - radius, y: position.y };
        if (min === toRight) return { x: rect.x + rect.width + radius, y: position.y };
        if (min === toTop) return { x: position.x, y: rect.y - radius };
        return { x: position.x, y: rect.y + rect.height + radius };
    }

    const dist = Math.sqrt(distSq);
    return {
        x: closestX + (dx / dist) * radius,
        y: closestY + (dy / dist) * radius,
    };
}
