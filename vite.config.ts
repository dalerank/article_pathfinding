import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
    base: "./",
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "src"),
        },
    },
    server: {
        port: 5173,
    },
    build: {
        rollupOptions: {
            input: {
                main: path.resolve(__dirname, "index.html"),
                sandbox: path.resolve(__dirname, "examples/sandbox.html"),
                narrowGate: path.resolve(__dirname, "examples/narrow-gate.html"),
                effectiveWidth: path.resolve(__dirname, "examples/effective-width.html"),
                avoidancePriority: path.resolve(__dirname, "examples/avoidance-priority.html"),
                priorityStandoff: path.resolve(__dirname, "examples/priority-standoff.html"),
                localAvoidance: path.resolve(__dirname, "examples/local-avoidance.html"),
                pathfinding: path.resolve(__dirname, "examples/pathfinding.html"),
                targetSnapping: path.resolve(__dirname, "examples/target-snapping.html"),
                flowField: path.resolve(__dirname, "examples/flow-field.html"),
                dynamicObstacles: path.resolve(__dirname, "examples/dynamic-obstacles.html"),
                linkCost: path.resolve(__dirname, "examples/link-cost.html"),
                pathRequestBudget: path.resolve(__dirname, "examples/path-request-budget.html"),
                astarScale: path.resolve(__dirname, "examples/astar-scale.html"),
                stalePath: path.resolve(__dirname, "examples/stale-path.html"),
                shootingNaiveRaycast: path.resolve(__dirname, "examples/shooting-naive-raycast.html"),
                shootingTimeMachine: path.resolve(__dirname, "examples/shooting-time-machine.html"),
                shootingRewindFormula: path.resolve(__dirname, "examples/shooting-rewind-formula.html"),
                shootingMaxRewind: path.resolve(__dirname, "examples/shooting-max-rewind.html"),
                shootingSpatialFilter: path.resolve(__dirname, "examples/shooting-spatial-filter.html"),
                shootingHitboxOrder: path.resolve(__dirname, "examples/shooting-hitbox-order.html"),
                shootingTrustButVerify: path.resolve(__dirname, "examples/shooting-trust-but-verify.html"),
                shootingAlreadyDead: path.resolve(__dirname, "examples/shooting-already-dead.html"),
                shootingRollbackVsLagcomp: path.resolve(__dirname, "examples/shooting-rollback-vs-lagcomp.html"),
                coyoteEdgeTiming: path.resolve(__dirname, "examples/coyote-edge-timing.html"),
                coyoteJumpBuffer: path.resolve(__dirname, "examples/coyote-jump-buffer.html"),
                coyoteTuning: path.resolve(__dirname, "examples/coyote-tuning.html"),
                npcRewardHacking: path.resolve(__dirname, "examples/npc-reward-hacking.html"),
                npcChaseTimeout: path.resolve(__dirname, "examples/npc-chase-timeout.html"),
                npcFsmVsBlackbox: path.resolve(__dirname, "examples/npc-fsm-vs-blackbox.html"),
                npcImperfection: path.resolve(__dirname, "examples/npc-imperfection.html"),
                cheatClientAuthority: path.resolve(__dirname, "examples/cheat-client-authority.html"),
                cheatSpeedhackBudget: path.resolve(__dirname, "examples/cheat-speedhack-budget.html"),
                cheatWallhackCulling: path.resolve(__dirname, "examples/cheat-wallhack-culling.html"),
                cheatGoldFromAir: path.resolve(__dirname, "examples/cheat-gold-from-air.html"),
                cheatLagSwitch: path.resolve(__dirname, "examples/cheat-lag-switch.html"),
                cheatDupeRace: path.resolve(__dirname, "examples/cheat-dupe-race.html"),
                cheatHallucinationTrap: path.resolve(__dirname, "examples/cheat-hallucination-trap.html"),
                cheatAimbotStats: path.resolve(__dirname, "examples/cheat-aimbot-stats.html"),
            },
        },
    },
});
