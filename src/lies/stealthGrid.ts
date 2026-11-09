/** Grid helpers for the Possibility Map stealth demo: map, line of sight, vision cone, BFS, belief diffusion. */

export const COLS = 30;
export const ROWS = 18;

const RAW = [
    "##############################",
    "#............#...............#",
    "#............#...............#",
    "#...####.....#....#######....#",
    "#...#..............#.........#",
    "#...#..............#.........#",
    "#...#....#####.....#.........#",
    "#........#...#...........###.#",
    "#........#...#...........#...#",
    "######.###...#####...#####...#",
    "#..................#.........#",
    "#..................#.........#",
    "#....######........#....###..#",
    "#....#.............#......#..#",
    "#....#.........#####......#..#",
    "#....#....................#..#",
    "#.........................#..#",
    "##############################",
];

export function buildWalls(): boolean[] {
    const walls: boolean[] = [];
    for (let y = 0; y < ROWS; y++) {
        const row = (RAW[y] ?? "").padEnd(COLS, ".").slice(0, COLS);
        for (let x = 0; x < COLS; x++) {
            const border = x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1;
            walls.push(border || row[x] === "#");
        }
    }
    return walls;
}

export const idx = (x: number, y: number) => y * COLS + x;
export const cx = (i: number) => i % COLS;
export const cy = (i: number) => Math.floor(i / COLS);

export function neighbors(walls: boolean[], i: number): number[] {
    const x = cx(i);
    const y = cy(i);
    const out: number[] = [];
    for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
    ]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
        const j = idx(nx, ny);
        if (!walls[j]) out.push(j);
    }
    return out;
}

/** Supercover-ish line walk between cell centers; blocked if any wall cell is crossed. */
export function lineOfSight(walls: boolean[], a: number, b: number): boolean {
    let x0 = cx(a);
    let y0 = cy(a);
    const x1 = cx(b);
    const y1 = cy(b);
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    while (!(x0 === x1 && y0 === y1)) {
        const e2 = 2 * err;
        if (e2 > -dy) {
            err -= dy;
            x0 += sx;
        }
        if (e2 < dx) {
            err += dx;
            y0 += sy;
        }
        if (walls[idx(x0, y0)]) return false;
    }
    return true;
}

/** Cells the guard can see: within range, inside the cone around `facing` (radians), with line of sight. */
export function visibleCells(walls: boolean[], from: number, facing: number, range: number, fovRad: number): Set<number> {
    const seen = new Set<number>([from]);
    const fx = cx(from);
    const fy = cy(from);
    for (let y = Math.max(0, fy - range); y <= Math.min(ROWS - 1, fy + range); y++) {
        for (let x = Math.max(0, fx - range); x <= Math.min(COLS - 1, fx + range); x++) {
            const i = idx(x, y);
            if (walls[i]) continue;
            const dx = x - fx;
            const dy = y - fy;
            const d = Math.hypot(dx, dy);
            if (d > range) continue;
            if (d > 1.5) {
                let diff = Math.atan2(dy, dx) - facing;
                diff = Math.atan2(Math.sin(diff), Math.cos(diff));
                if (Math.abs(diff) > fovRad / 2) continue;
            }
            if (lineOfSight(walls, from, i)) seen.add(i);
        }
    }
    return seen;
}

/** BFS: returns the next cell to step to on a shortest path from `from` to `to` (or `from` if unreachable). */
export function nextStep(walls: boolean[], from: number, to: number): number {
    if (from === to) return from;
    const prev = new Map<number, number>([[from, -1]]);
    const queue = [from];
    while (queue.length) {
        const cur = queue.shift()!;
        if (cur === to) break;
        for (const n of neighbors(walls, cur)) {
            if (prev.has(n)) continue;
            prev.set(n, cur);
            queue.push(n);
        }
    }
    if (!prev.has(to)) return from;
    let step = to;
    while (prev.get(step) !== from) step = prev.get(step)!;
    return step;
}

export function bfsDistances(walls: boolean[], from: number): Int32Array {
    const dist = new Int32Array(COLS * ROWS).fill(-1);
    dist[from] = 0;
    const queue = [from];
    while (queue.length) {
        const cur = queue.shift()!;
        for (const n of neighbors(walls, cur)) {
            if (dist[n] >= 0) continue;
            dist[n] = dist[cur] + 1;
            queue.push(n);
        }
    }
    return dist;
}

/**
 * One tick of "where could the player be now": each cell spreads its probability evenly to itself and its
 * open neighbours (the player could have moved one step), then everything the guard currently sees is zeroed
 * (the player is not there, or we would see them) and the map is renormalised.
 */
export function diffuseBelief(walls: boolean[], belief: Float32Array, seen: Set<number>): void {
    const next = new Float32Array(belief.length);
    for (let i = 0; i < belief.length; i++) {
        const p = belief[i];
        if (p <= 0) continue;
        const ns = neighbors(walls, i);
        const share = p / (ns.length + 1);
        next[i] += share;
        for (const n of ns) next[n] += share;
    }
    let sum = 0;
    for (let i = 0; i < next.length; i++) {
        if (seen.has(i)) next[i] = 0;
        sum += next[i];
    }
    if (sum > 0) for (let i = 0; i < next.length; i++) belief[i] = next[i] / sum;
    else belief.set(next);
}
