# WORKFLOW — Estrategia multi-agente de proj_minerva

Cómo se construyó (y se sigue construyendo) este proyecto con Claude Code usando un
modelo de **orquestador + subagentes**, con modelos distintos según el rol. Esta
estrategia la definió Edilson al inicio del proyecto y demostró funcionar a lo largo
de T1–T15.

## La idea en una línea

> **Fable 5 orquesta y verifica; Sonnet 5 implementa.** El razonamiento caro se gasta
> en decidir, diagnosticar y comprobar; el volumen de código lo produce un modelo más
> económico sobre tareas quirúrgicamente descritas.

## Roles

### Orquestador — Claude **Fable 5** (la sesión principal de Claude Code)

Responsable de todo lo que requiere criterio y contexto global:

1. **Planificar** en `PLAN.md` (sandbox del plan: objetivo de la iteración,
   arquitectura, decisiones, riesgos). Se actualiza al empezar/terminar cada fase.
2. **Definir tareas** en `TASKS.md`, cada una con: contexto, entregables concretos,
   criterio de **aceptación** verificable, y los **gotchas conocidos** que el
   subagente debe respetar (p. ej. "sin backticks en strings de main").
3. **Delegar** la implementación a subagentes (tool `Agent`, `model: sonnet`).
4. **Verificar** cada entrega ANTES de marcar `[x]`: typecheck/lint/tests + suites
   e2e vía CDP + captura de pantalla cuando el cambio es visual. La verificación
   NUNCA se delega al mismo agente que implementó.
5. **Depurar causas raíz** cuando la verificación falla (históricamente, los smokes
   fallan más por bugs del test que de la app — el orquestador decide cuál es cuál).
6. **Integrar y llevar bitácora**: gotchas nuevos al log de `TASKS.md`, estado a la
   memoria persistente, hitos al `README.md`.
7. **Escalar al humano** cuando se necesita una acción que solo Edilson puede hacer
   (login por device flow, entregar API keys, crear el OAuth App, probar UX).

### Subagentes — Claude **Sonnet 5** (implementación)

- Reciben UNA tarea acotada de `TASKS.md` con aceptación clara y gotchas anotados.
- Implementan, corren typecheck/lint/tests localmente, y reportan qué tocaron.
- Su "terminé" **no cuenta como verificación**: el orquestador reproduce y verifica.
- Ejemplos reales (IDs en la bitácora de TASKS.md): T12 settings UI
  (`a8ec8959ac1812fed`), T13 streaming (`adae073f8f6e3b9a3`), T14 ventana
  desacoplable + visor (`a51e416ddd0ef0ffd`).

### Agentes/skills especializados (`.claude/`)

- `agents/electron-security-reviewer.md` — revisión de la frontera de seguridad
  (usado en T11).
- `agents/pr-didactic-analyzer.md` + `skills/{mermaid-c4-diagram, endpoint-doc-probe,
  er-diagram-schema}` — la base del prompt del producto (el análisis didáctico).

## Los tres artefactos

| Artefacto | Rol | Regla |
|---|---|---|
| `PLAN.md` | Sandbox del plan de la iteración | Se re-escribe con libertad; no es bitácora |
| `TASKS.md` | Control de tareas + **bitácora append-only** | `[ ]` pendiente · `[~]` en progreso · `[x]` hecha **y verificada** · `[!]` bloqueada. Nada pasa a `[x]` sin verificación del orquestador |
| `WORKFLOW.md` | Este documento | Se actualiza si la estrategia cambia |

La bitácora de `TASKS.md` es la memoria técnica del proyecto: cada gotcha descubierto
(preload CJS, vite:esm-shim, contaminación entre suites e2e, safeStorage en Hyprland…)
queda escrito con causa y fix, y los gotchas relevantes se copian a la descripción de
las tareas futuras que puedan tropezar con ellos.

## Ciclo de una tarea

```
PLAN.md (contexto) ──► TASKS.md (tarea bien descrita, con aceptación y gotchas)
        │
        ▼
  Agent(model: sonnet) implementa ──► reporta
        │
        ▼
  Orquestador VERIFICA:  typecheck + lint + tests
                         suites e2e (CDP, puerto 9222)
                         captura de pantalla si es UI  ◄── lección T15-bis
        │
   ¿falla? ──► el orquestador diagnostica: ¿bug de app o bug del test?
        │        (app → nueva tarea/fix;  test → se endurece la suite)
        ▼
  [x] en TASKS.md + bitácora + memoria + README si es hito
```

## Por qué esta división de modelos

- **Fable 5 (orquestador)**: los errores caros de este proyecto nunca fueron de
  tipeo de código — fueron de diagnóstico (¿la app está rota o el test miente?),
  de diseño de verificación (los checks geométricos que "pasaban" con el visor
  colapsado) y de decisiones de arquitectura (protocolo tagged vs JSON para
  streaming). Ahí rinde el modelo más capaz.
- **Sonnet 5 (subagentes)**: una tarea con contexto completo, aceptación clara y
  gotchas anotados es territorio ideal para un modelo rápido y económico. La calidad
  la garantiza la descripción de la tarea + la verificación posterior, no el tamaño
  del modelo que escribe el código.
- El costo total baja y el throughput sube: mientras un subagente implementa, el
  orquestador prepara la siguiente tarea o verifica la anterior.

## Lecciones acumuladas (resumen; detalle en la bitácora de TASKS.md)

1. **Verificar siempre, e2e, desde fuera**: la suite Playwright (`e2e/`, antes
   suites `scripts/smoke-*.mjs` vía CDP — retiradas al completar la migración
   el 2026-07-25). El unit test verde no garantiza nada del flujo completo.
2. **Las suites también tienen bugs** — y más seguido que la app. Tres rondas de
   "bugs fantasma" fueron contaminación de estado entre suites, un target CDP que
   apuntaba a la ventana equivocada, y matchers ambiguos.
3. **La verificación de UI termina en una captura mirada de verdad**
   (`scripts/screenshot-app.sh`): el DOM puede decir "visible" mientras el usuario ve
   un panel vacío (getBoundingClientRect ignora clipping).
4. **El humano en el loop donde toca**: logins, keys, y validación de UX son de
   Edilson; el orquestador los pide explícitamente y no se bloquea esperando — deja
   watchers (`scripts/watch-auth.mjs`) o continúa con otra tarea.
