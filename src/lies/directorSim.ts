/**
 * A tiny tower-defense loop for the Storyteller demo: waves walk to a base in the middle and the
 * player clicks them away. Waves come from either an honest Poisson stream or a director that reads
 * the player's actual state (enemies alive, damage just taken) — L4D-style, heavily simplified.
 */
export type SpawnMode = "honest" | "director";

export const ARENA_W = 600;
export const ARENA_H = 360;
export const BASE = { x: ARENA_W / 2, y: ARENA_H / 2, r: 26 };
export const ENEMY_R = 11;

export interface DirectorConfig {
    durationSec: number;
    wavesPerMinute: number;
    enemySpeed: number; // px/s
    damagePerEnemy: number;
    peakTension: number;
    relaxSec: number;
    maxCalmSec: number;
}

export const DEFAULT_DIRECTOR: DirectorConfig = {
    durationSec: 60,
    wavesPerMinute: 20,
    enemySpeed: 42,
    damagePerEnemy: 7,
    peakTension: 60,
    relaxSec: 6,
    maxCalmSec: 12,
};

const WAVE_SIZE = [0, 2, 4, 7];
const TENSION_PER_ALIVE = 7;
const TENSION_PER_DAMAGE = 1.5;
const DAMAGE_MEMORY_DECAY = 0.82; // per second

export interface Enemy {
    x: number;
    y: number;
    vx: number;
    vy: number;
    spawnAt: number; // enemies of a wave trickle in over ~1s
    alive: boolean;
    reached: boolean;
}

export interface Wave {
    t: number;
    severity: 1 | 2 | 3;
    forced: boolean;
}

export type DirectorPhase = "build" | "relax" | "forced";

export class DirectorSim {
    t = 0;
    hp = 100;
    enemies: Enemy[] = [];
    waves: Wave[] = [];
    damageTaken = 0;
    kills = 0;
    /** recent damage, decays — part of what the director reads as "stress" */
    recentDamage = 0;
    tension = 0;
    tensionLog: number[] = []; // per second
    damageLog: number[] = []; // per second
    phase: DirectorPhase = "build";
    relaxUntil = 0;
    lastWaveT = 0;
    phaseReason = "";
    private nextWholeSecond = 0;
    private damageThisSecond = 0;

    constructor(
        public mode: SpawnMode,
        public cfg: DirectorConfig,
        private rng: () => number,
    ) {}

    get finished(): boolean {
        return this.t >= this.cfg.durationSec || this.hp <= 0;
    }

    get aliveCount(): number {
        return this.enemies.filter((e) => e.alive && e.spawnAt <= this.t).length;
    }

    private rollSeverity(): 1 | 2 | 3 {
        const r = this.rng();
        return r < 0.5 ? 1 : r < 0.85 ? 2 : 3;
    }

    private spawnWave(severity: 1 | 2 | 3, forced: boolean): void {
        this.waves.push({ t: this.t, severity, forced });
        this.lastWaveT = this.t;
        const side = this.rng() * Math.PI * 2; // waves come from one direction, spread a bit
        for (let i = 0; i < WAVE_SIZE[severity]; i++) {
            const ang = side + (this.rng() - 0.5) * 1.1;
            const dist = Math.hypot(ARENA_W, ARENA_H) / 2 + 10;
            let x = BASE.x + Math.cos(ang) * dist;
            let y = BASE.y + Math.sin(ang) * dist;
            x = Math.max(-5, Math.min(ARENA_W + 5, x));
            y = Math.max(-5, Math.min(ARENA_H + 5, y));
            const len = Math.hypot(BASE.x - x, BASE.y - y);
            const speed = this.cfg.enemySpeed * (0.85 + this.rng() * 0.3);
            this.enemies.push({
                x,
                y,
                vx: ((BASE.x - x) / len) * speed,
                vy: ((BASE.y - y) / len) * speed,
                spawnAt: this.t + i * 0.18,
                alive: true,
                reached: false,
            });
        }
    }

