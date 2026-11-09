/** Two-bone IK (law of cosines): hip -> knee -> foot, knee bent towards `bendDir` (+1 = right, -1 = left). */
export interface P {
    x: number;
    y: number;
}

export function solveTwoBone(hip: P, target: P, l1: number, l2: number, bendDir: number): { knee: P; foot: P; reached: boolean } {
    const dx = target.x - hip.x;
    const dy = target.y - hip.y;
    const dist = Math.hypot(dx, dy);
    const reach = l1 + l2 - 0.001;
    const d = Math.max(Math.abs(l1 - l2) + 0.001, Math.min(dist, reach));
    const base = Math.atan2(dy, dx);
    const cosHip = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
    const off = Math.acos(Math.max(-1, Math.min(1, cosHip)));
    const k1 = { x: hip.x + Math.cos(base + off) * l1, y: hip.y + Math.sin(base + off) * l1 };
    const k2 = { x: hip.x + Math.cos(base - off) * l1, y: hip.y + Math.sin(base - off) * l1 };
    const knee = (k1.x - hip.x) * bendDir > (k2.x - hip.x) * bendDir ? k1 : k2;
    const foot = { x: hip.x + Math.cos(base) * d, y: hip.y + Math.sin(base) * d };
    return { knee, foot, reached: dist <= reach };
}
