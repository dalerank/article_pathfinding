/** Small seeded PRNG (mulberry32) so the "honest" and "lied" runs can be compared on the same dice. */
export type Rng = () => number;

export function makeRng(seed: number): Rng {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function randomSeed(): number {
    return (Math.random() * 0xffffffff) >>> 0;
}

/** Integer in [min, max] inclusive. */
export function rollInt(rng: Rng, min: number, max: number): number {
    return min + Math.floor(rng() * (max - min + 1));
}
