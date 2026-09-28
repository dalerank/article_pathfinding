export interface Vec2 {
    x: number;
    y: number;
}

export function vec2(x: number, y: number): Vec2 {
    return { x, y };
}

export function add(a: Vec2, b: Vec2): Vec2 {
    return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
    return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Vec2, s: number): Vec2 {
    return { x: a.x * s, y: a.y * s };
}

export function length(a: Vec2): number {
    return Math.sqrt(a.x * a.x + a.y * a.y);
}

export function distance(a: Vec2, b: Vec2): number {
    return length(sub(a, b));
}

export function normalize(a: Vec2): Vec2 {
    const len = length(a);
    if (len === 0) return { x: 0, y: 0 };
    return { x: a.x / len, y: a.y / len };
}
