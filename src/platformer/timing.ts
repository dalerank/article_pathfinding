/** Was the jump pressed early/late enough to still count? See coyote.txt "Где заканчивается платформа?". */
export function coyoteTimeAllowsJump(timeSinceLeftGroundMs: number, coyoteTimeMs: number): boolean {
    return timeSinceLeftGroundMs <= coyoteTimeMs;
}

/** Was the landing close enough to a buffered early jump press? See coyote.txt "Обратная проблема coyote time". */
export function jumpBufferAllowsLanding(bufferedMsAgo: number, jumpBufferMs: number): boolean {
    return bufferedMsAgo <= jumpBufferMs;
}
