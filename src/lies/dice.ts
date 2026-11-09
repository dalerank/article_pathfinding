/** Damage dice and "true hit" (two random numbers, Fire Emblem 6+). */

export interface DiceSpec {
    id: string;
    label: string;
    count: number;
    sides: number;
    bonus: number;
}

/** All three have roughly the same range and mean (~6.5–7), only the shape differs. */
export const DICE_SPECS: DiceSpec[] = [
    { id: "1d12", label: "1d12", count: 1, sides: 12, bonus: 0 },
    { id: "2d6", label: "2d6", count: 2, sides: 6, bonus: 0 },
    { id: "3d4", label: "3d4", count: 3, sides: 4, bonus: 0 },
];

export function rollDice(spec: DiceSpec, rng: () => number): number {
    let sum = spec.bonus;
    for (let i = 0; i < spec.count; i++) sum += 1 + Math.floor(rng() * spec.sides);
    return sum;
}

/** Exact distribution: probability of each total (index = total). */
export function diceDistribution(spec: DiceSpec): number[] {
    let dist = [1];
    for (let d = 0; d < spec.count; d++) {
        const next = new Array(dist.length + spec.sides).fill(0);
        for (let total = 0; total < dist.length; total++) {
            if (dist[total] === 0) continue;
            for (let face = 1; face <= spec.sides; face++) next[total + face] += dist[total] / spec.sides;
        }
        dist = next;
    }
    return dist;
}

export type HitMode = "1rn" | "2rn";

/** Hit if a roll in 0..99 is below the displayed chance (1RN), or the average of two rolls is (2RN). */
export function rollHit(mode: HitMode, displayed: number, rng: () => number): boolean {
    const a = Math.floor(rng() * 100);
    if (mode === "1rn") return a < displayed;
    const b = Math.floor(rng() * 100);
    return (a + b) / 2 < displayed;
}

/** Exact real probability behind a displayed hit chance (displayed is 0..100). */
export function realHitChance(mode: HitMode, displayed: number): number {
    if (mode === "1rn") return Math.min(100, Math.max(0, displayed)) / 100;
    let hits = 0;
    for (let a = 0; a < 100; a++) for (let b = 0; b < 100; b++) if ((a + b) / 2 < displayed) hits += 1;
    return hits / 10000;
}
