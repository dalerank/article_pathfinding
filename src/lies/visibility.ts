/** 2D visibility polygon by ray casting to every wall corner (±epsilon), plus point-in-polygon. */
export interface Vec {
    x: number;
    y: number;
}

export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface Segment {
    a: Vec;
    b: Vec;
}

export function rectSegments(r: Rect): Segment[] {
    const p = [
        { x: r.x, y: r.y },
        { x: r.x + r.w, y: r.y },
        { x: r.x + r.w, y: r.y + r.h },
        { x: r.x, y: r.y + r.h },
    ];
    return p.map((a, i) => ({ a, b: p[(i + 1) % 4] }));
}

/** Distance along the ray (origin + t*dir) to the segment, or Infinity. */
function raySegment(o: Vec, dx: number, dy: number, s: Segment): number {
    const sx = s.b.x - s.a.x;
    const sy = s.b.y - s.a.y;
    const denom = dx * sy - dy * sx;
    if (Math.abs(denom) < 1e-9) return Infinity;
    const t = ((s.a.x - o.x) * sy - (s.a.y - o.y) * sx) / denom;
    const u = ((s.a.x - o.x) * dy - (s.a.y - o.y) * dx) / denom;
    if (t < 0 || u < 0 || u > 1) return Infinity;
    return t;
}

export function visibilityPolygon(origin: Vec, segments: Segment[]): Vec[] {
    const angles: number[] = [];
    for (const s of segments) {
        for (const p of [s.a, s.b]) {
            const a = Math.atan2(p.y - origin.y, p.x - origin.x);
            angles.push(a - 0.0001, a, a + 0.0001);
        }
    }
    angles.sort((a, b) => a - b);
    const poly: Vec[] = [];
    for (const a of angles) {
        const dx = Math.cos(a);
        const dy = Math.sin(a);
        let best = Infinity;
        for (const s of segments) best = Math.min(best, raySegment(origin, dx, dy, s));
        if (best < Infinity) poly.push({ x: origin.x + dx * best, y: origin.y + dy * best });
    }
    return poly;
}

export function pointInPolygon(p: Vec, poly: Vec[]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i];
        const b = poly[j];
        if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
}

export function circleHitsRect(c: Vec, r: number, rect: Rect): boolean {
    const nx = Math.max(rect.x, Math.min(c.x, rect.x + rect.w));
    const ny = Math.max(rect.y, Math.min(c.y, rect.y + rect.h));
    return (c.x - nx) ** 2 + (c.y - ny) ** 2 < r * r;
}
