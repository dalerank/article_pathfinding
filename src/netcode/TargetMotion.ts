export interface StrafeConfig {
    center: number;
    amplitude: number;
    /** Seconds for one full left-right-left cycle. */
    period: number;
}

/**
 * Deterministic sinusoidal strafe — a pure function of server time, so every
 * tick is reproducible from the clock alone (no per-tick physics state to
 * desync between the demo's "client" and "server" halves).
 */
export function strafeX(time: number, cfg: StrafeConfig): number {
    return cfg.center + cfg.amplitude * Math.sin((2 * Math.PI * time) / cfg.period);
}
