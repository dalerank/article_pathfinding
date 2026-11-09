/** Uniform random scatter vs Poisson-disc (dart throwing) scatter, plus "does this look clumpy" metrics. */
export interface Point {
    x: number;
    y: number;
}

export function uniformScatter(count: number, width: number, height: number, margin: number, rng: () => number): Point[] {
    const points: Point[] = [];
    for (let i = 0; i < count; i++) {
        points.push({ x: margin + rng() * (width - 2 * margin), y: margin + rng() * (height - 2 * margin) });
    }
    return points;
}

/**
 * Poisson-disc by rejection ("dart throwing"): accept a random point only if it is at least
 * `minDist` away from every accepted one. Slow (O(n^2)), but trivially correct and fine for ~200 points.
 */
export function poissonScatter(
    count: number,
    width: number,
    height: number,
    margin: number,
    minDist: number,
    rng: () => number,
    maxAttempts = 30000,
): Point[] {
    const points: Point[] = [];
    const minDistSq = minDist * minDist;
    for (let attempt = 0; attempt < maxAttempts && points.length < count; attempt++) {
        const candidate = { x: margin + rng() * (width - 2 * margin), y: margin + rng() * (height - 2 * margin) };
        let ok = true;
        for (const p of points) {
            const dx = p.x - candidate.x;
            const dy = p.y - candidate.y;
            if (dx * dx + dy * dy < minDistSq) {
                ok = false;
                break;
            }
        }
        if (ok) points.push(candidate);
    }
    return points;
}

/** Spacing a perfectly even layout of `count` points would have — used to pick minDist and the "clump" threshold. */
export function idealSpacing(count: number, width: number, height: number): number {
    return Math.sqrt((width * height) / Math.max(1, count));
}

export interface ScatterStats {
    clumpPairs: Array<[number, number]>;
    minNearest: number;
    avgNearest: number;
    biggestHole: number; // radius of the largest empty circle (sampled on a grid)
    holeCenter: Point;
}

export function scatterStats(points: Point[], width: number, height: number, margin: number, clumpDist: number): ScatterStats {
    const clumpPairs: Array<[number, number]> = [];
    const nearest = points.map(() => Infinity);
    for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
            if (d < clumpDist) clumpPairs.push([i, j]);
            nearest[i] = Math.min(nearest[i], d);
            nearest[j] = Math.min(nearest[j], d);
        }
    }
    let biggestHole = 0;
    let holeCenter = { x: width / 2, y: height / 2 };
    const step = 8;
    for (let y = margin; y <= height - margin; y += step) {
        for (let x = margin; x <= width - margin; x += step) {
            // the hole must stay inside the field, so the border also limits it
            let r = Math.min(x - margin, y - margin, width - margin - x, height - margin - y);
            for (const p of points) r = Math.min(r, Math.hypot(p.x - x, p.y - y));
            if (r > biggestHole) {
                biggestHole = r;
                holeCenter = { x, y };
            }
        }
    }
    const finite = nearest.filter(Number.isFinite);
    return {
        clumpPairs,
        minNearest: finite.length ? Math.min(...finite) : 0,
        avgNearest: finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : 0,
        biggestHole,
        holeCenter,
    };
}
