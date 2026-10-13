/** Patrol -> Chase -> Search -> Patrol, see dont_make_npc_smarter.txt "Что делает дизайнер?". */
export type ChaseState = "patrol" | "chase" | "search";

export interface ChaseFsmInput {
    state: ChaseState;
    playerVisible: boolean;
    timeInStateSec: number;
    giveUpAfterSec: number;
}

/**
 * giveUpAfterSec = Infinity models the "умный" NPC that never stops searching once it has seen the
 * player — the behavior the article says makes the NPC exploitable, not the behavior designers ship.
 */
export function nextChaseState(input: ChaseFsmInput): ChaseState {
    const { state, playerVisible, timeInStateSec, giveUpAfterSec } = input;
    if (playerVisible) return "chase";
    if (state === "chase") return "search";
    if (state === "search") return timeInStateSec >= giveUpAfterSec ? "patrol" : "search";
    return "patrol";
}
