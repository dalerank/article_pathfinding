/**
 * A deliberately tiny MDP for dont_make_npc_smarter.txt "Функция награды": 12 states, 4 actions,
 * solved by real value iteration so moving a reward slider actually changes the policy, not a lookup table.
 */

export type Distance = "far" | "close" | "point";
export type Health = "high" | "low";
export type Cover = "no" | "yes";

export interface NpcState {
    distance: Distance;
    health: Health;
    cover: Cover;
}

export type NpcAction = "attack" | "retreat" | "chase" | "wait";

export interface RewardWeights {
    killReward: number;
    damagePenalty: number;
    deathPenalty: number;
    chaseTimeoutPenalty: number;
}

export interface Outcome {
    prob: number;
    reward: number;
    next: NpcState;
}

const DISTANCES: Distance[] = ["far", "close", "point"];
const HEALTHS: Health[] = ["high", "low"];
const COVERS: Cover[] = ["no", "yes"];
export const ACTIONS: NpcAction[] = ["attack", "retreat", "chase", "wait"];

export function allStates(): NpcState[] {
    const states: NpcState[] = [];
    for (const distance of DISTANCES) for (const health of HEALTHS) for (const cover of COVERS) states.push({ distance, health, cover });
    return states;
}

export function stateKey(s: NpcState): string {
    return `${s.distance}|${s.health}|${s.cover}`;
}

/** Chance that an attack from this distance kills the player outright. */
const KILL_CHANCE: Record<Distance, number> = { far: 0, close: 0.25, point: 0.5 };

/** Chance that attacking from this distance/cover gets the NPC hit back. */
const DAMAGE_CHANCE: Record<Distance, Record<Cover, number>> = {
    far: { no: 0, yes: 0 },
    close: { no: 0.3, yes: 0.1 },
    point: { no: 0.5, yes: 0.2 },
};

function attackOutcomes(state: NpcState, weights: RewardWeights): Outcome[] {
    const pKill = KILL_CHANCE[state.distance];
    const pDamage = DAMAGE_CHANCE[state.distance][state.cover];
    const combos: Array<{ prob: number; kill: boolean; damage: boolean }> = [
        { prob: pKill * pDamage, kill: true, damage: true },
        { prob: pKill * (1 - pDamage), kill: true, damage: false },
        { prob: (1 - pKill) * pDamage, kill: false, damage: true },
        { prob: (1 - pKill) * (1 - pDamage), kill: false, damage: false },
    ];
    return combos
        .filter((c) => c.prob > 0)
        .map(({ prob, kill, damage }) => {
            let reward = 0;
            let health = state.health;
            let distance = state.distance;
            let cover = state.cover;
            if (kill) {
                reward += weights.killReward;
                distance = "far";
                cover = "no";
            }
            if (damage) {
                if (health === "high") {
                    health = "low";
                    reward -= weights.damagePenalty;
                } else {
                    reward -= weights.deathPenalty;
                    health = "high";
                    distance = "far";
                    cover = "no";
                }
            }
            return { prob, reward, next: { distance, health, cover } };
        });
}

/** Per-tick cost of staying in pursuit, see "добавляем штраф за слишком долгое преследование". */
function chaseOutcomes(state: NpcState, weights: RewardWeights): Outcome[] {
    if (state.distance === "point") return [{ prob: 1, reward: 0, next: state }];
    const stepCost = weights.chaseTimeoutPenalty * 0.3;
    if (state.distance === "far") {
        return [
            { prob: 0.6, reward: -stepCost, next: { ...state, distance: "close" } },
            { prob: 0.4, reward: -stepCost, next: state },
        ];
    }
    return [
        { prob: 0.5, reward: -stepCost, next: { ...state, distance: "point" } },
        { prob: 0.3, reward: -stepCost, next: state },
        { prob: 0.2, reward: -stepCost, next: { ...state, distance: "far" } },
    ];
}

/** Always safe, never risks damage — the "выгоднее вообще не выходить из укрытия" escape hatch. */
function retreatOutcomes(state: NpcState): Outcome[] {
    const moved: Distance = state.distance === "far" ? "far" : state.distance === "close" ? "far" : "close";
    return [
        { prob: 0.7 * 0.6, reward: 0, next: { ...state, distance: moved, cover: "yes" } },
        { prob: 0.7 * 0.4, reward: 0, next: { ...state, distance: moved } },
        { prob: 0.3 * 0.6, reward: 0, next: { ...state, cover: "yes" } },
        { prob: 0.3 * 0.4, reward: 0, next: state },
    ];
}

function waitOutcomes(state: NpcState): Outcome[] {
    return [{ prob: 1, reward: 0, next: state }];
}

export function outcomes(state: NpcState, action: NpcAction, weights: RewardWeights): Outcome[] {
    switch (action) {
        case "attack":
            return attackOutcomes(state, weights);
        case "chase":
            return chaseOutcomes(state, weights);
        case "retreat":
            return retreatOutcomes(state);
        case "wait":
            return waitOutcomes(state);
    }
}

export interface MdpSolution {
    policy: Map<string, NpcAction>;
    values: Map<string, number>;
}

function qValue(values: Map<string, number>, state: NpcState, action: NpcAction, weights: RewardWeights, gamma: number): number {
    let q = 0;
    for (const o of outcomes(state, action, weights)) {
        q += o.prob * (o.reward + gamma * (values.get(stateKey(o.next)) ?? 0));
    }
    return q;
}

/** Real Bellman value iteration over all 12 states — cheap enough to re-solve on every slider move. */
export function solveMdp(weights: RewardWeights, gamma = 0.9, iterations = 500): MdpSolution {
    const states = allStates();
    let values = new Map<string, number>(states.map((s) => [stateKey(s), 0]));

    for (let iter = 0; iter < iterations; iter++) {
        const next = new Map<string, number>();
        for (const s of states) {
            let best = -Infinity;
            for (const action of ACTIONS) best = Math.max(best, qValue(values, s, action, weights, gamma));
            next.set(stateKey(s), best);
        }
        values = next;
    }

    const policy = new Map<string, NpcAction>();
    for (const s of states) {
        let bestAction: NpcAction = "wait";
        let bestQ = -Infinity;
        for (const action of ACTIONS) {
            const q = qValue(values, s, action, weights, gamma);
            if (q > bestQ) {
                bestQ = q;
                bestAction = action;
            }
        }
        policy.set(stateKey(s), bestAction);
    }
    return { policy, values };
}

/** Sample one real transition from the same outcome distribution the policy was solved against. */
export function sampleOutcome(state: NpcState, action: NpcAction, weights: RewardWeights, rand: number): { next: NpcState; reward: number } {
    const list = outcomes(state, action, weights);
    let acc = 0;
    for (const o of list) {
        acc += o.prob;
        if (rand <= acc) return { next: o.next, reward: o.reward };
    }
    const last = list[list.length - 1];
    return { next: last.next, reward: last.reward };
}
