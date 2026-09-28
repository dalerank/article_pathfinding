export interface ControlPanelCallbacks {
    onAgentCountChange(count: number): void;
    onAvoidanceToggle(enabled: boolean): void;
    onPauseToggle(): void;
    onReset(): void;
}

/**
 * Minimal Phase 1 control panel. Pathfinding-algorithm switching, debug
 * toggles, and preset experiments are added in later phases (spec sections
 * 15-17) once the underlying systems exist.
 */
export class ControlPanel {
    constructor(root: HTMLElement, callbacks: ControlPanelCallbacks) {
        root.innerHTML = "";

        const heading = document.createElement("h2");
        heading.textContent = "Controls";
        root.appendChild(heading);

        root.appendChild(
            this.buildRow("Agents", (row) => {
                const input = document.createElement("input");
                input.type = "range";
                input.min = "10";
                input.max = "500";
                input.step = "10";
                input.value = "10";

                const value = document.createElement("span");
                value.textContent = input.value;

                input.addEventListener("input", () => {
                    value.textContent = input.value;
                    callbacks.onAgentCountChange(Number(input.value));
                });

                row.appendChild(input);
                row.appendChild(value);
            }),
        );

        root.appendChild(
            this.buildRow("Avoidance", (row) => {
                const checkbox = document.createElement("input");
                checkbox.type = "checkbox";
                checkbox.checked = true;
                checkbox.addEventListener("change", () => callbacks.onAvoidanceToggle(checkbox.checked));
                row.appendChild(checkbox);
            }),
        );

        const buttonRow = document.createElement("div");
        buttonRow.className = "control-row";

        const pauseButton = document.createElement("button");
        pauseButton.textContent = "Pause / Resume (Space)";
        pauseButton.addEventListener("click", () => callbacks.onPauseToggle());

        const resetButton = document.createElement("button");
        resetButton.textContent = "Reset (R)";
        resetButton.addEventListener("click", () => callbacks.onReset());

        buttonRow.appendChild(pauseButton);
        buttonRow.appendChild(resetButton);
        root.appendChild(buttonRow);

        const hint = document.createElement("p");
        hint.style.color = "#8b93a3";
        hint.textContent = "Left click: set target · Shift+Left click: add agent · Right click: add obstacle";
        root.appendChild(hint);

        const examplesHint = document.createElement("p");
        examplesHint.style.color = "#8b93a3";
        examplesHint.innerHTML =
            'Примеры к статье: ' +
            '<a href="examples/narrow-gate.html" style="color:#4fc3f7">Narrow Gate</a> &middot; ' +
            '<a href="examples/avoidance-priority.html" style="color:#4fc3f7">Avoidance Priority</a> &middot; ' +
            '<a href="examples/local-avoidance.html" style="color:#4fc3f7">Local Avoidance</a> &middot; ' +
            '<a href="examples/pathfinding.html" style="color:#4fc3f7">A* Pathfinding</a> &middot; ' +
            '<a href="examples/flow-field.html" style="color:#4fc3f7">A* vs Flow Field</a> &middot; ' +
            '<a href="examples/dynamic-obstacles.html" style="color:#4fc3f7">Dynamic Obstacles</a> &middot; ' +
            '<a href="examples/link-cost.html" style="color:#4fc3f7">Link Cost Override</a> &middot; ' +
            '<a href="examples/path-request-budget.html" style="color:#4fc3f7">Path Request Budget</a>';
        root.appendChild(examplesHint);
    }

    private buildRow(labelText: string, build: (row: HTMLElement) => void): HTMLElement {
        const row = document.createElement("div");
        row.className = "control-row";

        const label = document.createElement("label");
        label.textContent = labelText;
        row.appendChild(label);

        build(row);
        return row;
    }
}
