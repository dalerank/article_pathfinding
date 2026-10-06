# NavMesh Sandbox

An interactive 2D sandbox illustrating common NavMesh, pathfinding, and crowd-behavior
problems: why 200 agents can't fit through one gate, how local avoidance differs from
global navigation, why Hierarchical A* and Flow Field exist, and how avoidance priority
and path-request budgeting affect congestion.

It also hosts two further, independent example sets:

- Lag compensation in networked shooters (`shooting.txt`): why "I hit them" on the
  client can be an honest miss on the server, how hitbox history + rewind fixes that,
  and where the fix itself has costs and failure modes (unbounded rewind windows, lying
  clients, dead shooters, full-world rollback vs a single rewound hitbox).
- Coyote time and jump buffer in platformers (`coyote.txt`): why a "physically correct"
  ground check feels like a bug, and how games deliberately lie about timing at a
  platform edge (and about how early an input was pressed) to match what the player
  meant instead of what the simulation measured.

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
- `examples/*.html` — thirteen NavMesh examples, each with its own page and logic in
  `src/pages/*.ts`: Narrow Gate, Effective Width, Avoidance Priority, Priority Standoff,
  Local Avoidance, A* / Hierarchical A*, Target Snapping, A* vs Flow Field,
  Dynamic Obstacles, Link Cost Override, Path Request Budget & Jitter, A* Cost at
  Scale, Stale Path.
- `examples/shooting-*.html` — nine lag-compensation examples (`src/pages/shooting-*.ts`):
  Naive Raycast, Time Machine, Rewind Formula, Max Rewind Window, Spatial Filter,
  Hitbox vs Animation Order, Trust But Verify, Already Dead, Rollback vs Lag
  Compensation.
- `examples/coyote-*.html` — three coyote-time examples (`src/pages/coyote-*.ts`):
  Coyote Time, Jump Buffer, Forgiveness Tuning.
- `src/navigation` — NavMesh grid, A*, Hierarchical A*, Flow Field.
- `src/avoidance` — local avoidance and avoidance priority.
- `src/simulation` — world, agents, fixed-timestep loop, path-request queue.
- `src/netcode` — snapshot history (rewind), deterministic target motion, raycast —
  shared engine for the shooting examples.
- `src/platformer` — coyote-time/jump-buffer forgiveness-window checks, shared by the
  coyote examples.
- `src/experiments` — world configuration for each NavMesh example.

## Status

All simulation systems are implemented and measured live (no hardcoded numbers in
any metric): NavMesh grid + A*, Hierarchical A* (regions + portals), Flow Field,
crowd/avoidance with priorities, obstacle collisions, target snapping to the nearest
walkable point, cost-weighted cells (link cost override), and a budgeted path-request
queue with repath jitter.

Not implemented: benchmark mode (run N times, report average/min/max), URL parameters
(`?experiment=`), and a responsive layout for mobile screens.
