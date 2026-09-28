# NavMesh Sandbox

An interactive 2D sandbox illustrating common NavMesh, pathfinding, and crowd-behavior
problems: why 200 agents can't fit through one gate, how local avoidance differs from
global navigation, why Hierarchical A* and Flow Field exist, and how avoidance priority
and path-request budgeting affect congestion.

## Stack

TypeScript, Phaser 3, Vite, no backend.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:5173/` — a landing page linking to every example.

## Build

```bash
npm run build
```

## Structure

- `index.html` — landing page linking to every example.
- `examples/sandbox.html` — free sandbox (add agents/obstacles, drag, metrics).
- `examples/*.html` — eight examples, each with its own page and logic in
  `src/pages/*.ts`: Narrow Gate, Avoidance Priority, Local Avoidance,
  A* / Hierarchical A*, A* vs Flow Field, Dynamic Obstacles, Link Cost Override,
  Path Request Budget & Jitter.
- `src/navigation` — NavMesh grid, A*, Hierarchical A*, Flow Field.
- `src/avoidance` — local avoidance and avoidance priority.
- `src/simulation` — world, agents, fixed-timestep loop, path-request queue.
- `src/experiments` — world configuration for each example.

## Status

All simulation systems are implemented and measured live (no hardcoded numbers in
any metric): NavMesh grid + A*, Hierarchical A* (regions + portals), Flow Field,
crowd/avoidance with priorities, obstacle collisions, target snapping to the nearest
walkable point, cost-weighted cells (link cost override), and a budgeted path-request
queue with repath jitter.

Not implemented: benchmark mode (run N times, report average/min/max), URL parameters
(`?experiment=`), and a responsive layout for mobile screens.
