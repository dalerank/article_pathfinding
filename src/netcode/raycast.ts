import type { Vec2 } from "@/simulation/Vec2";

/** Does the forward ray from `origin` through `aim` pass within `radius` of `center`? */
export function raycastHitsCircle(origin: Vec2, aim: Vec2, center: Vec2, radius: number): boolean {
    const dx = aim.x - origin.x;
    const dy = aim.y - origin.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return false;

    const dirX = dx / len;
    const dirY = dy / len;
    const toCenterX = center.x - origin.x;
    const toCenterY = center.y - origin.y;
    const projection = toCenterX * dirX + toCenterY * dirY;
    if (projection < 0) return false;

    const closestX = origin.x + dirX * projection;
    const closestY = origin.y + dirY * projection;
    return Math.hypot(center.x - closestX, center.y - closestY) <= radius;
}

export interface AxisAlignedRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Does the segment `a`→`b` pass through `rect` (axis-aligned slab test)? Used for real line-of-sight occlusion by cover. */
export function segmentIntersectsRect(a: Vec2, b: Vec2, rect: AxisAlignedRect): boolean {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    let tMin = 0;
    let tMax = 1;

    if (dx === 0) {
        if (a.x < rect.x || a.x > rect.x + rect.width) return false;
    } else {
        let t1 = (rect.x - a.x) / dx;
        let t2 = (rect.x + rect.width - a.x) / dx;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);
        if (tMin > tMax) return false;
    }

    if (dy === 0) {
        if (a.y < rect.y || a.y > rect.y + rect.height) return false;
    } else {
        let t1 = (rect.y - a.y) / dy;
        let t2 = (rect.y + rect.height - a.y) / dy;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);
        if (tMin > tMax) return false;
    }

    return true;
}
