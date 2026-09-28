import type { SimulationMetrics } from "@/simulation/Simulation";

/** Phase 1 metrics readout (spec section 14). Scrolling frame-time graph is Phase 8. */
export class MetricsPanel {
    private readonly cells: Record<string, HTMLTableCellElement> = {};

    constructor(root: HTMLElement) {
        root.innerHTML = "";

        const heading = document.createElement("h2");
        heading.textContent = "Metrics";
        root.appendChild(heading);

        const table = document.createElement("table");
        table.className = "metrics-table";

        const rows: Array<[string, string]> = [
            ["fps", "FPS"],
            ["frameTime", "Frame time (ms)"],
            ["simulationTime", "Simulation time (ms)"],
            ["pathfindingTime", "Pathfinding time (ms)"],
            ["avoidanceTime", "Avoidance time (ms)"],
            ["agentCount", "Agents"],
            ["activeAgentCount", "Active agents"],
        ];

        for (const [key, label] of rows) {
            const tr = document.createElement("tr");
            const th = document.createElement("td");
            th.textContent = label;
            const td = document.createElement("td");
            td.textContent = "0";
            this.cells[key] = td;
            tr.appendChild(th);
            tr.appendChild(td);
            table.appendChild(tr);
        }

        root.appendChild(table);
    }

    update(metrics: SimulationMetrics, fps: number): void {
        this.cells.fps.textContent = fps.toFixed(0);
        this.cells.frameTime.textContent = metrics.frameTime.toFixed(2);
        this.cells.simulationTime.textContent = metrics.simulationTime.toFixed(2);
        this.cells.pathfindingTime.textContent = metrics.pathfindingTime.toFixed(2);
        this.cells.avoidanceTime.textContent = metrics.avoidanceTime.toFixed(2);
        this.cells.agentCount.textContent = String(metrics.agentCount);
        this.cells.activeAgentCount.textContent = String(metrics.activeAgentCount);
    }
}
