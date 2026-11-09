/**
 * Drop-chance models for "Pity Timer". All three are shown to the player as the same number
 * (`displayedChance`), but they treat a streak of misses differently.
 */
export type PityMode = "honest" | "pity" | "prd";

export interface PityConfig {
    displayedChance: number; // 0..1, what the tooltip says
    softPityStart: number; // misses after which chance starts climbing (pity mode)
    hardPity: number; // miss count at which the drop is guaranteed (pity mode)
}

/** Chance of a drop on the next roll, given how many misses in a row we have had. */
export function dropChance(mode: PityMode, misses: number, cfg: PityConfig, prdC: number): number {
    switch (mode) {
        case "honest":
            return cfg.displayedChance;
        case "pity": {
            if (misses + 1 >= cfg.hardPity) return 1;
            if (misses < cfg.softPityStart) return cfg.displayedChance;
            // linear ramp from displayedChance to 1 between softPityStart and hardPity
            const span = Math.max(1, cfg.hardPity - 1 - cfg.softPityStart);
            const t = (misses - cfg.softPityStart + 1) / span;
            return Math.min(1, cfg.displayedChance + (1 - cfg.displayedChance) * t);
        }
        case "prd":
            // Pseudo-random distribution (Warcraft III / Dota): chance = C * N, reset on success.
            return Math.min(1, prdC * (misses + 1));
    }
}

/** Average success rate a PRD with constant C really produces (1 / expected attempts). */
export function prdRateFromC(c: number): number {
    let expected = 0;
    let noSuccessYet = 1;
    for (let n = 1; ; n++) {
        const p = Math.min(1, c * n);
        expected += n * noSuccessYet * p;
        noSuccessYet *= 1 - p;
        if (p >= 1 || noSuccessYet < 1e-12) break;
    }
    return 1 / expected;
}

/** Find C so that PRD's long-run rate equals the displayed chance (binary search, rate is monotonic in C). */
export function prdConstantFor(chance: number): number {
    let lo = 0;
    let hi = chance;
    for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (prdRateFromC(mid) < chance) lo = mid;
        else hi = mid;
    }
    return (lo + hi) / 2;
}
