/** An abstract "who shoots first" duel, see dont_make_npc_smarter.txt "NPC должен ошибаться". */
export interface DuelResult {
    playerWon: boolean;
    marginMs: number;
}

/**
 * Whoever has the shorter effective reaction time wins. A miss roll below `npcMissChance` makes the
 * NPC's shot never land at all (effectively infinite reaction time), not just "slower".
 */
export function resolveDuel(playerReactionMs: number, npcReactionDelayMs: number, npcMissChance: number, missRoll: number): DuelResult {
    const npcEffectiveMs = missRoll < npcMissChance ? Infinity : npcReactionDelayMs;
    const playerWon = playerReactionMs < npcEffectiveMs;
    const marginMs = Number.isFinite(npcEffectiveMs) ? Math.abs(playerReactionMs - npcEffectiveMs) : playerReactionMs;
    return { playerWon, marginMs };
}
