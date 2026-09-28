# NavMesh Sandbox

Интерактивный 2D sandbox для сопровождения статьи о проблемах NavMesh, pathfinding
и поведения толпы ([`docs/article.md`](docs/article.md)): почему 200 агентов не проходят
в одни ворота, чем local avoidance отличается от глобальной навигации, зачем нужен
Hierarchical A* и Flow Field, и как приоритеты и бюджет path request влияют на затор.

Полное техническое задание: [`NavMesh_Sandbox_Implementation_Spec.md`](NavMesh_Sandbox_Implementation_Spec.md).

## Стек

TypeScript, Phaser 3, Vite, без backend.

## Запуск

```bash
npm install
npm run dev
```

Открой `http://localhost:5173/` — титульная страница со ссылками на все примеры.

## Сборка

```bash
npm run build
```

## Структура

- `index.html` — титульная страница со ссылками на все примеры.
- `examples/sandbox.html` — свободная песочница (добавление агентов/препятствий,
  drag, метрики).
- `examples/*.html` — восемь примеров, каждый со своей страницей и логикой в
  `src/pages/*.ts`: Narrow Gate, Avoidance Priority, Local Avoidance,
  A* / Hierarchical A*, A* vs Flow Field, Dynamic Obstacles, Link Cost Override,
  Path Request Budget & Jitter.
- `src/navigation` — NavMesh grid, A*, Hierarchical A*, Flow Field.
- `src/avoidance` — local avoidance и avoidance priority.
- `src/simulation` — мир, агенты, fixed-timestep loop, очередь path request.
- `src/experiments` — конфигурация мира для каждого примера.

## Статус

Реализованы Phase 1–7 из раздела 23 спеки: базовый sandbox, NavMesh grid и A*,
Hierarchical A*, crowd/avoidance с приоритетами, Flow Field, dynamic obstacles,
path request budget + repath jitter, плюс не входившие в исходное ТЗ примеры
(снэппинг цели через `NavMesh.SamplePosition`, cost override для OffMeshLink).

Не реализовано: Phase 8 полировка (benchmark mode, URL-параметры
`?experiment=`, адаптивная вёрстка под мобильные экраны).
