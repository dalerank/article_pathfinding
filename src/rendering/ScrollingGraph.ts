/** Minimal scrolling bar graph on a plain <canvas> — one bar per sample, newest on the right. */
export class ScrollingGraph {
    private readonly ctx: CanvasRenderingContext2D;
    private readonly samples: number[] = [];

    constructor(
        private readonly canvas: HTMLCanvasElement,
        private readonly maxSamples: number,
        private readonly color: string,
    ) {
        this.ctx = canvas.getContext("2d")!;
    }

    push(value: number, scaleMax: number): void {
        this.samples.push(value);
        if (this.samples.length > this.maxSamples) this.samples.shift();
        this.draw(Math.max(scaleMax, 1));
    }

    clear(): void {
        this.samples.length = 0;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    private draw(scaleMax: number): void {
        const { width, height } = this.canvas;
        this.ctx.clearRect(0, 0, width, height);
        const barWidth = width / this.maxSamples;

        this.ctx.fillStyle = this.color;
        this.samples.forEach((value, i) => {
            const barHeight = Math.min(height, (value / scaleMax) * height);
            this.ctx.fillRect(i * barWidth, height - barHeight, Math.max(1, barWidth - 1), barHeight);
        });
    }
}

export function buildGraphRow(root: HTMLElement, label: string, color: string, samples: number): HTMLCanvasElement {
    const row = document.createElement("div");
    row.style.marginBottom = "8px";
    const rowLabel = document.createElement("div");
    rowLabel.textContent = label;
    rowLabel.style.color = "#8b93a3";
    rowLabel.style.marginBottom = "2px";
    const canvas = document.createElement("canvas");
    canvas.width = samples * 2;
    canvas.height = 50;
    canvas.style.width = "100%";
    canvas.style.height = "50px";
    canvas.style.display = "block";
    canvas.style.background = "#1b1f27";
    canvas.style.border = `1px solid ${color}33`;
    row.append(rowLabel, canvas);
    root.appendChild(row);
    return canvas;
}
