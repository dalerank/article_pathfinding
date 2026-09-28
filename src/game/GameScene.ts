import Phaser from "phaser";
import { Simulation } from "@/simulation/Simulation";
import { createWorld, WORLD_HEIGHT, WORLD_WIDTH } from "@/simulation/World";
import { createTarget } from "@/simulation/Target";
import type { Obstacle } from "@/simulation/Obstacle";
import { AgentRenderer } from "@/rendering/AgentRenderer";
import { CameraController } from "./CameraController";

const OBSTACLE_SIZE = 60;
const OBSTACLE_COLOR = 0x3a4152;
const TARGET_COLOR = 0xef5350;
const INITIAL_AGENT_COUNT = 10;

export class GameScene extends Phaser.Scene {
    simulation!: Simulation;

    private agentRenderer!: AgentRenderer;
    private targetGraphics!: Phaser.GameObjects.Graphics;
    private obstacleRects = new Map<number, Phaser.GameObjects.Rectangle>();
    private obstacleLayer!: Phaser.GameObjects.Container;

    constructor() {
        super("game");
    }

    create(): void {
        new CameraController(this, WORLD_WIDTH, WORLD_HEIGHT);

        const world = createWorld(createTarget({ x: WORLD_WIDTH * 0.8, y: WORLD_HEIGHT / 2 }));
        this.simulation = new Simulation(world);

        this.obstacleLayer = this.add.container(0, 0);
        this.targetGraphics = this.add.graphics();
        this.agentRenderer = new AgentRenderer(this);

        this.resetScenario();
        this.setupInput();
    }

    update(_time: number, delta: number): void {
        this.simulation.update(delta);
        this.agentRenderer.render(this.simulation.world.agents);
        this.drawTarget();
    }

    resetScenario(): void {
        this.simulation.world.agents.length = 0;
        for (const rect of this.obstacleRects.values()) rect.destroy();
        this.obstacleRects.clear();
        this.simulation.world.obstacles.length = 0;

        for (let i = 0; i < INITIAL_AGENT_COUNT; i++) {
            const x = WORLD_WIDTH * 0.15 + Math.random() * 60;
            const y = WORLD_HEIGHT / 2 - 60 + Math.random() * 120;
            this.simulation.addAgent({ x, y });
        }
    }

    setAgentCount(count: number): void {
        const agents = this.simulation.world.agents;
        if (agents.length < count) {
            while (agents.length < count) {
                const x = WORLD_WIDTH * 0.15 + Math.random() * 60;
                const y = WORLD_HEIGHT / 2 - 100 + Math.random() * 200;
                this.simulation.addAgent({ x, y });
            }
        } else {
            agents.length = count;
        }
    }

    setAvoidanceEnabled(enabled: boolean): void {
        for (const agent of this.simulation.world.agents) {
            agent.avoidanceEnabled = enabled;
        }
    }

    private setupInput(): void {
        this.input.mouse?.disableContextMenu();

        this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
            const point = { x: pointer.worldX, y: pointer.worldY };

            if (pointer.rightButtonDown()) {
                this.addObstacleAt(point.x, point.y);
                return;
            }

            if (pointer.event.shiftKey) {
                this.simulation.addAgent(point);
                return;
            }

            this.simulation.setTarget(point);
        });

        this.input.keyboard?.on("keydown-SPACE", () => this.simulation.togglePaused());
        this.input.keyboard?.on("keydown-R", () => this.resetScenario());
    }

    private addObstacleAt(x: number, y: number): void {
        const obstacle = this.simulation.addObstacle(
            x - OBSTACLE_SIZE / 2,
            y - OBSTACLE_SIZE / 2,
            OBSTACLE_SIZE,
            OBSTACLE_SIZE,
        );
        this.createObstacleView(obstacle);
    }

    private createObstacleView(obstacle: Obstacle): void {
        const rect = this.add.rectangle(
            obstacle.x + obstacle.width / 2,
            obstacle.y + obstacle.height / 2,
            obstacle.width,
            obstacle.height,
            OBSTACLE_COLOR,
        );
        rect.setStrokeStyle(1, 0x545c6e);
        rect.setInteractive({ draggable: true, useHandCursor: true });

        rect.on("drag", (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
            rect.x = dragX;
            rect.y = dragY;
            obstacle.x = dragX - obstacle.width / 2;
            obstacle.y = dragY - obstacle.height / 2;
        });

        this.obstacleLayer.add(rect);
        this.obstacleRects.set(obstacle.id, rect);
    }

    private drawTarget(): void {
        const { x, y } = this.simulation.world.target.position;
        this.targetGraphics.clear();
        this.targetGraphics.lineStyle(2, TARGET_COLOR, 1);
        this.targetGraphics.strokeCircle(x, y, 10);
        this.targetGraphics.lineBetween(x - 14, y, x + 14, y);
        this.targetGraphics.lineBetween(x, y - 14, x, y + 14);
    }
}
