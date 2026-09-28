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
                narrowGate: path.resolve(__dirname, "examples/narrow-gate.html"),
                avoidancePriority: path.resolve(__dirname, "examples/avoidance-priority.html"),
                localAvoidance: path.resolve(__dirname, "examples/local-avoidance.html"),
                pathfinding: path.resolve(__dirname, "examples/pathfinding.html"),
            },
        },
    },
});