    /** Called once per simulated second: decide whether a wave starts now. */
    private decide(): void {
        if (this.mode === "honest") {
            if (this.rng() < this.cfg.wavesPerMinute / 60) this.spawnWave(this.rollSeverity(), false);
            return;
        }
        if (this.t < this.relaxUntil) {
            this.phase = "relax";
            return;
        }
        if (this.tension >= this.cfg.peakTension) {
            this.relaxUntil = this.t + this.cfg.relaxSec;
            this.phase = "relax";
            this.phaseReason = `напряжение ${this.tension.toFixed(0)} ≥ ${this.cfg.peakTension}: даю передышку ${this.cfg.relaxSec}с`;
            return;
        }
        if (this.t - this.lastWaveT >= this.cfg.maxCalmSec && this.aliveCount === 0) {
            this.phase = "forced";
            this.phaseReason = `${(this.t - this.lastWaveT).toFixed(0)}с тишины — скучно, подкидываю волну`;
            this.spawnWave(this.rollSeverity(), true);
            return;
        }
        this.phase = "build";
        const headroom = Math.max(0, 1 - this.tension / this.cfg.peakTension);
        if (this.rng() < (this.cfg.wavesPerMinute / 60) * 1.7 * headroom) {
            let sev = this.rollSeverity();
            if (this.tension > this.cfg.peakTension * 0.4 && sev === 3) sev = 1;
            this.phaseReason = `напряжение ${this.tension.toFixed(0)}: есть запас, волна ${["", "малая", "средняя", "большая"][sev]}`;
            this.spawnWave(sev, false);
        } else {
            this.phaseReason = `напряжение ${this.tension.toFixed(0)}: накапливаю`;
        }
    }

    step(dt: number): void {
        if (this.finished) return;
        this.t += dt;
        while (this.t >= this.nextWholeSecond) {
            this.decide();
            this.recentDamage *= DAMAGE_MEMORY_DECAY;
            this.tensionLog.push(this.tension);
            this.damageLog.push(this.damageThisSecond);
            this.damageThisSecond = 0;
            this.nextWholeSecond += 1;
        }
        for (const e of this.enemies) {
            if (!e.alive || e.spawnAt > this.t) continue;
            e.x += e.vx * dt;
            e.y += e.vy * dt;
            if (Math.hypot(e.x - BASE.x, e.y - BASE.y) < BASE.r + ENEMY_R * 0.5) {
                e.alive = false;
                e.reached = true;
                this.hp = Math.max(0, this.hp - this.cfg.damagePerEnemy);
                this.damageTaken += this.cfg.damagePerEnemy;
                this.recentDamage += this.cfg.damagePerEnemy;
                this.damageThisSecond += this.cfg.damagePerEnemy;
            }
        }
        this.tension = this.aliveCount * TENSION_PER_ALIVE + this.recentDamage * TENSION_PER_DAMAGE;
    }

    killAt(x: number, y: number): boolean {
        let best: Enemy | null = null;
        let bestD = ENEMY_R + 8;
        for (const e of this.enemies) {
            if (!e.alive || e.spawnAt > this.t) continue;
            const d = Math.hypot(e.x - x, e.y - y);
            if (d < bestD) {
                bestD = d;
                best = e;
            }
        }
        if (best) {
            best.alive = false;
            this.kills += 1;
            return true;
        }
        return false;
    }

    /** Kills the enemy closest to the base — used by the autopilot with a limited clicks-per-second budget. */
    killClosest(): boolean {
        let best: Enemy | null = null;
        let bestD = Infinity;
        for (const e of this.enemies) {
            if (!e.alive || e.spawnAt > this.t) continue;
            const d = Math.hypot(e.x - BASE.x, e.y - BASE.y);
            if (d < bestD) {
                bestD = d;
                best = e;
            }
        }
        if (!best) return false;
        best.alive = false;
        this.kills += 1;
        return true;
    }

    /** Seconds in which the base took damage from two different waves' enemies within 5s — "беда за бедой". */
    get brutalMoments(): number {
        let n = 0;
        for (let i = 0; i + 4 < this.damageLog.length; i++) {
            let sum = 0;
            for (let k = 0; k < 5; k++) sum += this.damageLog[i + k];
            if (sum >= this.cfg.damagePerEnemy * 4) {
                n += 1;
                i += 4;
            }
        }
        return n;
    }

    get spawnedEnemies(): number {
        return this.enemies.filter((e) => e.spawnAt <= this.t).length;
    }

    get longestCalm(): number {
        let longest = 0;
        let prev = 0;
        for (const w of this.waves) {
            longest = Math.max(longest, w.t - prev);
            prev = w.t;
        }
        return Math.max(longest, Math.min(this.t, this.cfg.durationSec) - prev);
    }
}

export interface AutoResult {
    survived: boolean;
    hp: number;
    waves: number;
    brutal: number;
    longestCalm: number;
}

/** Headless run with an autopilot that can kill `killsPerSec` enemies per second. */
export function autoRun(mode: SpawnMode, cfg: DirectorConfig, rng: () => number, killsPerSec: number): AutoResult {
    const sim = new DirectorSim(mode, cfg, rng);
    const dt = 0.05;
    let budget = 0;
    while (!sim.finished) {
        sim.step(dt);
        budget = Math.min(2, budget + killsPerSec * dt);
        while (budget >= 1 && sim.killClosest()) budget -= 1;
    }
    return { survived: sim.hp > 0, hp: sim.hp, waves: sim.waves.length, brutal: sim.brutalMoments, longestCalm: sim.longestCalm };
}
