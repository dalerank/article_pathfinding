# NavMesh Sandbox — техническое задание

## 1. Цель

Создать небольшое интерактивное 2D приложение для сопровождения статьи про NavMesh, pathfinding и поведение толпы.

Приложение должно работать в браузере и показывать систему **сверху**, без 3D графики. Все агенты представлены кругами, препятствия — прямоугольниками или полигонами, маршруты — линиями, а внутренние состояния алгоритмов должны быть визуализированы непосредственно на сцене.

Главная цель проекта — не сделать универсальную библиотеку pathfinding, а дать читателю возможность самостоятельно увидеть проблемы и решения, описанные в статье.

Пользователь должен иметь возможность:

- добавлять и перемещать агентов;
- задавать общую цель;
- перемещать препятствия;
- менять ширину проходов;
- менять количество агентов;
- включать и выключать local avoidance;
- переключать алгоритмы pathfinding;
- видеть построенные маршруты;
- видеть NavMesh / регионы / flow field;
- видеть направление движения агентов;
- запускать заранее подготовленные эксперименты;
- видеть базовую статистику производительности.

## 2. Технологический стек

Рекомендуемый стек:

- TypeScript;
- Phaser 3;
- Vite;
- HTML/CSS для панели управления;
- без backend.

```text
Browser
  │
  ├── Phaser 3
  │     ├── rendering
  │     ├── input
  │     └── game loop
  │
  └── Simulation
        ├── NavMesh
        ├── A*
        ├── Hierarchical A*
        ├── Flow Field
        ├── Local Avoidance
        ├── Dynamic Obstacles
        └── Metrics
```

Запуск:

```bash
npm install
npm run dev
```

Сборка:

```bash
npm run build
```

## 3. Архитектура

Не смешивать rendering и simulation. Simulation должна работать независимо от Phaser настолько, насколько это разумно.

```text
src/
├── main.ts
├── game/
│   ├── Game.ts
│   ├── GameScene.ts
│   └── CameraController.ts
│
├── simulation/
│   ├── Simulation.ts
│   ├── Agent.ts
│   ├── Obstacle.ts
│   ├── Target.ts
│   └── World.ts
│
├── navigation/
│   ├── NavMesh.ts
│   ├── NavMeshBuilder.ts
│   ├── NavMeshQuery.ts
│   ├── AStar.ts
│   ├── HierarchicalAStar.ts
│   └── FlowField.ts
│
├── avoidance/
│   ├── LocalAvoidance.ts
│   ├── RVO.ts
│   └── AvoidancePriority.ts
│
├── rendering/
│   ├── AgentRenderer.ts
│   ├── PathRenderer.ts
│   ├── NavMeshRenderer.ts
│   ├── FlowFieldRenderer.ts
│   └── DebugRenderer.ts
│
├── experiments/
│   ├── Experiment.ts
│   ├── NarrowGateExperiment.ts
│   ├── PathfindingExperiment.ts
│   ├── FlowFieldExperiment.ts
│   ├── AvoidanceExperiment.ts
│   └── DynamicObstacleExperiment.ts
│
└── ui/
    ├── ControlPanel.ts
    └── MetricsPanel.ts
```

## 4. Координатная система

В simulation использовать обычную 2D систему координат. Преобразование между simulation coordinates и screen coordinates должно находиться в одном месте.

```text
        +Y
         ↑
         │
         │
         │
         └────────────→ +X
```

## 5. World и Agent

Начальный размер мира: `1200 x 700`.

```ts
interface World {
    width: number;
    height: number;
    obstacles: Obstacle[];
    agents: Agent[];
    target: Target;
}
```

Агент — круг:

```ts
interface Agent {
    id: number;
    position: Vec2;
    velocity: Vec2;
    radius: number;
    maxSpeed: number;
    destination: Vec2;
    path: Vec2[];
    pathIndex: number;
    avoidanceEnabled: boolean;
    avoidancePriority: number;
}
```

Начальные параметры: `radius = 8`, `maxSpeed = 80`, количество агентов `10...500`.

## 6. Obstacles

На первом этапе — прямоугольники, поддерживающие drag мышью.

```ts
interface Obstacle {
    id: number;
    x: number;
    y: number;
    width: number;
    height: number;
    movable: boolean;
    affectsNavMesh: boolean;
}
```

## 7. Навигационное представление

Для sandbox не требуется сложный production NavMesh. На первом этапе использовать grid, поверх которого реализовать все демонстрационные алгоритмы.

```text
┌───┬───┬───┬───┬───┐
│   │   │   │███│   │
├───┼───┼───┼───┼───┤
│   │   │███│███│   │
├───┼───┼───┼───┼───┤
│   │   │   │   │   │
├───┼───┼───┼───┼───┤
│   │███│   │   │   │
└───┴───┴───┴───┴───┘
```

```ts
interface NavCell {
    x: number;
    y: number;
    walkable: boolean;
    regionId: number;
}
```

Размер клетки: `10...20` px.

## 8. A*

Реализовать обычный A* поверх grid. Поддержать 4/8 направлений и Manhattan/Euclidean heuristic.

