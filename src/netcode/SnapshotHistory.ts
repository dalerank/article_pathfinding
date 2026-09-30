export interface Snapshot<T> {
    tick: number;
    time: number;
    value: T;
}

/**
 * Fixed-capacity ring buffer of world snapshots — the "time machine" from
 * shooting.txt ("Делаем машину времени"). Used both to render a client's
 * delayed/interpolated view of a remote target and, for the compensated
 * examples, to let the server rewind to the hitbox state a given shot
 * actually happened against.
 */
export class SnapshotHistory<T> {
    private readonly snapshots: Snapshot<T>[] = [];

    constructor(private readonly capacity: number) {}

    push(tick: number, time: number, value: T): void {
        this.snapshots.push({ tick, time, value });
        if (this.snapshots.length > this.capacity) this.snapshots.shift();
    }

    clear(): void {
        this.snapshots.length = 0;
    }

    get length(): number {
        return this.snapshots.length;
    }

    get newest(): Snapshot<T> | undefined {
        return this.snapshots[this.snapshots.length - 1];
    }

    get oldest(): Snapshot<T> | undefined {
        return this.snapshots[0];
    }

    /** Age (seconds) of the oldest retained snapshot relative to `time` — how far back this history can still answer for. */
    availableWindow(time: number): number {
        const oldest = this.oldest;
        return oldest ? time - oldest.time : 0;
    }

    /**
     * Interpolates the stored value at `time` using `lerp`, clamped to the
     * oldest/newest snapshot when `time` falls outside the retained window.
     */
    sampleAt(time: number, lerp: (a: T, b: T, t: number) => T): T | undefined {
        const n = this.snapshots.length;
        if (n === 0) return undefined;
        if (time <= this.snapshots[0].time) return this.snapshots[0].value;
        const last = this.snapshots[n - 1];
        if (time >= last.time) return last.value;

        let lo = 0;
        let hi = n - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (this.snapshots[mid].time <= time) lo = mid;
            else hi = mid;
        }
        const a = this.snapshots[lo];
        const b = this.snapshots[hi];
        const t = (time - a.time) / (b.time - a.time);
        return lerp(a.value, b.value, t);
    }
}

export function lerpNumber(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

/** Step function for discrete/boolean state — "what was true at or just before this moment", no blending. */
export function lerpStep<T>(a: T, b: T, t: number): T {
    return t < 1 ? a : b;
}
