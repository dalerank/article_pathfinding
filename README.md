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

## Сборка

```bash
npm run build
```

## Статус

Сейчас реализован Phase 1 (базовый sandbox): мир, агенты, цель, препятствия,
ввод (клик — цель, Shift+клик — агент, ПКМ — препятствие, drag — перемещение
препятствия), рендеринг, fixed-timestep simulation loop и базовые метрики.

Модули навигации (`src/navigation`), avoidance (`src/avoidance`) и экспериментов
(`src/experiments`) — заглушки с сигнатурами из ТЗ; реализуются по фазам 2–8,
описанным в разделе 23 спеки.