```ts
findPath(start: Vec2, target: Vec2): Vec2[]
```

В Debug Mode визуализировать open set, closed set, visited cells и final path.

## 9. Hierarchical A*

Разбить карту на крупные регионы и сначала искать маршрут между регионами, а затем уточнять его обычным A* внутри нужных областей.

```text
┌────────┬────────┬────────┐
│   A    │   B    │   C    │
├────────┼────────┼────────┤
│   D    │   E    │   F    │
└────────┴────────┴────────┘

A → B → E → F
```

```ts
interface Region {
    id: number;
    cells: NavCell[];
    neighbors: number[];
}
```

## 10. Flow Field

Flow field предназначен для большого количества агентов, идущих к одной цели.

```text
Target
  ↓
Integration Field
  ↓
Direction Field
  ↓
Agents
```

Пример:

```text
↘  →  →  →  ↓
↘  ↘  →  ↓  ↓
→  →  ↘  ↓  ↓
→  ↗  →  →  ↓
```

Каждый агент использует одно общее поле вместо независимого поиска полного пути.

## 11. Local Avoidance

Local avoidance работает поверх глобального pathfinding. Минимальная реализация должна искать соседних агентов, обнаруживать потенциальное столкновение, вычислять avoidance vector и смешивать его с desired velocity.

```text
Global path:
Agent ───────────────────────→ Target

Local movement:
desired velocity →
                 ○
                ↗ actual velocity
```

Начальный вариант может использовать простую steering-модель, например:

```ts
finalVelocity =
    desiredVelocity * 0.7 +
    avoidanceVelocity * 0.3;
```

Коэффициенты должны быть настраиваемыми.

## 12. Avoidance Priority

У каждого агента есть `avoidancePriority: 0...99`.

Сравнить два режима:

```text
All agents: priority = 50
```

и:

```text
Random: priority = random(0, 99)
```

Цель эксперимента — показать влияние асимметрии локальных решений на заторы.

## 13. Эксперименты

### Narrow Gate

```text
████████████       ████████████
████████████       ████████████
████████████       ████████████

       ○ ○ ○ ○ ○ ○
        ○ ○ ○ ○ ○

████████████       ████████████
```

Слайдер `Gate width: 0.5...5.0 m`. При изменении ширины перестраивать навигацию и измерять время прохождения группы.

Metrics:

```text
Gate width:       1.6 m
Agents:             200
Average clearance:  0.61 m
Time to target:     4.2 s
```

Числа в реальном приложении должны измеряться, а не быть захардкожены.

### A* / Hierarchical A*

Показать карту с препятствиями, визуализировать исследованные клетки, регионы и итоговый путь.

### A* / Flow Field

Создать 200–500 агентов с одной целью и визуально сравнить множество независимых поисков с одним общим flow field.

### Local Avoidance

Переключатель `Avoidance ON/OFF`, отображение desired и actual velocity для выбранного агента.

### Avoidance Priority

Сравнить одинаковый priority и случайные priorities на сцене с узким проходом.

### Dynamic Obstacles

Пользователь перетаскивает препятствие мышью, после чего можно видеть количество NavMesh rebuilds и их стоимость.

### Path Request Budget

Добавить очередь:

```text
Agent 1  ─┐
Agent 2   │
Agent 3   ├──> Path Request Queue
Agent 4   │
...       │
Agent 200 ┘
```

Параметр `Max path requests/frame`: `1 / 4 / 8 / 12 / 24 / unlimited`.

### Repath Jitter

Добавить `Repath interval` и `Repath jitter`. Показывать на графике разницу между синхронными и распределёнными path requests.

## 14. Metrics

Показывать:

```text
FPS
Frame time
Simulation time
Pathfinding time
Avoidance time
Rendering time

Agents
Active agents
Path requests/frame
Pending requests

Navigation
NavMesh cells
Walkable cells
Regions
Flow field rebuilds
```

Использовать `performance.now()`.

Добавить scrolling graph frame time с возможностью отображения frame/pathfinding/avoidance.

## 15. Debug Visualization

Переключатели:

```text
[x] Agents
[x] Paths
[ ] NavMesh
[ ] Regions
[ ] Open/Closed Set
[ ] Flow Field
[ ] Velocity
[ ] Avoidance Radius
[ ] Target
[ ] Obstacles
```

Для выбранного агента показывать radius, desired velocity и actual velocity.

## 16. Управление

```text
Left click
    → установить target

Shift + Left click
    → создать агента

Right click
    → создать obstacle

Drag obstacle
    → перемещать obstacle

Click agent
    → выбрать agent

Space
    → pause / resume

R
    → reset experiment

1
    → A*

2
    → Hierarchical A*

3
    → Flow Field

4
    → Local Avoidance

5
    → Dynamic Obstacles

D
    → debug mode
```

## 17. Preset Experiments

Dropdown:

```text
Free Sandbox
Narrow Gate
A* vs Hierarchical A*
A* vs Flow Field
Local Avoidance
Avoidance Priority
Dynamic Obstacles
Path Request Budget
Repath Jitter
```

При выборе эксперимента мир сбрасывается в заранее подготовленное состояние.

## 18. Simulation Loop

