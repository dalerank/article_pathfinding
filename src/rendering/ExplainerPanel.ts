export interface LegendItem {
    color: string;
    label: string;
    shape?: "dot" | "ring" | "line";
}

/** Small color-swatch legend explaining what's on screen — see feedback: "не ясно, что происходит на экране". */
export function buildLegend(root: HTMLElement, items: LegendItem[]): void {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.flexWrap = "wrap";
    row.style.gap = "8px 14px";
    row.style.fontSize = "11px";
    row.style.color = "#c5cad3";
    row.style.margin = "2px 0 12px";

    for (const item of items) {
        const el = document.createElement("span");
        el.style.display = "inline-flex";
        el.style.alignItems = "center";
        el.style.gap = "5px";

        const swatch = document.createElement("span");
        swatch.style.display = "inline-block";
        swatch.style.flex = "none";
        if (item.shape === "ring") {
            swatch.style.width = "9px";
            swatch.style.height = "9px";
            swatch.style.borderRadius = "50%";
            swatch.style.border = `2px solid ${item.color}`;
        } else if (item.shape === "line") {
            swatch.style.width = "14px";
            swatch.style.height = "2px";
            swatch.style.background = item.color;
        } else {
            swatch.style.width = "10px";
            swatch.style.height = "10px";
            swatch.style.borderRadius = "50%";
            swatch.style.background = item.color;
        }

        el.append(swatch, document.createTextNode(item.label));
        row.appendChild(el);
    }
    root.appendChild(row);
}

/** Imperative "how to use this" callout — placed at the TOP of the panel, not buried under the metrics. */
export function buildHowTo(root: HTMLElement, html: string): void {
    const box = document.createElement("div");
    box.style.background = "#16261c";
    box.style.border = "1px solid #2f4a36";
    box.style.borderRadius = "6px";
    box.style.padding = "8px 10px";
    box.style.margin = "0 0 12px";
    box.style.fontSize = "12px";
    box.style.lineHeight = "1.5";
    box.style.color = "#cfe8d6";
    box.innerHTML = html;
    root.appendChild(box);
}

/** Live "what just happened" sentence, updated after each shot — see feedback: "не ясно, что означают числа". */
export function buildNarrative(root: HTMLElement, placeholder: string): (html: string) => void {
    const box = document.createElement("div");
    box.style.background = "#1b1f27";
    box.style.border = "1px solid #2a2f3a";
    box.style.borderRadius = "6px";
    box.style.padding = "8px 10px";
    box.style.margin = "0 0 12px";
    box.style.fontSize = "12px";
    box.style.lineHeight = "1.5";
    box.style.color = "#e6e8eb";
    box.style.minHeight = "2.7em";
    box.textContent = placeholder;
    root.appendChild(box);
    return (html: string) => {
        box.innerHTML = html;
    };
}
