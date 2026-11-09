/**
 * N-gram predictor of the player's next choice (lanes 0..k-1), with back-off: if the longest context
 * has never been seen, fall back to a shorter one, down to plain frequencies.
 */
export class NGramPredictor {
    history: number[] = [];
    private counts = new Map<string, number[]>();

    constructor(
        public readonly order: number,
        public readonly symbols: number,
    ) {}

    private key(ctx: number[]): string {
        return ctx.length ? ctx.join(",") : "∅";
    }

    /** Probabilities for the next symbol, plus which context length was actually used. */
    predict(): { probs: number[]; contextLen: number; samples: number } {
        for (let len = Math.min(this.order, this.history.length); len >= 0; len--) {
            const ctx = this.history.slice(this.history.length - len);
            const c = this.counts.get(this.key(ctx));
            const total = c ? c.reduce((a, b) => a + b, 0) : 0;
            if (c && total > 0) {
                // add-one smoothing so a single observation isn't treated as certainty
                const probs = c.map((v) => (v + 0.5) / (total + 0.5 * this.symbols));
                return { probs, contextLen: len, samples: total };
            }
        }
        return { probs: new Array(this.symbols).fill(1 / this.symbols), contextLen: 0, samples: 0 };
    }

    observe(symbol: number): void {
        for (let len = 0; len <= Math.min(this.order, this.history.length); len++) {
            const ctx = this.history.slice(this.history.length - len);
            const k = this.key(ctx);
            if (!this.counts.has(k)) this.counts.set(k, new Array(this.symbols).fill(0));
            this.counts.get(k)![symbol] += 1;
        }
        this.history.push(symbol);
        if (this.history.length > 1000) this.history.shift();
    }

    reset(): void {
        this.history = [];
        this.counts.clear();
    }
}

export function argmax(xs: number[]): number {
    let best = 0;
    for (let i = 1; i < xs.length; i++) if (xs[i] > xs[best]) best = i;
    return best;
}