Использовать fixed timestep, например 60 Hz.

```text
┌──────────────────────┐
│ Input                │
└──────────┬───────────┘
           ↓
┌──────────────────────┐
│ Path Requests Queue  │
└──────────┬───────────┘
           ↓
┌──────────────────────┐
│ Global Navigation    │
│ A* / Hierarchical    │
│ / Flow Field         │
└──────────┬───────────┘
           ↓
┌──────────────────────┐
│ Local Avoidance      │
└──────────┬───────────┘
           ↓
┌──────────────────────┐
│ Agent Movement       │
└──────────┬───────────┘
           ↓
┌──────────────────────┐
│ Metrics              │
└──────────┬───────────┘
           ↓
┌──────────────────────┐
│ Rendering            │
└──────────────────────┘
```

Rendering FPS может быть переменным, simulation должна использовать фиксированный timestep.

## 19. Deterministic Random

Для экспериментов использовать seeded random, чтобы один и тот же сценарий можно было воспроизводить.

Особенно важно для:

- расположения агентов;
- avoidance priority;
- repath jitter;
- препятствий.

## 20. Benchmark Mode

Добавить кнопку `[ Benchmark ]`, которая запускает один и тот же эксперимент много раз и выводит average/min/max.

```text
Iterations: 100

Average:
Pathfinding:  X.XX ms
Avoidance:    X.XX ms
Simulation:   X.XX ms

Min: ...
Max: ...
```

Никакие benchmark values не должны быть захардкожены.

## 21. URL-параметры

Поддержать прямой запуск эксперимента:

```text
/?experiment=narrow-gate
/?experiment=flow-field
/?experiment=avoidance
```

Это позволит встраивать ссылки на конкретные эксперименты непосредственно в статью.

## 22. Ограничения

На первом этапе не реализовывать:

- полноценный 3D NavMesh;
- production-quality ORCA/RVO;
- multiplayer;
- networking;
- ECS;
- backend;
- сохранение проектов;
- сложный editor;
- полноценную физику.

Главное — прозрачная визуализация принципов.

## 23. Этапы реализации

### Phase 1 — базовый sandbox

Vite, TypeScript, Phaser, World, Agent, Target, Obstacles, input, rendering и metrics.

### Phase 2 — navigation

Grid, walkable cells, A* и path rendering.

### Phase 3 — hierarchical navigation

Regions, region graph, Hierarchical A* и визуализация.

### Phase 4 — crowd

Multiple agents, path request queue, local avoidance и avoidance priority.

### Phase 5 — Flow Field

Integration field, direction field, shared field и визуализация.

### Phase 6 — dynamic obstacles

Draggable obstacles, navigation rebuild и metrics.

### Phase 7 — experiments

Все preset experiments.

### Phase 8 — polish

UI, graphs, debug overlays, benchmark mode, deterministic random, responsive layout и URL parameters.

## 24. Требования к коду

Код должен быть TypeScript, без `any` без необходимости, разбит на небольшие модули и не должен связывать алгоритмы с Phaser.

Алгоритмы должны быть максимально читаемыми: это учебная демонстрация, поэтому:

```text
readability > micro-optimization
```

При этом simulation должна оставаться достаточно быстрой для примерно 500 агентов на обычном desktop браузере.

## 25. Критерии готовности

1. `npm run dev` запускает приложение.
2. `npm run build` проходит без ошибок.
3. Можно создать минимум 500 агентов.
4. Можно менять target.
5. Можно перемещать obstacles.
6. A* строит корректный путь.
7. Hierarchical A* строит корректный путь.
8. Flow Field позволяет большому количеству агентов двигаться к одной цели.
9. Local avoidance предотвращает очевидные столкновения.
10. Можно включать и выключать avoidance.
11. Можно менять avoidance priority.
12. Есть path request queue.
13. Есть dynamic obstacle experiment.
14. Есть debug visualization.
15. Есть metrics.
16. Есть минимум пять preset experiments.
17. Эксперименты воспроизводимы благодаря seeded random.
18. Simulation не зависит от FPS rendering.
19. Benchmark numbers измеряются реально.
20. Каждый эксперимент можно открыть через URL.

## 26. Основной принцип

Sandbox не должен выглядеть как отдельная игра. Это интерактивная иллюстрация статьи.

Каждый эксперимент должен отвечать на конкретный вопрос:

```text
Почему узкий проход создаёт проблему?
        ↓
Narrow Gate
```

```text
Почему одного A* недостаточно?
        ↓
Hierarchical A*
```

```text
Почему 200 одинаковых запросов не всегда нужны?
        ↓
Flow Field
```

```text
Почему глобальный path не решает столкновения?
        ↓
Local Avoidance
```

```text
Почему симметрия толпы может мешать?
        ↓
Avoidance Priority
```

```text
Почему динамический obstacle может быть дорогим?
        ↓
Dynamic Obstacles
```

```text
Почему нельзя выполнять все path requests одновременно?
        ↓
Path Request Budget
```

Финальная цель — маленькая прозрачная лаборатория, в которой каждую идею из статьи можно включить, увидеть, сломать и сравнить с другим подходом.
