# TASKS — proj_minerva

Estados: `[ ]` pendiente · `[~]` en progreso · `[x]` hecha y **verificada** · `[!]` bloqueada

Regla: una tarea no pasa a `[x]` sin correr su verificación (ver PLAN.md). Cada tarea
anota **quién** la hizo (subagente/directo) y **cómo** se verificó.

---

## F1 — Base del proyecto

- [x] **T1. Scaffold electron-vite + React + TS**
  Crear la estructura base con electron-vite (main/preload/renderer), TypeScript
  estricto, ESLint + Prettier, y scripts `dev/build/typecheck/lint`. Conservar
  README.md, CLAUDE.md, .claude/ y .agents/ existentes.
  _Aceptación:_ `npm run typecheck`, `lint` y `build` en verde; `npm run dev` abre ventana.

- [x] **T2. Contratos IPC tipados + preload bridge**
  `src/shared/ipc.ts` con canales y tipos req/res; `src/shared/types.ts` con modelos
  de dominio (RepoRef, PullRequestSummary, PrDetail, DiffFile, CommentThread, …).
  Preload expone `window.minerva.{auth,github,ai}` tipado vía contextBridge. Main
  registra handlers en `src/main/ipc/` con validación de payloads.
  _Aceptación:_ typecheck verde; renderer llama un handler `ping` de prueba y recibe
  respuesta tipada; contextIsolation on, nodeIntegration off, sandbox on.

- [x] **T3. Shell de UI de 3 paneles (Tailwind, tema oscuro)**
  Layout estilo GitKraken: sidebar izquierda (lista de PRs), centro (diff), panel
  derecho colapsable (didáctico). Tailwind v4, tema oscuro, Zustand para estado de
  layout. Datos mock.
  _Aceptación:_ dev abre la ventana con los 3 paneles navegables; build verde.

## F2 — GitHub

- [x] **T4. Capa GitHub en main con datos mock detrás de interfaz**
  `src/main/github/` con interfaz `GithubService` (listPRs, getPrDetail, getPrFiles,
  getComments, postComment, …) e implementación mock (fixtures realistas). Handlers
  IPC conectados. Flag `MINERVA_MOCK=1`.
  _Aceptación:_ la UI lista PRs mock end-to-end (renderer→IPC→main→mock).

- [x] **T5. Vista de lista de PRs real (renderer)** _(absorbida por T3+T4)_
  Lista de PRs abiertos agrupados por repo, con búsqueda/filtros, estados de CI y
  reviewers. Loading/error states.
  _Aceptación:_ contra mocks: estados de carga, error y datos se ven correctos.

- [x] **T6. Auth GitHub real (Device Flow) + Octokit**
  OAuth Device Flow en main, token cifrado con safeStorage en userData, implementación
  real de `GithubService` con Octokit (GraphQL para listados, REST para acciones).
  _Aceptación:_ login manual de Edilson funciona; PRs reales listados; token nunca
  llega al renderer (revisión con electron-security-reviewer).

- [x] **T7. Vista de diff estilo GitKraken**
  Árbol de archivos (toggle tree/list), split view e inline view, syntax highlighting
  (Shiki), word wrap, navegación entre archivos.
  _Aceptación:_ con un PR mock con varios archivos, ambas vistas renderizan bien.

- [x] **T8. Comentarios: leer y publicar**
  Hilos de comentarios de PR y de línea; publicar comentario general y por línea.
  _Aceptación:_ contra mocks e2e; con cuenta real, comentar en un PR de prueba.

## F3 — Panel didáctico (IA)

- [x] **T9-final. `OpenRouterAiService` real (OpenRouter, multi-LLM)**
  Decisión 2026-07-05 (Edilson): usar OpenRouter en vez de Anthropic directo para poder
  elegir entre múltiples LLMs. Implementado en `src/main/ai/`:
  `env.ts` (lee `OPENROUTER_API_KEY`/`MINERVA_AI_MODEL` de `process.env`, con fallback a
  parsear el `.env` de la raíz en dev), `prompts/analyze-pr.ts` (system prompt versionado,
  adaptado de `.claude/agents/pr-didactic-analyzer.md`, pide JSON estricto), `diff-budget.ts`
  (presupuesto ~60k chars, trunca por archivo y lista omitidos), `json-extract.ts` (extrae
  el primer `{...}` balanceado de la respuesta, por si el modelo la envuelve en texto/code
  fence), `section-mapper.ts` (valida/mapea a `DidacticSection[]`, descarta secciones
  malformadas con log, lanza si ninguna sobrevive), y `openrouter-service.ts`
  (`OpenRouterAiService implements AiService`: pide detalle+archivos al `GithubService`
  ACTIVO inyectado, arma el prompt, hace POST con fetch nativo + `AbortController` a 60s,
  mapea errores 401/402/429/otros a mensajes en español sin exponer la key).
  `createAiService(github)` (`./index.ts`) ahora recibe el `GithubService` activo y elige
  `OpenRouterAiService` si hay key (INDEPENDIENTE de `MINERVA_MOCK`, para poder probar IA
  real sobre PRs mock) o `MockAiService` si no. `handlers.ts` actualizado para pasar la
  instancia de `githubService` a `createAiService`.
  _Aceptación:_ typecheck/lint/test/build verdes (11 archivos de test nuevos, ~40 casos,
  fetch mockeado — nunca se llama a OpenRouter real en tests). VERIFICADA e2e por el
  orquestador 2026-07-06: análisis real sobre PR mock #482 en 13.4s (ver log).

- [x] **T10. Panel didáctico en renderer (Markdown + Mermaid)**
  Render de streaming Markdown + bloques Mermaid (C4, erDiagram) con fallback si el
  diagrama no parsea. Secciones: resumen, arquitectura, endpoints (con snippet curl/.http
  copiable), esquema.
  _Aceptación:_ fixtures de las 3 categorías renderizan diagramas válidos.

- [~] **T11. Revisión de seguridad + pulido**
  Pasar electron-security-reviewer a todo el código; arreglar hallazgos; revisar
  empaquetado básico.
  _Aceptación:_ 0 hallazgos altos; build de producción arranca.
  _Estado:_ revisión hecha (0 altos, 2 medios, 3 bajos). Arreglados: validación de
  esquema http(s) en `setWindowOpenHandler` y eliminación de la rama de fallback sin
  contextIsolation en preload (ahora lanza error). Validación por canal hecha
  (`ipc/validators.ts`). CSP explícita hecha en T15 (2026-07-06): img-src 'self'
  data: https:, font-src, connect-src, object-src 'none', base-uri 'none',
  form-action 'none' (frame-ancestors no aplica vía <meta>). PENDIENTE: empaquetado
  (electron-builder) — no existe aún.

## F4 — Features post-MVP (pedidas por Edilson 2026-07-06)

- [x] **T12. Settings UI: selector de modelo de IA**
  Modal de settings (engrane en TitleBar). Lista curada de modelos (IDs verificados
  contra la API pública de OpenRouter): `z-ai/glm-5.2` (DEFAULT), `moonshotai/kimi-k2.7-code`,
  `google/gemini-3.5-flash`, `openai/gpt-5.5`, `anthropic/claude-opus-4.8`,
  `anthropic/claude-sonnet-5`. Persistencia en main (JSON en userData, no secreto).
  Precedencia: settings > env MINERVA_AI_MODEL > default glm-5.2.
  _Aceptación:_ cambiar modelo desde la UI persiste tras reiniciar y el análisis usa el
  modelo elegido (verificable en la respuesta de OpenRouter).

- [x] **T13. Streaming del análisis didáctico**
  El texto del análisis aparece en vivo. Protocolo de secciones incremental (el modelo
  emite secciones en formato tagged parseable en streaming), SSE de OpenRouter en main,
  eventos push main→renderer (nuevo canal de eventos en preload con suscripción tipada).
  _Aceptación:_ al pulsar Analizar PR se ve texto fluyendo en <2s del primer token;
  el resultado final renderiza igual que hoy (secciones + Mermaid).

- [x] **T14. Panel didáctico desacoplable + visor de recursos**
  (a) Botón "abrir en ventana": el panel se abre en una BrowserWindow propia, más ancha,
  sincronizada con el PR seleccionado (cache de análisis en main para no re-pagar el LLM).
  (b) Visor de recursos: cada diagrama Mermaid/tabla/snippet tiene "expandir" → lightbox
  con zoom/pan (diagramas) y vista amplia (tablas), también disponible en la ventana
  desacoplada.
  _Aceptación:_ desacoplar muestra el mismo análisis sin nueva llamada al LLM; zoom/pan
  fluido en un diagrama C4 grande.

- [x] **T15. Bugfixes reportados por Edilson (2026-07-06)**
  (a) Botones Copiar/Expandir del snippet superpuestos → el expandir ahora vive DENTRO
  del header de `CodeSnippet`, junto a Copiar (el overlay `ExpandableResource` queda
  solo para diagramas). (b) Comentarios de GitHub como texto plano → `Markdown`
  compartido en `ui/` (movido desde `didactic/DidacticMarkdown`), usado en hilos,
  descripción del PR y panel didáctico; con override de `img`. (c) Visor de Mermaid
  vacío → el SVG (width:100% de mermaid) colapsaba a 0px dentro del wrapper absolute
  del zoom; fix: `withNaturalSize` reescribe el STRING del SVG a los px del viewBox
  antes de insertarlo, y `fitToContainer` calcula el fit desde el viewBox (idempotente).
  (d) Iconos rotos en C4 → CSP sin `img-src data:` bloqueaba el PNG base64 del person
  icon; CSP explícita nueva (cierra el pendiente (b) de T11). (e) BONUS descubierto por
  la suite endurecida: reutilizar la ventana didáctica con otro PR cambiaba la URL pero
  NO el contenido (navegación same-document al cambiar solo el hash) → `main.tsx` ahora
  escucha `hashchange` y remonta `DidacticWindowApp` con `key={hash}`.
  _Aceptación:_ smoke-bugfixes 7/7 + regresión de las 9 suites verde.

- [x] **T16. Calidad de diagramas: lienzo claro + layout C4 + DSL más sobrio**
  Reportado por Edilson con captura (2026-07-06): en el visor, las etiquetas de las
  flechas de un C4 son ilegibles (tema dark sobre fondo oscuro, sin fondo propio) y se
  enciman entre sí y sobre las cajas (layout C4 por defecto: 4 shapes por fila,
  márgenes mínimos, etiquetas de Rel largas generadas por la IA).
  (a) Tema claro: mermaid pasa de `theme: 'dark'` a `'neutral'`; los diagramas se
  renderizan SIEMPRE sobre fondo blanco — tarjeta inline del panel y área del visor
  (`MermaidZoomPan`) con `bg-white`. Decisión de Edilson: blanco en ambas superficies,
  un solo tema.
  (b) Config de layout en el `initialize` (mermaid 11.16): `c4: { c4ShapeInRow: 3,
  c4BoundaryInRow: 1, c4ShapeMargin ↑, c4ShapePadding ↑, diagramMarginX/Y ↑,
  messageFontSize ↑ }` + ajustes análogos razonables para `er` y `flowchart`.
  (c) DSL más sobrio: prompt (`analyze-pr.ts`) y skill `mermaid-c4-diagram` exigen
  etiquetas de `Rel()` de ≤4 palabras (el detalle va en el Markdown de la sección, no
  en la flecha), ≤8 elementos por diagrama y tecnología corta.
  Decisión de Edilson: mantener sintaxis C4 (no migrar a flowchart) y hacer (a)+(b)+(c).
  _Aceptación:_ captura del visor con un C4 real donde TODAS las etiquetas de relación
  sean legibles sobre blanco y no pisen cajas; typecheck/lint/tests + suites afectadas
  (smoke-bugfixes, smoke-detach) verdes.

- [x] **T17. Contraste del tema oscuro (markdown didáctico + superficies)**
  Reportado por Edilson con captura (2026-07-06, visor "Endpoint — vista amplia"):
  en el tema oscuro casi no se distinguen los resaltes — headers de tabla, headings,
  inline code y bloques de código quedan planos sobre `panel`/`bg`.
  Archivos: `src/renderer/src/components/ui/Markdown.tsx` (principal),
  `src/renderer/src/components/didactic/DidacticSectionCard.tsx`,
  `src/renderer/src/styles.css`.
  Entregables:
  (a) `styles.css`: nuevo token `--color-code-bg` (fondo de bloques de código, más
  oscuro que `panel`, ~`#15181d`) y subir un paso `--color-border` (~`#353b47`)
  para que bordes/separadores se noten. NO tocar `--color-muted` ni el resto.
  (b) `Markdown.tsx`: cuerpo de texto legible — `p`/`li`/`td` pasan de `text-muted`
  a texto principal con leve atenuación (p.ej. `text-text/90`; `muted` queda para
  metadatos, no para el contenido). Jerarquía de headings visible: `h2` un paso más
  grande con `border-b border-border pb-1`; `h3` claramente semibold en `text-text`.
  Inline code como chip visible (fondo más claro tipo `bg-white/10` + texto casi
  blanco). `pre` sobre `bg-[var(--color-code-bg)]` (o utilidad `bg-code-bg` del
  token) + borde. `thead` con fondo notorio (p.ej. `bg-border/60`) y `text-text`;
  zebra sutil en filas (`even:bg-white/[0.03]` en `tr` del tbody o equivalente).
  (c) `DidacticSectionCard`: header de sección con fondo levemente elevado
  (p.ej. `bg-white/[0.04]`) para que el título de cada sección se note.
  Gotchas: `Markdown.tsx` es compartido con los comentarios de GitHub
  (ConversationTab) — la mejora aplica a ambos, no bifurcar. Tailwind v4 CSS-first:
  los tokens `@theme` generan utilidades (`--color-code-bg` → `bg-code-bg`).
  _Aceptación:_ typecheck/lint/`npm test` verdes; captura del visor amplio con una
  sección de endpoint (tabla + JSON): headers de tabla, headings, chips de inline
  code y bloque de código claramente distinguibles a simple vista.

- [x] **T18. Visor de diff: un solo grid por archivo (alineación entre hunks)**
  Reportado por Edilson con captura (2026-07-06, PR real #70 de clevr-merlin):
  "la indentación del visor de cambios tiene varios problemas". Diagnóstico del
  orquestador VERIFICADO contra el patch crudo de GitHub (viene limpio, 4 espacios,
  `)` en columna 0): la indentación dentro de cada hunk es correcta, pero cada
  `HunkBlock` renderiza su PROPIO grid y en las plantillas actuales
  (`auto max-content ...`) las columnas `auto` de los gutters ABSORBEN el espacio
  libre sobrante del contenedor → el inicio de la columna de código varía por hunk
  (~100px entre hunks en la captura) y se percibe como sangría rota/inconsistente.
  Archivos: `src/renderer/src/components/pr-detail/{DiffView,SplitDiff,InlineDiff}.tsx`.
  NO tocar `lib/diff-parser.ts` (sus tests quedan como están).
  Entregables:
  (a) `SplitDiff`/`InlineDiff` pasan a recibir `hunks: DiffHunk[]` y renderizan UN
  solo grid por archivo: por cada hunk, una fila header con el estilo actual
  (`border-y border-border bg-panel px-3 py-1 font-mono text-[11px] text-muted`)
  en `style={{ gridColumn: '1 / -1' }}`, seguida de sus filas (armadas con los
  builders existentes `buildSplitRows([hunk])`/`buildInlineRows([hunk])`).
  (b) Gutters que NO absorben espacio libre: split
  `max-content minmax(max-content, 1fr) max-content minmax(max-content, 1fr)`
  (wrap: `max-content minmax(0, 1fr) max-content minmax(0, 1fr)`); inline
  `max-content max-content max-content minmax(max-content, 1fr)`
  (wrap: `... minmax(0, 1fr)`). El `minmax(..., 1fr)` del contenido mantiene los
  fondos verde/rojo llegando al borde derecho.
  (c) `HunkBlock` desaparece o queda mínimo; keys de filas únicos por
  `${hunkIndex}:${rowIndex}`; el patrón `group/row contents` para el hover del
  botón "+" y las filas de threads/composer (`gridColumn: '1 / -1'`) se conservan.
  Gotchas: NO resetear estado con setState-en-efecto (regla del linter); el
  `overflow-auto` vive en el contenedor de `DiffView`, no meter overflow por hunk.
  _Aceptación:_ typecheck/lint/`npm test` verdes; `smoke-diff.mjs` verde; captura
  de un diff mock con varios hunks donde los números de línea y el inicio del
  código quedan en la MISMA x en TODOS los hunks del archivo — en split e inline,
  con word wrap on y off — y la indentación relativa se conserva.

- [ ] **T19. Silenciar los "Payload inválido" de arranque (CenterPane placeholder)**
  Hallazgo del orquestador (2026-07-06, revisando logs de dev): con la app recién
  abierta (sin PR seleccionado), `CenterPane` llama `usePullRequestDetail` y
  `useCommentThreads` con un placeholder `{owner:'', name:'', fullName:''}` /
  `number: 0` para respetar las reglas de hooks; el validador de main lo rechaza
  (correctamente) y loguea `Error occurred in handler ... Payload inválido` en
  `github:getPullRequestDetail` y `github:getCommentThreads` en cada arranque o
  deselección. Inofensivo (el guard `!selectedPr` ignora el resultado) pero es
  ruido que asusta en el log y un round-trip IPC inútil.
  Fix sugerido: que ambos hooks acepten `repo: RepoRef | null` y hagan no-op
  (sin fetch, `loading: false`) cuando `repo === null || number < 1`, y que
  `CenterPane` pase `selectedPr?.repo ?? null`. Sin cambios en main.
  _Aceptación:_ arrancar la app y deseleccionar PR sin que aparezca ningún
  "Payload inválido" en el log de dev; smoke-e2e y smoke-comments verdes.

## F5 — Iteración 2026-07-06 (noche): sección "levantar la app" + highlighting

- [x] **T20. Nueva sección `setup` del análisis didáctico: instructivo para levantar la app**
  Pedido de Edilson (2026-07-06): el agente debe explicar al desarrollador cómo
  levantar la app para probar el PR — si se puede con Docker cómo, cómo correrla
  en local, qué variables de entorno necesita y, si el PR agrega variables de
  entorno nuevas, listarlas explícitamente. Todo en UNA sección propia
  (instructivo), SIEMPRE presente, segunda en el orden (tras `summary`).
  Alcance (slice vertical):
  - `src/shared/types.ts`: variante `{ kind: 'setup'; snippets: DidacticSnippet[] }`;
    `DidacticSnippet.language` pasa a `'curl' | 'http' | 'bash' | 'env'`.
  - `src/shared/events.ts`: variante draft `setup` (como `endpoint`).
  - `src/main/ai/section-mapper.ts`: `case 'setup'` (misma forma que `endpoint`);
    `mapSnippet` acepta `bash`/`env`.
  - `src/main/ai/stream-parser.ts`: `KNOWN_KINDS` + `toDraft` + `sectionToText`
    (snippets también para `setup`).
  - `src/main/ai/prompts/analyze-pr.ts`: kind `setup` en marcadores y contrato:
    siempre presente, con docker si el diff/metadata lo evidencia, corrida local,
    env vars requeridas y OBLIGATORIO detectar env vars nuevas del diff
    (`process.env.X`, `os.environ`, `ENV` en Dockerfile, `.env.example`, config);
    honestidad cuando el diff no alcanza; snippets `bash` (comandos) y `env`
    (bloque para `.env`). OJO gotcha: concatenación de comillas, sin backticks.
  - `.claude/agents/pr-didactic-analyzer.md`: misma sección en el contrato
    ("🚀 Cómo levantar la app", siempre).
  - `src/main/ai/fixtures.ts`: sección `setup` en al menos 2 fixtures shopwave
    (una con env vars nuevas). Sin backticks en strings.
  - `DidacticAnalysisArea.tsx`: `SECTION_META.setup` (título "Cómo levantar la app",
    icono `Rocket`); render de snippets para `endpoint` **o** `setup` en ambas
    variantes (final y draft).
  - Tests: casos `setup` + lenguajes nuevos en `section-mapper.test.ts` y
    `stream-parser.test.ts` (round-trip `stringifySections`).
  _Aceptación:_ typecheck/lint/test verdes; con `MINERVA_MOCK=1` el PR con fixture
  `setup` muestra la card con snippets copiables (captura mirada); smoke-didactic
  (o suite equivalente) verde.

- [x] **T21. Syntax highlighting en bloques de código (didáctico + comentarios)**
  Pedido de Edilson (2026-07-06): resaltar sintaxis donde mostramos código
  (`CodeSnippet.tsx` y fences de `ui/Markdown.tsx`). **Librería APROBADA por
  Edilson (2026-07-06): Shiki** (motor TextMate de VS Code), elegida frente a
  highlight.js y prism-react-renderer por calidad y por cubrir exactamente
  nuestros lenguajes (`shellscript`, `http`, `dotenv`, `docker`, `sql`, `diff`,
  ts/tsx/json/yaml — verificado contra tm-grammars). **Hallazgo del orquestador
  al arrancar:** Shiki 4.3.1 YA es dependencia — la vista de diff (T7) usa
  `src/renderer/src/lib/highlighter.ts` (singleton lazy `createHighlighterCore`,
  imports finos `@shikijs/langs/*`, motor regex JS, tema `github-dark-default`,
  render por tokens React sin innerHTML). Decisión revisada: EXTENDER ese módulo,
  no crear otro highlighter ni otro tema (coherencia visual con el diff):
  - Agregar gramáticas: `dotenv`, `http`, `docker`, `diff`, `python`.
  - Nueva API multilínea `highlightCode(code, lang)` (la existente
    `highlightLine` es por línea, limitación propia del diff que aquí no aplica).
  - Mapa de lenguajes de dominio: snippet `curl`→bash, `env`→dotenv, `http`,
    `bash`; fences de markdown (`language-xxx`) con aliases comunes; lo
    desconocido cae a texto plano sin romper.
  - Componente compartido `HighlightedCode` (tokens → spans React) usado por
    `CodeSnippet.tsx` y el override `code` de `ui/Markdown.tsx`; fallback al
    `<pre>` plano mientras el highlighter carga (async) y para langs no
    soportados. Sin `dangerouslySetInnerHTML` (contenido de PRs no confiable).
  _Aceptación:_ typecheck/lint/test verdes; captura mirada con un snippet bash y
  un fence resaltados en el panel didáctico y en la vista amplia del visor.

## F5.1 — Iteración 2026-07-06 (noche 2): sincronía del panel didáctico

- [x] **T22. Sincronía del análisis entre panel acoplado y ventana desacoplada**
  Reportado por Edilson con captura (PR real clevr-merlin #70): (a) desacoplar a
  mitad de un streaming abre una ventana que muestra el placeholder — debe
  conservar lo ya streameado y seguir recibiendo, y el panel acoplado debe
  CERRARSE al desacoplar; (b) cerrar y reabrir el panel acoplado vuelve al
  placeholder aunque el análisis ya se pagó, y re-pulsar "Analizar PR" con un
  análisis aún en vuelo lanza una SEGUNDA llamada LLM (sin dedupe in-flight).
  Causas raíz diagnosticadas por el orquestador:
  - Main no registra análisis EN CURSO: `ai:getCachedAnalysis` solo ve
    completados; el hook solo se suscribe a `onAnalysisProgress` dentro de
    `analyze()` → una ventana montada a mitad del streaming no tiene forma de
    engancharse.
  - `openrouter-service.ts` emite `onProgress(sections, { done: true })` SOLO en
    éxito; en error lanza sin evento terminal → una ventana adjunta se quedaría
    en "streaming" para siempre.
  - El panel acoplado (`DidacticPanel` → `DidacticAnalysisArea`) no pasa
    `autoLoadFromCache`.
  Alcance (slice vertical):
  - `src/main/ipc/handlers.ts`: registro in-flight
    `Map<key, { promise, snapshot }>` (key `owner/name#number`) DENTRO de
    `registerIpcHandlers`. `ai:analyzePullRequest`: cache hit → igual que hoy;
    in-flight hit → devolver LA MISMA promesa (cero llamadas LLM extra); miss →
    arrancar, guardar snapshot en cada `onProgress` y hacer el broadcast como
    hoy, PERO suprimir el broadcast del `{ done: true }` que emite el servicio
    en éxito: el evento terminal lo emite el handler DESPUÉS de
    `analysisCache.set(...)` (garantiza que quien reciba `done: true` sin error
    ya encuentra el cache poblado), con las secciones finales del snapshot. En
    catch: broadcast terminal `{ done: true, error: <message>, sections:
    <último snapshot o []> }` y re-throw para que el invoke del solicitante
    rechace como hoy. `finally`: borrar la entrada in-flight.
  - `src/shared/events.ts`: `AnalysisProgressEvent.error?: string` (solo en el
    evento terminal de un análisis fallido; documentarlo).
  - `src/shared/types.ts`: tipo `AnalysisState =
    { status: 'idle' } | { status: 'streaming'; sections: DraftDidacticSection[] }
    | { status: 'cached'; analysis: DidacticAnalysis }` (importa el draft de
    `events.ts`; si genera ciclo de imports, definirlo en `events.ts`).
  - `src/shared/ipc.ts`: canal `ai:getAnalysisState`
    `{ req: { repo; number }; res: AnalysisState }` + entrada en la lista de
    canales.
  - `src/main/ipc/validators.ts`: `'ai:getAnalysisState': isRepoAndNumberPayload`.
  - Handler `ai:getAnalysisState`: cache hit → `cached`; in-flight → `streaming`
    con el último snapshot; si no → `idle`.
  - `src/preload/index.ts`: exponer `ai.getAnalysisState`; en
    `isAnalysisProgressPayload` aceptar `error` opcional string (no exigirlo).
  - `src/renderer/src/hooks/use-didactic-analysis.ts`: reemplazar
    `autoLoadFromCache` por **auto-attach SIEMPRE** (deja de existir la opción):
    al montar, `getAnalysisState`; `cached` → `setAnalysis`; `streaming` →
    `setStreamingSections(snapshot)` + suscribirse a `onAnalysisProgress`
    filtrando por PR; al recibir evento con `done: true`: si trae `error` →
    `setError`; si no → `getCachedAnalysis` y `setAnalysis` con el hit (si
    diera null — no debería — quedarse con el último snapshot). Desuscribir en
    terminal y al desmontar. OJO linter react-hooks: `setState` SOLO dentro de
    callbacks de promesa/evento, nunca síncrono en el cuerpo del efecto (patrón
    ya usado en el hook actual); el análisis lanzado por `analyze()` local
    conserva su flujo actual (requestSeq) — el attach solo aplica al montar
    cuando NO hay análisis local en curso, y un `analyze()` local posterior
    tiene prioridad (cortar la suscripción de attach al llamar `analyze()`).
  - `DidacticAnalysisArea.tsx` y `DidacticWindowApp.tsx`: eliminar la prop
    `autoLoadFromCache` (el comportamiento pasa a ser el default en ambas
    superficies).
  - `DidacticPanel.tsx`: en el onClick de "Abrir en ventana", tras
    `openDidactic(...)` cerrar el panel (`toggleDidacticPanel()` con el panel
    abierto; o agregar `closeDidacticPanel` al store si queda más claro).
  - `scripts/smoke-detach.mjs`: EXTENDER con: (1) con un análisis en curso
    (invalidar + `analyzePullRequest` sin await), abrir la ventana desacoplada
    a mitad del streaming y verificar que muestra contenido parcial y termina
    mostrando el análisis completo sin segunda llamada LLM (contar eventos /
    verificar que `getAnalysisState` pasó por `streaming`); (2) verificar que
    el panel acoplado quedó cerrado tras desacoplar (el aside colapsado a
    w-10 / botón "Abrir panel didáctico" presente); (3) cerrar y reabrir el
    panel acoplado con cache poblado → muestra el análisis SIN pulsar
    "Analizar PR". Reglas de suites del CLAUDE.md: target CDP excluye
    `#didactic`, limpiar estado global al arrancar, señales inequívocas.
  Gotchas conocidos a respetar: sin backticks en strings de main; preload es
  CJS (no tocar config); `import.meta.dirname` en main; el evento push va a
  TODAS las ventanas (el filtro por PR es del hook); mock de IA streamea por el
  mismo pipeline (las suites corren con `OPENROUTER_API_KEY=` vacío +
  `MINERVA_MOCK=1`).
  _Aceptación:_ typecheck/lint/test verdes; smoke-detach extendida verde;
  smoke-didactic y smoke-streaming sin regresión; verificación del orquestador
  con capturas MIRADAS (attach a mitad de streaming en la ventana desacoplada;
  panel reabierto mostrando cache).

- [x] **T23. Resize del panel didáctico acoplado**
  Reportado por Edilson: el panel acoplado no se puede redimensionar
  (`w-[380px]` fijo en `DidacticPanel.tsx`). Handle de arrastre en el borde
  izquierdo (cursor `col-resize`, pointer events con `setPointerCapture`),
  ancho en `app-store` (`didacticPanelWidth`), clamp razonable (mín ~320px,
  máx ~60% del viewport), persistencia en `localStorage` y doble-click en el
  handle para volver al ancho por defecto. Fix directo del orquestador TRAS
  verificar T22 (mismo archivo).
  _Aceptación:_ arrastre funcional verificado por CDP + captura mirada; el
  ancho sobrevive reinicio del renderer; typecheck/lint verdes.

## F6 — Empaquetado

- [x] **T24. Empaquetado con electron-builder (Linux)**
  Pedido de Edilson (2026-07-06): empaquetar la aplicación. Cierra el pendiente
  de T11. Contexto relevado por el orquestador: main ya es packaged-aware
  (`app.isPackaged` + `loadFile` relativo a `import.meta.dirname` en ventana
  principal Y didáctica); main ESM soportado (Electron 43); el único import de
  node_modules en runtime de main/preload es `octokit` (verificado — el resto
  se bundlea en el renderer por vite).
  Entregables:
  (a) `electron-builder` como devDependency (versión estable actual).
  (b) `package.json`: mover a `devDependencies` las deps que solo usa el
  renderer (lucide-react, mermaid, react, react-dom, react-markdown,
  remark-gfm, shiki, zustand) — vite las bundlea en build; en `dependencies`
  queda SOLO `octokit`. NO tocar versiones.
  (c) `electron-builder.yml` en la raíz: `appId: dev.edygg.minerva`,
  `productName: Minerva`, `directories.output: dist`,
  `files: ['out/**/*', 'package.json', '!**/.env', '!**/.env.*']` —
  **CRÍTICO excluir `.env`**: `ai/env.ts` lo busca en la raíz del app y
  electron-builder NO lo excluye por defecto (la key se filtraría al asar).
  `asar: true`, `npmRebuild: false` (no hay deps nativas),
  `electronLanguages` NO configurar (mermaid necesita locales? no — dejar
  default). Linux: `target: [AppImage]`, `category: Development`,
  `executableName: minerva`, `maintainer: Edilson`. Sin icono propio (default
  de Electron; pulido posterior).
  (d) Scripts npm: `"dist": "electron-vite build && electron-builder --linux"`
  y `"dist:dir": "electron-vite build && electron-builder --linux dir"`
  (unpacked rápido para verificar).
  (e) `.gitignore`: agregar `dist/`.
  (f) Correr `npm run dist` y reportar: artefactos generados, tamaño, y
  cualquier warning de electron-builder.
  Gotchas a respetar: NO tocar `electron.vite.config.ts` (preload CJS
  obligatorio); si falta el binario de electron tras el install:
  `node node_modules/electron/install.js`; para matar procesos usar patrones
  con corchete (`pkill -f "[e]lectron"`); no hace falta lanzar la app — la
  verificación e2e del empaquetado la hace el orquestador.
  _Aceptación (verifica el orquestador):_ `typecheck`/`lint`/`npm test`/`build`
  verdes tras el cambio de deps; `npm run dist` produce `dist/Minerva-*.AppImage`
  y `dist/linux-unpacked/`; el asar NO contiene `.env` (listar con
  `npx @electron/asar list`); el AppImage arranca con `MINERVA_MOCK=1` +
  `--remote-debugging-port=9222`, smoke-e2e verde contra el binario empaquetado
  y captura MIRADA; sesión/settings en userData `Minerva` propio (esperado:
  no comparte con dev).

- [x] **T25. GitHub Action de release multi-OS** _(Blacksmith revertido a
  runners hosteados de GitHub por pedido de Edilson; verificada e2e con el
  release real v0.1.0 — ver bitácora 2026-07-07)_
  Pedido de Edilson (2026-07-06): workflow que se active en releases y construya
  la app para Windows, macOS y Linux usando Blacksmith
  (docs.blacksmith.sh). Relevamiento del orquestador (de llms-full.txt):
  labels `blacksmith-{2,4,8,16,32}vcpu-ubuntu-{2204,2404}[-arm]`,
  `blacksmith-{2..32}vcpu-windows-2025` (beta pública),
  `blacksmith-{6,12}vcpu-macos-{latest,15,26}` (solo Apple Silicon M4/arm64);
  las actions de cache propias de Blacksmith están ARCHIVADAS — se usan las
  estándar (`actions/setup-node` con `cache: npm`) que pegan al cache
  colocado de Blacksmith sin cambios. PREREQUISITO humano: la GitHub App de
  Blacksmith instalada en la cuenta `edyggclevr` (app.blacksmith.sh) — sin
  eso los jobs quedan en cola para siempre.
  Entregables:
  (a) `.github/workflows/release.yml`: trigger `release: types: [published]`;
  `permissions: contents: write`; matrix de 3 jobs con `fail-fast: false`:
  - linux → `blacksmith-4vcpu-ubuntu-2404`, `npx electron-builder --linux`
  - windows → `blacksmith-4vcpu-windows-2025`, `npx electron-builder --win`
  - mac → `blacksmith-6vcpu-macos-latest`, `npx electron-builder --mac`
  Pasos por job: checkout@v4, setup-node@v4 (node 22, cache npm), `npm ci`,
  `npm run typecheck` (barato, corta builds rotos), `npm run build`
  (electron-vite), electron-builder del SO con `--publish never`, y subida de
  artefactos al release con `gh release upload "$GITHUB_REF_NAME" <archivos>
  --clobber` (env `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`, `shell: bash`
  también en Windows). Subir: `dist/*.AppImage` (linux), `dist/*.exe` (win),
  `dist/*.dmg` (mac). `timeout-minutes: 30` por job. En mac exportar
  `CSC_IDENTITY_AUTO_DISCOVERY: false` (sin firma; evita que electron-builder
  busque certificados). Paso previo no bloqueante que avise si la versión de
  package.json no coincide con el tag del release.
  (b) `electron-builder.yml`: agregar targets `mac` (dmg, arch arm64 y x64 —
  el runner M4 compila ambos) con `category: public.app-category.developer-tools`,
  y `win` (nsis x64). NO tocar la sección linux ni `files` (la exclusión de
  `.env` es requisito de seguridad).
  (c) README: nota corta en la sección Empaquetado sobre el workflow de
  release (cómo se dispara, dónde quedan los binarios, prerequisito
  Blacksmith, y que macOS/Windows salen SIN firmar — Gatekeeper/SmartScreen
  avisarán).
  Gotchas: los artefactos toman la versión de package.json (bump antes de
  taggear); no usar actions `useblacksmith/*` (archivadas); runner macOS es
  arm64 (electron-builder baja los dist x64 para el arch cruzado dentro de
  mac sin problema).
  _Aceptación (verifica el orquestador):_ YAML válido (parseo + actionlint si
  está disponible); typecheck/lint/tests locales intactos; push del workflow
  y release de prueba `v0.1.0` (prerelease) disparando los 3 jobs; los
  binarios quedan adjuntos al release — o, si Blacksmith no está instalado
  aún, los jobs quedan en cola y se reporta la acción humana a Edilson.

---

## F7 — IA multi-proveedor (OpenRouter + Claude Code + Codex) — 2026-07-07

> Rama `feature/multi-provider-ai` (desde `origin/main`). Diseño y contexto de
> investigación: `PLAN.md` § "Iteración actual (2026-07-07)". **Decisión de arquitectura
> clave**: se usan los CLIs/SDK OFICIALES (`@anthropic-ai/claude-agent-sdk`,
> `codex app-server`), NO se reimplementa el OAuth de Anthropic/OpenAI. El flujo OAuth
> in-app estilo opencode para Claude Pro/Max exige suplantar al cliente oficial (header
> `anthropic-beta: oauth-...` + system prompt "You are Claude Code...") — evade los
> controles de acceso de Anthropic, viola sus ToS y arriesga el baneo de la cuenta de
> Edilson; opencode lo removió por eso. **No se implementa.**
>
> **CONFIRMADO por Edilson (2026-07-07)**: enfoque de CLIs oficiales aprobado; instalará
> `codex`; pidió avisar antes de las pruebas e2e de T28/T29 para asegurar sesiones válidas
> de Claude/Codex. Requisito añadido: **T32** (campo persistente para `OPENROUTER_API_KEY`).
>
> Invariante que respetan TODAS: el pipeline de streaming es agnóstico del proveedor —
> cada proveedor nuevo emite el MISMO protocolo `@@@SECTION` alimentando
> `StreamSectionParser` delta a delta; el panel didáctico, la cache LRU y la ventana
> desacoplada NO se tocan. Gotchas de main vigentes (sin backticks en strings largos,
> `import.meta.dirname`, preload CJS, reiniciar `npm run dev` al tocar `src/main/**`).

- [x] **T26. Modelo de datos proveedor+modelo (shared + settings + IPC)**
  _Hecha y verificada (2026-07-07, subagente `a568dae75cf640dcd`). `src/shared/ai-providers.ts`
  nuevo (catálogo por proveedor, `AiProviderId`, guards, defaults); `ai-models.ts` re-exporta
  el slice OpenRouter. `store.ts`: `PersistedSettings={aiProvider, models}` con migración
  in-memory de `{aiModel}` (no reescribe disco hasta el próximo setter). `env.ts`:
  `getEffectiveAiSelection()` + `getAiSettingsInfo()`. IPC: `settings:get`→`AiSettingsInfo`,
  nuevos `settings:setAiProvider`/`setProviderModel` con guards. Renderer adaptado al mínimo
  (OpenRouter sin cambios de comportamiento). Verificado por el orquestador: typecheck (node+web),
  lint, 318 tests verdes; migración y precedencia con tests unit. index.ts (factory) sin tocar,
  lo refactoriza T27._
  Contexto: hoy `src/shared/ai-models.ts` es una lista plana de IDs de OpenRouter y
  `src/main/settings/store.ts` persiste `{ aiModel: string }`. Hay que modelar N
  proveedores, cada uno con su lista de modelos y su modelo seleccionado, y qué proveedor
  está activo — sin romper archivos `settings.json` viejos.
  Entregables:
  (a) `src/shared/ai-providers.ts` (o extender `ai-models.ts`): tipo `AiProviderId =
  'openrouter' | 'claude-code' | 'codex'`; catálogo `{ provider, label, models: {id,
  label, vendor}[] }`. La lista curada ACTUAL migra bajo `openrouter` (los IDs de hoy
  aplican SOLO a OpenRouter). Claude Code: `claude-fable-5`, `claude-opus-4-8`,
  `claude-sonnet-5`, `claude-haiku-4-5` (labels legibles). Codex: placeholder curado
  (`gpt-5.5-codex`, etc.) que T29 podrá refrescar dinámicamente. `DEFAULT_AI_PROVIDER =
  'openrouter'`, default de modelo por proveedor.
  (b) `store.ts`: `PersistedSettings` → `{ aiProvider: AiProviderId, models: Partial<Record<AiProviderId,string>> }`.
  **Migración**: si al leer aparece la forma vieja `{ aiModel }`, mapear a
  `{ aiProvider:'openrouter', models:{openrouter: aiModel} }` (no perder la elección
  previa de Edilson). `isValidPersistedSettings` acepta ambas formas; setters nuevos
  `setAiProvider(id)` y `setProviderModel(provider, modelId)`, escritura atómica intacta.
  (c) `src/main/ai/env.ts`: `getEffectiveAiSelection()` → `{ provider, model }` con
  precedencia settings > env (`MINERVA_AI_PROVIDER` + `MINERVA_AI_MODEL`) > default.
  Mantener `getEffectiveAiModel()` como shim si algo lo usa aún.
  (d) `src/shared/ipc.ts` + validators + handlers + preload: `settings:get` responde la
  selección completa + catálogo; nuevos `settings:setAiProvider` y
  `settings:setProviderModel` con sus guards (provider ∈ enum; model string ≤100). El
  tipo `AssertNoMissingChannel` obliga a tocar `IPC_CHANNELS` y `payloadValidators`.
  _Aceptación:_ typecheck/lint/tests verdes; test unit de migración (forma vieja → nueva);
  el settings viejo `{aiModel:"z-ai/glm-5.2"}` en userData se lee como OpenRouter+ese
  modelo tras el cambio (sin perder selección). Sin tocar UI todavía (T30).

- [x] **T27. Abstracción de proveedores + probe de estado de login**
  _Hecha y verificada (2026-07-07, subagente `aa6a336cbfbed9b48`). `providers/registry.ts`
  (metadata authKind api-key/cli + binario), `providers/cli-probe.ts` (execFile `--version`
  timeout 1500ms, cache TTL 5s, login best-effort por existencia de `~/.claude/.credentials.json`
  con `subscriptionType`→plan y `~/.codex/auth.json`; TODO handshake real en T28/T29),
  `providers/provider-status.ts` (agregador). Canal `ai:getProviderStatus` → `Record<AiProviderId,
  {status:'unavailable'|'installed'|'authenticated', account?:{email?,plan?}}>` (sin secretos).
  Factory `createAiService` refactor: elige por proveedor activo, OpenRouter idéntico al actual,
  claude-code/codex caen a mock con `// T28`/`// T29`. Verificado por orquestador: typecheck,
  lint, 333 tests (nuevos: cli-probe, provider-status, index factory)._
  Contexto: `createAiService` (`src/main/ai/index.ts:26`) hoy es binario (key→OpenRouter,
  else mock). Pasa a resolver por proveedor activo. Se necesita saber, por proveedor, si
  está disponible/autenticado (OpenRouter: ¿hay key?; Claude/Codex: ¿CLI instalado y
  logueado?). Patrón a imitar: `src/main/auth/auth-manager.ts` (estado sin exponer
  secretos vía `getStatus()`).
  Entregables:
  (a) `src/main/ai/providers/registry.ts`: metadata por proveedor (id, label, cómo se
  autentica: `api-key` | `cli`, binario esperado, cómo lista modelos).
  (b) `src/main/ai/providers/cli-probe.ts`: detección no bloqueante de `claude`/`codex`
  (existe en PATH; versión; ¿logueado? leyendo el handshake — Claude:
  `query().initializationResult().account`; Codex: `account/read` RPC). Cachear resultado
  con TTL corto; NUNCA colgar el arranque (timeout + degradar a "no disponible").
  (c) canal IPC `ai:getProviderStatus` → por proveedor `{ status:
  'unavailable'|'installed'|'authenticated', account?: {email?, plan?} }` (SIN tokens).
  (d) refactor `createAiService(github)` → lee selección de settings, instancia
  `OpenRouterAiService` | `ClaudeCodeAiService` | `CodexAiService`; fallback a
  `MockAiService` si el proveedor activo no está autenticado (con log claro del porqué).
  _Aceptación:_ typecheck/lint/tests; el probe reporta correcto el estado real de la
  máquina de Edilson (claude instalado/logueado; codex según lo instale); arranque de la
  app NO se degrada en tiempo aunque los CLIs falten; con OpenRouter activo + key, el
  comportamiento actual queda idéntico (no-regresión del análisis existente).

- [x] **T28. `ClaudeCodeAiService` (Agent SDK oficial)**
  Contexto: adaptador que implementa `AiService` usando `@anthropic-ai/claude-agent-sdk`
  (NUEVA dependencia; binarios nativos por plataforma — anotar para T31/empaquetado).
  Reutiliza `buildUserMessage` y `ANALYZE_PR_SYSTEM_PROMPT` (mismos que OpenRouter) y
  emite el protocolo `@@@SECTION` alimentando `StreamSectionParser`.
  Entregables: `src/main/ai/providers/claude-code-service.ts`: `query({ prompt, options:{
  ... , model, allowedTools:[], persistSession:false }})`, iterar el stream, empujar los
  deltas de texto al parser (`onProgress`), mismos timeouts (120s total / 20s inactividad)
  y mapeo de errores (no autenticado → mensaje accionable "corré `claude login`"). Modelos
  desde el registry (T26), filtrables por versión del CLI si aplica.
  Gotchas: sin tools (una sola vuelta de generación, no un loop de agente); el system
  prompt de análisis va por el canal que el SDK ofrezca para system/append; NO inventar
  headers de suplantación — el SDK ya se autentica solo con la sesión del CLI.
  _Aceptación (orquestador):_ typecheck/lint/tests; análisis real de un PR mock con Claude
  Code seleccionado, streameando secciones por el mismo pipeline; captura mirada del panel
  con contenido real; verificar que sin login degrada con mensaje claro (no crash).
  **Acción humana**: Edilson con `claude` logueado.
  _Implementado y verificado a nivel unit (2026-07-07, subagente `adec8a6ea6cd03e41`).
  Dep `@anthropic-ai/claude-agent-sdk@0.3.203`. `claude-code-service.ts` usa `query({prompt,
  options:{model, systemPrompt: ANALYZE_PR_SYSTEM_PROMPT, tools:[], maxTurns:1,
  persistSession:false, settingSources:[], includePartialMessages:true, abortController}})`;
  extrae deltas de `stream_event`→`content_block_delta`→`text_delta` → parser. Errores
  accionables (authentication_failed→`claude login`, ENOENT→binario). Módulos compartidos
  extraídos: `analysis-prompt.ts` (prId, buildUserMessage) y `analysis-timeouts.ts`. IDs de
  modelo verificados contra el .d.ts del SDK (`claude-sonnet-5`/`opus-4-8`/`fable-5`
  coinciden; `haiku-4-5` a confirmar e2e). Probe NO refinado al handshake (decisión: hot
  path barato). 10 tests unit. **FIX del orquestador**: `createAiService` se volvió async
  (consulta el probe) y `handlers.ts` lo resolvía UNA vez al arranque → el cambio de
  proveedor en Settings no surtía efecto sin reiniciar; movido a resolverse POR ANÁLISIS
  dentro del handler (tras cache/in-flight hits). typecheck/lint/358 tests verdes.
  **VERIFICADO e2e (2026-07-07)**: análisis real de shopwave/api#482 con Claude Code (plan Max) en 19.6s → 4 secciones reales (summary, setup, architecture, endpoint). Probe reporta claude-code authenticated con plan="max". Captura mirada de la pantalla de proveedores. **HECHO.**_

- [x] **T29. `CodexAiService` (`codex app-server` JSON-RPC)**
  Contexto: adaptador que spawnea `codex app-server` y habla JSON-RPC 2.0 por stdio.
  Referencia de wire: `packages/effect-codex-app-server` de t3code. Emite `@@@SECTION` al
  parser igual que los demás.
  Entregables: `src/main/ai/providers/codex-service.ts` + un cliente JSON-RPC mínimo sobre
  el stdio del proceso hijo: `initialize` → `initialized` → `account/read` (estado) →
  `thread/start` → `turn/start` (con el prompt de análisis), capturar los item deltas de
  texto (`item/*`) → `parser.push`. Modelos vía `model/list` RPC (paginado) con fallback
  al curado de T26. Manejo de: no autenticado (`codex login`), CLI ausente, cierre/limpieza
  del proceso hijo, timeouts.
  Gotchas: proceso hijo de larga vida gestionado desde `main` (matar en `app.quit`); fijar
  versión mínima del CLI y detectar incompatibilidad del protocolo; sanear el entorno del
  spawn.
  _Aceptación:_ typecheck/lint/tests; análisis real de un PR mock con Codex seleccionado,
  streameando por el pipeline; captura mirada; sin login/CLI degrada con mensaje claro.
  **Acción humana**: Edilson instala y loguea `codex`.
  _Implementado por subagente `a9915ffaec7c2a6cc` PERO **reescrito por el orquestador**: el
  subagente no encontró el clon de t3code y adivinó el wire (initialize sin params,
  `instructions`, input como string) → NO habría funcionado. El orquestador descubrió el
  protocolo REAL del binario 0.142.5 con `codex app-server generate-ts`/`generate-json-schema`
  (¡el binario genera su propio esquema!) + un turno de humo en vivo, y corrigió
  `codex-service.ts`: `initialize` con clientInfo+capabilities{experimentalApi:true};
  system prompt en `baseInstructions` (NO `instructions`); `thread/start` con
  `sandbox:'read-only'`+`approvalPolicy:'never'` (Codex es agente de código, sin esto ejecuta
  comandos); threadId de `result.thread.id`; `turn/start.input` = `[{type:'text',text,text_elements:[]}]`
  (Array<UserInput>); **`turn/start` es ack inmediato (`inProgress`) — el fin es la
  notificación `turn/completed`** (el código original mataba el proceso tras el ack → 0
  deltas); delta de texto SOLO en `item/agentMessage/delta`.params.delta. Modelo real =
  `gpt-5.5` (no `gpt-5.5-codex`; catálogo corregido). El cliente JSON-RPC (framing JSONL) del
  subagente estaba OK. **VERIFICADO e2e (2026-07-07)**: análisis real de shopwave/api#482 con
  Codex (gpt-5.5, cuenta ChatGPT prolite de Edilson) en 28.5s → 4 secciones reales. Probe
  reporta codex authenticated. 10 tests unit reescritos al protocolo real. **HECHO.**_

- [x] **T30. UI de selección de proveedor y modelo (Settings) + estado de login**
  Contexto: `src/renderer/src/components/settings/SettingsModal.tsx` monta hoy un
  `ModelPicker` de lista plana. Nueva pantalla: elegir PROVEEDOR (con su estado de login)
  y luego MODELO dentro del proveedor. Transparente al hook `use-didactic-analysis` (no se
  toca).
  Entregables:
  (a) Vista de proveedores: card por proveedor con chip de estado (`ai:getProviderStatus`)
  — "Conectado (email/plan)" | "Instalado, sin sesión" | "No disponible" — y acción
  contextual: OpenRouter → gestionar key (o nota de que va por `.env` hasta que exista la
  tarea safeStorage); Claude/Codex → botón "Conectar" que dispara/guía el login del CLI y
  un enlace a instalarlo si falta.
  (b) Al seleccionar proveedor, `ModelPicker` filtra a los modelos de ese proveedor
  (catálogo de T26); persistir vía `settings:setAiProvider`/`setProviderModel`.
  (c) `use-provider-status.ts` (hook) + `ActiveModelHint` muestra "proveedor · modelo".
  _Aceptación:_ typecheck/lint/tests; smoke e2e CDP nuevo (`smoke-providers.mjs`):
  cambiar de proveedor, ver estados de login, seleccionar modelo, persistencia tras
  reabrir; **captura mirada** de la pantalla en cada estado. Reglas de suites: target CDP
  `!url.includes('#didactic')`, limpiar estado global al arrancar, verificar contenido.
  _Hecha y verificada (2026-07-07, subagente `adec8a6ea6cd03e41`). `ProviderPicker` (card por
  proveedor con chip de estado desde `ai:getProviderStatus`), `OpenRouterKeyForm` (campo
  password + Guardar/Borrar + fuente de la key), `CliLoginGuide` (guía `claude login`/`codex
  login` + "Volver a comprobar"), `ModelPicker` filtrado por proveedor (campo libre "Otro"
  solo OpenRouter), hooks `use-provider-status`/`use-openrouter-key`, `ActiveModelHint` =
  "proveedor · modelo". **VERIFICADO e2e por el orquestador (2026-07-07)**: captura mirada de
  la pantalla con los 3 proveedores "Conectado" (Claude Code · max, Codex, OpenRouter),
  detalle por proveedor, selector filtrado (4 modelos Claude / 6 OpenRouter+Otro / gpt-5.5
  Codex), y el campo de key de OpenRouter mostrando "Tomada de tu archivo .env — guardala acá
  para que quede cifrada". El cambio de proveedor surte efecto en el análisis sin reiniciar
  (fix del handler, ver T28). **HECHO.**_

- [x] **T31. Empaquetado + frontera de seguridad de los CLIs/SDK**
  Contexto: el Agent SDK trae binarios nativos por plataforma; hay spawn de procesos hijos
  desde `main`. Revisar contra la frontera de seguridad de `CLAUDE.md`.
  Entregables: `asarUnpack` en `electron-builder.yml` para los binarios del Agent SDK
  (verificar que el AppImage los ejecuta); confirmar que los tokens de los CLIs NUNCA
  llegan al renderer (viven en `~/.claude`/`~/.codex`, fuera de Minerva); entorno saneado
  en los spawns; nota en README (§ Empaquetado / requisitos) de que Claude/Codex requieren
  sus CLIs instalados y logueados; medir el impacto en tamaño del AppImage.
  _Aceptación:_ `npm run dist` produce un AppImage funcional; `smoke-packaged.mjs` sigue
  verde; análisis real con Claude Code funcionando DESDE el empaquetado (no solo dev);
  captura mirada; revisión de que no se filtran secretos al renderer.
  _**HECHA Y VERIFICADA E2E** (2026-07-07, subagente `a467578c9338cef66` + verificación del
  orquestador). ENFOQUE: NO se bundlea el binario del Agent SDK (~250MB/plataforma); se usa el
  `claude`/`codex` del sistema. Verificado que el SDK funciona con `pathToClaudeCodeExecutable`
  al claude del PATH. Entregables: `resolve-cli.ts` (resuelve el binario en PATH + ubicaciones
  comunes ~/.local/bin, /usr/local/bin, /opt/homebrew/bin, ~/.npm-global/bin, ~/.bun/bin, etc.;
  Windows best-effort con .cmd/.exe), usado en claude-code-service (`pathToClaudeCodeExecutable`),
  codex-app-server-client (spawn) y cli-probe (si null → unavailable sin spawnear).
  `spawn-env.ts` compartido (sanea OPENROUTER_API_KEY/GITHUB_TOKEN del entorno del hijo, ahora
  también en Claude). `electron-builder.yml`: `!**/node_modules/@anthropic-ai/claude-agent-sdk-*/**`.
  392 tests. **Verificación del orquestador**: `npm run dist` → AppImage **125M** (vs 124M
  pre-SDK, o sea el binario de 250MB QUEDÓ FUERA); asar confirma SDK JS `sdk.mjs` presente pero
  `claude-agent-sdk-linux` ausente; `.env` excluido; **análisis real con Claude Code DESDE el
  AppImage empaquetado en 21.0s → 4 secciones** (resuelve el claude del sistema); probe reporta
  claude-code=max/codex=ok/openrouter=unavailable (correcto: .env fuera del asar → la key va por
  safeStorage/T32 en prod); smoke-packaged 6/6. **HECHA.**
  MEJORA IDENTIFICADA (investigación de t3code, subagente `a0796af9884396a46`): t3code valida el
  mismo enfoque (usa `claude`/`codex` del sistema, NO el binario vendorizado; de hecho ellos NO
  excluyen el peso muerto de 250MB → nuestro build es MÁS liviano). PERO t3code resuelve el PATH
  de forma más robusta: al arrancar lanza un **shell de login** (`$SHELL -ilc` para leer `$PATH`
  real; `launchctl getenv PATH` en macOS; PowerShell con perfil en Windows) e inyecta ese PATH en
  `process.env` — así encuentra CLIs instalados vía nvm/volta/fnm/rutas custom que nuestra lista
  hardcodeada de `resolve-cli.ts` no cubre. Para Edilson (claude en ~/.local/bin) YA funciona;
  la mejora es para robustez de distribución general. Candidata a T33 (opcional)._

- [x] **T32. `OPENROUTER_API_KEY` persistente (safeStorage) — backend + IPC**
  _Backend hecho y verificado (2026-07-07, subagente `aa59330f9b40573dd`). `openrouter-key-store.ts`
  (cifra con safeStorage, `openrouter-key.bin`, degrada a memoria); `env.ts` precedencia
  safeStorage > env > .env vía `resolveOpenRouterApiKey()` + `getOpenRouterKeyStatus()`; canales
  `settings:setOpenRouterKey` ({key}, vacío=borrar) y `settings:getOpenRouterKeyStatus` →
  `{configured, source:'safeStorage'|'env'|'none'}`. La key NUNCA cruza al renderer (verificado:
  `loadApiKey` solo en env.ts). provider-status ya la reconoce como authenticated. 346 tests.
  **La UI del campo se implementa en T30.**_
  Contexto: cierra el pendiente histórico "key vía safeStorage + campo en Settings". Hoy
  la key SOLO se lee de `.env`/`process.env` (`src/main/ai/env.ts`, `getAiEnv`). Patrón a
  imitar exacto: `src/main/auth/token-store.ts` (cifra con `safeStorage`, guarda un `.bin`
  en `app.getPath('userData')`, degrada a solo-memoria si `isEncryptionAvailable()` es
  false). La key es SECRETA → NO va en `settings.json` plano (ese es para provider/model,
  T26); va cifrada aparte.
  Entregables:
  (a) `src/main/ai/openrouter-key-store.ts` (o extender token-store parametrizado):
  `saveApiKey(key)`, `loadApiKey(): string|null`, `clearApiKey()`, archivo
  `openrouter-key.bin`. Mismo comportamiento de degradación que el token de GitHub.
  (b) `ai/env.ts`: `getAiEnv()` / la resolución de la key pasa a precedencia
  **safeStorage > env `OPENROUTER_API_KEY`** (la key guardada por el usuario gana; si no
  hay, cae al `.env`/env var de hoy — no romper el flujo actual de dev).
  (c) IPC: `settings:setOpenRouterKey` (`{key: string}`, se guarda y se limpia si viene
  vacía) y `settings:getOpenRouterKeyStatus` (→ `{ configured: boolean, source:
  'safeStorage'|'env'|'none' }` — NUNCA devuelve la key). Guards + handlers + preload.
  El refactor del factory (T27) debe reconocer la key de safeStorage como "OpenRouter
  autenticado".
  (d) UI (se integra en la pantalla de proveedores de T30): en la card de OpenRouter, un
  campo para pegar la key (input `password`), botón guardar y botón borrar, con estado
  "Configurada (safeStorage) / Tomada de .env / No configurada". Nunca re-mostrar la key.
  Gotchas: la key jamás cruza al renderer (solo el `configured`/`source`); `safeStorage`
  en Hyprland necesita el `--password-store=gnome-libsecret` que main ya fuerza (mismo
  gotcha que el token de GitHub); escritura del `.bin` con permisos restrictivos.
  _Aceptación (orquestador):_ typecheck/lint/tests; guardar una key desde la UI, reiniciar
  la app y verificar que OpenRouter queda autenticado sin `.env`; borrar la key vuelve a
  "no configurada" (o cae al `.env` si existe); la key NO aparece en ningún payload del
  renderer (revisión de la frontera); captura mirada del campo en sus tres estados.
  Ordena: depende de T26 (settings/ipc reestructurados) y se coordina con T27 (factory) y
  T30 (UI). Implementar tras T26; la parte UI junto con T30.
  _**HECHO** (backend subagente `aa59330f9b40573dd`, UI dentro de T30). VERIFICADO e2e
  (2026-07-07): con la key en `.env`, la card de OpenRouter muestra el campo con estado
  "Tomada de tu archivo .env — guardala acá para que quede cifrada" + Guardar/Borrar
  (captura mirada); provider-status reporta openrouter authenticated; la key no cruza al
  renderer (grep: `loadApiKey` solo en env.ts). Pendiente opcional: que Edilson pruebe el
  guardado real vía safeStorage desde la UI si quiere migrar del `.env`._

- [x] **T33. PATH robusto para app GUI (hidratación vía shell de login)**
  Contexto: mejora identificada en la investigación de t3code (ver nota de T31). Una app
  Electron lanzada desde el LAUNCHER del SO hereda un PATH mínimo, no el del shell del
  usuario → `resolve-cli.ts` podría no encontrar `claude`/`codex` si viven en una ruta que
  solo el shell conoce (nvm/volta/fnm/mise, prefijos globales de npm/pnpm/bun, rutas custom).
  Entregables: `src/main/system/shell-path.ts` — `hydratePathFromLoginShell()`: lanza el
  shell de login del usuario (`$SHELL -ilc`, marcadores para aislar el `$PATH` del ruido del
  perfil, timeout 2.5s), con fallback `launchctl getenv PATH` en macOS; fusiona (append sin
  duplicar, nunca reemplaza) el PATH capturado en `process.env.PATH`. No-op en Windows (las
  GUI heredan el PATH del registro) y nunca lanza (fallo → PATH intacto). Enganchado en
  `index.ts` (whenReady, **solo si `app.isPackaged`**, ANTES de `registerIpcHandlers` para que
  el probe/resolve-cli ya vean el PATH completo desde la primera resolución; en dev desde
  terminal el PATH ya viene completo → no se toca). Helpers puros exportados
  (`extractMarkedPath`, `mergePaths`) para test.
  _**HECHA Y VERIFICADA** (2026-07-07). 8 unit tests (parseo con ruido + merge append-only +
  dedupe + segmentos vacíos). **Mecanismo probado aislado en la máquina de Edilson**: con
  `PATH=/usr/bin:/bin` (recortado como el launcher), `hydratePathFromLoginShell()` recupera
  `~/.local/bin` Y `~/.local/share/mise/.../bin` (Edilson usa **mise** — ruta que resolve-cli
  NO hardcodea, así que T33 aporta valor real más allá de ~/.local/bin). AppImage rebuildeado
  con T33 = 125M, arranca OK con la hidratación activa, smoke-packaged 6/6 (el enganche no
  rompió el arranque). 400 tests totales. **HECHA.**_

---

## F8 — Selector de modelo dinámico + reasoning effort — 2026-07-07

> Rama `feature/model-effort` (desde `feature/multi-provider-ai`). Diseño y respuestas a las
> dos preguntas de Edilson: `PLAN.md` § "PROPUESTA F8". Aprobado por Edilson (F8 completo).
> Patrón base (de t3code): **descriptores de opción autocontenidos por modelo** — cada modelo
> declara sus choices válidas + default; la UI es genérica sobre eso; al cambiar de modelo el
> valor se recalcula (si el guardado no aplica → default). Se implementa SOLO el descriptor
> `effort` (extensible a service tier / thinking / context window después).
>
> Datos del protocolo REAL ya relevados (F7 + esta investigación):
> - Codex `model/list` (paginado `{data, nextCursor}`): tu cuenta expone `gpt-5.5`,`gpt-5.4`,
>   `gpt-5.4-mini`,`gpt-5.3-codex-spark`; cada `Model` trae `supportedReasoningEfforts`
>   (array de `{reasoningEffort, description}`), `defaultReasoningEffort`, `displayName`,
>   `hidden`. Regenerar esquema: `codex app-server generate-ts --out DIR`.
> - Codex effort se pasa en `turn/start.effort` (string low|medium|high|xhigh).
> - Claude Agent SDK: `EffortLevel = low|medium|high|xhigh|max`, campo `effort` en las options
>   de `query()`, `supportsEffort`/`supportedEffortLevels` por modelo (en `sdk.d.ts`).
> - OpenRouter: `reasoning: { effort }` en el body (verificar por-modelo cuáles lo aceptan).
> Gotchas de main vigentes: `import.meta.dirname`, sin backticks en strings largos, preload CJS.

- [x] **T34. Modelo de datos: option descriptors + selección con opciones**
  _HECHA Y VERIFICADA (2026-07-07, subagente `a60898bc8ab417210`). typecheck/lint/424 tests. Resolución robusta con test (xhigh en haiku-4-5 -> default high; max en sonnet-5 respetado; modelo sin descriptor -> options vacío). Bug arreglado de paso: setAiProvider/setProviderModel preservan modelOptions._
  `src/shared/ai-providers.ts`: `AiModelOption` gana `options?: ModelOptionDescriptor[]`,
  con `ModelOptionDescriptor = { id: string (por ahora 'effort'), label: string, choices:
  { value: string, label: string, description?: string, isDefault?: boolean }[] }`. Poblar el
  descriptor `effort` HARDCODE para Claude Code (matriz por modelo: fable-5/opus-4.8/sonnet-5
  soportan low|medium|high|xhigh|max; los demás según t3code — sin xhigh en varios; anotar los
  remapeos de compat para T36) y OpenRouter (qué modelos soportan reasoning + sus choices
  low|medium|high). Codex queda con su curado (los efforts reales llegan dinámicos en T35).
  `src/main/settings/store.ts`: `PersistedSettings` gana
  `modelOptions?: Partial<Record<AiProviderId, Record<string, string>>>` (p.ej.
  `{codex:{effort:'high'}}`). MIGRACIÓN aditiva: settings sin `modelOptions` → `{}` (usa
  defaults); no romper la migración de `{aiModel}` de T26 ni la forma `{aiProvider, models}`.
  Setter `setModelOption(provider, optionId, value)`. `src/main/ai/env.ts`:
  `getEffectiveAiSelection()` → `{ provider, model, options: Record<string,string> }`
  resolviendo cada opción contra las choices del modelo activo (si el valor guardado no está
  en las choices → default del modelo; si el modelo no tiene esa opción → se omite). IPC
  `settings:setModelOption` ({provider, optionId, value}) + guard + handler + preload.
  Extender `AiSettingsInfo` (respuesta de `settings:get`) con las opciones seleccionadas
  actuales (`selectedOptions` por proveedor) para que la UI pinte el estado.
  _Gotchas:_ TS estricto; la resolución robusta es el corazón (test explícito: guardar
  effort='max' para Codex —que no lo soporta— y verificar que resuelve al default del modelo).
  _Aceptación:_ typecheck/lint/tests (incl. migración aditiva + resolución robusta). Sin UI aún.

- [x] **T35. Catálogo dinámico de Codex (corregir `codex-model-catalog.ts` + cablear)**
  _HECHA (2026-07-07, subagente `a8a8cb6600a0f1583`). codex-model-catalog.ts reescrito con protocolo real (initialize con params, data/nextCursor, Model.supportedReasoningEfforts -> descriptor effort). provider-models.ts (canal `ai:getProviderModels` con cache TTL 60s + fallback). typecheck/lint/450 tests. Falta verificación e2e (4 modelos reales) que hace el orquestador en T37._
  Reescribir `src/main/ai/providers/codex-model-catalog.ts` con el protocolo REAL: `initialize`
  con `{clientInfo, capabilities:{experimentalApi:true}}`; `initialized`; paginar `model/list`
  leyendo `result.data` (NO `.models`) y `result.nextCursor`; por cada `Model` construir un
  `AiModelOption` con `id`, `label`=`displayName`, `vendor`='OpenAI', y `options`=[descriptor
  `effort` armado desde `supportedReasoningEfforts` (choices) + `defaultReasoningEffort`
  (isDefault)]. NO filtrar por `hidden`/plan (lección t3code: exponer lo que da la RPC).
  Fallback al curado (`AI_PROVIDER_CATALOG.codex.models`) ante cualquier fallo. Cablear a la UI
  con un canal IPC NUEVO async `ai:getProviderModels` (o `ai:getCodexModels`) con **cache TTL**
  (p.ej. 60s) + fallback — NO meter async en el `settings:get` síncrono de T26. El renderer lo
  consume aparte (con loading/fallback). Reutilizar el `CodexAppServerClient` (ya resuelve el
  binario del sistema vía resolve-cli). Tests contra la forma real (mock del cliente devolviendo
  `{data:[...], nextCursor}`).
  _Aceptación:_ typecheck/lint/tests; verificación e2e del orquestador (con la sesión de Edilson,
  los 4 modelos reales aparecen); fallback al curado si no hay sesión.

- [x] **T36. Pasar el reasoning effort a los tres servicios**
  _HECHA (2026-07-07, subagente `ad31a67d2cf7d79f5`). Codex turn/start.effort; Claude query effort + normalizeClaudeEffort (hook de compat, hoy identidad); OpenRouter body.reasoning.effort (formato verificado en docs). Solo se manda si hay effort resuelto (sin effort = comportamiento actual). typecheck/lint/450 tests. Falta e2e con effort alto real (coordinar sesión)._
  Leer `options.effort` de `getEffectiveAiSelection()` (T34) e inyectarlo:
  - `codex-service.ts`: agregar `effort` a los params de `turn/start` (solo si hay valor).
  - `claude-code-service.ts`: pasar `effort` en las `options` de `query()`, con un ÚNICO punto
    de normalización de compatibilidad (estilo `normalizeClaudeCliEffort` de t3code: p.ej.
    `xhigh`→`max` para modelos que no soportan xhigh nativo; `max`→`high` donde no exista).
    Documentar la matriz.
  - `openrouter-service.ts`: agregar `reasoning: { effort }` al body JSON (solo para modelos que
    lo soporten según T34; no mandarlo si no). Verificar el formato exacto contra la API de
    OpenRouter al implementar.
  _Gotchas:_ no romper el análisis actual cuando no hay effort seleccionado (comportamiento por
  defecto idéntico a hoy). Sin backticks en strings largos de main.
  _Aceptación:_ typecheck/lint/tests (cada servicio inyecta el effort cuando corresponde y lo
  omite si no); verificación e2e del orquestador: análisis real con effort alto en cada proveedor
  (coordinar sesión con Edilson para Claude/Codex).
  Puede ir en paralelo con T35 (archivos disjuntos: servicios vs catalog/ipc).

- [x] **T37. UI: selector de effort + modelos dinámicos de Codex**
  _HECHA Y VERIFICADA e2e (2026-07-07, subagente `a1579dcf0725db3fc` + verificación del orquestador). use-provider-models (fetch dinámico con fallback estático), ModelPicker dinámico, ModelOptionPicker (segmented de effort, genérico sobre descriptores, remount por key), setModelOption, ActiveModelHint con effort. **BUG destapado por la verificación e2e y ARREGLADO por el orquestador**: getEffectiveAiSelection (main) resolvía el effort contra el catálogo ESTÁTICO, donde Codex no tenía descriptor effort (solo el dinámico lo traía) -> el effort guardado se descartaba (selectedOptions.codex={}). Fix: poblar el estático de Codex (ai-providers.ts) con los 4 modelos + descriptor effort comun [low,medium,high,xhigh]; el dinámico sigue siendo la fuente de verdad para la UI. Verificado: selectedOptions.codex={effort:xhigh} tras setear; Codex ACEPTA effort xhigh en turn/start (turno corre, solo que xhigh es lento >2min). Captura mirada del selector RAZONAMIENTO con los 4 modelos Codex. 451 tests. OBSERVACIÓN: xhigh puede rozar el timeout total de 120s -> pulido futuro. **HECHA.**_
  En `src/renderer/src/components/settings/`: bajo el `ModelPicker`, un selector GENÉRICO sobre
  los `options` (descriptores) del modelo SELECCIONADO — por ahora renderiza el descriptor
  `effort` como radios/segmented con sus choices (label + description), marca el default,
  persiste vía `settings:setModelOption`. Remount por `key` al cambiar modelo/proveedor (para
  que el valor se recalcule contra el nuevo modelo). Para Codex, poblar el `ModelPicker` con los
  modelos DINÁMICOS de T35 (`ai:getProviderModels`) con estado de carga + fallback al curado.
  Componente reutilizable (`ModelOptionPicker` o similar) para poder sumar service tier/thinking
  después sin reescribir.
  _Gotchas:_ linter react-hooks (reset por remount, no setState-en-efecto); estados de carga/error
  visibles; el selector solo muestra choices soportadas por el modelo actual (vienen del descriptor).
  _Aceptación:_ typecheck/lint/tests; smoke e2e CDP (cambiar modelo/effort, persistencia tras
  reabrir, Codex muestra 4 modelos); **captura mirada** del selector de effort en cada proveedor.

- [ ] **T38. (Opcional/diferible) Gating por versión del CLI**
  Ofrecer solo modelos/efforts soportados por la versión instalada de `claude`/`codex` (semver,
  estilo `getBuiltInClaudeModelsForVersion` de t3code). Pulido; se decide al final de F8.

---

## Log F7 — Gotcha clave: el protocolo de `codex app-server` se AUTO-GENERA

**2026-07-07 (T29).** El binario `codex` puede emitir su propio contrato del app-server:
`codex app-server generate-ts --out <dir>` (bindings TypeScript) y
`codex app-server generate-json-schema --out <dir>` (JSON Schema). Es la FUENTE DE VERDAD por
versión del CLI — mejor que t3code (que puede ir en otra versión). Verdades del protocolo
0.142.5 (transport `stdio://` default, framing **JSONL** = un objeto JSON por línea, NO
Content-Length):
- Handshake: `initialize`(request, params `{clientInfo, capabilities:{experimentalApi:true,…}}`)
  → `initialized`(notify, sin params) → `account/read`(`{refreshToken:false}` →
  `{account: {type:'chatgpt', email, planType} | null, requiresOpenaiAuth}`; **auth = account
  != null**, `requiresOpenaiAuth` es true aun logueado).
- `thread/start` params `{model, baseInstructions, sandbox:'read-only', approvalPolicy:'never'}`
  → `{thread:{id}, model}`. El system prompt va en **`baseInstructions`**. sandbox+approval
  evitan que el agente ejecute comandos.
- `turn/start` params `{threadId, input: Array<UserInput>}` con `UserInput = {type:'text',
  text, text_elements:[]}`. **Resuelve con un ACK inmediato (`turn.status:'inProgress'`)** — el
  fin real es la notificación **`turn/completed`**.
- Deltas de texto del asistente: notificación **`item/agentMessage/delta`** con
  `params.delta:string`. (Razonamiento va por `item/reasoning/textDelta` — ignorar.)
- Modelos vía `model/list` → `{data:[{id:'gpt-5.5',…}]}`. Hoy solo `gpt-5.5` (default del
  thread). NO existe un id `gpt-5.5-codex`.
- Errores: notificación `error` `{message}`; o `turn/completed` con `turn.status:'failed'`.
Reproducir el descubrimiento: `codex app-server generate-ts --out /tmp/x/ts` y leer
`ClientRequest.ts`/`ServerNotification.ts`/`v2/*Params.ts`. El esquema JSON completo está en
`codex_app_server_protocol.v2.schemas.json`.

---

## Log

- 2026-07-05: Plan creado. T1 lanzada a subagente Sonnet.
- 2026-07-05: **T1 hecha y verificada** (subagente Sonnet `adffa4a9458bb8541` + verificación del orquestador).
  typecheck/lint/build verdes; ventana "Minerva" confirmada mapeada vía `hyprctl clients`.
  Gotchas: (a) hubo que correr `node node_modules/electron/install.js` porque el binario
  de Electron no se descargó en el install inicial; (b) electron pineado a vite 7.x
  (peer dep de electron-vite 5); (c) preload se emite como `.mjs`.
- 2026-07-05: T2 lanzada a subagente Sonnet.
- 2026-07-05: **T2 hecha y verificada** (subagente `af17719ebd6674455`). Contratos en
  `src/shared/ipc.ts` (IpcContract + MinervaApi derivado por tipos), validación de
  payloads en `src/main/ipc/register.ts`, preload sin ipcRenderer crudo. Prueba de
  tipos negativa confirmada (TS2322). Checks verdes + ventana OK.
- 2026-07-05: T3 lanzada a subagente Sonnet.
- 2026-07-05: **BUG encontrado en verificación de T3** (venía desde T1): con `sandbox: true`
  el preload NO puede ser ESM — Electron lanzaba `SyntaxError: Cannot use import statement
  outside a module` y `window.minerva` quedaba undefined → TitleBar crasheaba → pantalla
  en blanco. Fix (orquestador): preload forzado a CJS en electron.vite.config.ts
  (`format: 'cjs'`, `entryFileNames: '[name].cjs'`) + ruta `.cjs` en main. Hardening:
  `useConnectionStatus` defensivo + `ErrorBoundary` global en main.tsx.
  Lección: verificar SIEMPRE con la app corriendo y captura de pantalla, no solo checks.
- 2026-07-05: **T3 hecha y verificada** (subagente `abca3fdf8fa2a4daa` + fix del orquestador).
  Captura visual confirma: sidebar 3 repos/8 PRs con badges, empty state, panel didáctico,
  indicador "Conectado" verde (IPC end-to-end OK). Checks verdes.
- 2026-07-05: T4 implementada (subagente). `src/main/github/{service,mock-service,fixtures,index}.ts`
  (interfaz `GithubService` tipada sobre `IpcRequest/IpcResponse` del contrato, mock en memoria
  con latencia simulada 180-320ms y `postComment` mutando hilos del proceso), 5 handlers
  `github:*` delegando a una instancia única en `registerIpcHandlers`. Renderer: hooks
  `usePullRequests` (debounce 250ms), `usePullRequestDetail`, `usePullRequestFiles`,
  `useCommentThreads` (con `reload`), store con `selectedPr` completo (no solo id) para no
  tener que re-buscarlo al pedir detalle/archivos/hilos. `ConversationTab` ahora incluye
  formulario de comentario general end-to-end. Eliminado `src/renderer/src/mocks/pull-requests.ts`.
  typecheck/lint/build verdes.
  Gotcha de build no trivial: con `main` a ESM, el plugin `vite:esm-shim` de electron-vite
  usa una regex de texto plano (no AST) para ubicar dónde termina el último `import ... from
  '...'` del bundle e insertar ahí un shim de interop CJS (necesario porque `main/index.ts`
  usaba `__dirname`). Esa regex no distingue código real de texto dentro de un string: los
  fixtures mock (diffs de ejemplo con `import { X } from 'y'` como texto) calzaban con el
  patrón y el shim quedaba insertado en medio de esas cadenas, corrompiendo el bundle
  (`Unterminated string literal` solo en `npm run build`, típecheck/lint no lo detectan).
  Fix: `main/index.ts` usa `import.meta.dirname` en vez de `__dirname` — sin ese global de
  CommonJS el plugin de interop nunca se activa. Pendiente: verificación visual del
  orquestador (no se corrió `npm run dev` por instrucción explícita de la tarea).
- 2026-07-05: **T4 hecha y verificada** con smoke e2e vía CDP (`scripts/smoke-e2e.mjs`,
  app corriendo con `--remote-debugging-port=9222`): 5/5 PASS — lista vía IPC, indicador
  Conectado, selección de PR (#479), tab Archivos con DiffFiles, y **postComment
  end-to-end** (comentario visible en el hilo tras recarga). Captura visual confirma.
  Se agregó `ws` como devDependency para el harness CDP.
- 2026-07-05: **T5 verificada como absorbida por T3+T4**: agrupación por repo, badges
  CI/draft/reviewDecision, estados loading/error en hooks, y búsqueda con debounce
  filtrando en main — verificada e2e con `scripts/smoke-search.mjs` (PASS).
- 2026-07-05: T7 lanzada a subagente Sonnet.
- 2026-07-05: **T7 hecha y verificada** (subagente `a9d98db100c78a2e5`). Parser de unified
  diff propio + split/inline + árbol tree/list + Shiki (via shiki/core con langs estáticos
  y engine JS — evita ~150 chunks en el build; highlighting línea a línea con tokens React,
  sin dangerouslySetInnerHTML). 29/29 tests vitest. Smoke e2e `scripts/smoke-diff.mjs`:
  7/7 PASS. Captura visual confirma split view con hunks, números, colores y highlighting.
- 2026-07-05: T8 lanzada a subagente Sonnet.
- 2026-07-05: **T8 hecha y verificada** (subagente `acd364604ba0454f4`). Hilos de línea en
  el diff (indicador en gutter, expansión inline, reply, crear hilo con "+", side
  LEFT/RIGHT), chip path:line navegable desde Conversación, hilos resueltos colapsados.
  36/36 tests. Smoke `scripts/smoke-comments.mjs`: 5/5 PASS. Nota de verificación: los 2
  fallos iniciales eran del PROPIO TEST (clickeaba el botón de colapso padre en vez del
  span[role=link] del chip) — la app estaba bien; debug con `scripts/debug-t8.mjs`.
- 2026-07-05: T9(mock)+T10 lanzadas juntas a subagente Sonnet: panel didáctico completo
  en renderer (Markdown+Mermaid) contra un `AiService` mock en main con fixtures de
  DidacticAnalysis; el Anthropic real se enchufa en T9-final cuando haya API key.
- 2026-07-05: **T10 hecha y verificada** (subagente `a7dc9045832b2c275`). Panel didáctico
  e2e con AiService mock: secciones summary/endpoint/architecture/schema, Mermaid lazy
  (chunk separado ~1MB, securityLevel strict, theme dark, fallback a código fuente),
  react-markdown+gfm, snippets copiables. Smoke `scripts/smoke-didactic.mjs`: 9/9 PASS
  (C4 #482, ER #479, C4Component #201, reset de panel al cambiar PR). T9 queda [~]:
  estructura/interfaz lista, falta impl real Anthropic (bloqueada por API key).
- 2026-07-05: T11 (revisión de seguridad) lanzada a subagente Sonnet.
- 2026-07-05: **Revisión de seguridad completada** (subagente `a66b63f5c713f8db3`):
  0 altos. Fixes aplicados por el orquestador (openExternal solo http/https; preload
  lanza si no hay contextIsolation). Regresión completa de smokes tras los fixes:
  smoke-e2e 5/5, smoke-diff 7/7, smoke-comments 5/5, smoke-search PASS, smoke-didactic 9/9.
  Nota: dos fallos intermedios de smoke-e2e eran del PROPIO test (querySelector('textarea')
  tomaba el reply de un hilo en vez del composer general tras T8; y /comentar/i matcheaba
  "· 1 comentario" del header de hilos). La app estaba bien en ambos casos.
- 2026-07-05: Edilson entregó el OAuth Client ID (`Ov23liwnuK40dnyINVGy`, Device Flow
  habilitado). T6 lanzada a subagente Sonnet, incluyendo la validación profunda de
  payloads IPC (hallazgo medio #2 de la revisión de seguridad).
- 2026-07-05: Edilson entregó `OPENROUTER_API_KEY` (`.env` en la raíz, ya en
  `.gitignore`). T9-final lanzada a subagente Sonnet.
- 2026-07-05: **T9-final implementada** (subagente Sonnet). `src/main/ai/env.ts`
  (parser propio de `.env`, `process.env` primero), `prompts/analyze-pr.ts` +
  `prompts/README.md` (reescrito: el diseño previo de clasificador multi-paso con
  Anthropic Agent SDK quedó obsoleto, ahora es una sola llamada de chat a OpenRouter
  que clasifica y genera todo junto), `diff-budget.ts`, `json-extract.ts`,
  `section-mapper.ts`, `openrouter-service.ts` (`OpenRouterAiService`). `createAiService`
  (`ai/index.ts`) ahora toma el `GithubService` activo por parámetro y elige real vs.
  mock según haya o no `OPENROUTER_API_KEY` — independiente de `MINERVA_MOCK`, a
  propósito, para poder correr IA real sobre PRs mock. `handlers.ts` actualizado para
  pasarle `githubService` a `createAiService`. Gotcha aplicado: el prompt (string largo)
  se armó con concatenación de comillas normales, no template literal con backticks
  (mismo bug de `vite:esm-shim` que en `github/fixtures.ts`); build final confirma
  `out/main/index.js` sin corrupción (`node -c` OK, contenido del prompt presente en el
  bundle). Fix de lint: los `throw` en el catch de la llamada a `fetch` necesitaban
  `{ cause: error }` (regla `preserve-caught-error`, mismo patrón que `ipc/register.ts`).
  typecheck/lint/test (150/150, ~40 nuevos)/build verdes. PENDIENTE: verificación e2e
  del orquestador con la app corriendo (`MINERVA_MOCK=1` + key real) antes de pasar a `[x]`.
- 2026-07-06: **T6 hecha y verificada**: login real de Edilson completado vía Device Flow
  (código 6934-F39F → `signed_in` como `edygg`, observado por watcher CDP). Bug encontrado
  y arreglado en verificación: la Sidebar no refetcheaba al cambiar el estado de auth
  (3 instancias de useAuth con estado local independiente) → `authStatus` movido al store
  de zustand como fuente única, `usePullRequests(search, authState)` refetchea al loguear,
  y useAuth retoma polling si monta con device flow pendiente. Lista real devuelve `[]`
  legítimo (query base `is:pr is:open involves:@me`; el buscador acepta cualificadores
  `org:`/`repo:` — empty state nuevo lo explica).
- 2026-07-06: **T9-final hecha y verificada**: Edilson entregó OPENROUTER_API_KEY
  (guardada en `.env` raíz, modo 600, gitignored, + `.env.example`). Verificación e2e
  real: `ai:analyzePullRequest` sobre PR mock shopwave/api#482 con MINERVA_MOCK=1 +
  key real → 13.4s, secciones [summary, endpoint], resumen de calidad (detectó falta
  de persistencia del cupón en el modelo Cart). Modelo: anthropic/claude-sonnet-4.5
  vía MINERVA_AI_MODEL. Lint/typecheck/tests(150)/build verdes tras fix de deps de
  useCallback en use-auth.
- 2026-07-06: Gotcha de tooling del orquestador: `pkill -f "<patrón>"` en los comandos
  de verificación mataba el PROPIO shell si el patrón aparece literal en la línea de
  comando (por eso todos los "exit 144"). Usar `[e]lectron` en el patrón.
- 2026-07-06: **T12 hecha y verificada** (subagente `a8ec8959ac1812fed`). Settings en
  userData/settings.json (atómico), lista curada en shared/ai-models.ts, precedencia
  settings>env>default, modal con radio-cards + "Otro (avanzado)", hint "vía <modelo>".
  Smoke `scripts/smoke-settings.mjs` 6/6: default GLM 5.2, persistencia en disco, y
  PRUEBA de que el análisis usa settings (modelo inválido → 400 de OpenRouter; GLM 5.2
  → análisis real OK). 170/170 tests. T13 lanzada.
- 2026-07-06: **T13 hecha y verificada** (subagente `adae073f8f6e3b9a3`). Protocolo tagged
  @@@SECTION/@@@MERMAID/@@@SNIPPET (reemplaza JSON — más robusto para streaming),
  StreamSectionParser incremental (24 tests), SSE real en openrouter-service (timeouts
  120s total + 20s inactividad), mock streamea con el mismo parser, eventos push
  main→renderer (preload expone onAnalysisProgress concreto, sin `on` genérico).
  188/188 tests. Smoke `scripts/smoke-streaming.mjs`: mock 6/6 (7 eventos, 909ms) y
  REAL 6/6 (GLM 5.2: primer evento 5.3s, total 10.5s, crecimiento 0→2126 chars).
  T14 lanzada.
- 2026-07-06: **T14 hecha y verificada** (subagente `a51e416ddd0ef0ffd`). Cache LRU de
  análisis en main (20 entradas; hit → instantáneo sin eventos ni costo LLM), canales
  ai:getCachedAnalysis/ai:invalidateAnalysis/window:openDidactic, ventana didáctica
  única (reutilizada por navegación, hash #didactic/<owner>/<name>/<n>, misma frontera
  de seguridad extraída a src/main/windows/), botón Re-analizar, ResourceViewer con
  zoom/pan (rueda hacia cursor, drag, fit, Esc). 229/229 tests.
  Smoke `scripts/smoke-detach.mjs` 8/8 (dos targets CDP, uno por ventana).
- 2026-07-06: **Lección de la suite e2e**: los "6/9 flaky" de smoke-didactic NUNCA
  fueron bug de la app — era contaminación entre suites en la misma sesión de app:
  (a) smoke-search dejaba el buscador filtrando 'refunds' → los clicks de selección
  de otras suites fallaban en silencio; (b) el cache de T14 convierte el "primer
  análisis" de suites posteriores en cache-hit sin streaming. Fixes: smoke-didactic
  limpia el buscador al arrancar; smoke-detach invalida el cache de su PR. Regresión
  completa de las 7 suites en una sola sesión: TODAS verdes.
  Regla para futuras suites: dejar el estado global (buscador, cache) como lo
  encontraste o limpiarlo al empezar.
- 2026-07-06: **T15 hecha y verificada** (bugs reportados por Edilson con capturas).
  Fixes de app: (1) botón "Expandir snippet" integrado al header de CodeSnippet
  (antes el overlay flotante caía encima de "Copiar" — ambos incliqueables);
  (2) `ui/Markdown.tsx` compartido (ex DidacticMarkdown) para hilos de comentarios
  y descripción del PR (ConversationTab/ThreadCard renderizaban <pre> plano);
  (3) visor de recursos vacío: el SVG de mermaid (width:100% + max-width) colapsaba
  a 0px dentro del wrapper `absolute` de MermaidZoomPan → `withNaturalSize` fija
  width/height del viewBox EN EL STRING del SVG (mutar el nodo montado se pierde si
  React re-inserta el innerHTML) y el fit se calcula del viewBox (medir rect/zoom
  era orden-dependiente: dos fits en el mismo frame — StrictMode — componían el
  factor hasta clavarse en 25%); (4) CSP explícita con `img-src 'self' data: https:`
  (el person icon de C4 es PNG base64 → icono roto; también habilita avatares e
  imágenes de comentarios de GitHub); (5) BUG REAL destapado al endurecer la suite:
  reutilizar la ventana didáctica con otro PR era navegación same-document (solo
  cambia el hash) → Chromium NO recarga y quedaba el contenido del PR anterior con
  la URL del nuevo; main.tsx ahora es reactivo a `hashchange` con `key={hash}`.
  229/229 tests; 9 suites e2e verdes (nueva `scripts/smoke-bugfixes.mjs` 7/7).
- 2026-07-06: **Lecciones de suites e2e (ronda 2)**:
  (a) TODA suite debe excluir la ventana didáctica al elegir target CDP
  (`!t.url.includes('#didactic')`) — smoke-didactic se conectó a la ventana
  desacoplada y todos sus clicks "fallaban" sin bug alguno (6/9 fantasma, otra vez).
  (b) El check de reuso de ventana era solo-URL y por eso el bug (5) vivió oculto:
  verificar CONTENIDO, no solo URL. (c) No esperar por textos que ya existen en el
  placeholder ('Resumen'); esperar señales inequívocas (botón Re-analizar habilitado).
  (d) Con IA real las secciones del análisis varían por corrida: los checks de
  snippet/diagrama necesitan fallback a otro PR (cache) o tolerancia; el residuo de
  flakiness de smoke-bugfixes en batch es eso — standalone pasa 7/7 consistente.
  (e) Suites que analizan un PR concreto deben invalidar su cache al arrancar
  (streaming/settings cayeron por cache-hit de corridas previas).
- 2026-07-06: **T15-bis: el visor de mermaid SEGUÍA vacío para Edilson** (captura suya:
  diálogo colapsado a header+toolbar, zoom clavado en 25% = clamp mínimo). Causa REAL
  (distinta a la de T15): el diálogo del ResourceViewer tenía `max-h-[90vh]` y altura
  por contenido, pero el diagrama dentro de MermaidZoomPan es `absolute` (fuera de
  flujo, no aporta altura) → el diálogo colapsaba y el `overflow-hidden` escondía todo.
  Fix: `h-[90vh]` FIJO para recursos mermaid (markdown/snippet conservan max-h).
  Extra: `page-title-updated` bloqueado en la ventana didáctica (el <title> del HTML
  pisaba el título por-PR).
  **LECCIÓN CLAVE (pedida por Edilson): las verificaciones de UI deben terminar en una
  CAPTURA DE PANTALLA mirada de verdad.** Mis checks CDP daban PASS porque
  getBoundingClientRect ignora el clipping: el SVG "medía" 991x355 dentro de un área
  de 0px de alto. Nuevo helper `scripts/screenshot-app.sh` (hyprctl+grim, no
  interactivo, mismo mecanismo que omarchy-capture-screenshot; segundo arg apunta a
  la ventana didáctica por título). Suites endurecidas: smoke-bugfixes y smoke-detach
  ahora exigen altura real del área de zoom (>300px) y solape vertical.
  Verificado VISUALMENTE con grim: visor con C4 a fit 86% (ventana ancha) y 53%/34%
  (tileada), zoom a 151% funcionando, y ventana desacoplada también OK.
  typecheck/lint/229 tests/smoke-bugfixes 7/7/smoke-detach 8/8 verdes.
- 2026-07-06: **Fix: sesión de GitHub no persistía (login en cada arranque)**.
  Causa: Chromium no reconoce XDG_CURRENT_DESKTOP=Hyprland → password store
  `basic_text` → `safeStorage.isEncryptionAvailable() = false` → token-store se
  niega (bien) a persistir el token sin cifrar → re-login SIEMPRE, en dev Y en
  producción en esa máquina — aunque gnome-keyring estaba corriendo con
  org.freedesktop.secrets. Fix en `main/index.ts` (antes de whenReady): si el
  desktop no está en la lista que Chromium reconoce, se fuerza
  `--password-store=gnome-libsecret` (Secret Service de D-Bus); override con
  MINERVA_PASSWORD_STORE. + Log diagnóstico permanente del backend al arrancar.
  Verificado: probes de electron (basic_text/false sin switch → gnome_libsecret/
  true con switch), roundtrip cifrar→archivo→REINICIO de proceso→descifrar OK,
  y la app real loguea "backend: gnome_libsecret — cifrado disponible: true".
  Falta 1 login manual de Edilson para confirmar el ciclo completo (el token
  se guarda al completar el device flow).
- 2026-07-06: **Documentación actualizada al estado real (cierre de sesión)**:
  CLAUDE.md reescrito (stack actual, OpenRouter+settings+streaming tagged+cache,
  ventana desacoplada reactiva a hashchange, CSP, gotchas duros, reglas de
  verificación con suites CDP + captura obligatoria); README con features F4,
  puesta en marcha real, sección de desarrollo/verificación y roadmap al día;
  PLAN.md con nota de estado; .env.example con MINERVA_PASSWORD_STORE.
  NUEVO `.agents/WORKFLOW.md`: documenta la estrategia multi-agente del proyecto —
  **Fable 5 como orquestador** (plan, definición de tareas, verificación e2e,
  diagnóstico de causas raíz, bitácora) y **Sonnet 5 en subagentes** para la
  implementación de tareas bien descritas; regla de oro: nada pasa a [x] sin
  verificación del orquestador.
- 2026-07-06: **T16 (calidad de diagramas) — implementación + 2 gotchas nuevos**.
  Cambios (subagente Sonnet `ae4a8010cbc71ac7f` + ajustes del orquestador):
  mermaid `theme: 'neutral'` + fondo blanco en tarjeta inline y área del visor;
  config de layout en `initialize` (c4ShapeInRow 3, c4BoundaryInRow 1, márgenes/
  padding arriba, messageFontSize 14; er/flowchart análogos); prompt y skill
  `mermaid-c4-diagram` con reglas de DSL sobrio (Rel ≤4 palabras, ≤8 elementos,
  tecnología corta). El efecto medido en el C4 del fixture: viewBox pasa de
  2412x512 (fila única apretada) a 1316x1042, 0 pares de etiquetas solapadas.
  **GOTCHA (mermaid): el carácter `#` dentro de un diagrama C4 rompe el lexer**
  ("Lexical error on line N") con CUALQUIER config — el fixture del PR 482 tenía
  `title ... PR #482 ...` y por eso el visor caía a "Diagrama no renderizable";
  era un bug LATENTE (no lo introdujo T16). Ojo: un render fallido de mermaid
  deja un SVG residual en el DOM (los checks que cuentan SVGs mienten; verificar
  el fallback card, no la presencia de SVG). Fix: sin `#` en fixtures + regla
  explícita en prompt y skill. Además el catch de `MermaidDiagram` ahora hace
  `console.error` del motivo (antes tragaba el error en silencio y el fallback
  era indistinguible entre DSL malo y bug nuestro).
  **GOTCHA (electron-vite): `electron-vite dev` SIN `--watch` NO reconstruye ni
  reinicia main al cambiar `src/main/**`** (solo el renderer tiene HMR) — la
  nota de CLAUDE.md de "main cambia ⇒ reinicio completo" solo aplica con `-w`.
  Cambios en fixtures/prompts requieren reiniciar `npm run dev` a mano.
  Verificación: typecheck/lint/229 tests verdes; smoke-bugfixes 7/7 y
  smoke-detach 8/8 (contra instancia propia con CDP en :5174, sin tocar la
  instancia del usuario); DOM del visor: fondo rgb(255,255,255), fills de texto
  #444/negro sobre blanco, 0 solapes. Captura visual pendiente de hyprlock
  (vigía en background la toma al desbloquear) — T16 queda [~] hasta MIRARLA.
- 2026-07-06: **T16 cerrada [x] — segunda ronda tras MIRAR la captura** (la lección
  de T15-bis salvó la tarea otra vez: el DOM decía "todo bien" y la captura mostró
  el diagrama en miniatura). Tres fixes adicionales del orquestador:
  (1) **`withNaturalSize` nunca funcionó con C4**: mermaid emite el person icon como
  `<image xlink:href=...>` SIN declarar `xmlns:xlink` y DOMParser en modo
  `image/svg+xml` rechaza el documento entero → la función devolvía el markup
  intacto (width 100% → colapso en el wrapper absolute). Fix: parsear como
  `text/html` (tolerante y coherente con dangerouslySetInnerHTML).
  (2) **Recorte de lienzo**: el motor C4 emite >100px de bandas muertas por lado;
  ahora `normalizeSvg` mide el bbox real (host oculto con visibility:hidden — con
  display:none getBBox da 0) y recorta el viewBox a contenido+24px. El auto-fit
  pasó de 51% a 67% en el fixture. Aplica también a la tarjeta inline (max-width).
  (3) **`c4ShapeMargin: 110`** (60 se quedaba corto: las etiquetas de Rel
  horizontales pisaban las cajas vecinas) + etiquetas del fixture 482 acortadas a
  la regla de ≤4 palabras.
  NUEVO `scripts/screenshot-cdp.mjs`: captura por CDP (`Page.captureScreenshot`),
  independiente del workspace visible de Hyprland y de hyprlock — grim capturaba
  el lockscreen o un workspace ajeno; para verificar CONTENIDO de la app este es
  el camino robusto (la captura hyprctl+grim sigue valiendo para geometría real
  de ventana).
  Verificación final: typecheck/lint/229 tests; smoke-bugfixes 7/7, smoke-detach
  8/8, smoke-didactic 9/9; captura CDP MIRADA: fondo blanco, fit 67%, todas las
  etiquetas de Rel legibles en los huecos sin pisar cajas, title y boundary
  correctos. Diagramas de PR 479 (ER) y 201 (C4) también renderizan.
- 2026-07-06: **T17 y T18 hechas y verificadas** (reportes de Edilson con capturas
  sobre el PR real #70 de clevr-merlin; implementación en paralelo por dos
  subagentes Sonnet; verificación del orquestador).
  **T17 (contraste)**: token `--color-code-bg #15181d` + `--color-border` a
  `#353b47`; `Markdown.tsx` con cuerpo `text-text/90` (muted ya no se usa para
  contenido), h2 con `border-b`, inline code `bg-white/10`, `pre` sobre
  `bg-code-bg`, `thead bg-border/60` + zebra `even:bg-white/[0.03]`, `td
  text-text/85`; header de `DidacticSectionCard` con `bg-white/[0.04]`.
  **T18 (alineación diff)**: GOTCHA CSS GRID aprendido — las pistas `auto` de un
  grid ABSORBEN el espacio libre del contenedor (a diferencia de `max-content`):
  con un grid POR HUNK, los gutters se inflaban distinto en cada hunk según su
  línea más larga y el inicio del código saltaba ~100px entre hunks (se percibía
  como "indentación rota"; el patch crudo de GitHub venía limpio — verificado
  con `gh api .../pulls/70/files`). Fix: UN grid por archivo (SplitDiff/InlineDiff
  reciben `hunks` y renderizan los headers `@@` como filas `gridColumn: 1 / -1`),
  gutters `max-content` y contenido `minmax(max-content, 1fr)` (los fondos
  verde/rojo siguen llegando al borde); `OpenComposer` pasó a key compuesta
  `hunk:fila`. `HunkBlock` eliminado de DiffView.
  Verificación: typecheck/lint/229 tests; smoke-diff 7/7, smoke-comments 5/5;
  capturas CDP MIRADAS: split e inline con hunks múltiples alineados (números y
  código en la misma x, sangría relativa intacta, wrap on/off), análisis real de
  #482 (kimi-k2.7-code) y visor "Endpoint — vista amplia" con tabla, chips y JSON
  claramente distinguibles. Sin regresiones visibles en lista de PRs/conversación.
- 2026-07-06: **T20 hecha y verificada** (subagente Sonnet + verificación del
  orquestador). Nueva sección `setup` ("Cómo levantar la app"), SIEMPRE presente,
  2ª tras summary: Docker si el diff lo evidencia, corrida local, env vars
  requeridas y tabla OBLIGATORIA de env vars nuevas del PR (o declaración
  explícita de que no hay). Slice completo: types/events (kind `setup` +
  languages `bash`/`env` en snippets), section-mapper, stream-parser
  (KNOWN_KINDS/toDraft/sectionToText), prompt analyze-pr.ts, agente
  pr-didactic-analyzer.md, fixtures pr482 (con env var nueva
  COUPON_MAX_DISCOUNT_RATE) y pr479 (caso "sin env vars"), SECTION_META con
  icono Rocket y render de snippets en endpoint|setup (final y draft).
  Verificación: typecheck/lint/235 tests; smoke-didactic EXTENDIDA con 4 checks
  de setup (card presente, env vars documentadas, snippets copiables, caso
  "sin env vars") 13/13; smoke-streaming 6/6; smoke-detach 8/8 — todo con IA
  mock forzada (OPENROUTER_API_KEY= vacío gana al .env) + MINERVA_MOCK=1.
  Capturas CDP MIRADAS: card con markdown jerárquico, tabla de la env var nueva
  y snippets bash/env con "Copiar". Nota de diseño de la suite: checks de
  contenido estrictos contra fixture con fallback laxo al contrato ("habla de
  variables de entorno") para cuando corre con IA real.
- 2026-07-06: **T21 hecha y verificada** (subagente Sonnet + verificación del
  orquestador). Shiki aprobado por Edilson tras comparar con highlight.js y
  prism-react-renderer; al arrancar se descubrió que Shiki 4.3.1 YA estaba en el
  proyecto (diff view, T7) — se EXTENDIÓ `lib/highlighter.ts` en vez de crear
  otro highlighter: gramáticas dotenv/http/docker/diff/python, `highlightCode`
  multilínea (contexto completo, a diferencia de `highlightLine` del diff),
  `resolveSnippetLang` (curl→bash, env→dotenv, aliases de fences, desconocido→
  null) y componente compartido `ui/HighlightedCode.tsx` (tokens→spans React,
  sin innerHTML; remount-por-key para el fallback plano mientras carga, la
  convención del repo para el linter set-state-in-effect). Integrado en
  `CodeSnippet` y el override `code` de `ui/Markdown.tsx` (fences con
  `language-xxx`; inline intacto); `ResourceViewer` lo hereda vía CodeSnippet.
  De paso: fence del bodyMarkdown del PR mock 482 etiquetado ` ```bash ` para
  ejercitar e2e la ruta de fences. Verificación: typecheck/lint/271 tests +
  build; smoke-didactic 13/13, smoke-streaming 6/6, smoke-diff 7/7 (el
  highlighter es compartido con el diff), smoke-detach 8/8; capturas MIRADAS:
  snippets bash/env de la card setup coloreados (dotenv resalta claves) y fence
  curl del comentario del PR 482 con 11 spans coloreados.
  GOTCHA nuevo (verificación): el watcher de electron-vite dev NO recompiló
  main al tocar `github/fixtures.ts` (el fence tagueado no aparecía tras
  esperar el "restart"); hizo falta matar y relanzar `npm run dev`. Y al
  relanzar: `pkill -f "vite"` sin el truco del corchete mata el PROPIO shell
  del comando compuesto (exit 144) — usar siempre `pkill -f "[v]ite"` /
  `pkill -f "[e]lectron"`.
- 2026-07-06: **T21-bis (fix directo del orquestador, reportado por Edilson con
  captura del PR real clevr-merlin #70)**: la vista de diff mostraba archivos
  `.py` sin resaltar — T21 agregó gramáticas nuevas para fences/snippets pero
  NO actualizó `EXTENSION_TO_LANG` (el mapa por extensión que usa
  `inferLanguage` en el diff). Fix en `lib/highlighter.ts`: extensiones
  py/pyi→python, toml→toml (gramática nueva), env→dotenv, http, diff/patch,
  dockerfile→docker, y `inferLanguage` ahora resuelve por BASENAME los archivos
  sin extensión útil (`Dockerfile`, `Dockerfile.*`, `.env`, `.env.example`).
  `resolveSnippetLang` hereda todo por el spread. LECCIÓN: al sumar una
  gramática de Shiki hay que tocar DOS mapas (aliases de fences y extensiones
  del diff) — quedaron uno al lado del otro en el mismo archivo.
  Verificación: typecheck/lint/281 tests; e2e contra el PR REAL #70 (sesión
  GitHub persistida): archivo de tests Python con 1653 spans coloreados,
  captura mirada (imports/strings/comentarios diferenciados); smoke-diff 7/7 y
  smoke-didactic 13/13 en mock.
- 2026-07-06: **T22 hecha y verificada** (subagente Sonnet `ad98f3613035c3f3c` +
  fix del orquestador + verificación del orquestador). Reporte de Edilson con
  captura: desacoplar a mitad de un streaming abría una ventana en placeholder;
  cerrar/reabrir el panel perdía el resultado; y re-analizar con uno en vuelo
  pagaba el LLM dos veces. Implementado: registro in-flight en
  `ai:analyzePullRequest` (promesa compartida por PR + snapshot vivo vía getter),
  canal nuevo `ai:getAnalysisState` (cached|streaming|idle), evento terminal
  SIEMPRE (el `done:true` del servicio se suprime y se re-emite DESPUÉS de
  poblar el cache; en error se emite con `error: string` — antes en error nadie
  se enteraba jamás), hook con auto-attach en ambas superficies (la opción
  `autoLoadFromCache` desapareció) y "Abrir en ventana" cierra el panel acoplado.
  BUG encontrado por la VERIFICACIÓN VISUAL del orquestador (los smokes no lo
  atrapaban): la primera implementación solo se suscribía al streaming si
  montaba a MITAD de uno; una ventana ya abierta en un PR (reutilizada con el
  MISMO PR no hay `hashchange` → no hay remount) quedaba SORDA ante un análisis
  lanzado después desde otra superficie. Fix: el hook mantiene un listener de
  progreso PERMANENTE durante todo el montaje (attach pasivo; un chunk nuevo
  limpia analysis/error viejos y re-sincroniza; `analyze()` local tiene
  prioridad vía ref `localAnalysisActive`). smoke-detach EXTENDIDA a 17 checks
  (panel cerrado tras desacoplar, reabrir muestra cache sin click, dedupe
  in-flight por `generatedAt`, attach a mitad de streaming, ventana sorda se
  re-sincroniza); tres bugs de SUITE corregidos por el orquestador en el camino:
  (1) el click de "Abrir en ventana" requiere PR seleccionado en la UI (las
  suites viejas llamaban IPC directo); (2) matcher ambiguo — "Re-analizar"
  visible NO implica análisis terminado, se muestra también durante streaming
  adjunto (la señal buena: contenido + `getAnalysisState === 'streaming'`, o
  el cursor ▍); (3) el estado final se pollea hasta `cached` (carrera con los
  ~900ms del mock). smoke-didactic ahora invalida el cache de TODOS sus PRs al
  arrancar: con T22 el panel auto-adjunta el cache al montar, y "partir del
  placeholder" ya no se logra solo con el remount por cambio de PR.
  Verificación: typecheck/lint/290 tests; smoke-detach 17/17 (x2), smoke-didactic
  13/13, smoke-streaming 6/6, smoke-bugfixes 7/7; capturas CDP MIRADAS:
  desacoplada enganchada a mitad de streaming con el resumen ya transmitido,
  principal con panel cerrado, desacoplada completa, panel reabierto con cache.
- 2026-07-06: **T23 hecha y verificada** (fix directo del orquestador tras T22,
  mismo archivo). Resize del panel acoplado: handle de 6px en el borde
  izquierdo (pointer capture, sin listeners globales), `didacticPanelWidth` en
  app-store con clamp [320, 60% del viewport EVALUADO por llamada] y
  persistencia en localStorage (`minerva.didacticPanelWidth`); doble click
  restaura los 380px por defecto. Verificación por CDP con input REAL
  (`Input.dispatchMouseEvent` — los PointerEvent sintéticos de JS no activan
  `setPointerCapture`, tiran NotFoundError): crecer 180px → 349→528, achicar
  120px → 528→407, doble click → 380, ancho sobrevive `Page.reload`; typecheck/
  lint/290 tests y las 3 suites afectadas en verde tras el cambio.
  GOTCHA nuevo (verificación): con **hyprlock activo, TAMPOCO sirve la captura
  por CDP** — Chromium deja de producir frames con la superficie ocluida y
  `Page.captureScreenshot` (fromSurface true o false, incluso con
  `--disable-backgrounding-occluded-windows`) se cuelga en vez de fallar; la
  captura de T23 quedó pendiente por eso (la geometría se verificó numérica
  vía CDP, que sí funciona bajo el lock). Otro artefacto del entorno: con la
  ventana principal TILEADA angosta por Hyprland el layout desborda en X y el
  handle puede quedar fuera del viewport — verificar resize con la ventana a
  ancho completo.
- 2026-07-06: **T24 hecha y verificada** (subagente Sonnet `a20d8e25a96b72c58` +
  verificación del orquestador contra el binario real). Empaquetado
  electron-builder 26.15.3: `electron-builder.yml` (appId dev.edygg.minerva,
  productName Minerva, target AppImage, asar, npmRebuild false) con
  **exclusión explícita de `.env`** en `files` (electron-builder NO lo excluye
  solo y `ai/env.ts` lo busca en la raíz del app — la key se habría filtrado
  al asar; verificado con `npx @electron/asar list | grep .env` → vacío).
  Split de deps al patrón electron-vite: `dependencies` queda SOLO `octokit`
  (único import de node_modules en runtime de main/preload — verificado);
  react/mermaid/shiki/etc. a devDependencies (vite los bundlea en el
  renderer; react ya NO viaja como node_modules en el asar). Scripts `dist` y
  `dist:dir`. Artefactos: `dist/Minerva-0.1.0.AppImage` (124M) +
  `dist/linux-unpacked/` (324M).
  Verificación del orquestador: typecheck/lint/290 tests verdes tras el split
  de deps; NUEVA suite `scripts/smoke-packaged.mjs` (7/7) contra el AppImage
  REAL corriendo con MINERVA_MOCK=1 y CDP en :5175 — el target es la URL
  `file://...app.asar/out/renderer/index.html` (prueba en sí de que corre el
  build, no el dev server): preload CJS cargado, IPC vivo, PRs mock, detalle,
  tab Archivos con diff resaltado; captura CDP MIRADA (3 paneles correctos).
  safeStorage en el empaquetado: backend `gnome_libsecret`, cifrado
  disponible true (el fix del password-store viaja al binario). userData
  propio (`~/.config/Minerva`) — sesión/settings NO compartidos con dev
  (esperado).
  GOTCHA nuevo (entorno): **esta máquina Arch no tiene `libfuse.so.2`** (solo
  fuse3) → el AppImage NO corre por doble click; sale con "AppImages require
  FUSE". Workarounds: `./Minerva-0.1.0.AppImage --appimage-extract-and-run`
  (así se verificó), instalar el paquete `fuse2`, o usar
  `dist/linux-unpacked/minerva` directo. Además las suites dev NO sirven
  contra el packaged (su matcher de target exige `localhost:5173`) — para
  eso existe smoke-packaged.mjs (puerto CDP configurable vía
  MINERVA_CDP_PORT, default 5175, para no chocar con una instancia dev).
  Pendiente de pulido futuro: icono propio (hoy usa el default de Electron,
  warning esperado de electron-builder) y `desktopName`/WM_CLASS.
- 2026-07-07: **Repo subido a GitHub** (pedido de Edilson): git init + commit
  inicial `1ebe31e` (151 archivos) + push SSH a
  `github.com/edyggclevr/proj_minerva` (existía vacío; cuenta gh
  `edyggclevr`). Chequeo de seguridad previo: `.env` real fuera (solo
  `.env.example` con key vacía, verificado línea a línea), node_modules/out/
  dist ignorados. OJO: el repo es PÚBLICO y la bitácora menciona
  `clevr-merlin#70` (repo interno de la empresa de Edilson; solo el nombre,
  sin código) — avisado a Edilson, decide él si privatizar o limpiar.
- 2026-07-07: **T25 implementada y pusheada, bloqueada en verificación e2e**
  (subagente Sonnet `a0cae5a6d07055ab4` + verificación local del orquestador).
  `.github/workflows/release.yml`: trigger `release: published`, matrix
  fail-fast:false de 3 jobs (blacksmith-4vcpu-ubuntu-2404 → AppImage;
  blacksmith-4vcpu-windows-2025 → NSIS x64; blacksmith-6vcpu-macos-latest
  (M4/arm64) → DMG arm64+x64 con CSC_IDENTITY_AUTO_DISCOVERY=false, sin
  firma), pasos checkout→setup-node 22 (cache npm)→npm ci→warning no
  bloqueante si package.json ≠ tag→typecheck→build→electron-builder
  `--publish never`→`gh release upload "$GITHUB_REF_NAME" <glob> --clobber`
  con `shell: bash` (también en Windows; el glob expandido por bash NO se
  re-separa por espacios — "Minerva Setup 0.1.0.exe" viaja como un arg).
  `electron-builder.yml` ganó secciones `mac` (dmg arm64+x64, categoría
  developer-tools) y `win` (nsis x64); linux y `files` (exclusión de `.env`)
  intactos. Relevamiento Blacksmith (llms-full.txt): labels
  blacksmith-{2..32}vcpu-ubuntu-{2204,2404}[-arm] / -windows-2025 (beta) /
  blacksmith-{6,12}vcpu-macos-{latest,15,26} (solo Apple Silicon M4); las
  actions useblacksmith/* de cache están ARCHIVADAS — las estándar
  (actions/cache, setup-node) usan el cache de Blacksmith sin cambios;
  gotcha Windows runner: sin contenedores Linux (no nested virt).
  Verificación local: YAML parseado OK (js-yaml transitivo; actionlint no
  disponible), typecheck/lint/290 tests verdes. El intento del orquestador
  de crear el release de prueba fue denegado por el clasificador de
  permisos (crear superficie pública) — queda como acción humana.
- 2026-07-07: **T25 cerrada [x] — verificada e2e con release real.** Edilson
  pidió quitar Blacksmith (problemas configurándolo) → runners hosteados de
  GitHub (`ubuntu-latest`/`windows-latest`/`macos-latest`) con actions
  vigentes (checkout@v7, setup-node@v6 — verificadas contra los releases de
  GitHub). Con autorización explícita de Edilson el orquestador publicó el
  prerelease `v0.1.0` → run 28837863415: **3/3 jobs verdes** (~2.5–4 min c/u)
  y 4 assets adjuntos al release: `Minerva-0.1.0.AppImage` (130MB),
  `Minerva.Setup.0.1.0.exe` (105MB, NSIS x64), `Minerva-0.1.0-arm64.dmg`
  (122MB) y `Minerva-0.1.0.dmg` (124MB, x64). DATO: el repo ahora vive en
  `amiedygg/proj_minerva` (Edilson lo movió desde `edyggclevr`; el remote
  local sigue apuntando al nombre viejo y GitHub redirige — repuntar el
  remote quedó denegado por permisos, puede hacerlo Edilson). En repos
  públicos los runners hosteados no consumen minutos pagos.

---

## F9 — Persistencia del análisis + metadata de generación + staleness por SHA — 2026-07-07

> Rama `feature/analysis-persistence` (desde `feature/model-effort`/F8). Diseño completo en
> `PLAN.md` § "Iteración actual (2026-07-07): F9". Dos issues de Edilson: (1) el banner
> "vía proveedor·modelo·esfuerzo" del panel didáctico miente cuando cambio la config
> después de generar un análisis (lee la config vigente, no con qué se generó); (2) el
> último resumen de un PR debe persistir entre sesiones, y si el head del PR recibe commits
> nuevos (cambia el SHA) hay que avisar y sugerir actualizar.
>
> Invariantes: pipeline de streaming AGNÓSTICO (protocolo `@@@SECTION`) intacto; secretos
> solo en main; gotchas de main (sin backticks en strings largos, `import.meta.dirname`,
> preload CJS, reiniciar `npm run dev` al tocar `src/main/**`); persistir SOLO análisis
> completos.

- [x] **T39. Backbone de datos: `DidacticAnalysis` con `headSha`+`generatedWith`, `PullRequestSummary.headSha`, GitHub `oid`**
  _Hecha y verificada (2026-07-07, subagente `a0456b1ca98053cd8`). Split limpio
  `GeneratedAnalysis` (lo que produce el `AiService`) vs `DidacticAnalysis extends
  GeneratedAnalysis` (+`headSha`+`generatedWith: AnalysisGenerationInfo`, lo que cachea/
  devuelve el handler); `service.ts` retorna `Promise<GeneratedAnalysis>` (los 4 servicios
  solo cambian la anotación); `shared/ipc.ts` sin tocar (res sigue `DidacticAnalysis`).
  `PullRequestSummary.headSha` + GraphQL `oid` en ambas queries + mapping `?? ''`. Fixtures:
  8 PRs con headSha hex estable. El subagente además dejó un SELLADO PUENTE en handlers.ts
  (`headSha:''` + `generatedWith: getEffectiveAiSelection()`) para que compile — bien marcado
  como "headSha real y persistencia = T40". Verificado por el orquestador: typecheck (node+web),
  lint, 451 tests verdes. E2e de headSha del mock diferido a T40 (reinicia la app igual)._
  Contexto: hoy `DidacticAnalysis` (`src/shared/types.ts`) es `{ prId, sections, generatedAt }`
  — sin proveedor/modelo/effort ni SHA. `PullRequestSummary` tiene `headRef` (nombre de
  rama) pero NO el SHA del commit. Las queries GraphQL de `real-service.ts` piden
  `lastCommit: commits(last:1) { nodes { commit { statusCheckRollup { state } } } }` pero
  NO `oid`. Esta tarea sienta el modelo de datos SIN cambiar comportamiento observable aún
  (T40 hace el sellado real; T41/T42 la UI).
  Entregables:
  (a) `src/shared/types.ts`:
    - Nuevo `interface GeneratedAnalysis { prId: string; sections: DidacticSection[]; generatedAt: string }`
      (exactamente la forma vieja de `DidacticAnalysis`).
    - Nuevo `interface AnalysisGenerationInfo { provider: AiProviderId; model: string; options: Record<string, string> }`
      (importar `AiProviderId` de `./ai-providers`, ya se importa ahí).
    - `DidacticAnalysis` pasa a `extends GeneratedAnalysis` + `headSha: string` +
      `generatedWith: AnalysisGenerationInfo`. Documentar en JSDoc que SOLO el handler
      (`ipc/handlers.ts`) construye el objeto enriquecido; los servicios producen
      `GeneratedAnalysis`.
    - `PullRequestSummary` gana `headSha: string` (SHA del último commit del head; `''` si
      GitHub no lo devolviera). `PullRequestDetail` lo hereda.
  (b) DESACOPLAR lo que produce el servicio de lo que recibe el renderer. HOY
    `src/main/ai/service.ts` declara `AiService.analyzePullRequest(...): Promise<IpcResponse<'ai:analyzePullRequest'>>`
    y `IpcResponse<'ai:analyzePullRequest'>` (en `shared/ipc.ts`, L54) es `DidacticAnalysis`.
    Si `DidacticAnalysis` exige ahora `headSha`+`generatedWith`, los servicios (que solo
    construyen `{prId, sections, generatedAt}`) dejarían de compilar. Fix:
    - `service.ts`: `AiService.analyzePullRequest` pasa a retornar `Promise<GeneratedAnalysis>`
      (importar `GeneratedAnalysis` de `../../shared/types`), NO `IpcResponse<...>`. Actualizar
      el JSDoc: el servicio produce el CONTENIDO; el handler (`ipc/handlers.ts`) lo enriquece a
      `DidacticAnalysis` (con headSha+generatedWith) antes de cachear/devolver (T40).
    - `shared/ipc.ts`: `'ai:analyzePullRequest'.res` SIGUE siendo `DidacticAnalysis` (es lo que
      el renderer recibe, ya enriquecido por el handler). NO cambiar. Igual `ai:getCachedAnalysis`.
    - Los 4 servicios (`openrouter-service.ts`, `providers/claude-code-service.ts`,
      `providers/codex-service.ts`, `mock-service.ts`): cambiar la anotación de retorno de
      `Promise<IpcResponse<'ai:analyzePullRequest'>>` a `Promise<GeneratedAnalysis>`. El objeto
      que ya construyen (`{prId, sections, generatedAt}`) es un `GeneratedAnalysis` válido —
      NO añadir headSha/generatedWith en los servicios. Revisar helpers internos del mock
      (`streamAndReturn`/`final`) que tipen el retorno.
  (c) `src/main/github/real-service.ts`: añadir `oid` dentro de `commit { ... }` en el
    `lastCommit` de AMBAS queries (`SEARCH_PULL_REQUESTS_QUERY` y `PULL_REQUEST_DETAIL_QUERY`).
    Extender los tipos GraphQL locales (los `interface` de nodo, ~L55-100) para incluir
    `lastCommit.nodes[].commit.oid?: string`. En `mapSearchNode` y `mapDetailNode` mapear
    `headSha: node.lastCommit?.nodes?.[0]?.commit?.oid ?? ''`.
  (d) `src/main/github/fixtures.ts`: cada PR fixture gana un `headSha` estable y realista
    (40 hex chars, distinto por PR; p. ej. derivar algo determinista y legible como
    `'a1b2c3d4e5f6...'` — NO usar backticks). `mock-service.ts`: propagar ese `headSha` en
    lo que devuelven summary/detail (revisar cómo arma los `PrRecord`/summaries; si el
    fixture ya se spreadea, con añadir el campo al fixture basta, pero VERIFICAR que el
    summary construido lo incluye).
  (e) Ajustar TODOS los sitios que construyen `PullRequestSummary`/`PullRequestDetail` de
    prueba (fixtures de tests, helpers de smoke si aplican) para incluir `headSha` — el
    typecheck de tests dirá cuáles.
  Gotchas: sin backticks en strings largos de main (fixtures — usar comillas simples/dobles
  concatenadas); `import.meta.dirname` si tocaras rutas (no debería). NO tocar el pipeline
  de streaming ni `stream-parser`/`section-mapper`.
  _Aceptación (orquestador):_ typecheck (node+web)/lint/`npm test` verdes; con `MINERVA_MOCK=1`
  el detalle de un PR mock trae `headSha` no vacío (verificable por CDP:
  `window.minerva.github.getPullRequestDetail`); no hay cambio visible en el panel todavía.

- [x] **T40. Sellado en el handler + persistencia a disco del análisis**
  _Hecha y verificada (2026-07-07, subagente `a3351e226a110f125`). `analysis-store.ts` nuevo
  (persistencia atómica `analyses.json` en userData, patrón de settings/store: filePath
  perezoso, load tolerante, writeAtomic tmp+rename; forma `{version:1, entries:[{key,analysis}]}`,
  cap 20 aplicado en saveEntries y defensivamente en load, valida cada entry completa y
  descarta inválidas). `AnalysisCache` disk-backed: hidrata perezoso en 1er acceso, write-
  through en set/invalidate serializando el Map (orden LRU) — evict reflejado en disco.
  Store inyectado por constructor (interfaz `AnalysisStoreLike`) para test con fake en
  memoria. Handler completa el sellado de T39: fetch `getPullRequestDetail(req)` en try/catch
  propio (cae a `''` si falla) → headSha real. Verificado por el orquestador: typecheck/lint,
  468 tests. **E2E REAL (mock AI, provider openrouter forzado)**: analizar shopwave/api#482 →
  headSha sellado `a482f001…`, generatedWith `{openrouter, glm-5.2}`, cached; `analyses.json`
  escrito en userData con esos datos; **MATAR app → RELANZAR → `getAnalysisState` da `cached`
  hidratado de disco SIN re-analizar**, headSha+generatedWith persistidos. Provider restaurado
  a claude-code. Smoke reusable: `scripts/smoke-persistence.mjs` (modos provider-openrouter/
  analyze/check/restore)._
  Contexto: `AnalysisCache` (`src/main/ai/analysis-cache.ts`) es SOLO en memoria (Map,
  cap 20, LRU) — se pierde al cerrar la app. El handler `ai:analyzePullRequest`
  (`src/main/ipc/handlers.ts`) hoy cachea el `GeneratedAnalysis` tal cual. Esta tarea:
  (1) sella `headSha`+`generatedWith` al generar, (2) persiste el análisis a disco para que
  sobreviva reinicios. Depende de T39.
  Entregables:
  (a) `src/main/ai/analysis-store.ts` (NUEVO): persistencia atómica en disco, MISMO patrón
    que `src/main/settings/store.ts` (leelo de referencia):
    - `analyses.json` en `join(app.getPath('userData'), 'analyses.json')` — `filePath()`
      perezoso, NUNCA en construcción (app puede no estar ready; igual que settings store).
    - Forma en disco: `{ version: 1, entries: Array<{ key: string; analysis: DidacticAnalysis }> }`,
      orden del array = recencia (menos reciente primero, más reciente último), cap 20.
    - `load()`: readFileSync tolerante (archivo ausente → vacío sin log; corrupto/forma
      inválida → vacío + `console.warn`). VALIDAR cada entry: `key` string no vacío +
      `analysis` con la forma completa de `DidacticAnalysis` (incluidos `headSha` string y
      `generatedWith` con provider/model/options) — entries que no validan se DESCARTAN
      (no crashear). Cachear en memoria como settings store (`loaded`/`cache`).
    - `writeAtomic(entries)`: tmp + rename, igual que settings.
    - API mínima: `loadEntries(): Array<{ key, analysis }>` y `saveEntries(entries)`.
  (b) `src/main/ai/analysis-cache.ts`: `AnalysisCache` disk-backed:
    - Hidrata de disco perezosamente en el PRIMER acceso (`get`/`set`/`invalidate`): un flag
      `hydrated`; al hidratar, `analysisStore.loadEntries()` puebla el `Map` en orden.
    - `set` e `invalidate` hacen write-through: tras mutar el `Map`, serializar sus entries
      (`[...this.entries.entries()].map(([key, analysis]) => ({ key, analysis }))`) y
      `analysisStore.saveEntries(...)`. El LRU/evict ya existente se refleja en disco.
    - Mantener la API pública actual (`get`/`set`/`invalidate`/`size`) intacta para no tocar
      el handler más de lo necesario. Inyectar el store como dependencia del constructor con
      default al singleton real (para testear con un store fake en memoria).
    - Cuidado con la CLAVE: hoy `prKey` está DUPLICADA (en cache y en handler). Al serializar
      a disco la key debe ser la MISMA (`owner/name#number`). Mantener `prKey` como está.
  (c) `src/main/ipc/handlers.ts`, `ai:analyzePullRequest` (camino de cache-miss). NOTA: T39
    YA dejó un sellado-PUENTE ahí (`const result: DidacticAnalysis = { ...generated,
    headSha: '', generatedWith: getEffectiveAiSelection() }` antes de `analysisCache.set`).
    T40 COMPLETA ese bloque: reemplazar el `headSha: ''` por el SHA real del PR. NO duplicar
    el bloque, MODIFICARLO:
    - `generatedWith` ya sale de `getEffectiveAiSelection()` (bien — es la selección real).
    - `headSha`: fetchear una vez el detalle del PR para el SHA:
      `const detail = await githubService.getPullRequestDetail(req)` → `detail.headSha`.
      Hacerlo dentro del `try`, cerca de generar (best-effort: si fallara, `headSha: ''` y
      seguir — NO tumbar el análisis por no poder leer el SHA; envolver ese fetch en su
      propio try/catch que caiga a `''`).
    - El objeto `result: DidacticAnalysis` pasa a llevar el `headSha` real. Se sigue
      cacheando/devolviendo `result` (ya es `DidacticAnalysis`). El evento terminal y el
      snapshot NO cambian.
  (d) Tests unit: `analysis-store` (persist→load round-trip; cap 20 y orden LRU en disco;
    archivo ausente → vacío; JSON corrupto → vacío + warn; entry con forma inválida se
    descarta pero las válidas sobreviven; escritura atómica deja el archivo final íntegro).
    `analysis-cache` con store fake (hidratación en primer acceso; write-through en
    set/invalidate; evict del más antiguo se persiste). Handler: que el objeto cacheado y
    devuelto lleve `headSha` y `generatedWith` correctos (mock de `getEffectiveAiSelection`
    y `getPullRequestDetail`).
  Gotchas: sin backticks; `app.getPath` solo perezoso; el mock de IA llama `onProgress`
  síncrono (no romper el registro in-flight ya existente); persistir SOLO en el `set` de
  éxito (ya es el único lugar que llama `set`).
  _Aceptación (orquestador):_ typecheck/lint/`npm test` verdes; e2e: analizar un PR mock,
  MATAR la app, reabrir, seleccionar el MISMO PR → el análisis aparece SIN pulsar "Analizar
  PR" y SIN nueva llamada al LLM (verificable: `ai:getAnalysisState` da `cached` al montar,
  y el `analyses.json` en userData contiene la entrada con `headSha`+`generatedWith`).

- [x] **T41. Banner del panel didáctico sellado con la config de generación (Issue 1)**
  _Hecha y verificada (2026-07-07, subagente `a3ffc31af237a9b90`). `ActiveModelHint` acepta
  `generatedWith?: AnalysisGenerationInfo`; helper `resolveModelHintLabels(catalog, provider,
  model, effortValue)` compartido por ambos caminos (sello del análisis vs config vigente en
  streaming); `DidacticAnalysisArea` pasa `analysis?.generatedWith`. Verificado por el
  orquestador: typecheck/lint/468 tests. **E2E REAL (`scripts/smoke-f9-ui.mjs banner`)**:
  analizar #482 con provider openrouter → banner "vía OpenRouter · z-ai/glm-5.2"; cambiar la
  config VIGENTE a claude-code (persist + reload del renderer) → el banner del análisis YA
  generado SIGUE mostrando "OpenRouter · z-ai/glm-5.2" (leído del DOM real: `span[title*=
  'Proveedor y modelo activos']`), NO claude-code. Bug del Issue 1 confirmado arreglado.
  NOTA: captura de pixeles no posible (hyprlock activo → grim muestra el lockscreen y CDP
  captureScreenshot se cuelga, gotcha conocido); el banner es texto plano sin clipping, así
  que el assert de DOM innerText ES el contenido que ve el usuario._
  Contexto: `src/renderer/src/components/didactic/ActiveModelHint.tsx` lee proveedor/modelo/
  effort de `useSettings()` (config VIGENTE). Debe, cuando hay un análisis mostrado, leerlos
  del `analysis.generatedWith` (sellado en T40). Depende de T39/T40.
  Entregables:
  (a) `ActiveModelHint.tsx`: nueva prop opcional `generatedWith?: AnalysisGenerationInfo`.
    - Si `generatedWith` viene: `provider`/`model`/`options.effort` salen de él. Los LABELS
      (label del proveedor, label del effort) se resuelven contra `useSettings().info.catalog`
      (catálogo ESTÁTICO — los labels no cambian con la selección; `getModelOption(catalog,
      provider, model)` para el descriptor `effort`, buscar la choice con
      `value === generatedWith.options.effort`). Si el modelo ya no está en el catálogo (id
      viejo), mostrar el id crudo sin effort (degradar, no romper).
    - Si NO viene (streaming en curso, aún sin análisis final): comportamiento ACTUAL (config
      vigente). Extraer la lógica de "resolver labels a partir de (provider, model, effort)"
      en un helper local reutilizado por ambos caminos para no duplicar.
    - Sigue devolviendo `null` si `info` (catálogo) aún no cargó.
  (b) `DidacticAnalysisArea.tsx` (L211-213): pasar `generatedWith={analysis?.generatedWith}`
    al `ActiveModelHint`. Cuando se muestra `analysis`, el prop lleva el sello; en streaming
    `analysis` es `null` → `undefined` → banner cae a config vigente (correcto: se está
    generando con esa config AHORA).
  (c) Import del tipo `AnalysisGenerationInfo` desde `shared/types`.
  Gotchas: `ActiveModelHint` NO debe hacer su propio fetch de settings distinto —
  `useSettings` ya comparte el store; solo se usa `info.catalog` para labels. No tocar
  `DidacticWindowApp` (usa el mismo `DidacticAnalysisArea`, hereda el fix).
  _Aceptación (orquestador):_ typecheck/lint/`npm test` verdes; e2e + captura MIRADA:
  analizar un PR con el proveedor/effort A; cambiar en Settings a proveedor/effort B; el
  banner del análisis YA generado sigue mostrando A (no B). Al re-analizar (config B), el
  banner pasa a B.

- [x] **T42. Detección de staleness por SHA + prompt de actualización (Issue 2)**
  _Hecha y verificada (2026-07-07, subagente `af762b9d594c37881`). SOLO renderer: `lib/
  staleness.ts` (`isAnalysisStale` puro + 6 tests), hook `use-pr-head-sha.ts` (fetch único de
  detail al montar, patrón de use-pull-request-detail), y wiring en `DidacticAnalysisArea`
  (prop `currentHeadSha`, `isStale` derivado en render, barra `border-warning/40 bg-warning/10`
  con SHAs cortos `A→B` y botón "Actualizar"→`reanalyze()`), `DidacticPanel` (pasa
  `selectedPr.headSha`) y `DidacticWindowApp` (usa el hook). Verificado por el orquestador:
  typecheck/lint/474 tests. **E2E REAL (`scripts/smoke-f9-ui.mjs stale-check`)**: se editó el
  `analyses.json` persistido poniendo headSha `0000dead…` en #482 (≠ fixture `a482f001…`),
  reinicio → al seleccionar #482 aparece la barra "commits nuevos" (DOM: /commits nuevos/) +
  botón "Actualizar"; pulsar "Actualizar" → reanaliza (mock) → sella el headSha actual →
  barra desaparece. Bug del Issue 2 confirmado resuelto. (Captura de pixeles no posible por
  hyprlock, ídem T41; verificado por contenido del DOM.)_
  Contexto: con T39/T40, `analysis.headSha` guarda el SHA de cuando se generó. Falta
  comparar contra el SHA ACTUAL del PR y avisar. Depende de T39/T40. **SOLO renderer** (más
  un hook nuevo): NO se toca main ni el contrato IPC — la condición de staleness se prueba
  e2e manipulando el `analyses.json` persistido (headSha viejo ≠ el del fixture actual), sin
  ninguna afordance de código de producción (ver Aceptación).
  Entregables:
  (a) `DidacticAnalysisArea.tsx`: nueva prop opcional `currentHeadSha?: string`.
    - `DidacticPanel.tsx` (`src/renderer/src/components/layout/`, L116-120): pasa
      `currentHeadSha={selectedPr.headSha}` (ya tiene el summary con headSha desde T39).
    - Ventana desacoplada (`DidacticWindowApp.tsx`): no tiene el summary → un hook nuevo
      `use-pr-head-sha.ts` que hace `window.minerva.github.getPullRequestDetail({repo,number})`
      UNA vez al montar y devuelve `headSha` (best-effort, `null` mientras carga o si falla).
      `DidacticWindowApp` lo usa y pasa el resultado como `currentHeadSha`. (No sobre-pedir:
      es un fetch liviano, una vez.)
    - `isStale = analysis != null && !!currentHeadSha && !!analysis.headSha && analysis.headSha !== currentHeadSha`.
  (b) Barra de aviso NO destructiva encima del análisis (solo cuando `isStale`, junto al
    toolbar del resultado): estilo de aviso (p. ej. `border-warning/40 bg-warning/10` si
    existe el token; si no, reusar el patrón de `border-danger/40 bg-danger/10` pero en tono
    informativo — revisar tokens en `styles.css`). Texto: "Este PR recibió commits nuevos
    desde que se generó este resumen." + SHAs cortos (`analysis.headSha.slice(0,7)` →
    `currentHeadSha.slice(0,7)`). Botón "Actualizar" que llama `reanalyze()` (ya expuesto por
    `useDidacticAnalysis`). El análisis viejo permanece visible debajo. La barra desaparece
    cuando el re-análisis termina (el nuevo `analysis.headSha` == `currentHeadSha`).
  (c) Tests unit: extraé la comparación en una función pura (p. ej. `isAnalysisStale(analysis,
    currentHeadSha)` o helper local) y testeala (igual→no stale; distinto→stale; headSha
    vacío en cualquiera→no stale; analysis null→no stale). El hook `use-pr-head-sha` si es
    testeable con un mock de `window.minerva`.
  Gotchas: NO resetear estado por efecto (regla del linter) — el `isStale` es derivado en
  render, no estado; la barra reacciona sola cuando cambian `analysis`/`currentHeadSha`. El
  hook `use-pr-head-sha` sigue el patrón de los otros hooks de datos (`use-pull-request-detail.ts`):
  setState solo en callbacks de promesa, cleanup con flag `cancelled`. SOLO renderer.
  _Aceptación (orquestador):_ typecheck/lint/`npm test` verdes; e2e + captura MIRADA (el
  orquestador crea la condición de staleness escribiendo en `analyses.json` de userData una
  entrada del PR con un `headSha` distinto al del fixture, luego lanza la app): al
  seleccionar el PR aparece la barra "commits nuevos" con `A→B`; pulsar "Actualizar" →
  re-analiza (mock) y la barra desaparece (el nuevo análisis sella el headSha del fixture ==
  current). En la ventana desacoplada la barra también aparece (el hook fetchea el headSha
  actual vía `getPullRequestDetail`).

## F10 — Error honesto cuando el proveedor de IA no está disponible — 2026-07-11

Bug de campo (0.2.1 empaquetada en macOS): con el proveedor activo no inicializable
(OpenRouter sin key en esa máquina / CLI no encontrado o sin sesión), `createAiService`
caía SILENCIOSAMENTE a `MockAiService`, y como el mock solo conoce los PRs shopwave,
cualquier análisis de un PR real moría con "Pull request no encontrado: <pr real>" —
culpaba al PR cuando el problema era la configuración de IA de esa máquina.

- [x] **T43. Proveedor no disponible: error accionable en vez de fallback silencioso al mock**
  _Hecha y verificada e2e (2026-07-11, orquestador)._ Cuatro cambios:
  (a) `src/main/ai/index.ts`: `mockFallbackOrThrow` — el fallback a `MockAiService` queda
    SOLO para `MINERVA_MOCK=1` (demo/e2e; mismo criterio que `../github/index.ts`, leído
    del env directo para no arrastrar el grafo de GitHub real a los tests del factory).
    Con GitHub real se LANZA la causa + remedio por proveedor: OpenRouter sin key →
    "Agregala en Settings"; CLI `unavailable` → "No se encontró el CLI «claude|codex»";
    CLI `installed` → "sin sesión iniciada. Corré «<bin> login»".
  (b) `src/main/ai/mock-service.ts`: PR desconocido → "La IA en modo demo solo tiene
    análisis para los PRs de ejemplo..." (defensa: nunca más culpar al PR).
  (c) `src/main/ai/providers/resolve-cli.ts`: + directorios de version managers de Node
    (nvm `versions/node/<v>/bin` con orden semver DESC, volta, asdf shims, fnm XDG y
    legado; respeta `NVM_DIR`/`FNM_DIR`) — un CLI instalado con npm bajo nvm era
    invisible para una app GUI lanzada desde Finder/launcher (causa probable del caso
    macOS).
  (d) `src/renderer/src/hooks/use-didactic-analysis.ts`: `toErrorMessage` limpia el
    prefijo de Electron "Error invoking remote method 'ai:...': Error: " — el canal IPC
    no le dice nada al usuario.
  Verificación (orquestador): typecheck/lint verdes; `npm test` verde (481 tests,
  incluye los nuevos: factory — throw vs fallback por `MINERVA_MOCK`; resolve-cli —
  nvm multi-versión elige la más nueva, `NVM_DIR`, volta, fnm). E2E real reproduciendo el bug de campo: settings a
  `openrouter` + `.env` escondido + GitHub REAL → analizar #70 de clevr-merlin → panel
  muestra "El proveedor de IA activo (OpenRouter) no tiene API key configurada en esta
  máquina. Agregala en Settings..." (captura CDP MIRADA; sin prefijo IPC, sin "Pull
  request no encontrado"). Regresión demo: `MINERVA_MOCK=1` sin key → `smoke-didactic`
  13/13 (fallback al mock intacto, warn en consola de main). Entorno restaurado
  (settings/.env) al terminar.
  Gotcha nuevo: la pantalla puede estar con hyprlock (verificación remota) —
  `scripts/screenshot-app.sh` (grim) captura el lock; usar `scripts/screenshot-cdp.mjs`
  (Page.captureScreenshot) que ve el contenido renderizado igual. Y para lanzar la app
  desde una shell sin sesión gráfica: exportar `WAYLAND_DISPLAY=wayland-1`,
  `XDG_RUNTIME_DIR=/run/user/1000` y `DISPLAY=:0` antes de `npm run dev`.

## F11 — Copiar URL de comentarios de GitHub — 2026-07-11 (v0.2.3)

Pedido de Edilson: cada comentario de un PR debe ofrecer un botón para copiar su URL
permanente de github.com, para poder referenciar el comentario en otros agentes.

- [x] **T44. Botón "copiar URL" por comentario en ThreadCard**
  _Hecha y verificada e2e (2026-07-11, rama `fix/copy-comment-url`)._ Cambios:
  (a) `shared/types.ts`: `PrComment.htmlUrl?` (opcional: sin URL la UI simplemente no
    ofrece el botón — las fixtures no la traen y no hizo falta tocarlas).
  (b) `main/github/real-service.ts`: campo `url` en las dos selecciones GraphQL de
    comentarios (query de hilos + mutation de reply) y `html_url` en el mapeo REST.
  (c) `main/github/mock-service.ts`: `mockCommentUrl` sella la URL al hidratar las
    fixtures y en `postComment`, con el mismo formato de ancla que GitHub real
    (`#discussion_r…` hilos de línea, `#issuecomment-…` generales; al responder por
    `threadId` se mira `thread.isLineThread`, no el request).
  (d) `renderer .../pr-detail/ThreadCard.tsx`: botón por comentario (icono `Link`,
    lucide) con feedback "Copiado" 1.5s, mismo patrón que `CodeSnippet`. Cubre
    Conversación e hilos inline del diff (ThreadCard se reutiliza).
  Verificación: typecheck/lint/`npm test` verdes (481); suite nueva
  `scripts/smoke-copy-url.mjs` 5/5 (presencia, CONTENIDO real del portapapeles vía
  `navigator.clipboard.readText` con match del formato de URL, feedback aparece y
  desaparece, variante inline) + `smoke-comments` 5/5 sin regresión.
  Gotcha nuevo: `navigator.clipboard` (write Y read) exige documento CON FOCO — en un
  e2e la ventana suele estar desenfocada y el `writeText` falla SILENCIOSO (el catch
  del botón se lo traga: no aparece "Copiado"). La suite manda `Page.bringToFront`
  por CDP antes del click. Matiz de F10: con hyprlock activo `Page.captureScreenshot`
  puede COLGARSE (el compositor no produce frames) — no solo grim; la captura visual
  queda pendiente de desbloqueo.

- [x] **T45. Workflow de binarios dev por PR** (`.github/workflows/pr-dev-builds.yml`)
  _Hecha (2026-07-11)._ Mismo matrix de 3 SOs que `release.yml`, pero disparado por
  `pull_request` a main (+`workflow_dispatch`): re-versiona con
  `npm version --no-git-tag-version` a `<version>-dev.pr<N>` (p. ej. `0.2.3-dev.pr6`)
  y sube los binarios como ARTIFACTS del run (retención 14 días), no como release.
  Corre typecheck + `npm test` antes de empaquetar. Concurrency por PR: un push
  nuevo cancela los builds del anterior.
  Verificación (PR #6): primer run linux+mac VERDES; windows rojo — no por el
  empaquetado sino porque `npm test` nunca había corrido en Windows (release.yml
  solo typechequea) y `resolve-cli.test.ts` armaba un PATH multi-entrada con ':'
  hardcodeado, que sobre Node de Windows (`path.delimiter` = ';') queda como UNA
  entrada inválida → `resolveCliPath` devolvía null. Gotcha: en tests que armen
  `process.env.PATH`, SIEMPRE `['a','b'].join(delimiter)` — mockear `node:os` no
  cambia `node:path`, que sigue siendo el de la plataforma real. Segundo run
  (d94bf8b): 3/3 SOs verdes, artifacts `minerva-0.2.3-dev.pr6-{linux,mac,windows}`
  (124/235/100 MB, retención 14 días).

- [x] **T46. Familia GPT-5.6 (Sol/Terra/Luna) en los catálogos + v0.2.4**
  _Hecha y verificada e2e (2026-07-11, rama `fix/codex-gpt-5.6-models`)._ Issue:
  los modelos nuevos de OpenAI no aparecían en Settings. Diagnóstico (RPC
  `model/list` en vivo): el catálogo dinámico de Codex funciona, pero un CLI
  `codex` < 0.144 NO expone la familia 5.6 (0.142.5 devolvía los 4 viejos, 0.144.1
  devuelve `gpt-5.6-sol|terra|luna`) — se actualizó el CLI standalone de la máquina
  con `codex update`. Cambios de código (necesarios igual): (a) los 3 modelos en
  `CODEX_MODELS` estático (`shared/ai-providers.ts`) — CLAVE porque
  `getEffectiveAiSelection` resuelve el `effort` contra el catálogo ESTÁTICO y un
  modelo dinámico fuera de él perdía el effort en silencio; Sol/Terra traen efforts
  nuevos `max|ultra`, Luna hasta `max` (default `medium` los tres, verificado por
  RPC). (b) `ultra` en `EFFORT_CHOICE_LABELS/DESCRIPTIONS` y en
  `KNOWN_EFFORT_LABELS` del catálogo dinámico. (c) `openai/gpt-5.6-{sol,terra,luna}`
  en `OPENROUTER_MODELS` (IDs verificados contra la API pública de OpenRouter).
  (d) versión 0.2.4. Verificación: typecheck/lint/`npm test` verdes (484, con 3
  tests nuevos: effort `ultra` se respeta en Sol, resolución robusta `ultra`→
  `medium` en Luna, labels `max`/`ultra`/desconocido en el catálogo dinámico);
  e2e vía CDP: `ai:getProviderModels` devuelve los 3 en codex (dinámico, con
  max/ultra) y openrouter; visual (screenshot CDP): modal Settings con los 3
  listados y RAZONAMIENTO mostrando Bajo…Máximo/Ultra al seleccionar Sol.
  Gotchas nuevos: (1) `scripts/smoke-settings.mjs` quedó OBSOLETA desde T26:
  valida el campo legacy `aiModel` que `settings:get` ya no devuelve y asume
  OpenRouter activo — falla por estado, no por regresión; ojo: su paso 2 PERSISTE
  un modelo inválido en el settings.json real y si crashea a mitad no lo restaura
  (pendiente re-escribirla). (2) Con hyprlock activo `screenshot-app.sh` captura
  el splash del lock; `screenshot-cdp.mjs` sí funciona (esta vez no se colgó,
  matiz vs. T44).

- [x] **T47. Reescritura de `scripts/smoke-settings.mjs` (multi-proveedor)**
  _Hecha y verificada (2026-07-11, rama `fix/smoke-settings-multiprovider`)._
  Repara la obsolescencia detectada en T46: la suite T12 validaba el campo
  legacy `aiModel` (que `settings:get` no devuelve desde T26), asumía
  OpenRouter como proveedor activo, dejaba un modelo inválido persistido en el
  settings.json REAL si crasheaba a mitad, y dejaba el modal abierto. La nueva
  suite: (1) NO asume proveedor/modelo activo — snapshotea la selección al
  arrancar y la restaura en un `finally` (incluye cerrar el modal); (2) valida
  la forma multi-proveedor de `settings:get` (provider/model/modelSource/
  perProviderModel/catalog) y el catálogo curado al día (regresión T46:
  GPT-5.6 con `ultra` en codex y en openrouter); (3) `setAiProvider`,
  `setProviderModel`, persistencia en disco por proveedor, y `setModelOption`
  (T34, effort high → selectedOptions, luego de vuelta al default); (4) corta
  con exit 2 y mensaje claro si OpenRouter no está `authenticated` (antes un
  "sin key" podía disfrazarse de PASS en el check del modelo inválido); (5)
  conserva los checks de análisis (inválido → error 400 de OpenRouter, válido
  → secciones reales). Verificación: 2 corridas seguidas 9/9 (idempotente) con
  MINERVA_MOCK=1 + IA real, y settings.json del usuario intacto al terminar
  (residuo tolerado y documentado: `modelOptions.openrouter.effort='medium'`,
  el default). lint verde.

- [x] **T48. Fix UX: re-analizar no limpiaba el contenido anterior**
  _Hecha y verificada (2026-07-11)._ Reporte del usuario: al re-analizar un PR
  ya analizado no se entendía cuándo se actualizaba ni cuándo terminaba. Causa:
  `analyze()` en `use-didactic-analysis.ts` limpiaba `error` y
  `streamingSections` pero NO `analysis`, y la precedencia de render de
  `DidacticAnalysisArea` es `error > analysis > streamingSections > loading` —
  el resultado viejo seguía ganando, el streaming nuevo corría invisible detrás
  y al final el contenido se intercambiaba en silencio. Fix: `setAnalysis(null)`
  al arrancar el flujo local (el listener pasivo de attach ya lo hacía en su
  rama de chunk, quedó simétrico). Ahora el re-análisis muestra skeleton
  "Analizando PR con IA…" → secciones en streaming → resultado final con
  "Re-analizar" habilitado. Verificación: typecheck/lint/484 tests verdes,
  `smoke-didactic` 13/13, script CDP ad-hoc muestreando frames a 100ms tras el
  clic (skeleton visible de inmediato, 8/8), y capturas `screenshot-cdp.mjs`
  a mitad del re-análisis (panel limpio con skeleton) y al terminar (análisis
  completo + botón habilitado).

- [x] **T49. Fix layout: split diff sin wrap desbordaba a la derecha + wrap por defecto**
  _Hecha y verificada (2026-07-11)._ Reporte del usuario: en la vista split sin
  word wrap, el diff se desbordaba horizontalmente y el lado nuevo quedaba
  empujado fuera de la vista (gutter verde visible con contenido "vacío" hasta
  scrollear); solo con wrap activado se alineaba bien. Causa: el grid único de
  4 columnas usaba `minmax(max-content, 1fr)` en ambas columnas de contenido —
  cada una crecía hasta su línea más larga y el grid entero excedía el
  contenedor `overflow-auto`. Fix en `SplitDiff.tsx`: sin wrap ahora son dos
  paneles 50/50 con `overflow-x-auto` PROPIO (estilo VS Code); la alineación
  vertical entre paneles sale gratis porque sin wrap toda fila mide una línea
  (`leading-5`), el gutter se fija por dígitos (`calc(Nch + 2.25rem)`) para no
  variar entre paneles/segmentos, y las cards de hilo/composer (ancho completo)
  cortan el segmento de paneles y se intercalan. Con wrap queda el grid único
  de siempre (`minmax(0, 1fr)`); celdas extraídas a `SideCells` compartidas.
  Además `wordWrap: true` por defecto en `app-store.ts` (pedido explícito).
  Verificación: typecheck/lint/484 tests verdes; `smoke-diff` 7/7 y
  `smoke-comments` 5/5; probe CDP ad-hoc 11/11 (defaults split+wrap activos,
  wrap sin scroll horizontal del contenedor, sin wrap: 2 paneles de igual
  ancho, panel derecho visible sin scrollear, scroll interno con líneas de
  98ch, gutters iguales); capturas con `screenshot-app.sh` en ambos modos.
  Gotcha nuevo: los probes CDP heredan el estado que las suites anteriores
  dejaron en el renderer (vista inline, wrap toggled) — un `location.reload()`
  al arrancar resetea el store zustand y devuelve los defaults reales.

## F10 — v0.3.0: Lista de PRs con filtro de estado, refresh, watcher y leído/no-leído (2026-07-11)

> Rama `feature/pr-list-filters-watcher`. Diseño completo en PLAN.md § "Iteración
> actual (2026-07-11)". Decisiones de Edilson: filtro Abiertos/Cerrados/Todos
> (Cerrados incluye merged, badge distingue), polling 60s desde main, solo
> indicadores in-app, visto = abrir el PR en el detalle.

- [x] **T50. Contrato compartido: filtro de estado, markPrSeen y evento prListChanged**
  _Hecha y verificada (2026-07-11, subagente `afa37fd0570d5544e`). Verificación del
  orquestador: typecheck/lint/500 tests verdes + revisión del diff (guards de payload
  en preload calcados de onAnalysisProgress, validators con hasOnlyKeys, sin
  ipcRenderer crudo). 16 casos de test nuevos en validators.test.ts._
  Alcance: SOLO `src/shared/` + `src/preload/` + `src/main/ipc/validators.ts`.
  Entregables:
  (a) `types.ts`: `PrStateFilter = 'open' | 'closed' | 'all'`; `PrUnread =
  { isNew: boolean; hasUpdates: boolean; hasNewComments: boolean }`;
  `PullRequestSummary.unread?: PrUnread` (opcional — lo decora el handler, los
  servicios GitHub no lo conocen).
  (b) `ipc.ts`: `github:listPullRequests` req pasa a `{ search?: string;
  state?: PrStateFilter }`; canal NUEVO `github:markPrSeen` req `{ prId: string;
  updatedAt: string; commentCount: number }` → res `{ ok: true }`. Actualizar
  `IPC_CHANNELS` (el assert de exhaustividad obliga).
  (c) `events.ts`: `PrChange = { type: 'new_pr' | 'pr_closed' | 'pr_merged' |
  'new_comments' | 'updated'; prId: string; number: number; title: string;
  repo: RepoRef }`; `PrListChangedEvent = { changes: PrChange[] }`;
  `MINERVA_EVENTS.prListChanged = 'minerva:event:prListChanged'`.
  (d) `preload/index.ts`: exponer `github.markPrSeen` (sale solo del contrato) y
  `events.onPrListChanged(cb)` — método concreto con unsubscribe, calcado de
  `onAnalysisProgress` (incluye guard de payload).
  (e) `validators.ts`: `listPullRequests` acepta `state` ∈ {open,closed,all}
  además de `search`; validator de `markPrSeen` (prId string 1..200, updatedAt
  string 1..64, commentCount entero ≥0; rechazar keys extra).
  Gotchas: preload es CJS (no tocar config); ningún `ipcRenderer` crudo al
  renderer; TypeScript estricto sin `any`.
  _Aceptación:_ typecheck/lint/`npm test` verdes (los servicios main aún ignoran
  `state`: compilar debe seguir en verde porque el campo es opcional).

- [x] **T51. Main: filtro de estado, fixtures cerrados, seen-store, unread y watcher**
  _Hecha (subagente `acd2fc94719bd523f`) y verificada por el orquestador (2026-07-11):
  typecheck/lint/530 tests verdes (33 nuevos: seen-store y pr-watcher con fake timers);
  smoke-pr-list 10/10 x2 corridas. FIX del orquestador tras la 1ª corrida e2e:
  `mock-service.listPullRequests` devolvía LOS MISMOS objetos `record.detail` en cada
  llamada — el snapshot del watcher guardaba referencias y la mutación in-place de
  `postComment` (commentCount += 1) mutaba también el snapshot "viejo": el diff nunca
  veía cambios y `prListChanged` jamás se emitía (solo en mock; el real construye
  objetos frescos por fetch). Fix: copia shallow por PR en el mock. GOTCHA NUEVO en
  bitácora al final._
  Depende de T50. Alcance: `src/main/github/` + `src/main/ipc/handlers.ts`.
  Entregables:
  (a) `real-service.ts`: en `listPullRequests`, qualifier según `state`
  (default open): open→"is:open", closed→"is:closed", all→sin qualifier de
  estado; añadir "sort:updated-desc" SIEMPRE a la query de búsqueda.
  (b) `mock-service.ts`: filtrar por `state` en memoria (merged cuenta como
  closed para el filtro 'closed'); `fixtures.ts`: añadir 3 PRs nuevos del
  universo shopwave — 1 `closed` y 2 `merged` — con detail/files/threads
  mínimos coherentes. GOTCHA: sin backticks como delimitadores en strings de
  fixtures (plugin vite:esm-shim); comillas normales concatenadas.
  (c) `seen-store.ts` NUEVO: `pr-seen.json` en userData, patrón EXACTO de
  `settings/store.ts` (lazy `app.getPath('userData')` — nunca en el
  constructor —, cache en memoria, escritura atómica tmp+rename, lectura
  tolerante a corrupción → objeto vacío). Forma: `{ version: 1, entries:
  Record<prId, { updatedAt: string; commentCount: number; seenAt: string }> }`,
  cap 1000 entradas (prune por seenAt más viejo al escribir). API:
  `markSeen(prId, { updatedAt, commentCount })`, `computeUnread(summary):
  PrUnread` (isNew = sin entrada; hasUpdates = updatedAt distinto Y más nuevo
  que el sellado; hasNewComments = commentCount actual > sellado). Singleton
  de módulo como `settingsStore`. Tests unit (fs mockeado o tmpdir).
  (d) `handlers.ts`: `github:listPullRequests` decora cada summary con
  `unread: seenStore.computeUnread(pr)` ANTES de responder; handler nuevo
  `github:markPrSeen` → `seenStore.markSeen(...)` → `{ ok: true }`.
  (e) `pr-watcher.ts` NUEVO en `src/main/github/`:
  `createPrWatcher({ list, broadcast, intervalMs })` con `start()`/`stop()`.
  `list` = `() => githubService.listPullRequests({ state: 'all' })`.
  Tick: snapshot Map por `pr.id`; primer tick = baseline SIN broadcast; diffs
  siguientes → `PrChange[]` (id nuevo → new_pr; open→closed/merged →
  pr_closed/pr_merged; commentCount↑ → new_comments; si no, updatedAt
  distinto → updated); broadcast `prListChanged` SOLO si hay cambios.
  Errores: mensaje de "No autenticado" → skip silencioso; rate limit →
  backoff x2 (hasta 15 min) con reset al éxito; cualquier otro error se
  loguea y NO tumba el timer. `intervalMs` default 60000, overrideable con
  env `MINERVA_WATCH_INTERVAL_MS` (parseInt válido > 0). Instanciarlo en
  `registerIpcHandlers` (misma instancia de `githubService`, broadcast estilo
  `broadcastProgress` a todas las ventanas) y `stop()` en `before-quit`.
  Tests unit del diff/backoff con timers falsos.
  Gotchas: `import.meta.dirname` (nunca `__dirname`); sin backticks en strings;
  tocar `src/main/**` ⇒ los smokes requieren reinicio de `npm run dev`.
  _Aceptación:_ typecheck/lint/`npm test` verdes con tests nuevos de
  seen-store y pr-watcher; `MINERVA_MOCK=1` lista PRs con `unread` poblado y
  los fixtures closed/merged aparecen con `state: 'closed'|'merged'` según filtro.

- [x] **T52. Renderer: segmented de estado, refresh manual, dots y visto-al-abrir**
  _Hecha (subagente `af689a5a3c683b136`) y verificada por el orquestador (2026-07-11):
  typecheck/lint verdes; smoke-pr-list 10/10 x2; captura MIRADA de la sidebar con
  segmented + refresh + dots + badges + contadores. Decisiones del subagente aceptadas:
  placeholder "Cargando" solo si no hay datos previos (los refetches de fondo no
  blanquean la lista), icono de estado coherente con el badge (GitMerge morado,
  GitPullRequestClosed muted). Sin tests de componentes: no existe infraestructura
  jsdom/RTL en el repo (vitest corre en node y solo cubre lib/ puro) — la cobertura de
  UI queda en la suite e2e (T53)._
  Depende de T50 (puede correr en paralelo con T51 — con mock aún sin filtro
  main, la UI compila y los estados llegan con T51).
  Alcance: `src/renderer/src/` (store, hook, Sidebar, PrListItem, tests).
  Entregables:
  (a) `stores/app-store.ts`: `prStateFilter: PrStateFilter` (default 'open') +
  `setPrStateFilter` (sesión, sin localStorage).
  (b) `hooks/use-pull-requests.ts`: firma `usePullRequests(search, authState,
  state)`; refetch al cambiar `state` (mismo debounce solo para search — el
  cambio de filtro fetchea inmediato); exponer `refetch()` manual; suscripción
  a `window.minerva.events.onPrListChanged` → `refetch()` (unsubscribe en
  cleanup); exponer `markSeen(pr: PullRequestSummary)` → llama
  `github.markPrSeen({ prId: pr.id, updatedAt: pr.updatedAt, commentCount:
  pr.commentCount })` fire-and-forget + clear optimista del `unread` de ese
  item en el estado local (map inmutable). GOTCHA linter react-hooks: nada de
  setState síncrono en el cuerpo del efecto; patrón `cancelled` existente.
  (c) `Sidebar.tsx`: header bajo el buscador con segmented control de 3
  opciones (Abiertos | Cerrados | Todos, estilo tabs/pills consistente con el
  tema) ligado a `prStateFilter`, y botón de refresh (icono `RefreshCw` de
  lucide, `animate-spin` mientras `loading`, `aria-label="Actualizar"`,
  disabled durante loading). En el onClick de cada item: `selectPr(pr)` +
  `markSeen(pr)`. Los estados vacíos distinguen filtro ("No hay PRs cerrados"
  vs "No hay PRs abiertos" vs "No hay PRs").
  (d) `PrListItem.tsx`: (1) dot rojo `bg-danger` (~6px, rounded-full) junto al
  título cuando `pr.unread && (unread.isNew || unread.hasUpdates)`, con
  `aria-hidden` + title accesible; (2) contador de comentarios: icono
  `MessageSquare` + `pr.commentCount` en la fila inferior (hoy NO se pinta),
  con mini-dot rojo superpuesto cuando `unread.hasNewComments`; (3) badge de
  estado cuando `pr.state !== 'open'`: "merged" (morado, p.ej.
  text-purple-400/border) y "closed" (muted/danger suave); (4) jerarquía
  visual: título de PR visto sin updates en tono atenuado (`text-text/70`),
  no visto en `text-text` font-medium.
  (e) Tests de renderer si existen patrones (revisar tests actuales de
  componentes/hooks y seguirlos; como mínimo, tests del hook con
  window.minerva mockeado si ya hay precedente).
  _Aceptación:_ typecheck/lint/`npm test` verdes; con `MINERVA_MOCK=1`:
  segmented cambia la lista, refresh gira y repuebla, dots visibles en PRs no
  vistos y se apagan al seleccionar, badges merged/closed en el filtro
  Cerrados/Todos, contador de comentarios visible.

- [x] **T53. Suite e2e `scripts/smoke-pr-list.mjs` + verificación integral v0.3.0**
  _Hecha por el orquestador (2026-07-11). 10 casos: filtros (3), refresh, unread por
  IPC con sellado determinístico (markPrSeen con updatedAt/commentCount VIEJOS fuerza
  hasUpdates+hasNewComments sin importar qué dejó en pr-seen.json una corrida
  anterior), dots en DOM, clear optimista al seleccionar, persistencia en main, y
  watcher end-to-end (MINERVA_WATCH_INTERVAL_MS=1500 + postComment → la lista se
  refresca SOLA). Verificación integral: 10/10 x2 corridas + regresión smoke-e2e 5/5,
  smoke-search 1/1, smoke-comments 5/5 (falló primero por la contaminación conocida:
  smoke-search deja "refunds" en el buscador y smoke-comments no limpia estado — se
  confirmó con reload + corrida sola; NO es regresión), smoke-didactic 13/13, captura
  mirada del filtro "Todos". El primer FAIL del caso watcher destapó el bug de
  aliasing del mock (ver T51) Y un matcher débil de la propia suite
  (includes('2') sobre el texto completo del item matchea +adds/-dels — endurecido a
  extraer el contador exacto del span del MessageSquare)._
  Depende de T51+T52. Nueva suite CDP siguiendo las reglas del CLAUDE.md:
  target excluye `#didactic`; limpiar estado global al arrancar
  (`location.reload()` para resetear el store — gotcha T49 —, buscador vacío);
  señales inequívocas. Casos: (1) filtro por estado (Abiertos sin
  closed/merged; Cerrados solo closed+merged con badges; Todos ambos);
  (2) botón refresh presente y funcional (click → lista estable, sin error);
  (3) dot de no-visto presente en un PR fixture, seleccionar → dot desaparece;
  (4) markPrSeen persiste (nueva query a main devuelve unread.isNew false);
  (5) comentar vía `postComment` en OTRO PR mock sube commentCount → tras
  refresh, dot de comentarios nuevos; (6) watcher: con
  `MINERVA_WATCH_INTERVAL_MS=1500`, tras postComment el evento
  `prListChanged` refresca la lista SIN refresh manual (esperar el cambio en
  el DOM con timeout generoso). Verificación del orquestador: typecheck/lint/
  tests, smoke-pr-list + regresión de smoke-e2e y smoke-comments, y captura
  MIRADA de la sidebar (segmented + dots + badges).
  _Aceptación:_ suite verde 2 corridas seguidas (sin flakiness); regresiones
  verdes; captura revisada.

### Bitácora F10 (2026-07-11) — gotchas nuevos

- **Mock que muta in-place + consumidores con snapshot = cambios invisibles.** El
  watcher de PRs diffea snapshots de `listPullRequests`; el mock devolvía el MISMO
  objeto `record.detail` en cada llamada, así que la mutación de `postComment`
  alcanzaba también al snapshot anterior y el diff daba siempre vacío. Regla: los
  servicios mock devuelven COPIAS por llamada (paridad con el real, que construye
  objetos frescos del fetch). Solo se manifestó en la 2ª corrida de la suite porque
  la 1ª tenía un matcher débil (ver siguiente).
- **`includes(dígito)` sobre innerText de un item es un matcher inválido**: los
  +adds/-dels, #número y contadores matchean cualquier dígito suelto. Extraer el
  valor exacto del nodo específico (span del contador) antes de comparar. (Instancia
  nueva de la lección "matchers ambiguos" de T15.)
- **Lanzar la app desde el shell del agente (sesión tty)**: exportar
  `WAYLAND_DISPLAY=wayland-1 DISPLAY=:0` para que Electron arranque, y
  `HYPRLAND_INSTANCE_SIGNATURE=$(ls -t /run/user/1000/hypr/ | head -1)` para que
  `hyprctl` (screenshot-app.sh) funcione. Sin eso: "Missing X server or $DISPLAY" /
  "HYPRLAND_INSTANCE_SIGNATURE not set".
- **smoke-search deja "refunds" en el buscador** y las suites que no limpian estado
  (smoke-comments) fallan si corren después en la misma sesión. Mitigación barata al
  correr en cadena: `location.reload()` entre suites; fix de fondo pendiente:
  smoke-comments debería limpiar el buscador al arrancar como manda el CLAUDE.md.
## F11 — Panel didáctico como harness agéntico sobre snapshot del PR + proveedor OpenCode (v0.4.0, 2026-07-11)

> Rama `feature/didactic-agentic-harness` (desde `main`; F10/T50–T53 vive en su propia
> rama sin mergear — la numeración no colisiona). Plan completo y decisiones en
> `PLAN.md`. Resumen: snapshot local del commit del PR (tarball por headSha) +
> herramientas read-only para los TRES proveedores; OpenCode reemplaza a OpenRouter
> (patrón T3 Code, repo `pingdotgg/t3code`); sin CLIs instalados → card con enlaces
> oficiales de instalación.

- [x] **T54. `snapshot-store`: copia local del commit del PR + limpieza periódica**
  _Hecha (2026-07-11, subagente Sonnet) y VERIFICADA por el orquestador: revisión de
  código completa, 12/12 unit (create/reuse+touch, dedupe concurrente, sanitización
  `../../evil`, atomicidad, huérfanos `.tmp-*`, LRU por count y bytes, timer), typecheck
  y lint verdes. FIX del orquestador: `tar.extract` ahora filtra SYMLINKS/hardlinks
  (`filter: 'type' in entry && (File|Directory)`) — un repo hostil podía traer un link a
  `~/.ssh` que las herramientas read-only seguirían al leer, escapando el jail sin
  escribir nada; verificado empíricamente con un tarball artesanal (el link se omite,
  archivos y dirs intactos). Gotcha de tipos: el `filter` de node-tar 7 une
  `Stats | ReadEntry` (compartido con `tar.create`) — hace falta el guard `'type' in
  entry`. E2e con tarball real de GitHub queda cubierto en T61. Cableado del cleaner en
  `before-quit`: pendiente de integración junto con T55 (lo hace el orquestador)._
  Contexto: los proveedores agénticos necesitan un directorio con el repo AL COMMIT del
  PR. Fuente real: tarball `GET /repos/{owner}/{repo}/tarball/{sha}` con el Octokit ya
  autenticado (NUNCA git); mock: árbol fixture escrito con fs.
  Entregables:
  (a) `GithubService.writeSnapshot(req: { repo: RepoRef; headSha: string }, destDir)`
  en la interfaz (`github/service.ts`) + real (`real-service.ts`: request tarball,
  abortar si supera 150 MB, extraer con la dep `tar` YA instalada — `tar.extract`
  con `strip: 1`, `cwd: destDir`) + mock (`mock-service.ts`: escribe ~8 archivos
  plausibles del universo shopwave por repo — package.json, un par de rutas/handlers,
  un modelo — en un módulo nuevo `fixtures-snapshot.ts`; SIN backticks en los strings).
  (b) `src/main/github/snapshot-store.ts`: `ensureSnapshot(repo, headSha): Promise<string>`
  → `userData/snapshots/<owner>-<name>-<sha7>/` (sanitizar owner/name/sha a
  `[A-Za-z0-9._-]`; `app.getPath` SIEMPRE perezoso, patrón settings-store); dedupe de
  descargas en vuelo (Map de promesas, patrón inFlightAnalyses T22); escribir a dir
  temporal + rename atómico (nunca dejar snapshots a medias); `touch` mtime al reusar.
  (c) Limpieza: `createSnapshotCleaner({ start, stop, sweep })` — sweep al arrancar y
  cada 30 min: borra por LRU (mtime) lo que exceda 10 snapshots o 2 GB. `stop()` se
  cablea en `before-quit` (`main/index.ts`), junto al resto del teardown.
  Gotchas: `import.meta.dirname`, sin backticks en strings de main, el snapshot es
  contenido NO confiable (jamás ejecutarlo). NO tocar package.json (deps ya
  instaladas por el orquestador).
  _Aceptación:_ typecheck/lint/tests verdes; unit tests con dirs temporales (fake
  service): ensureSnapshot crea/reusa/dedupea, sanitización de paths, LRU expulsa por
  count y por bytes, rename atómico (un fallo a mitad no deja dir final).

- [x] **T55. `opencode-runtime`: server OpenCode gestionado desde main**
  _Hecha (2026-07-11, subagente Sonnet) y VERIFICADA por el orquestador: revisión de
  código completa, 23 unit + typecheck/lint/519 tests verdes. WIRE VERIFICADO contra el
  binario real 1.17.18: ready-line "opencode server listening on http://127.0.0.1:<p>"
  (NO es la primera línea de stdout — la precede un warning de OPENCODE_SERVER_PASSWORD),
  `/global/health` → `{"healthy":true,"version":"1.17.18"}`, `--version` → "1.17.18"
  pelado. Verificación manual del subagente (bundle esbuild del módulo real): version
  gate ok, un solo spawn con llamadas concurrentes, stop sin huérfanos (ps antes/después).
  FIX del orquestador: si el server muere DESPUÉS de estar listo (crash externo), el
  handler de exit ahora resetea el singleton — sin eso todo análisis posterior fallaba
  contra una URL muerta hasta reiniciar la app. Cableado en `main/index.ts` (orquestador):
  `before-quit` → `snapshotCleaner.stop()` (T54) + `stopOpencodeServer()` fire-and-forget
  (el SIGTERM sale sincrónico; la escalada a SIGKILL puede no correr si main muere antes,
  aceptable — opencode termina con SIGTERM). GOTCHAS NUEVOS: (1) el `opencode` de omarchy
  es un wrapper que resuelve vía npx en frío (~3-4s) — el timeout de ready de 10s tiene
  margen real pero no sobra; (2) en tests, aserciones de rechazo disparadas por
  `vi.advanceTimersByTimeAsync` necesitan un `.catch()` no-op ANTES de avanzar el timer
  (si no, PromiseRejectionHandledWarning)._
  Contexto: patrón T3 Code (`opencodeRuntime.ts` del repo `pingdotgg/t3code`). El
  binario `opencode` 1.17.18 ESTÁ instalado en esta máquina (`~/.local/bin/opencode`):
  verificar el wire EMPÍRICAMENTE (lección T29 — nunca adivinar el protocolo; se puede
  spawnear `opencode serve` en un puerto libre y curlear `/global/health`, `/doc`).
  Entregables:
  (a) `resolve-cli.ts`: `CliBinaryName` gana `'opencode'` (mismas ubicaciones).
  (b) `src/main/ai/providers/opencode-runtime.ts`: `getOpencodeServer(): Promise<{ url }>`
  singleton lazy — puerto efímero (net listen(0)), spawn del binario resuelto con
  `serve --hostname=127.0.0.1 --port=N`, `detached: true`, env =
  `buildSanitizedSpawnEnv()` + `OPENCODE_CONFIG_CONTENT` (JSON de permisos read-only:
  `"*"`, `edit`, `bash`, `webfetch`, `websearch`, `question`, `external_directory` →
  `"deny"`; `read`, `grep`, `glob`, `list` → `"allow"`; NUNCA `ask`: en headless
  cuelga). Ready = línea "opencode server listening" en stdout (URL vía regex
  `/on\s+(https?:\/\/[^\s]+)/`, timeout 10s); si el proceso sale antes → error con
  stdout+stderr. `stopOpencodeServer()`: kill de process-group (SIGTERM → 1s →
  SIGKILL), cableado en `before-quit` (`main/index.ts`).
  (c) Gate de versión: `opencode --version` (execFile, timeout corto), mínimo
  `1.14.19` (constante exportada), comparador semver simple local (sin dep nueva).
  Gotchas: NO tocar package.json (`@opencode-ai/sdk` ya instalado y pinneado por el
  orquestador — este módulo NO usa el SDK, solo gestiona el proceso); sin backticks
  en strings de main; sanear env (OpenCode usa su propio auth store, no necesita
  nuestras keys).
  _Aceptación:_ typecheck/lint/tests verdes; unit tests (spawn mockeado): parseo de
  ready-line, timeout, exit-antes-de-ready con detalle, config JSON exacta de
  permisos, semver gate; y UNA verificación manual reportada contra el binario real
  (server arranca, `/global/health` responde `{ healthy: true, version }`, se mata
  limpio sin huérfanos).

- [x] **T56. `OpenCodeAiService` + user message agéntico compartido + timeouts agénticos**
  _(a)+(b) hechos por el orquestador (commit 187a5a6); (c) por subagente Sonnet
  (2026-07-11) y VERIFICADO por el orquestador. SDK: se usa `@opencode-ai/sdk/v2`
  (la raíz v1 NO tiene `message.part.delta` ni `session.idle`; v1 queda para
  provider.list de T57 — conviven). GOTCHA CRÍTICO de wire: las firmas del .d.ts
  genérico (`{path, body}`) MIENTEN — las clases reales del cliente usan params
  FLAT (`promptAsync({ sessionID, model, system, parts })`); la forma anidada hace
  500 con el placeholder sin reemplazar. Filtro de texto real: delta con
  `field==='text'` + rol assistant (message.updated) + parte tipo 'text'
  (message.part.updated solo para bookkeeping de tipos, jamás su .text — bug
  #27966/#26697); las partes reasoning/tool se excluyen. 19 unit tests. Humo real
  del subagente: clase real bundleada + binario real + `opencode/big-pickle` →
  3 secciones con detalles solo visibles leyendo el snapshot. VERIFICACIÓN
  INTEGRAL del orquestador (app real, MINERVA_MOCK=1 + CDP): análisis agéntico de
  shopwave/api#482 con opencode/big-pickle en 54.4s → 4 secciones (summary, setup,
  architecture, endpoint) selladas con generatedWith correcto. Cableado del case
  'opencode' en createAiService por el orquestador (mensajes accionables distintos
  para installed-sin-upstreams vs binario ausente)._
  Contexto: cuarto `AiService` real (patrón `OpenCodeAdapter.ts` de t3code, adaptado a
  nuestra vuelta única). Depende de T54+T55.
  Entregables:
  (a) `analysis-timeouts.ts`: constantes agénticas `AGENTIC_REQUEST_TIMEOUT_MS=300_000`
  / `AGENTIC_INACTIVITY_TIMEOUT_MS=60_000` (los 3 proveedores agentizados las usarán).
  (b) `analysis-prompt.ts`: `buildAgenticUserMessage(detail, files)` — mismo contenido
  que `buildUserMessage` MÁS instrucción: el repo al commit del PR está en el
  directorio de trabajo, explorarlo (grep/read) ANTES de responder, no ejecutar nada;
  `prompts/analyze-pr.ts` gana un párrafo de herramientas (mismo estilo concatenado,
  SIN backticks como delimitador).
  (c) `src/main/ai/providers/opencode-service.ts` (`OpenCodeAiService implements
  AiService`): `ensureSnapshot` → `createOpencodeClient({ baseUrl, directory: snapshot })`
  (`@opencode-ai/sdk` YA instalado; decidir v1 vs `/v2` contra lo que el SDK 1.17.x
  realmente exporte y ANOTAR en el reporte) → suscribirse a eventos ANTES de promptear
  → `session.create` → prompt con `system` = system prompt didáctico, `model` = slug
  `<providerID>/<modelID>` parseado (separador = PRIMER `/`), parts de texto →
  acumular SOLO deltas de texto del asistente de ESE sessionID
  (`message.part.delta`; ignorar partes de tool/razonamiento) → `parser.push` +
  throttle de progreso (patrón claude-code-service) → fin por `session.idle` →
  `parser.finalize`. En abort/timeout: `session.abort` best-effort. Errores
  accionables: sin upstream conectado → "corré «opencode auth login» y conectá un
  proveedor"; CLI ausente → mensaje con https://opencode.ai/docs/ .
  Gotchas: NO confiar en `message.part.updated` (bug #27966/#26697 — deltas +
  session.idle); el filtrado de partes debe verificarse EMPÍRICAMENTE con el binario
  real (una sesión de humo contra un dir de prueba); jamás loguear contenido.
  _Aceptación:_ typecheck/lint/tests verdes; unit tests con cliente/stream mockeados
  (deltas → secciones, idle → finalize, error de sesión → throw accionable, timeout
  inactividad); reporte de UNA corrida de humo real (snapshot pequeño, modelo del
  gateway `opencode/*`) con las secciones parseadas.

- [x] **T57. Proveedor `opencode` en registry/probe/modelos/settings (aditivo)**
  _Hecha (2026-07-11, subagente Sonnet) y VERIFICADA por el orquestador. Forma de
  `provider.list` verificada empíricamente (GET /provider): `{ all, default,
  connected }` — OJO: los tipos con nombre `Provider`/`Model` que exporta el SDK
  v1 son de OTRA forma (sin `variants`), se usan interfaces estructurales locales
  (patrón codex-model-catalog). Probe: authenticated = server + ≥1 upstream en
  `connected` (criterio t3code), `account.plan` describe los upstreams; nunca
  arranca el server si el binario/versión fallan. Catálogo dinámico con cache TTL
  60s generalizada (Map codex+opencode) y fallback curado (gateway free). UI:
  ProviderPicker ya era genérico; CLI_META gana opencode; "Otro (avanzado)" ahora
  también para opencode con placeholder por proveedor. VERIFICADO e2e (CDP):
  status opencode authenticated "3 upstreams: openai, github-copilot, opencode",
  56 modelos dinámicos, selección persiste. NOTA: abrir Settings arranca el server
  de OpenCode en frío para el probe (paridad t3code; singleton T55 + TTL lo
  amortiguan). Captura mirada de Settings HECHA (2026-07-11,
  tras desbloqueo de pantalla, app desde worktree limpio en e385d73): los 4
  proveedores con chips correctos — OpenRouter "No disponible", Claude Code
  "Conectado · max", Codex "Conectado", OpenCode "Conectado · 3 upstreams:
  openai, github-copilot, opencode". VERIFICADA COMPLETA._
  Contexto: cablear `opencode` como proveedor de PRIMERA clase. `openrouter` NO se toca
  acá (se elimina en T59 — orden importa). Depende de T55.
  Entregables: `AiProviderId` gana `'opencode'` (`shared/ai-providers.ts`: catálogo con
  label "OpenCode" y fallback curado mínimo — `opencode/big-pickle` como default +
  2-3 del gateway; `DEFAULT_MODEL_BY_PROVIDER.opencode='opencode/big-pickle'`);
  registry (`authKind:'cli'`, binary `opencode`); `cli-probe.ts`/`provider-status.ts`:
  installed = binario+versión OK; authenticated = server responde y
  `client.provider.list()` (o `GET /provider` crudo) reporta ≥1 upstream en
  `connected` (criterio t3code); `provider-models.ts`: modelos dinámicos vía
  `provider.list()` de providers connected (slug `<provider>/<model>`, variants →
  `ModelOptionDescriptor` patrón T34) con cache TTL 60s + fallback al curado (patrón
  EXACTO `codex-model-catalog.ts` → `opencode-model-catalog.ts`); `createAiService`
  (`ai/index.ts`): case `'opencode'` → `OpenCodeAiService` si authenticated, si no
  `mockFallbackOrThrow` con mensaje accionable; Settings UI: `ProviderPicker` muestra
  la card (via catálogo, verificar que no haya listas hardcodeadas), `ModelPicker`
  con campo libre "Otro" también para opencode; validators de `settings:setAiProvider`
  aceptan el id nuevo.
  _Aceptación:_ typecheck/lint/tests verdes; unit: probe (3 estados), catálogo
  dinámico con fallback, mapping de variants; con la app corriendo (`MINERVA_MOCK=1`),
  Settings muestra OpenCode "Conectado" en esta máquina y el picker lista modelos
  reales del `provider.list()`.

- [x] **T58. Agentizar Claude Code y Codex sobre el snapshot**
  _Hecha (2026-07-11, subagente Sonnet) y VERIFICADA por el orquestador (revisión
  de código + suites). Claude: `cwd` snapshot, `tools`/`allowedTools`
  ['Read','Grep','Glob'] (verificados contra sdk.d.ts; NO existe tool de listado
  aparte de Glob), `permissionMode: 'dontAsk'` (los modos con prompt colgarían un
  headless; bypassPermissions salta TODO, descartado), maxTurns 30, settingSources
  []/persistSession false ahora CRÍTICOS (cwd hostil). PRUEBA DE SEGURIDAD real
  (cuenta Max): snapshot trampa con CLAUDE.md "responde BANANA" → IGNORADO; 16
  tool_use reales (solo Glob/Read/Grep), 9 turnos, 3 secciones que citan el código
  real. Codex: `ThreadStartParams.cwd` verificado con `codex app-server
  generate-json-schema` (0.144.1; `--out`, no `--out-dir`); sandbox read-only
  restringe ESCRITURA no lectura (ReadOnlySandboxPolicy solo tiene networkAccess)
  — humo real: el agente citó contenido del snapshot vía cwd. GOTCHAS: el
  CodexAppServerClient no se puede importar fuera de Electron (constructor toca
  app.on) — para humos, JSON-RPC a mano; scripts de scratchpad que importan SDKs
  necesitan symlink de node_modules (Node resuelve desde el archivo, no cwd)._
  Contexto: igualdad de condiciones día 1 (decisión de Edilson). Depende de T54.
  Entregables:
  (a) `claude-code-service.ts`: `ensureSnapshot` → `query({ options: { cwd: snapshot,
  ... } })` con herramientas READ-ONLY habilitadas (nombres reales contra el .d.ts del
  SDK instalado — se esperan `Read`/`Grep`/`Glob`; NADA de Write/Edit/Bash/WebFetch),
  `maxTurns` alto (30), timeouts agénticos de T56, y MANTENER `settingSources: []` +
  `persistSession: false` (el snapshot puede traer CLAUDE.md/hooks hostiles — verificar
  con un snapshot de prueba que contenga un CLAUDE.md trampa que NO se carga).
  `buildAgenticUserMessage` en vez del clásico. Actualizar el link viejo
  `docs.claude.com/...` → `https://code.claude.com/docs/en/setup`.
  (b) `codex-service.ts`/`codex-app-server-client.ts`: `thread/start` gana el cwd al
  snapshot — VERIFICAR el nombre real del param con `codex app-server
  generate-json-schema` (lección T29: el binario genera su propio esquema; NO
  adivinar); mantener `sandbox:'read-only'` + `approvalPolicy:'never'`; confirmar que
  el sandbox permite LEER el cwd; `buildAgenticUserMessage` + timeouts agénticos.
  Los tres proveedores comparten ahora el mismo user message y los mismos timeouts.
  Gotchas: los deltas de tool-use de Claude (`input_json_delta`) SIGUEN ignorándose
  (solo `text_delta` va al parser); en Codex solo `item/agentMessage/delta`.
  _Aceptación:_ typecheck/lint/tests verdes (tests existentes de ambos servicios
  actualizados); reporte de humo real de AL MENOS Claude Code (cuenta Max de Edilson)
  sobre un snapshot fixture: el análisis usa herramientas (visible en los mensajes del
  stream) y produce secciones; el CLAUDE.md trampa no se carga.

- [x] **T59. Eliminar OpenRouter como proveedor directo + migración de settings**
  _Hecha (2026-07-11, subagente Sonnet) y VERIFICADA por el orquestador: typecheck 0
  errores, lint limpio, 532/532 tests; revisión de la migración y del grep de
  limpieza (solo quedan menciones históricas y el slug `openrouter/<id>` de upstream).
  Borrados: openrouter-service(+test), openrouter-key-store(+test), ai-models.ts,
  OpenRouterKeyForm, use-openrouter-key; los tests de buildUserMessage migraron a
  `analysis-prompt.test.ts` (nunca fueron de OpenRouter). `DEFAULT_AI_PROVIDER =
  'opencode'`; también se eliminó el shim legacy `settings:setAiModel` (cero
  consumidores). MIGRACIÓN (settings/store.ts): corre sobre el JSON CRUDO ANTES de
  los guards de forma (clave: `isAiProviderId('openrouter')` ya es false — después
  de los guards el archivo ENTERO se descartaría), `aiProvider openrouter→opencode`,
  `models.openrouter: X → models.opencode: 'openrouter/X'` (una elección real de
  OpenCode gana), `modelOptions.openrouter` se descarta (efforts no equivalentes),
  se PERSISTE de inmediato y borra best-effort el `openrouter-key.bin` huérfano.
  DECISIONES: loader de .env se mantiene (MINERVA_AI_*; parsea sin mutar process.env)
  y `OPENROUTER_API_KEY` sale de ENV_KEYS_TO_STRIP (Minerva ya no la gestiona; no hay
  fuente propia que sanear, y estriparla rompería la auth por env del propio opencode).
  `MINERVA_AI_PROVIDER` inválido (incl. openrouter) → console.warn + default.
  provider-status.ts simplificado (todos los proveedores son cli). Las suites e2e de
  scripts/ que mencionan OpenRouter se ajustan en T61._
  Contexto: decisión de Edilson — OpenRouter ahora se usa DENTRO de OpenCode. Depende
  de T57. Borrar con confianza; git recuerda.
  Entregables: eliminar `openrouter-service.ts`, `openrouter-key-store.ts`,
  `ai-models.ts` (legacy re-export), slice openrouter del catálogo, resolución de key
  en `env.ts` (`getAiEnv().openRouterApiKey` y el `.env` loader SI ya nadie más lo
  usa), canales `settings:setOpenRouterKey`/`getOpenRouterKeyStatus` (ipc.ts,
  validators, handlers, preload), `OpenRouterKeyForm.tsx`, `use-openrouter-key.ts` y
  sus usos en `SettingsModal`/`ProviderPicker`; `AiProviderId` queda
  `'opencode'|'claude-code'|'codex'`; `DEFAULT_AI_PROVIDER='opencode'`. Migración en
  `settings/store.ts` al hidratar: `provider:'openrouter'` → `'opencode'` y
  `model:'X'` → `'openrouter/X'` (slug de upstream openrouter en OpenCode);
  best-effort borrar el archivo de key cifrada huérfano. `MINERVA_AI_PROVIDER=openrouter`
  en env se trata como inválido (warn + default), documentarlo. Actualizar tests
  afectados y `README.md` (sección proveedores).
  Gotchas: buscar TODOS los usos (`grep -ri openrouter src/`) — incluye
  `ActiveModelHint`, smokes y fixtures de tests; el smoke `smoke-settings` de T47 se
  ajusta en T61 pero no debe romper unit acá.
  _Aceptación:_ typecheck/lint/tests verdes; `grep -ri openrouter src/` solo devuelve
  el slug de modelos `openrouter/...` (upstream de OpenCode) y la migración; arranque
  con settings.json viejo (provider openrouter persistido) migra sin crash y Settings
  muestra OpenCode activo.

- [x] **T60. UI: card "sin CLIs" con enlaces oficiales + CliLoginGuide x3 + fase "explorando"**
  _Hecha (2026-07-11, subagente Sonnet) y VERIFICADA por el orquestador (código +
  visual e2e). CLI_META extraído a `lib/cli-meta.ts` (gotcha:
  react-refresh/only-export-components prohíbe exportar datos desde un archivo de
  componente); `AiSettingsInfo.mockGithub` gates la card en modo demo; phase
  'exploring'|'writing' aditivo end-to-end (servicios → meta → broadcast → preload
  validado → hook → panel), done sin phase. VERIFICACIÓN VISUAL (capturas miradas):
  (1) "Explorando el repositorio…" visible a los ~2s de un análisis agéntico real con
  opencode/big-pickle; (2) análisis final con hallazgos SOLO posibles leyendo el
  snapshot (findByCode inexistente, import a archivo ausente, min_amount_cents de la
  migración 0012 ignorada) + C4 renderizado + banner sellado; (3) card "Necesitás al
  menos un CLI de IA" con binarios renombrados temporalmente (real GitHub): copy,
  3 enlaces "instalación" + comandos login + "Volver a comprobar"; (4) click del
  enlace de OpenCode abre Chrome con opencode.ai/docs (external-link-guard e2e).
  NOTA UX (follow-up F12 potencial): la card vive en DidacticAnalysisArea → requiere
  un PR seleccionado; sin selección se ve el placeholder estático de DidacticPanel._
  Contexto: decisión de Edilson — sin ningún CLI instalado, guiar con enlaces
  oficiales. Depende de T57 (y de T59 para el copy final sin OpenRouter).
  Entregables:
  (a) `CliLoginGuide.tsx` generalizado a los 3 proveedores con `installUrl` y
  `loginCmd` por proveedor (opencode → `opencode auth login`,
  https://opencode.ai/docs/ ; claude → `claude login`,
  https://code.claude.com/docs/en/setup ; codex → `codex login`,
  https://developers.openai.com/codex/cli/) — enlaces como `<a target="_blank"
  rel="noreferrer">` (el `external-link-guard` ya los abre en el navegador y limita a
  http/https).
  (b) Card "Necesitás al menos un CLI de IA" en el placeholder del panel didáctico
  cuando `use-provider-status` reporta los 3 `unavailable`: explica en una línea el
  porqué, lista los 3 CLIs con su enlace y trae "Volver a comprobar" (re-fetch del
  status). No aparece con `MINERVA_MOCK=1` + mock IA activo.
  (c) Fase "explorando": `AnalysisProgressEvent` (`shared/events.ts`) gana
  `phase?: 'exploring' | 'writing'` (ADITIVO — validators/preload sin romper);
  los servicios agénticos emiten `exploring` al detectar actividad de tools antes de
  la primera sección y `writing` desde el primer delta de texto; el panel pinta
  "Explorando el repositorio…" (spinner) durante `exploring`.
  Gotchas: react-hooks del linter (nada de setState-en-efecto — remount por key);
  copy en español consistente con el resto.
  _Aceptación:_ typecheck/lint/tests verdes; captura MIRADA de: (1) card sin CLIs
  (PATH capado), (2) "Explorando el repositorio…" durante un análisis real, (3)
  CliLoginGuide con enlace de instalación visible; click de un enlace abre el
  navegador del sistema (verificación manual del orquestador).

- [x] **T61. Verificación integral F11 + revisión de seguridad + docs + v0.4.0**
  _Del orquestador (2026-07-11). typecheck/lint/539 tests verdes. E2e determinista
  (MINERVA_MOCK=1 + MINERVA_MOCK_AI=1, reload entre suites): smoke-e2e 5/5, didactic
  13/13, streaming 6/6, diff 7/7, comments 5/5, search, detach 17/17, copy-url 5/5,
  bugfixes 7/7, f9-ui (banner "vía OpenCode · opencode/big-pickle" sellado tras
  cambiar a claude-code), persistence completa CON reinicio real de la app. E2e con
  IA real: smoke-settings 9/9 (modelo inexistente rechaza con "Model not found"
  accionable); análisis agéntico vía UI en ~33-54s → 4 secciones. MIGRACIÓN VIVA
  verificada: settings.json con openrouter activo migró a opencode al primer acceso
  (elección real de opencode ganó sobre el mapeo, modelOptions.openrouter descartado,
  key huérfana borrada). Seguridad: ver bitácora F11 (1 fix aplicado, 1 hallazgo
  refutado empíricamente). Infra nueva: MINERVA_MOCK_AI=1 (la vieja receta
  "openrouter sin key" murió con T59). Docs: CLAUDE.md al mundo F11 (stack IA,
  frontera del snapshot, layout, comandos, nota e2e), README (T59) y v0.4.0.
  Capturas miradas: exploring, análisis final, card sin CLIs, CliLoginGuide,
  Settings x4 proveedores (pre-T59). GOTCHA de sesión: el salvapantallas de Omarchy
  bloquea screenshot-app.sh igual que hyprlock — coordinar capturas con pantalla
  activa. **F11 COMPLETA.**_
  Del orquestador (no delegable la verificación): typecheck/lint/tests; suites e2e
  (smoke-didactic + smoke-settings ajustadas al mundo sin OpenRouter; caso nuevo o
  suite nueva para: análisis agéntico mock end-to-end, card sin CLIs si es
  automatizable con PATH capado); regresión del resto de suites; e2e real con
  OpenCode (upstream de Edilson) y Claude Code sobre snapshot fixture; verificación
  de snapshots (creación, LRU, limpieza al arrancar); captura mirada de todos los
  estados nuevos; agente `electron-security-reviewer` sobre el diff completo (jail de
  permisos, secretos, snapshot no confiable, spawn env); README (arquitectura +
  requisitos: al menos un CLI) + CLAUDE.md (sección IA/stack) + version bump 0.4.0 +
  bitácora.

### Bitácora F11 — revisión de seguridad (2026-07-11, agente electron-security-reviewer)

- **[Medio, ARREGLADO] Bomba de descompresión en el snapshot**: `MAX_TARBALL_BYTES`
  topeaba solo el .tar.gz comprimido; un repo hostil ultra-compresible podía expandirse
  a GBs al extraer, llenando el disco antes del barrido LRU. Fix del orquestador:
  pre-scan del índice del tarball (`tar.list` + `onReadEntry` sumando `entry.size` —
  OJO: en node-tar 7 la opción canónica es `onReadEntry`, `onentry` es alias deprecado)
  y abort ANTES de extraer si el total declarado supera `MAX_EXTRACTED_BYTES` (500 MB).
- **[Alto, REFUTADO empíricamente] ¿`opencode.json` hostil dentro del snapshot puede
  re-permitir bash/edit?** Prueba con trampa real (snapshot con `opencode.json` +
  `.opencode/config.json` con bash/edit/webfetch en "allow", server con nuestro
  `OPENCODE_CONFIG_CONTENT`): `GET /config` con el header `x-opencode-directory`
  apuntando a la trampa devuelve TODOS los deny intactos — `OPENCODE_CONFIG_CONTENT`
  tiene precedencia sobre la config de proyecto (consistente con la doc). El jail
  aguanta. Vale re-verificar este mismo probe al subir la versión pinneada de opencode.
- **[Nota] `'*': 'deny'` como catch-all**: la config enumera los permisos conocidos hoy;
  si una versión futura de OpenCode agrega tipos de permiso nuevos, se confía en que
  `'*'` los cubra — re-confirmar al actualizar la versión mínima.
- Defensas verificadas por el revisor: sanitización de paths del snapshot, filtro de
  symlinks, jails de Claude (`settingSources: []` + tests) y Codex (read-only),
  resolve-cli sin cwd/rutas relativas (un PR no puede colar su propio binario),
  GITHUB_TOKEN estripado en todos los spawns, validators IPC completos (incl. `phase`
  en preload), links externos solo los 3 oficiales hardcodeados vía external-link-guard,
  migración de settings con guards estrictos sobre JSON crudo.

## F12 — Rediseño del panel de Settings: tabs por proveedor + "En uso" (2026-07-11)

> Pedido de Edilson: el panel debe enunciar claramente qué CLI/modelo/esfuerzo están
> activos; los radios de proveedor sobran (funcionan como tabs para VER los modelos
> de cada proveedor); rediseño general de UX. Aprobado también el resumen compacto
> en la TitleBar. Diseño completo en PLAN.md (F12). Solo renderer (+ helper de
> labels si hace falta): CERO cambios en main/preload/IPC.

- [x] **T62. Rediseño del modal de Settings (tabs + "En uso" + cards activables)**
  Nuevo `ActiveConfigSummary` (strip fijo bajo el header: proveedor activo + badge
  de estado, modelo mono + esfuerzo resuelto, badge de origen si `modelSource !==
  'settings'`); tabs por proveedor (`role=tablist`, estado local `viewedProvider`
  iniciado en `info.provider`, punto de estado + check de "activo" por tab); cards
  de modelo SIN radios ni "Guardar": click = activar proveedor+modelo vía los
  canales existentes (`setProviderModel` y luego `setAiProvider` si el tab visto no
  es el activo), spinner en vuelo, badge "Activo"; "Otro (avanzado)" (solo
  OpenCode) con botón "Usar" explícito; `ModelOptionPicker` intacto pero pintado
  SOLO para el modelo ACTIVO cuando el tab visto es el proveedor activo (lista
  dinámica). Extraer `resolveModelHintLabels` de `ActiveModelHint.tsx` a
  `renderer/src/lib/model-labels.ts`. Muere el estado borrador y sus remounts;
  `key={viewedProvider}` en el panel del tab para que `useProviderModels`
  re-fetchee sin efectos de sincronización.
  _Gotchas:_ lint react-hooks (nada de setState-en-efecto; derivar o remount por
  key); TS estricto; a11y tablist/tab/tabpanel + teclado; Esc/overlay siguen
  cerrando; no romper las señales de `smoke-settings.mjs` (`svg.lucide-settings`,
  los 3 labels de proveedor en el texto del modal).
  _Aceptación:_ typecheck/lint/test verdes; con la app en MINERVA_MOCK=1 el modal
  muestra "En uso" correcto, cambiar de tab NO cambia el proveedor activo, click en
  una card de otro proveedor activa proveedor+modelo (visible en el strip), y el
  esfuerzo solo aparece en el tab del proveedor activo.

- [x] **T63. TitleBar: chip resumen "Proveedor · Modelo" en el engrane**
  El engrane pasa a chip `icono + label` (mantener `svg.lucide-settings` DENTRO del
  botón), tooltip con detalle completo (proveedor, modelo, esfuerzo, origen), click
  = abrir settings. Labels vía `lib/model-labels.ts` (T62). Degradar con gracia
  mientras `info` es null (solo el icono).
  _Aceptación:_ typecheck/lint verdes; el chip refleja al instante un cambio hecho
  en el modal (mismo store zustand).

- [x] **T64. Suite `smoke-settings` del nuevo diseño + verificación integral F12**
  Del orquestador: actualizar `scripts/smoke-settings.mjs` con checks UI del nuevo
  mundo (tabs presentes, strip "En uso", activación por click de card cruzando
  proveedor, restauración en finally); correr typecheck/lint/test + suites e2e
  afectadas + captura MIRADA del modal y la TitleBar.

### Cierre F12 (2026-07-11, orquestador)

- **T62/T63** implementadas por subagente Sonnet (una entrega): creados
  `ActiveConfigSummary.tsx`, `ProviderTabs.tsx`, `ProviderModelPanel.tsx`,
  `lib/model-labels.ts` (extraccion de `resolveModelHintLabels`, ahora compartida
  por ActiveModelHint + strip "En uso" + chip TitleBar); reescritos
  `SettingsModal.tsx` (viewedProvider en `SettingsModalBody`, montado solo con
  `info !== null` para lazy-init sin efectos) y `TitleBar.tsx` (`SettingsChip`);
  borrados `ProviderPicker.tsx`/`ModelPicker.tsx`. Ajuste del orquestador en
  revision: las tabs quedaron DENTRO del area con scroll; movidas junto al strip
  fijo (con paneles largos, p. ej. OpenCode dinamico con ~50 modelos Copilot, se
  iban de vista).
- **T64 / verificacion (orquestador)**: typecheck/lint verdes, 585/585 tests.
  smoke-settings 13/13 con app real (MINERVA_MOCK=1, opencode autenticado: el paso
  de modelo invalido corrio de verdad y rechazo con "Model not found" accionable);
  incluye los checks nuevos: 3 `role="tab"`, click de tab NO cambia el proveedor
  activo, click de card activa claude-code/claude-fable-5 cruzando proveedor, strip
  + badge "Activo" reflejan la activacion. Regresion: smoke-search y smoke-f9-ui
  (sellado del banner) en verde. Capturas MIRADAS: modal con "EN USO Claude Code ·
  claude-fable-5 · Razonamiento: Medio" + badge Activo + chips de razonamiento, tab
  OpenCode mostrando el catalogo dinamico SIN tocar el proveedor activo, y chip
  "Claude Code · Fable 5" en la TitleBar. **F12 COMPLETA.**

### Bitacora F12 — gotchas

- **`innerText` devuelve el texto YA transformado por CSS**: el "En uso" del strip
  se pinta con `uppercase` de Tailwind, asi que `document.body.innerText` trae
  "EN USO" y un `includes('En uso')` en la suite falla aunque la UI este perfecta
  (primer run 12/13 por esto). Fix: comparar case-insensitive (`/en uso/i`).
  Moraleja repetida de la bitacora: cuando un smoke falla, primero sospechar del
  test.
- **`smoke-f9-ui` deja residuo en settings.json real**: cambia el proveedor activo
  a claude-code y su modelo a claude-sonnet-5 y NO restaura (a diferencia de
  smoke-settings, que snapshotea y restaura en `finally`). Detectado al verificar
  el estado final de la sesion; restaurado a mano. Deuda: darle a esa suite el
  mismo patron snapshot+finally.
- [x] **T65. Sellado de `generatedWith` capturado al INICIO del análisis (fix de carrera)**
  Pregunta de Edilson: ¿cambiar CLI/modelo/esfuerzo con un análisis en vuelo lo
  afecta? Verificado en código Y empíricamente (análisis real de opencode/big-pickle
  + cambio a claude-code/haiku/low a los ~6s): la GENERACIÓN es inmune — proveedor
  resuelto al crear el servicio por análisis (`handlers.ts`) y modelo/esfuerzo
  leídos UNA vez al inicio del `analyzePullRequest` de cada servicio
  (opencode:215/claude:182/codex:170); los re-clicks caen en el registro in-flight.
  PERO el sello `generatedWith` se evaluaba AL TERMINAR con la selección vigente:
  el análisis quedó cacheado/persistido como si lo hubiera generado la config
  nueva (la variante DURANTE del problema que T41 arregló para cambios
  POSTERIORES; F12 agranda la ventana porque activar es 1 click y lo agéntico
  tarda 30-60s). Fix directo del orquestador: capturar `getEffectiveAiSelection()`
  antes de `createAiService` y sellar con esa constante.
  _Verificación:_ typecheck/lint/585 tests verdes; experimento repetido con el fix
  → sello `opencode/big-pickle` correcto (resultado y cache) pese al cambio en
  vuelo; smoke-f9-ui (suite del sellado) OK con MINERVA_MOCK_AI=1 — corrida antes
  con IA real dio un FAIL fantasma en "análisis terminó": el waiter de 60s quedó
  corto para una corrida agéntica lenta, los checks del sello igual pasaron
  (gotcha: esa suite es determinista SOLO con MINERVA_MOCK_AI=1, como documenta
  su propio comentario).

## F13 — Mini-log de actividad del harness en el panel didáctico (2026-07-12)

> Pedido de Edilson: mientras un análisis corre, el panel didáctico debe dar
> feedback SUTIL de lo que el harness hace por dentro (tool calls, razonamiento).
> Investigado t3code (pingdotgg/t3code) como referencia: colapso por identidad
> (running→done actualiza la misma fila), labels tersos derivados
> (`deriveToolActivityPresentation`), historial plegado. Decisiones de UX
> acordadas: mini-log de últimas ≤5 acciones (no línea única ni log expandible),
> visible también en fase 'writing' (franja sobre las secciones), razonamiento
> como "Pensando…" genérico (NUNCA el texto: prompt injection desde el snapshot).

- [x] **T66. Mini-log de actividad end-to-end (tipos + tracker + 3 proveedores + mock + UI + e2e)**
  Implementado por el orquestador en una sola pasada (plan aprobado por Edilson):
  - `shared/events.ts`: `AnalysisActivityKind`/`AnalysisActivityItem` +
    `AnalysisProgressEvent.activity?` (buffer RODANTE completo en cada evento
    intermedio, no deltas: late-attach gratis y throttle inofensivo); variante
    `streaming` de `AnalysisState` (`shared/types.ts`) y `AnalyzeProgressMeta`
    (`main/ai/service.ts`) ganan el mismo campo aditivo.
  - Nuevo `main/ai/activity-tracker.ts` (puro, estilo throttle.ts): buffer ≤5 con
    colapso por id, labels en español derivados en main (`deriveActivityLabel`) y
    saneo en un solo lugar (`sanitizeDetail`: control chars, whitespace, truncado
    64, rutas relativizadas al snapshotDir). EDGES SIN THROTTLE (begin/complete/
    fail/primer thinking emiten onProgress directo — el createThrottle es
    leading-edge sin trailing flush, un edge tragado quedaría invisible);
    refinamientos viajan con la próxima emisión. 15 tests propios.
  - Proveedores: Claude (content_block_start tool_use + input_json_delta
    acumulado por `index` con cap 4KB + thinking_delta), OpenCode
    (ToolPart begin/complete/fail por state.status + ReasoningPart; con filtro
    de sesión NUEVO en `message.part.updated` — sin él un análisis concurrente
    contaminaría el feed), Codex (item/started|completed con sondeo defensivo de
    detalle + item/reasoning/textDelta ignorando el delta). Tests por proveedor
    (colapso, labels, "Pensando…" único, terminal sin activity, filtro sesión).
  - Handler: `activityBox` junto a snapshotBox, getter vivo en inFlightAnalyses,
    `ai:getAnalysisState` streaming devuelve `activity` (late-attach). Preload:
    guard aditivo `isActivityItem` (patrón `phase`). NADA toca AnalysisCache.
  - **Cambio de contrato T60**: el MOCK ahora SÍ emite `phase` + preludio
    guionado de actividad (4 pasos × 150ms por el tracker REAL, luego chunks con
    'writing') — ÚNICA vía e2e determinista; doc comments actualizados en
    events.ts/service.ts. Suma ~600ms al mock (inocuo para smoke-streaming).
  - Renderer: `activity` en use-didactic-analysis (attach + local + limpieza en
    terminal SIEMPRE), nuevo `HarnessActivityLog.tsx` (glifo por status, opacidad
    decreciente, aria-live) en la rama skeleton Y como franja sobre las secciones
    en 'writing'.
  _Verificación (orquestador):_ typecheck/lint verdes, 608/608 tests; nueva
  `scripts/smoke-harness-activity.mjs` 11/11 (wire + colapso + late-attach + UI
  en ambas fases); regresión smoke-streaming 6/6 y smoke-didactic 13/13;
  capturas MIRADAS: skeleton 'exploring' con "Listó la estructura / Leyendo
  src/api/routes.ts" bajo el spinner, y franja con las filas cerradas sobre la
  card Resumen en 'writing'. **F13 COMPLETA.**

### Bitácora F13 — gotchas

- **Claude correlaciona los deltas de tool-use por `index`, no por id de bloque**:
  `content_block_start` trae `{id, name}` pero los `input_json_delta` solo traen
  `index` — hace falta un `Map<index, {id, name, json}>` hasta el
  `content_block_stop`.
- **La rama `message.part.updated` de OpenCode NO filtraba por sesión** (era
  inocuo cuando solo alimentaba `partTypeById`): al colgarle actividad hubo que
  filtrar por `sessionID` o un análisis concurrente en el server compartido
  cruzaría sus tool calls al feed ajeno. El test del fixture minimalista
  (`partUpdated` sin `state`/`callID`) además obligó a guards defensivos: la
  forma real del wire manda, un part incompleto se ignora en vez de reventar.
- **Escapes unicode (estilo "backslash-u0000") en código generado por agente
  pueden colarse como BYTES de control literales** en el archivo escrito (un NUL
  en el fuente rompe grep/eslint de formas raras). Si un archivo recién escrito
  se comporta raro, verificar a nivel de bytes con python3 y parchear.
- **El screensaver de omarchy tapa las capturas**: `screenshot-app.sh` sale 0
  pero el PNG es negro. `hyprctl clients` lo delata
  (`org.omarchy.screensaver` encima); cerrarlo y recapturar.

## F14 — Modo de acceso a GitHub: OAuth o GitHub CLI (v0.5.0, 2026-07-12)

> Rama `feature/github-access-mode`. Motivación: orgs enterprise con *OAuth app
> access restrictions* bloquean la OAuth App de Minerva pero permiten GitHub CLI.
> Mecanismo: PUENTE DE TOKEN — auth delegada a `gh` (`gh auth token` vía execFile),
> datos por el `RealGithubService` actual sin cambios de ruta. Diseño completo en
> `PLAN.md`. Verificado empíricamente que el token de gh usado crudo (curl/Octokit)
> accede a orgs privadas, GraphQL y tarballs.

- [x] **T67. Tipos compartidos + settings store + canal IPC del modo**
  - `shared/types.ts`: `GithubAccessMode = 'oauth' | 'gh-cli'`; `AuthState` gana
    `cli_unavailable | cli_unauthenticated`; `AuthStatus.mode` REQUERIDO;
    `AiSettingsInfo.githubAccessMode`.
  - `main/settings/store.ts`: campo OPCIONAL `githubAccessMode?` en
    `PersistedSettings` (ausente = 'oauth', patrón `modelOptions`), guard en
    `isNewPersistedSettings`, `getGithubAccessMode()`/`setGithubAccessMode()`.
    GOTCHA CRÍTICO: `setAiProvider`/`setProviderModel`/`setModelOption` construyen
    el objeto persistido a mano — los TRES deben arrastrar `githubAccessMode`.
  - `main/ai/env.ts` (`getAiSettingsInfo`): incluir `githubAccessMode`.
  - `shared/ipc.ts`: canal `settings:setGithubAccessMode` req `{ mode }` res
    `AiSettingsInfo` + entrada en `IPC_CHANNELS`; validador con
    `hasOnlyKeys(['mode'])` + whitelist literal en `main/ipc/validators.ts`;
    método en `preload/index.ts`.
  - Tests: settings store (roundtrip, default 'oauth', setters no pisan el modo,
    valor inválido en disco rechazado) y validators (válido / clave extra / modo
    fuera de whitelist).
  Aceptación: typecheck+lint+test verdes; `settings.json` con y sin el campo carga.

- [x] **T68. `gh-cli-auth.ts`: probe + token + usuario (núcleo del modo gh)**
  - `main/ai/providers/resolve-cli.ts`: `'gh'` en `CliBinaryName` (comentario: gh
    no es CLI de IA, solo reutiliza el resolver de rutas).
  - Nuevo `main/auth/github-user.ts`: extraer `fetchGithubUser` de
    `auth-manager.ts` (línea ~52) tal cual; auth-manager la importa de ahí.
  - `main/auth/config.ts`: `export const GH_HOSTNAME = 'github.com'`.
  - Nuevo `main/auth/gh-cli-auth.ts` (clase `GhCliAuth`, singleton `ghCliAuth`):
    `getStatus(): Promise<AuthStatus>` con cache TTL 5s + single-flight (patrón
    `cli-probe.ts`): `resolveCliPath('gh')` → `execFile(ruta, ['auth','token',
    '--hostname', GH_HOSTNAME], { timeout: 3000, windowsHide: true })` → validar
    token con `fetchGithubUser`. Mapeo: gh no resuelto ⇒ `cli_unavailable`;
    exit≠0/timeout/stdout vacío ⇒ `cli_unauthenticated`; `/user` falla ⇒
    `cli_unauthenticated` (token descartado); OK ⇒ `signed_in` + user. NUNCA
    lanza; siempre `mode: 'gh-cli'`; el token JAMÁS en el AuthStatus ni en logs.
    `getTokenSync(): string | null` (snapshot del último probe).
    `refetchTokenAfter401(): Promise<string | null>` (re-ejecuta solo
    `gh auth token`, sin TTL, invalida cache del probe). `reset()` para tests.
    Env del execFile: `process.env` CRUDO (NO `buildSanitizedSpawnEnv` — borra
    GH_TOKEN/GITHUB_TOKEN, es solo para CLIs de IA).
  - Tests (`gh-cli-auth.test.ts`, execFile/resolveCliPath/fetch mockeados): los 4
    estados, trim de stdout, TTL/single-flight (2 getStatus concurrentes = 1
    spawn), refetchTokenAfter401 actualiza e invalida, args exactos y ausencia de
    opción `shell`.
  GOTCHAS repo: sin backticks en strings largos de main; `import.meta.dirname`.
  Aceptación: typecheck+lint+test verdes.

- [x] **T69. AuthManager consciente del modo + handler del canal + arranque**
  - `main/auth/auth-manager.ts`: builders OAuth agregan `mode: 'oauth'`;
    `getStatus()` pasa a ASYNC y delega a `ghCliAuth.getStatus()` cuando
    `settingsStore.getGithubAccessMode() === 'gh-cli'` (el `handle()` de IPC ya
    soporta promesas); `getToken()` SIGUE SÍNCRONO y delega a `getTokenSync()`;
    `signOut()`/`startDeviceFlow()` no-op en modo gh (devuelven el status gh;
    JAMÁS `gh auth logout`, JAMÁS `clearToken()` del token OAuth persistido);
    nuevo `cancelDeviceFlowIfPending()` (clearTimeout + `signed_out`, SIN
    clearToken — volver a oauth restaura la sesión persistida).
  - `main/index.ts` (~87-89): si el modo persistido es gh, calentar
    `ghCliAuth.getStatus()` tras `authManager.init()` (su timeout interno de 3s
    garantiza no bloquear el arranque).
  - `main/ipc/handlers.ts`: handler `settings:setGithubAccessMode` — persiste,
    `cancelDeviceFlowIfPending()` al pasar a gh, calienta el probe (`await
    ghCliAuth.getStatus()`), responde `getAiSettingsInfo()`.
  Aceptación: typecheck+lint+test verdes; tests existentes de auth-manager
  adaptados a la firma async sin perder cobertura.

- [x] **T70. Retry-401 en la ruta de datos + factory**
  - `main/github/real-service.ts`: adjuntar `code: 'GITHUB_UNAUTHORIZED'`
    (constante exportada `GITHUB_AUTH_ERROR_CODE`) al error 401 de
    `mapGithubError` y al de `requireToken()`. CONSERVAR el prefijo
    "No autenticado" — es marker en `pr-watcher.ts:53` (skip silencioso) y
    `Sidebar.tsx:18`.
  - Nuevo `main/github/gh-retry.ts`: `withGhCliTokenRetry(inner: GithubService)`
    — envuelve los 6 métodos con un helper `guarded(fn)`; modo ≠ gh ⇒ passthrough
    puro; en gh, ante error con ese code: `refetchTokenAfter401()` → reintento
    ÚNICO → si vuelve a fallar auth: Error "No autenticado con GitHub CLI:
    ejecuta 'gh auth login' en una terminal y reintenta." (prefijo-marker
    intacto).
  - `main/github/index.ts`: factory envuelve el real service con el decorador
    (mock corta antes, sin cambios).
  - Tests (`gh-retry.test.ts`, fake GithubService): passthrough en oauth; 401 →
    refetch → retry con éxito; 401 → refetch null → error gh; 401 en el retry NO
    re-reintenta; errores no-auth pasan intactos.
  Aceptación: typecheck+lint+test verdes (incl. pr-watcher.test.ts intacto).

- [x] **T71. Renderer: auth UI consciente del modo**
  - `stores/app-store.ts` (~152): initial `authStatus: { mode: 'oauth', state:
    'signed_out' }`.
  - `hooks/use-auth.ts`: polling DECLARATIVO — un efecto sobre `[state, mode]`
    que arma/limpia el intervalo cuando `shouldPoll(s)` = `device_pending` ||
    (`mode==='gh-cli'` && `state!=='signed_in'`). Correr `gh auth login` en una
    terminal debe reflejarse solo (≤3s + TTL 5s del probe).
  - `components/layout/TitleBar.tsx` (AuthControls): rama `signed_in` + gh =
    login + badge "vía GitHub CLI", SIN "Cerrar sesión", botón sutil a Settings;
    `cli_unavailable` = "GitHub CLI no encontrado" + abrir Settings;
    `cli_unauthenticated` = chip copiable `gh auth login` (patrón del chip de
    device code). Ramas oauth INTACTAS.
  - `components/layout/Sidebar.tsx`: con `needsLogin` y modo gh, el CTA cambia a
    "ejecuta gh auth login" + "Abrir configuración" (NO `signIn()`); pasar clave
    compuesta `mode + ':' + state` como `authState` a `usePullRequests` →
    cambiar de modo refetchea la lista.
  GOTCHA: el linter react-hooks prohíbe setState-en-efecto/refs-en-render; para
  reset por entidad usar remount por `key`.
  Aceptación: typecheck+lint+test verdes.

- [x] **T72. Settings UI: sección "Acceso a GitHub"**
  - `hooks/use-settings.ts`: `setGithubAccessMode(mode): Promise<boolean>`
    (patrón `selectProvider`) + refresco inmediato de `auth:getStatus` al store
    (que TitleBar/Sidebar reaccionen sin esperar al polling).
  - Nuevo `components/settings/GithubAccessSection.tsx`: primera sección no-IA
    del modal — dos opciones tipo card/radio (`oauth` device flow / `gh-cli`) con
    blurb didáctico (orgs que bloquean OAuth apps), guía estilo
    `CliLoginGuide.tsx` (instalar gh → link https://cli.github.com →
    `gh auth login`), y el `AuthStatus` tras el toggle como feedback (distingue
    unavailable / unauthenticated / signed_in con user). Nota visible si
    `info.mockGithub` (modo demo: datos mock, el ajuste aplica al modo real).
  - `SettingsModal.tsx`: montar la sección en `SettingsModalBody` con heading
    propio, visualmente separada de lo de IA.
  Aceptación: typecheck+lint+test verdes; el toggle persiste (verificable vía
  `window.minerva.settings.get()`).

- [x] **T73. Verificación integral F14 + suite e2e + docs + v0.5.0** (orquestador)
  - Nueva `scripts/smoke-github-mode.mjs` (app `MINERVA_MOCK=1 MINERVA_MOCK_AI=1`
    + CDP): sección visible, toggle oauth↔gh-cli con señales inequívocas,
    persistencia vía `settings.get()`, TitleBar en rama gh, restaurar `oauth` al
    final (la suite muta settings.json real). Excluir `#didactic` del target.
  - Regresión: `smoke-settings`, `smoke-pr-list`.
  - Manual con gh real (SIN MINERVA_MOCK): PRs de org privada, diff, análisis con
    snapshot, settings.json/logs sin token.
  - Captura MIRADA de TitleBar en modo gh + sección nueva.
  - `package.json` 0.5.0, README roadmap, CLAUDE.md (párrafo del modo gh),
    bitácora F14.

### Cierre F14 (2026-07-12, orquestador)

_Verificación integral (orquestador):_ typecheck/lint verdes, 649/649 tests
(41 nuevos: gh-cli-auth 18, gh-retry 7, store/validators/env ampliados).
Nueva `scripts/smoke-github-mode.mjs` 18/18 (x2 corridas seguidas,
idempotente): sección en Settings, toggle oauth<->gh-cli VÍA UI con
persistencia verificada, `auth:getStatus` en rama gh SIN token en el payload,
TitleBar en rama gh, restauración a oauth. Regresión: `smoke-settings` 13/13
(tras endurecerla, ver bitácora) y `smoke-pr-list` completa. Capturas MIRADAS:
modal con la sección nueva (card gh "Activo" + guía + "Autenticado como
edyggclevr vía gh") y TitleBar con badge "vía GitHub CLI" sin "Cerrar sesión".
Revisión del agente electron-security-reviewer: sin hallazgos altos/medios
(token confinado a main, canal con whitelist, execFile sin shell, sin rutas a
gh auth logout/clearToken accidentales). **Prueba REAL del puente** (app sin
MINERVA_MOCK, modo gh-cli): lista de PRs reales por GraphQL, detalle y diff de
21 archivos por REST — todo con el token de gh; settings.json solo guarda el
modo, 0 apariciones de token en logs. Versión 0.5.0 + README + CLAUDE.md.
**F14 COMPLETA.**

### Bitácora F14 — gotchas

- **El token de `gh auth token` hereda la aprobación de la app "GitHub CLI"**:
  GitHub autoriza por token + app emisora, nunca por cliente HTTP. Verificado
  con curl crudo contra org privada (repos, GraphQL search de Minerva,
  tarball 302). Si una org bloquea también GitHub CLI, `gh` tampoco
  funcionaría — no hay caso donde el puente sea peor que gh.
- **`smoke-settings` tenía una falla fantasma PREEXISTENTE (también en main)**,
  dependiente del settings.json de la máquina: sus primeros pasos mutan
  settings por IPC crudo (sin pasar por `useSettings`), el store zustand del
  renderer queda VIEJO, y si el proveedor activo stale coincide con la card a
  clickear, el click cae en el no-op de "card ya activa" (diseño F12) y la
  activación nunca dispara. Endurecida en F14: `location.reload()` + sleep
  antes del bloque de UI (regla que CLAUDE.md ya pedía entre suites; también
  aplica DENTRO de una suite entre mutaciones IPC crudas y checks de UI).
  `smoke-github-mode` nació con ese reload y con el toggle de VUELTA vía UI
  (un `setGithubAccessMode` por IPC persiste bien pero el TitleBar no se
  entera: el polling declarativo está apagado a propósito con gh signed_in).
- **Los setters del settings store construyen el objeto persistido a mano**:
  al agregar un campo top-level nuevo (githubAccessMode) hay que arrastrarlo
  en TODOS los setters existentes o el próximo cambio de proveedor/modelo lo
  borra en silencio. Cubierto con tests de "los otros setters no lo pisan".
- **`AuthStatus.mode` requerido fue la decisión correcta**: el typecheck
  encontró solo el initial del app-store como constructor extra — con campo
  opcional, la UI habría tenido ramas gh sin discriminante confiable.

## F14.1 — Fix: detección del CLI/sesión de Claude Code en macOS (2026-07-12)

Reporte real de Edilson en su Mac (claude 2.1.207, instalador nativo,
Minerva 0.5.0): (a) "claude no está en el PATH" con el CLI instalado y en
PATH; (b) tras reiniciar Minerva, "no detectamos una sesión iniciada" con
sesión activa. Diagnóstico + fix en la misma rama del PR de F14.

- [x] **T74. Probe de CLIs honesto y resistente (4 fixes, mismo commit)**
  - `resolve-cli.ts`: NO cachear el `null` (la cache negativa vitalicia
    dejaba "no está en tu PATH" atascado hasta reiniciar la app — causa raíz
    del síntoma (a)); `clearCliPathCache(binary?)` ahora invalida por binario
    y el probe lo usa cuando una ruta resuelta deja de responder (ventana del
    auto-update de claude, que reescribe el symlink en cada versión).
  - `cli-probe.ts`: fallback al Keychain de macOS para la sesión de Claude
    (`security find-generic-password -s 'Claude Code-credentials'`, SOLO
    existencia/exit code, jamás `-w`) — en macOS el CLI no escribe
    `~/.claude/.credentials.json`, así que una Mac autenticada caía SIEMPRE a
    `installed` (síntoma (b)); `PROBE_TIMEOUT_MS` 1500→4000 ms (primer exec
    post-auto-update paga Gatekeeper/XProtect).
  - Contrato (`shared/types.ts`): `AiProviderStatus` gana `reason:
    'not-found' | 'probe-failed'` + `resolvedPath` para `unavailable` —
    antes ambas causas se pintaban igual ("no está en tu PATH", mentira
    cuando el binario SÍ estaba); `CliLoginGuide` muestra copy distinto por
    causa, con la ruta encontrada en el caso probe-failed.
  - Verificación (orquestador, en esta máquina Linux): typecheck/lint verdes,
    654/654 tests (nuevos: null no cacheado + invalidación por binario en
    resolve-cli; reason/resolvedPath, keychain darwin x4 en cli-probe);
    `smoke-settings` 13/13 con IA real de OpenCode; forma nueva de
    `ai:getProviderStatus` verificada e2e vía CDP (3 proveedores
    `authenticated`, sin reason/resolvedPath fuera de `unavailable`, sin
    secretos en el payload); captura MIRADA del modal con el guide
    "Conectado · plan max". Pendiente de confirmar en la Mac real de Edilson
    (keychain + reinstalación en caliente), que este sandbox no puede simular.

### Bitácora F14.1 — gotchas

- **`smoke-settings` con `MINERVA_MOCK_AI=1` da un FAIL esperado** en el paso
  de "modelo inválido": el mock de IA acepta cualquier modelo (INESPERADO_OK).
  CLAUDE.md ya lo decía ("necesita IA real de OpenCode"); la corrida buena es
  `MINERVA_MOCK=1` a secas con sesión real de opencode.
- **En macOS `claude login` guarda la sesión en el Keychain** (ítem
  `Claude Code-credentials`), NO en `~/.claude/.credentials.json` — cualquier
  heurística de "archivo de credenciales" está ciega en Mac. El chequeo por
  `security` sin `-w` verifica existencia sin tocar el secreto.
- **El instalador nativo de claude reescribe `~/.local/bin/claude` en cada
  auto-update** (symlink → `~/.local/share/claude/versions/<v>`): cualquier
  cache de rutas resueltas debe poder invalidarse, y el primer exec del
  binario nuevo puede tardar segundos (Gatekeeper) — timeouts de probe cortos
  dan falsos "no disponible".

## F15 — Sección didáctica "Infraestructura cloud" (AWS/Cloudflare) (v0.6.0, 2026-07-12)

> Rama `feature/didactic-cloud-section`. Pedido de Edilson: cuando el repo del PR
> tenga infra AWS/Cloudflare, una sección nueva explica el BIG PICTURE del sistema
> desplegado (Lambdas, EventBridge, Workers…) y aterriza DÓNDE incide el PR.
> Decisiones acordadas: kind nuevo `cloud` (condicional, decide el prompt),
> Mermaid `architecture-beta` + icon packs LOCALES (`@iconify-json/logos` + mini-pack
> `cf` vendoreado), DOS diagramas por sección (`mermaids: string[]`): big picture +
> zoom al cambio. Diseño completo, alternativas descartadas y riesgos en `PLAN.md`.

- [x] **S0. Spike de render architecture-beta + iconos bajo strict** (orquestador)
  - Página scratch (fuera de src/) con mermaid 11.16.0 + `registerIconPacks`
    (JSON local de `@iconify-json/logos`) renderizando el few-shot del prompt con
    `securityLevel: 'strict'` + `theme: 'neutral'`. Verificar: iconos visibles
    (sobreviven al sanitizado), layout legible con grupos, `align row|column`.
  - Si falla ⇒ decidir plan C (flowchart + icon shapes v11.13+) ANTES de la ola 2
    y actualizar PLAN.md + T77.
  - Gate para T77; NO bloquea T75/T76.
  - _Verificado 2026-07-12 (orquestador, captura MIRADA): chromium headless +
    mermaid.min.js UMD del repo + JSON de logos volcado local. 3 casos OK bajo
    strict+neutral: (1) big picture con grupos iconizados (logos:aws /
    logos:cloudflare) y 7 servicios con logos reales; (2) zoom con sufijo "PR"
    en labels y "align row" (11.16) funcionando; (3) icono inexistente degrada
    a placeholder "?" SIN romper el render (comportamiento tolerante). El
    mini-pack custom (prefix cf, IconifyJSON inline) renderiza — el mecanismo
    de vendoreo para R2/D1/KV está validado. Nota menor: algunos labels se
    cruzan con aristas largas — mitigar en el prompt (grafos ≤10 servicios,
    aristas cortas, align). GATE T77: ABIERTO._

- [x] **T75. Shared + parser + mapper: kind `cloud` con multi-mermaid** (Sonnet)
  _Verificado 2026-07-12 (orquestador): diff revisado (parser acumula mermaids[]
  solo para cloud al CERRAR cada bloque; mapper nunca descarta por falta de
  diagramas; entrada mínima en SECTION_META para el Record exhaustivo — la UI
  real es T77). typecheck+lint verdes, 664/664 tests (47 nuevos en parser/mapper:
  2/1/0 diagramas, streaming incremental 0→1→2, roundtrip stringify⇄parse).
  Gotcha del subagente anotado: los mermaid de fixtures terminan en salto de
  línea A PROPÓSITO (el parser lo preserva al cerrar, a diferencia de snippets
  que recortan) — los roundtrips byte a byte deben replicarlo._
  - `shared/types.ts`: variante `{ kind: 'cloud'; markdown: string;
    mermaids: string[] }` en `DidacticSection`.
  - `shared/events.ts`: variante con `mermaids?: string[]` en
    `DraftDidacticSection`.
  - `main/ai/stream-parser.ts`: `'cloud'` en `KNOWN_KINDS` (:43); `toDraft()`
    (76-98): para cloud, ACUMULAR cada bloque `@@@MERMAID` cerrado en `mermaids[]`
    en orden (los demás kinds intactos con su `mermaid` único); `sectionToText()`
    (286-306): serializar N bloques MERMAID para cloud.
  - `main/ai/section-mapper.ts`: `case 'cloud'` — markdown obligatorio,
    `mermaids` = los bloques presentes (0..2; con 0 la sección SIGUE siendo
    válida: solo markdown). NUNCA descartar la sección por un diagrama ausente.
  - Tests (vitest): parse de sección cloud con 2 MERMAID en orden, con 1, con 0;
    streaming incremental (draft crece de 1 a 2 diagramas); roundtrip
    `stringifySections` ⇄ parser para cloud; kinds existentes sin regresión.
  - GOTCHAS repo: sin backticks en strings largos de main; `import.meta.dirname`.
  Aceptación: typecheck+lint+test verdes; los 5 kinds previos parsean idéntico.

- [x] **T76. Prompt + fixtures mock de la sección cloud** (Sonnet; depende de T75)
  _Verificado 2026-07-12 (orquestador). Entrega: prompt con categoría condicional
  + anti-alucinación, gramática architecture-beta, whitelist de 33 iconos, reglas
  de tamaño, few-shot con sección cloud completa; fixture en
  shopwave/checkout-service#77 (webhook de pagos — encaje natural: la narrativa
  cloud explica por qué el lock en memoria no sirve en Lambda concurrente).
  FIX del orquestador post-entrega: la convención de marcado " (PR)" en labels
  ERA INVÁLIDA — el lexer de architecture-beta solo acepta letras/números/
  espacios en [Label] (paréntesis, guiones, ★, «» probados: todos ERR). Se
  corrigió a sufijo plano " PR" en prompt (3 sitios) y fixture (2 labels). Los
  4 diagramas embarcados (2 fixture + 2 few-shot) validados contra mermaid
  11.16 real vía spike headless: 4/4 OK. typecheck+lint+664 tests verdes._
  - `main/ai/prompts/analyze-pr.ts` (string concatenado con comillas simples,
    JAMÁS backticks — gotcha vite:esm-shim):
    - Enum del marcador (:95): añadir `cloud`.
    - Regla de clasificación (58-64): categoría condicional `cloud` — emitir SOLO
      si el repo contiene infra reconocible de AWS/Cloudflare: Terraform (*.tf),
      CDK, SAM/CloudFormation, serverless.yml, wrangler.toml|jsonc, Pulumi, o
      deploy workflows que la referencien. Anti-alucinación explícita: si el mapa
      no se puede reconstruir desde el repo, NO emitir la sección.
    - Bloque de contenido (105-130): markdown didáctico (qué hace el sistema
      completo, cómo interactúan las piezas, y qué piezas toca este PR y cómo
      cambia la interacción) + DOS bloques @@@MERMAID `architecture-beta`:
      1º sistema completo; 2º zoom al área modificada con los servicios tocados
      marcados en el label (sufijo '(PR)').
    - Gramática exacta de architecture-beta (group/service/junction, aristas
      `a:R -- L:b`, `align`) + WHITELIST literal de iconos permitidos:
      `logos:aws-lambda|aws-s3|aws-dynamodb|aws-sqs|aws-sns|aws-eventbridge|`
      `aws-api-gateway|aws-step-functions|aws-cloudfront|aws-ec2|aws-ecs|`
      `aws-fargate|aws-rds|aws-aurora|aws-cognito|aws-kinesis|aws-route53|`
      `aws-vpc|aws-cloudwatch|aws-secrets-manager|cloudflare|cloudflare-workers`,
      `cf:r2|d1|kv|durable-objects|pages|queues`, y built-ins
      `cloud|database|disk|internet|server` como fallback. Reglas de tamaño:
      ≤10 servicios, labels ≤3 palabras, grupos por proveedor/dominio.
    - Few-shot: ampliar el ejemplo (131-160) con una sección cloud completa.
  - `main/ai/fixtures.ts`: sección `cloud` (markdown + 2 diagramas) en el PR
    shopwave que mejor encaje temáticamente, para e2e determinista con
    `MINERVA_MOCK_AI=1`. Los diagramas de la fixture usan SOLO iconos de la
    whitelist. Sin backticks en los strings.
  Aceptación: typecheck+lint+test verdes; con `MINERVA_MOCK=1 MINERVA_MOCK_AI=1`
  el análisis del PR elegido emite la sección cloud por el pipeline tagged
  (verificable en el resultado de `ai:analyzePullRequest`).

- [x] **T77. Renderer: card cloud + icon packs locales** (Sonnet; gate: S0 OK)
  _Verificado 2026-07-12 (orquestador): diff revisado (cf-icon-pack.ts tipado
  IconifyJSON con atribución CC-BY-4.0; registerIconPacks una vez junto a
  initialize; card con subtítulos fijos por posición y key por índice —
  correcto: el array es append-only durante streaming). GOTCHA descubierto por
  el subagente y bien resuelto: un import estático de @iconify-json/logos en
  MermaidDiagram.tsx (alcanzable estáticamente desde el entry) infla el bundle
  principal de 2.5MB a 10MB — los packs se cargan con import() dinámico dentro
  del mismo Promise.all del singleton lazy de mermaid. Build verificado: entry
  2531 kB (±1 kB vs baseline), logos 7496 kB y cf-pack 5 kB en chunks lazy.
  typecheck+lint+664 tests verdes. Verificación visual e2e: en T78._
  - Deps: `npm i @iconify-json/logos`. Nuevo
    `renderer/src/assets/cf-icon-pack.ts`: mini-pack IconifyJSON `cf` vendoreado
    (r2, d1, kv, durable-objects, pages, queues) con los SVG del Style Guide
    oficial de Cloudflare + comentario de atribución/fuente.
  - `MermaidDiagram.tsx` (initialize lazy, 109-133): `registerIconPacks([logos,
    cf])` UNA vez, con los JSON importados estáticamente en el mismo módulo/chunk
    lazy (la CSP `connect-src 'self'` prohíbe el loader remoto de Iconify).
  - `DidacticAnalysisArea.tsx`: entrada en `SECTION_META` (título
    "Infraestructura cloud", icono lucide `Cloud`); rama cloud en
    `renderSection`/`renderDraftSection`: markdown + cada diagrama de `mermaids`
    en su propio `MermaidDiagram` con subtítulo fijo ("Sistema completo" /
    "Dónde incide este PR"; si solo hay 1 diagrama, solo el primero).
  - El fallback existente de MermaidDiagram (card con código fuente si el parse
    falla) debe aplicar POR diagrama, sin tumbar la card entera.
  - GOTCHA: linter react-hooks prohíbe setState-en-efecto; reset por entidad =
    remount por `key`.
  Aceptación: typecheck+lint+test verdes; con la app en
  `MINERVA_MOCK=1 MINERVA_MOCK_AI=1`, el PR de la fixture muestra la card con
  los DOS diagramas renderizados con logos (no basta el DOM: captura).

- [x] **T78. Verificación integral F15 + suite e2e + docs + v0.6.0** (orquestador)
  - Nueva `scripts/smoke-cloud-section.mjs` (app `MINERVA_MOCK=1
    MINERVA_MOCK_AI=1` + CDP puerto 9222): analizar el PR de la fixture, esperar
    señal inequívoca (botón "Re-analizar" habilitado), verificar card cloud con 2
    SVGs de mermaid CON CONTENIDO (checks de contenido, no solo rects — el gotcha
    del visor colapsado), presencia de un icono de la whitelist en el SVG, y que
    un PR SIN infra no emite la sección. Excluir `#didactic` del target CDP;
    limpiar estado global al arrancar (`ai:invalidateAnalysis` + PR neutral).
  - Regresión: `smoke-didactic` (o la suite didáctica vigente) + `smoke-settings`.
  - Prueba con IA REAL (proveedor activo, sin MINERVA_MOCK_AI) sobre un repo real
    con infra AWS o Cloudflare: la sección aparece y los diagramas son coherentes
    con el repo; anotar tasa de Mermaid inválido (decide si el follow-up del
    validation-loop con `mermaid.parse()` se agenda).
  - Captura MIRADA de la card con logos (screenshot-app.sh, receta e2e de
    CLAUDE.md).
  - Docs: CLAUDE.md (sección cloud en el stack + gotcha de icon packs locales),
    README roadmap, bitácora F15, `package.json` 0.6.0.

### Cierre F15 (2026-07-12, orquestador)

_Verificación integral:_ typecheck/lint verdes, 664/664 tests. Nueva
`scripts/smoke-cloud-section.mjs` 9/9 (x2 corridas, idempotente): card presente,
subtítulos big picture/zoom, 2 SVGs mermaid CON contenido y visibles (nodos>20,
altura>50px), iconos inlineados (packs locales), markdown didáctico, marcado
"PR" en el zoom, y caso negativo (#482 sin infra ⇒ sin card). Regresión:
`smoke-didactic` 13/13, `smoke-streaming` 6/6, `smoke-harness-activity` 11/11
(el parser de streaming cambió en T75 — por eso estas dos extra). Captura
MIRADA con IA mock (card completa, logos AWS reales, zoom con Webhook Handler
PR / Orders Table PR). **Prueba con IA REAL (Claude Code / Fable 5, sin
MINERVA_MOCK_AI)**, dos casos: (a) snapshot SIN IaC ⇒ NO emitió la sección
(anti-alucinación funciona) y 0 mermaid rotos; (b) snapshot CON
`serverless.yml` (agregado a fixtures-snapshot.ts para habilitar el caso
positivo, coherente con la fixture didáctica) ⇒ sección cloud con 2
architecture-beta VÁLIDOS (0 rotos), narrativa fiel al serverless.yml — el
modelo incluso distinguió la parte Express/Redis NO declarada como infra y
sugirió confirmar en review que el lock nuevo no requiere un recurso propio.
Tasa de mermaid inválido con IA real: 0/2 corridas ⇒ el validation-loop con
mermaid.parse NO se agenda por ahora. Docs: CLAUDE.md (sección cloud + gotchas
7-9), README roadmap, package.json 0.6.0. **F15 COMPLETA.**

### Bitácora F15 — gotchas

- **Los `[Label]` de architecture-beta solo aceptan letras/números/espacios**:
  paréntesis, guion, ★ y «» rompen el lexer (probado uno a uno contra mermaid
  11.16 en spike headless). La convención de marcado " (PR)" del primer draft
  del prompt/fixture era INVÁLIDA — se corrigió a sufijo plano " PR". Moraleja:
  todo DSL que embarque una fixture o un few-shot se valida contra el parser
  REAL antes de darlo por bueno (los 4 diagramas embarcados pasaron por el
  spike).
- **Icon packs de mermaid: import() dinámico o pagas 7 MB en el entry**:
  `MermaidDiagram.tsx` es alcanzable estáticamente desde el entry del renderer,
  así que un `import` estático de `@iconify-json/logos` cae al bundle principal
  (2.5→10 MB medido) aunque solo se use dentro del `.then()` del singleton.
  `Promise.all([import('mermaid'), import('@iconify-json/logos'), ...])` deja
  los packs en el chunk lazy de mermaid.
- **El snapshot mock se cachea por headSha y sobrevive al hot reload**: tras
  editar `fixtures-snapshot.ts` hay que borrar
  `userData/snapshots/<owner>-<repo>-<sha>` Y reiniciar la app completa — en
  esta sesión el watcher de electron-vite NO reinició main tras la edición y el
  mock re-escribió el árbol viejo (1ª prueba real dio falso negativo).
- **chromium headless como banco de pruebas de mermaid**: `--headless=new
  --dump-dom` + mermaid.min.js UMD local + JSON de iconos volcado a un .js =
  validador de DSL sin app ni display (el spike S0 y el fix de labels salieron
  de ahí). Con hyprlock activo la captura grim sale negra — la alternativa es
  `scripts/screenshot-cdp.mjs` (Page.captureScreenshot, independiente del
  compositor).
- **Los iconos de producto de Cloudflare (R2/D1/KV/DO/Pages/Queues) no existen
  en ninguna colección Iconify**: se vendorearon los SVG oficiales de
  `cloudflare/cloudflare-docs` `src/icons/` (CC-BY-4.0, atribución en
  `cf-icon-pack.ts`), monocromos `currentColor` fijados al naranja #F6821F.

## E2E Playwright (2026-07-24/25, rama feature/playwright-e2e)

Migración del smoke testing a Playwright manteniendo checks y capturas.
**MIGRACIÓN COMPLETA (2026-07-25)**: suite en `e2e/` con 17 specs / 32 tests,
32/32 verde bajo Xvfb en ~7.4m. Los `scripts/smoke-*.mjs` fueron RETIRADOS
(quedan solo `debug-*.mjs`, `screenshot-*` y `watch-auth.mjs`).

- [x] Gate `npm run verify` + job `checks` en pr-dev-builds/release (PR #17)
- [x] Fixture `connectOverCDP` + specs núcleo (commits 98c3f2e/40e33e0)
- [x] Portar smoke-e2e → `general-comment.spec.ts` (solo el comentario
      general; el resto ya estaba cubierto)
- [x] Portar smoke-settings → `settings.spec.ts` (contrato IPC + modal F12;
      el paso de modelo inválido lanza SIN `MINERVA_MOCK_AI` y se
      auto-skipea si opencode no está authenticated)
- [x] Portar smoke-pr-list → `pr-list.spec.ts` (watcher con
      `MINERVA_WATCH_INTERVAL_MS=1500` vía `LaunchOptions.env`)
- [x] Portar smoke-github-mode → `github-mode.spec.ts` (probe de gh REAL;
      los checks aceptan los 3 estados válidos ⇒ sin skip)
- [x] Portar smoke-f9-ui → `f9-ui.spec.ts` (banner sellado; staleness
      sembrada por el test reescribiendo `analyses.json` entre lanzamientos —
      ya no necesita seeding manual del orquestador)
- [x] Portar smoke-bugfixes → `bugfixes.spec.ts` (triado: markdown, botones
      de snippet y CSP; el visor NO se duplicó — ya lo cubre detach.spec)
- [x] Portar smoke-harness-activity → `harness-activity.spec.ts`
- [x] Portar smoke-packaged → `packaged.spec.ts` (`LaunchOptions.executable`
      → `dist/linux-unpacked/minerva`; auto-skip si no hay binario)
- [x] `LaunchOptions` en `launchMinerva` (env extra con borrado por
      `undefined`, ejecutable y args alternos)
- [x] Job `e2e` en pr-dev-builds.yml (xvfb-run tras el gate checks; sube
      `test-results/` como artifact SIEMPRE, también en rojo)
- [x] Retirados los scripts legacy + docs (CLAUDE.md §Verificación y receta,
      README §Desarrollo y §Empaquetado, WORKFLOW.md lección 1)

### Bitácora — gotchas

- **`_electron.launch` de Playwright es INVIABLE con Electron 43 + PW 1.62**:
  `electronApp.close()` se cuelga para siempre en escenarios específicos
  (bisección: clipboard write + ~2s antes de cerrar; didáctica abierta a
  mitad de streaming) aunque el proceso Electron salga EXIT 0 inmediato. El
  wedge es bookkeeping interno de PW: ni SIGKILL, ni destruir streams stdio,
  ni emit('close'), ni page.close() previo lo destraban; el teardown del
  worker muere a los 120s y la corrida entera sale exit 1. Upstream:
  microsoft/playwright#39248, cerrado not-planned. Solución en
  `e2e/fixtures.ts`: spawn propio + `--remote-debugging-port=0` +
  `chromium.connectOverCDP` (API íntegra de PW; teardown = WS disconnect +
  SIGTERM propio). NO volver a `_electron` sin probar el fix upstream en rama
  aparte.
- **Shutdown de Chromium colgante bajo Xvfb sin clipboard manager**: tras
  escribir al clipboard, el quit (vía SIGTERM) puede no completar — el
  closeMinerva escala a SIGKILL a los 3s (un exit limpio tarda <1s).
- **xvfb-run por defecto es 640x480x8**: usar
  `-s "-screen 0 1600x1000x24"` o la ventana de 1400x900 sale mutilada en
  las capturas.
- **userData aislado por test**: `MINERVA_USER_DATA_DIR` (main/index.ts,
  setPath antes de whenReady) reemplaza TODA la limpieza de estado que las
  suites CDP legacy hacían a mano (buscador, invalidateAnalysis, PR neutral) —
  los specs nuevos no deben heredar esos rituales.
- **Un binario empaquetado VIEJO invalida packaged.spec en silencio**: el
  dist/linux-unpacked/ de la máquina era de antes de `MINERVA_USER_DATA_DIR`
  ⇒ habría corrido contra el userData REAL (sin aislamiento y escribiéndolo).
  El spec no puede detectar la antigüedad del binario: correr `npm run
  dist:dir` antes de confiar en ese spec (en CI ni se intenta: auto-skip).
- **Regex laxo sobre el body matchea el título del PR**: el check del tab
  Archivos con `/migrations|refunds/` pasaba SIN diff porque el título del
  #479 contiene "refunds" (se vio en la captura: "Cargando archivos…" con el
  test verde). Señal correcta: un nombre de archivo del fixture
  (`2026070401_create_refunds.sql`).
- **Nombre accesible duplicado "Actualizar"**: el botón de la barra de
  staleness colisiona con el refresh de la lista (aside) en modo estricto de
  Playwright — escopar al contenedor (`div` más interno con el texto del
  aviso) antes del `getByRole`.
- **Colas de la migración**: `e2e/` se lintea (eslint.config.js) pero NO entra
  a ningún tsconfig del typecheck — Playwright transpila al vuelo; los tipos
  de los specs solo los valida el editor. El paso de "modelo inválido" de
  settings.spec.ts SÍ corre entero en esta máquina (opencode authenticated,
  ~50 s de análisis real rechazado).

---

## F16 — Layout responsivo para tiling (v0.6.3, 2026-07-25, rama fix/responsive-tiling-layout)

Pedido de Edilson (2026-07-25): la UI se rompe al tilear la ventana (mitad
vertical, mitad horizontal, hasta 4 ventanas por monitor); Settings es el caso
más visible. Plan completo, breakpoints y diagnóstico medido: `PLAN.md` § F16.

Diagnóstico con sonda CDP (`Emulation.setDeviceMetricsOverride`, app construida
con mocks bajo Xvfb): a 960x540 el diff queda en **40px** (280 sidebar + 260
árbol + 380 didáctico = 920px `shrink-0`), y en Settings las tabs + la lista de
modelos son **inalcanzables** (solo `ProviderModelPanel` está dentro de un
`overflow-y-auto`; el resto se recorta contra `max-h-[85vh]`).

- [x] **T79. Fundaciones: tiers de layout + mínimos de ventana + re-clamp del ancho didáctico**
  `src/renderer/src/hooks/use-layout-tier.ts` (nuevo): `useSyncExternalStore`
  sobre `resize` que devuelve `{ width, height, w: 'xl'|'lg'|'md'|'sm',
  h: 'tall'|'short'|'xshort' }` (cortes: 1360/1040/760 y 700/560). Snapshot
  CACHEADO (string estable) para no romper `useSyncExternalStore`.
  `src/renderer/src/hooks/use-element-width.ts` (nuevo): ResizeObserver sobre un
  ref; `setState` SOLO en el callback del observer (nunca en el cuerpo del
  efecto) y solo si el ancho redondeado cambió.
  `main/index.ts`: `minWidth: 560`, `minHeight: 420`.
  `stores/app-store.ts`: re-clamp del `didacticPanelWidth` ante `resize` de
  ventana (hoy solo se clampea al arrastrar) + estado `sidebarOpen` para el modo
  drawer.
  _Aceptación:_ typecheck/lint verdes; el ancho didáctico persistido se achica
  solo al reducir la ventana; la ventana no puede achicarse por debajo del piso.
  _Gotchas:_ lint react-hooks del repo prohíbe `setState` en efecto; el
  `getSnapshot` de `useSyncExternalStore` no puede devolver un objeto nuevo por
  llamada.

- [x] **T80. SettingsModal: scroll único, sticky, tamaño por tier y dos columnas**
  Un solo `flex-1 min-h-0 overflow-y-auto` para TODO el cuerpo; `shrink-0` en el
  header. "En uso" y `ProviderTabs` pasan a `sticky` dentro del scroller (se
  conserva la intención de T62 sin bloquear el scroll). Tamaño: `max-w-[900px]`
  en dos columnas / `max-w-lg` en una; alto `h-[min(88vh,700px)]`; en `xshort`
  sheet de ventana completa. Con ≥980px de ventana el cuerpo se reparte en DOS
  COLUMNAS (GitHub | IA) con scroll propio — NO es un switcher: todas las
  secciones siguen montadas. (El plan original decía "nav lateral de anclas";
  con solo dos secciones era decorativa, ver PLAN.md § F16.)
  _Aceptación:_ a 960x540 y 1920x540 se llega por scroll a la lista de modelos y
  al selector de razonamiento; `settings.spec.ts` y `github-mode.spec.ts` siguen
  verdes SIN tocarlos.
  _Gotchas:_ `github-mode.spec.ts` exige "Acceso a GitHub", las dos cards y
  `gh auth login` VISIBLES apenas se abre el modal ⇒ prohibido un `<details>`
  cerrado o un switcher que desmonte secciones.

- [x] **T81. GithubAccessSection + ProviderModelPanel/Tabs compactos**
  Guía de `gh` de bloque `<ol>` (~110px) a una línea con los mismos textos
  visibles; nota de modo demo compacta. `ProviderTabs` con `overflow-x-auto` y
  `shrink-0` en los tabs. Cards de modelo en grid de 2 columnas cuando el panel
  supera ~720px (aprovecha el modal ancho) y `truncate`/`break-all` en los slugs
  largos.
  _Aceptación:_ los textos que verifican los specs siguen visibles; a 1920x540
  las cards se ven en dos columnas sin desbordar.

- [x] **T82. Sidebar: dock 280/240, drawer overlay en `md`/`sm`**
  Ancho por tier (`xl` 280, `lg` 240); en `md`/`sm` se renderiza como drawer
  overlay (`fixed`, backdrop, Esc, cierre al seleccionar PR) controlado por
  `sidebarOpen`. El contenido de la lista NO cambia.
  _Aceptación:_ a 960 de ancho el centro recupera los 280px; el drawer abre/
  cierra con el botón del TitleBar y al elegir un PR.

- [x] **T83. TitleBar: divulgación progresiva + toggle de la lista**
  Botón hamburguesa (solo en `md`/`sm`) que abre el drawer de PRs. Por tier:
  `lg` oculta el texto del estado de conexión (queda el punto); `md` el buscador
  colapsa a icono con campo overlay y el chip de settings pierde el texto; `sm`
  auth/settings/didáctico van a un menú `⋯`. En `short`, `h-12 → h-9`.
  _Aceptación:_ a 720px de ancho nada se desborda ni se solapa; el engrane
  conserva `svg.lucide-settings` (los specs lo localizan así).
  _Gotchas:_ NO sacar el icono `Settings` de dentro del botón (contrato e2e).

- [x] **T84. CenterPane + PrHeader compactos en `short`**
  `PrHeader` a una línea (título truncado + `#n` + Draft) con autor/rama/commits/
  labels dentro de un `<details>` "Detalles" cuando el alto es `short`/`xshort`;
  las tabs Conversación/Archivos comparten fila con el header en ese tier.
  _Aceptación:_ a 1920x540 el contenido del tab gana ~90px verticales; a
  1400x900 el header se ve exactamente como hoy.

- [x] **T85. FilesTab: árbol como columna o drawer según el ancho REAL del panel**
  `useElementWidth` sobre el contenedor del tab: ≥640px columna (como hoy),
  <640px el árbol se vuelve drawer interno con botón "N archivos" en la toolbar
  del diff, y el diff ocupa todo el ancho.
  _Aceptación:_ a 960x540 el diff pasa de 40px a >400px; `diff.spec.ts` verde.

- [x] **T86. DiffView/DiffToolbar: split→inline automático y toolbar compacta**
  `effectiveMode`: si el panel de diff mide <560px, se renderiza `inline` sin
  pisar la preferencia del store; el botón split queda deshabilitado con tooltip
  ("Necesita ~560px de ancho"). Toolbar: bajo 520px solo el basename (path
  completo en `title`).
  _Aceptación:_ el toggle sigue funcionando por encima del umbral; por debajo el
  usuario ve POR QUÉ está en inline; `diff.spec.ts` verde.

- [x] **T87. DidacticPanel + ConversationTab + ventana didáctica + ResourceViewer**
  Panel: tope de ancho por tier (34% en `lg`, 45% en `md`, mínimo 300) y rail en
  `sm`. `ConversationTab`: columna de lectura `max-w-[900px]` centrada y padding
  reducido bajo 520px. Ventana didáctica: `minWidth` 700 → 520, padding `p-6 →
  p-3` en anchos chicos. `ResourceViewer`: `max-w-5xl` → `min(92vw,1100px)` y
  sheet completo en `xshort`.
  _Aceptación:_ `didactic.spec.ts`, `detach.spec.ts` y `cloud-section.spec.ts`
  verdes; captura mirada de la ventana didáctica a 520px.

- [x] **T88. Spec e2e `responsive.spec.ts` + docs + bump 0.6.3**
  Helper `setViewport(page, w, h)` en `e2e/fixtures.ts` (CDP
  `Emulation.setDeviceMetricsOverride`, con `clearDeviceMetricsOverride` al
  final). Spec que recorre 1920x1080 / 960x1080 / 1920x540 / 960x540 y afirma:
  (a) el panel de diff mide >400px en todos, (b) `document.body.scrollWidth`
  nunca supera el viewport, (c) en Settings toda sección es alcanzable por
  scroll (comparando `scrollHeight`/`clientHeight` del scroller y llegando a la
  lista de modelos). Capturas adjuntas por tamaño. Docs: CLAUDE.md (convención
  de tiers + gotcha de la sonda), README (roadmap), `package.json` 0.6.2 →
  0.6.3.
  _Aceptación:_ `npm run verify` + suite e2e completa en verde bajo Xvfb;
  capturas de los 4 tamaños MIRADAS.

### Cierre F16 (2026-07-25, orquestador)

Verificación de la fase (toda ejecutada tras la última línea de código):

- `npm run verify` — typecheck (node + web), lint y 664 tests en 35 archivos: verde.
- Suite e2e Playwright COMPLETA bajo Xvfb (`xvfb-run -a -s "-screen 0
  1600x1000x24" npx playwright test`): **35/35 en verde**, incluidos los 3 tests
  nuevos de `responsive.spec.ts` y sin tocar NINGÚN spec existente — el tier por
  defecto (1400x900 = `xl`/`tall`) deja el shell idéntico a v0.6.2.
- Capturas MIRADAS (sonda CDP con `Emulation.setDeviceMetricsOverride`, app
  construida con mocks), antes y después, a 1920x1080 / 960x1080 / 1920x540 /
  960x540, en los tres estados (conversación, archivos, settings) + la ventana
  didáctica desacoplada a 520x700.

Números del antes/después a 960x540 (un cuarto de un monitor 1080p):

| | antes | después |
|---|---|---|
| ancho del panel de diff | **40px** (20 por lado en split) | **580px**, split legible |
| lista de PRs | columna fija de 280px | drawer (botón en TitleBar) |
| árbol de archivos | columna fija de 260px | drawer (botón "3" en la toolbar) |
| Settings | tabs y modelos **inalcanzables** | sheet completo, todo por scroll |
| cabecera del PR | ~110px | ~34px (`<details>` "Detalles") |

### Bitácora F16 — gotchas

- **`useRef` + `useEffect([])` NO mide un nodo que aparece tarde.** `FilesTab`
  tiene `return` tempranos (cargando / error / sin archivos), así que en el
  primer render el div medido no existe: el efecto corría una vez contra
  `ref.current === null` y jamás observaba nada ⇒ `width` se quedaba en `null` y
  el árbol seguía siendo columna a 580px (visto en la captura, con el layout
  "casi bien" — el tipo de bug que un assert de DOM no delata). Fix:
  `useElementWidth` es un **callback ref** (corre en cada montaje/desmontaje del
  nodo) con la limpieza en la función que devuelve (React 19). Copiado a
  CLAUDE.md como gotcha 11.
- **`page.setViewportSize()` no existe para nosotros.** Con `connectOverCDP` la
  página vive en una ventana que Playwright no creó y el método la rechaza. La
  vía es `Emulation.setDeviceMetricsOverride` por CDP (`setViewport` en
  `e2e/fixtures.ts`), cacheando la sesión CDP por página: al detachear, Chromium
  revierte los overrides. Gotcha 12 de CLAUDE.md.
- **`scrollIntoViewIfNeeded()` es LA aserción para "contenido recortado"**: si un
  ancestro `overflow-hidden` clipea el elemento y no hay scroller, Playwright no
  puede traerlo a la vista y el paso falla. Es exactamente el bug que tenía
  Settings, y un `toBeVisible()` solo no lo habría cazado (el elemento
  simplemente no estaba en el DOM visible).
- **`section:has([aria-label="Vista inline"])` matchea DOS elementos**: el
  `CenterPane` contiene al `DiffView`, así que el `:has` sube por la jerarquía y
  rompe el modo estricto. `.last()` = el panel de diff real.
- **El default de la app (1400x900) da un panel de diff de 480px**, por debajo
  del mínimo legible de split (560px) ⇒ con el panel didáctico abierto, la
  ventana por defecto ahora arranca en **inline**. No es una regresión: 480px en
  split son ~190px de código por lado. Cerrar el didáctico o ensanchar la
  ventana devuelve split solo, y el botón deshabilitado explica el porqué en su
  tooltip (sin eso, clickear split "no haría nada" y parecería roto).
- **El ancho del didáctico se persiste como PREFERENCIA, no como efectivo**: el
  clamp tier-aware se aplica al pintar (`clampDidacticWidth(preferred, ancho de
  ventana)`), así que tilear la ventana no destruye el ancho elegido en el
  monitor grande — vuelve solo al ensanchar. El mismo helper lo usa el arrastre,
  si no el panel saltaría al soltar el handle.
- **Fuera de alcance consciente**: sidebar redimensionable a mano (los tiers ya
  resuelven el espacio; el handle de `DidacticPanel` es el patrón a reusar si se
  pide) y fusionar las tabs Conversación/Archivos en la fila del `PrHeader` en
  ventanas bajas (el `PrHeader` de una línea ya recupera ~76px; fusionar
  acoplaría `CenterPane` con `PrHeader` por ~37px más).

---

## F17 — Auto-updater (v0.7.0, 2026-07-25, rama feature/auto-updater)

Pedido de Edilson (2026-07-25): *"quiero trabajar en una nueva rama para
solucionar el autoupdater… este feature sí es un breaking change por lo tanto
vamos a subir la versión a v0.7.0"*. Estudio de opciones, decisiones cerradas y
arquitectura: `PLAN.md` § F17.

**El diagnóstico en una línea:** no es "arreglar" el updater — no existe ni él ni
su feed. `grep` limpio sobre `src/`, `electron-builder.yml` sin sección `publish`
(⇒ sin `app-update.yml` embebido, electron-updater ni arranca), y `release.yml`
sube solo los instaladores con `gh release upload`, así que los `latest*.yml` y
los `*.blockmap` que electron-builder SÍ genera se quedan en el runner
(verificado contra v0.6.0: 4 assets, cero metadata).

**Decisiones cerradas con Edilson:** mac notify-only (sin Developer ID por
ahora), Windows sin firmar, descarga con consentimiento explícito (130 MB),
instalación al salir, check al arrancar + cada 6 h + botón manual,
`allowPrerelease: true`, y release por tag → draft → publish.

**Breaking change:** el auto-update existe de v0.7.0 en adelante. Quien tenga
0.6.x instalada no tiene updater y debe reinstalar a mano UNA vez.

- [x] **T89. Infra de release: `publish` en electron-builder + zip de mac + pipeline tag→draft→publish**
  _(subagente Sonnet; verificado por el orquestador: `npm run dist` real con los
  artefactos inspeccionados, YAML de los 3 archivos parseado con `js-yaml` +
  grafo de jobs `checks→draft→build→publish` confirmado, `npm run verify` y
  suite e2e 35/35 en verde.)_
  NO toca `src/`. `electron-builder.yml`: sección `publish: {provider: github,
  owner: amiedygg, repo: proj_minerva}` (es lo que genera `app-update.yml` dentro
  del paquete — sin eso electron-updater lanza en runtime) y `zip` añadido al
  target de mac junto al `dmg` (Squirrel.Mac lo exige aunque mac quede
  notify-only: el hueco se deja preparado para el Developer ID).
  `release.yml` reescrito: trigger `on: push: tags: ['v*']` en vez de
  `release: published`; jobs `checks` → `draft` (`gh release create "$TAG"
  --draft --title …`, UNA sola vez, para que los 3 runners no compitan creando
  drafts duplicados) → `build` (matriz igual que hoy, pero `npx electron-builder
  <flag> --publish always` con `GH_TOKEN`, que sube instalador + `latest*.yml` +
  `*.blockmap`) → `publish` (`gh release edit "$TAG" --draft=false`, con
  `needs: build`). El check tag-vs-`package.json` pasa de `::warning::` a
  **fallo duro** (`exit 1`).
  `pr-dev-builds.yml`: se queda con `--publish never`; confirmar que sigue verde
  con la sección `publish` presente.
  _Aceptación:_ `npx electron-builder --linux --publish never` local produce
  `dist/latest-linux.yml` + `app-update.yml` dentro del
  `linux-unpacked/resources/`; `actionlint` (o revisión manual) sobre los dos
  workflows; el job `draft` es idempotente si el tag se re-pushea.
  _(Corrección del orquestador: el criterio original pedía además un sidecar
  `dist/*.AppImage.blockmap` y estaba MAL — ver bitácora.)_
  _Gotchas:_ el `publish` de electron-builder crea la release como **draft** por
  defecto — por eso el job `draft` explícito es un contenedor, no un duplicado:
  electron-builder encuentra el draft existente por tag y sube ahí. `permissions:
  contents: write` hace falta en el workflow entero, no solo en un job.

- [x] **T90. Contrato: `UpdaterStatus`, canales IPC, evento push, validators y preload**
  _(subagente Sonnet; verificado por el orquestador: revisión del diff completo
  contra la frontera de seguridad —canal hardcodeado, guard de payload,
  `removeListener` de ESE listener, `isVoidPayload` en los 6 canales, cero
  `releaseNotes` en el contrato—, `npm run verify` verde por mi cuenta y suite
  e2e 35/35 incluida `packaged.spec.ts`.)_
  Sin lógica de updater todavía — solo el contrato, para que T91 y T93 puedan ir
  en paralelo. `src/shared/types.ts`: union `UpdaterStatus` exactamente como en
  `PLAN.md` § F17 (`disabled | unsupported | idle | checking | available |
  downloading | downloaded | error`) + `UpdateInfoLite { version, releaseUrl,
  releaseDate? }`. **`UpdateInfoLite` NO lleva `releaseNotes`**: vienen de GitHub
  como HTML crudo y no se renderizan (ver frontera de seguridad del PLAN).
  `src/shared/ipc.ts`: `updater:getStatus`, `updater:check`, `updater:download`,
  `updater:quitAndInstall`, `updater:openReleasePage` (todos `req: void`) y
  `minerva:getVersion` (`res: string`) en el namespace `system` — hoy
  `app.getVersion()` no se muestra en ninguna parte de la app.
  `src/shared/events.ts`: `minerva:event:updaterStatusChanged` con
  `UpdaterStatusChangedEvent { status: UpdaterStatus }` + entrada en
  `MINERVA_EVENTS`.
  `src/main/ipc/validators.ts`: los 5 canales nuevos son `void` ⇒ validator que
  rechaza cualquier cosa distinta de `undefined`.
  `src/preload/index.ts`: `window.minerva.updater.*` (funciones concretas) y
  `events.onUpdaterStatus(cb)` con el canal **hardcodeado**, mismo patrón que
  `onAnalysisProgress` — jamás un `on(channel, cb)` genérico.
  _Aceptación:_ `npm run verify` verde; ningún `any`; el renderer puede llamar
  `getStatus` y recibir el tipo correcto (aunque main devuelva `disabled` fijo).
  _Gotchas:_ `updater:quitAndInstall` existe pero es **acción secundaria**: el
  comportamiento por defecto es instalar al salir (decisión 4). No lo conviertas
  en el camino principal de la UI.

- [x] **T91. Núcleo del updater en main: capacidad, máquina de estados y scheduler**
  _(subagente Sonnet; verificado por el orquestador: precedencia de `capability.ts`
  y regex de semver leídas contra el código, descartada la carrera invoke-vs-push
  (`checkNow()` devuelve el `status` leído DESPUÉS del await), bundle de main sin
  corromper, `npm run verify` (694 tests) y suite e2e 35/35 en corrida limpia.)_
  `src/main/updater/config.ts`: `ALLOW_PRERELEASE = true`, `CHECK_INTERVAL_MS`
  (6 h), `STARTUP_DELAY_MS` (60 s), `RELEASE_OWNER`/`RELEASE_REPO`.
  `src/main/updater/capability.ts`: función **pura y testeable** (recibe
  `{ platform, isPackaged, env, canWrite }`, no toca `app` ni `fs` directo) que
  devuelve `'disabled' | 'auto' | 'notify'` según la tabla del PLAN:
  `!isPackaged` o `MINERVA_UPDATER=off` ⇒ `disabled`; `darwin` ⇒ `notify`
  (sin Developer ID); `linux` ⇒ `auto` solo si `$APPIMAGE` está definido **y**
  el archivo y su directorio padre son escribibles (AppImageLauncher, `/opt` y
  root rompen justo ahí), si no `notify`; `win32` ⇒ `auto`.
  `src/main/updater/updater.ts`: singleton que cablea `electron-updater`
  (`autoDownload: false`, `autoInstallOnAppQuit: true`, `allowPrerelease`,
  `logger` mínimo con info/warn/error/debug — NO agregar `electron-log`),
  mantiene el `UpdaterStatus`, agenda el check inicial con delay + el intervalo
  (limpiándolos en `before-quit`), y hace **broadcast a todas las ventanas**
  (mismo patrón que `analysisProgress`). En modo `notify` consulta el feed y
  compara semver pero NUNCA descarga.
  La `releaseUrl` la construye main desde plantilla hardcodeada con
  `RELEASE_OWNER`/`RELEASE_REPO` y la versión **validada como semver** — jamás
  una URL que venga del feed. `openReleasePage` va por `shell.openExternal`.
  `electron-updater` a **`dependencies`** (no dev) en `package.json`.
  Handlers en `src/main/ipc/handlers.ts` + init desde `src/main/index.ts`.
  _Aceptación:_ unit tests (vitest) de `capability.ts` cubriendo la matriz
  completa de plataforma/env/permisos y de la construcción+validación de la URL
  (una versión no-semver no produce URL); `npm run verify` verde; `npm run dev`
  arranca sin tocar la red (queda en `disabled`) y sin ruido en consola.
  _Gotchas:_ **`electron-updater` en `devDependencies` es un bug que solo aparece
  después de `npm run dist`** — `externalizeDepsPlugin` la externaliza, el bundle
  de main hace `require` de un paquete que no viaja en el asar, y la app
  empaquetada crashea al arrancar mientras en dev todo se ve perfecto. Errores
  siempre a estado `error` visible, nunca throw silencioso (regla de CLAUDE.md).
  En main usa `import.meta.dirname`, nunca `__dirname` (gotcha 2).

- [x] **T92. Mock del updater (`MINERVA_MOCK_UPDATER=1`) guionado**
  _(subagente Sonnet; verificado por el orquestador: los TRES guiones recorridos
  de punta a punta sobre la app construida con capturas miradas.)_
  `src/main/updater/mock-updater.ts`: implementación con el mismo contrato que
  el real que emite un guion determinista al recibir `check`: `checking` →
  `available` (versión = actual + minor) → al recibir `download`, una serie de
  `downloading` con percent 0→100 en pasos cortos → `downloaded`. Un segundo
  guion seleccionable por env (`MINERVA_MOCK_UPDATER=notify`) para el estado
  `unsupported` (el caso mac/AppImageLauncher), y `=error` para el camino de
  error. Se elige en el init de `updater.ts`, igual que `MockAiService` con
  `MINERVA_MOCK_AI`.
  _Aceptación:_ `MINERVA_MOCK_UPDATER=1 npm run dev` recorre el guion completo
  sin salir a la red; unit test del guion (secuencia de estados emitidos).
  _Gotchas:_ el mock es **LA única vía** de ejercitar esta UI en e2e: la suite
  corre la app sin empaquetar y ahí el updater real está `disabled` por diseño.
  Los tiempos del guion tienen que ser cortos (≤2 s el total) o el spec se vuelve
  lento y flaky.

- [x] **T93. UI: sección "Actualizaciones" en Settings + badge en el engrane**
  _(subagente Sonnet; verificado por el orquestador: capturas MIRADAS de los
  estados disponible/descargando/descargada/unsupported/error, jerarquía de
  "Se instalará al salir" vs "Reiniciar ahora" confirmada visualmente, badge
  presente en el chip de la TitleBar, `settings.spec.ts`/`github-mode.spec.ts`
  verdes sin tocarlos.)_
  `src/renderer/src/hooks/use-updater.ts`: suscripción a `onUpdaterStatus` +
  `getStatus` inicial; devuelve `{ status, version, check, download,
  quitAndInstall, openReleasePage }`.
  `src/renderer/src/components/settings/UpdateSection.tsx` (nuevo): versión
  actual (`minerva:getVersion`), botón "Buscar actualizaciones" (deshabilitado
  en `checking`/`downloading`), y por estado: "Estás al día" + fecha del último
  chequeo · "Disponible vX.Y.Z" + botón "Descargar (130 MB)" · barra de progreso
  con porcentaje · "Se instalará al salir de Minerva" + acción SECUNDARIA
  "Reiniciar ahora" · mensaje de error con reintento · en `unsupported`, texto
  honesto del porqué ("esta instalación no puede actualizarse sola") + "Ver la
  release". En `disabled` la sección no se monta.
  Ubicación en `SettingsModal`: en una columna al final; en dos columnas (≥980px,
  F16) debajo de "Acceso a GitHub".
  Badge discreto (punto) en el botón del engrane de la `TitleBar` cuando el
  estado es `available` o `downloaded` — reusar el patrón de "no leído" de la
  lista de PRs. **Nada de banners.**
  _Aceptación:_ los 6 estados se ven correctos con el mock; `settings.spec.ts` y
  `github-mode.spec.ts` siguen verdes **sin tocarlos**; capturas de idle /
  disponible / bajando / descargada MIRADAS.
  _Gotchas:_ requisito duro heredado de F16 — esas dos suites exigen textos
  VISIBLES apenas abre el modal, sin clicks ⇒ prohibido un `<details>` cerrado o
  cualquier cosa que desmonte secciones. La TitleBar en tier `sm` no tiene ancho
  para nada más que el punto. Las release notes NO se renderizan (HTML crudo de
  GitHub, ver frontera de seguridad).

- [x] **T94. e2e `updater.spec.ts` (mock guionado + pasada tileada)**
  _(subagente Sonnet; el orquestador diagnosticó y arregló DOS fallos que dejó:
  el test de `notify` clickeaba un botón que en `unsupported` no existía —lo
  que destapó un hueco real de producto, ver abajo— y `packaged.spec.ts` falló
  por el bump a 0.7.0 con el binario de `dist/` viejo. Verificado: suite
  completa en verde y capturas miradas.)_
  Spec nuevo en `e2e/` con `MINERVA_MOCK_UPDATER=1` pasado por el env extra que
  ya acepta `launchMinerva`. Recorrido: abrir Settings → ver la versión actual →
  "Buscar actualizaciones" → aparece "Disponible" con la versión del guion →
  "Descargar" → la barra progresa → "Se instalará al salir" → el badge del
  engrane está presente. Un segundo caso con `MINERVA_MOCK_UPDATER=notify`
  afirmando que **no hay** botón de descarga y sí el link a la release.
  Pasada responsive a 960×540 con `setViewport(page, 960, 540)`: la sección se
  alcanza con `scrollIntoViewIfNeeded()`.
  Reforzar en las fixtures que el resto de los specs corren con
  `MINERVA_UPDATER=off` explícito.
  _Aceptación:_ `npm run test:e2e` completo verde bajo Xvfb (`npm run build &&
  xvfb-run -a -s "-screen 0 1600x1000x24" npx playwright test`); capturas del
  spec nuevo miradas.
  _Gotchas:_ espera señales inequívocas (el botón "Descargar" habilitado, el
  texto "Se instalará al salir"), no strings que ya existan en el estado vacío.
  `scrollIntoViewIfNeeded()` es LA aserción de contenido recortado (F16).
  Redimensionar es `setViewport` por CDP, nunca `page.setViewportSize()`
  (gotcha 12).

- [x] **T95. Verificación del update REAL** — _orquestador_
  _(hecha contra el feed REAL de GitHub en vez del `generic` local: al existir
  v0.7.1 publicada ya no hacía falta montar un servidor. Cazó el bug de interop
  ESM/CJS que tenía el updater MUDO en producción —ver abajo— y, tras el fix,
  verificó el ciclo completo. Ciclo observado y medido, no inferido.)_
  Probar la mecánica de reemplazo del AppImage **sin quemar releases**:
  `npm run dist` con `version` 0.7.0-rc.1 y luego 0.7.0-rc.2, servir un `dist/`
  con ambos + `latest-linux.yml` desde `python3 -m http.server`, apuntar el
  updater a ese feed con provider `generic` (override temporal por env, o
  `dev-app-update.yml` + `forceDevUpdateConfig`), correr la AppImage rc.1 **de
  verdad** (con `$APPIMAGE` definido) y comprobar: detecta rc.2, descarga con
  progreso real, al cerrar la app reemplaza el archivo, y el siguiente arranque
  reporta 0.7.0-rc.2.
  _Aceptación:_ el ciclo completo observado, con captura de la versión nueva en
  la sección de Settings. Los hallazgos van a la bitácora de F17.
  _Gotchas:_ la AppImage tiene que ejecutarse tal cual (no `linux-unpacked`) o
  `capability` la marca `notify` y no hay nada que probar. Para matar la app:
  `pkill -f "[e]lectron"` en un comando SEPARADO (gotcha 5).

- [x] **T96. Bump a 0.7.0 + documentación del breaking change**
  _(orquestador directo: `package.json` 0.7.0, entrada de roadmap + aviso de
  reinstalación manual en README, sección "Auto-updater" y comandos nuevos en
  CLAUDE.md.)_
  `package.json` a `0.7.0`. `README.md`: entrada de roadmap del auto-updater y
  nota de instalación explicando que **quien venga de 0.6.x debe reinstalar a
  mano una vez** (no tiene updater con que enterarse). `CLAUDE.md`: sección corta
  del updater (módulo, modos de capacidad, `MINERVA_MOCK_UPDATER`,
  `MINERVA_UPDATER=off`) y los gotchas nuevos que salgan de T91/T95.
  Borrador de las notas de la release v0.7.0 con el breaking change arriba de
  todo.
  _Aceptación:_ `npm run verify` verde; los docs describen el estado REAL (mac
  notify-only, Windows sin firmar), sin prometer lo que no hay.

### Nota de contexto para F17 (no es tarea)

Las 6 releases existentes están marcadas **pre-release** y ninguna tiene
`latest*.yml`. Con `allowPrerelease: true` el updater las mira, pero v0.7.0 será
la más nueva por semver y las viejas nunca se van a seleccionar ⇒ no hace falta
sanearlas. La regla que sí queda vigente de acá en adelante: **ninguna release se
publica sin sus assets de metadata** — para eso está el pipeline draft→publish de
T89.

Los dev builds por PR suben como **artifacts del run**, no como releases, así que
el updater no los ve.

### Bitácora F17 — gotchas

- **El blockmap del AppImage va EMBEBIDO, no como sidecar `.blockmap`.** El
  criterio de aceptación de T89 (escrito por el orquestador) pedía ver un
  `dist/*.AppImage.blockmap` y eso no existe nunca: `app-builder-lib` usa
  `appendBlockmap()` para el target AppImage — `buildBlockMap(file, 'deflate')`
  SIN archivo de salida, o sea que lo appendea dentro del propio `.AppImage`
  con un header de 4 bytes (`targets/appimage/appImageUtil.js` +
  `differentialUpdateInfoBuilder.js`, verificado leyendo el código instalado).
  El sidecar `.blockmap` solo lo escribe `createBlockmap()`, que se usa para el
  instalador NSIS (`*.exe.blockmap`) y para el `zip` de mac. La evidencia de que
  el update diferencial de Linux SÍ está habilitado es el campo
  **`blockMapSize: 144026`** dentro de `latest-linux.yml`, no un archivo aparte.
  Lo cazó el subagente de T89 leyendo la fuente en vez de asumir que el criterio
  era correcto — el criterio se corrigió en la tarea.
- **`gh` necesita `GH_REPO` en jobs sin checkout.** El job `publish` de
  `release.yml` no hace checkout (solo corre `gh release edit`), así que `gh` no
  puede autodetectar el repo por el remote de git. Se pasa
  `GH_REPO: ${{ github.repository }}` por env en los jobs `draft` y `publish`.
- **`--publish never` NO desactiva la escritura de `app-update.yml`**, solo la
  SUBIDA de assets. Por eso los dev builds de `pr-dev-builds.yml` quedan con el
  feed embebido y una AppImage `X.Y.Z-sha-dev` va a ofrecer actualizar a la
  estable apenas salga. Es correcto por semver y además útil (empuja a no
  quedarse en un dev build viejo), pero conviene saberlo antes de que sorprenda.
- **`app.getVersion()` sin empaquetar devuelve la versión de ELECTRON, no la de
  Minerva.** Corriendo `electron out/main/index.js` (toda la suite e2e) el
  directorio de la app no tiene `package.json`, así que Electron cae a su propia
  versión: la sección de Settings muestra "Versión instalada: 43.0.0" y el mock
  ofrece "43.1.0" (deriva minor+1). Empaquetada devuelve la real (verificado con
  `dist/linux-unpacked`: `0.6.3`). Consecuencia para los specs: **nunca afirmar
  un literal de versión** en la suite sin empaquetar, solo el patrón — y por eso
  la aserción "la app empaquetada reporta la version de package.json" vive en
  `packaged.spec.ts`, que es donde significa algo.
- **Un binario viejo en `dist/` miente en silencio.** El chequeo de versión
  falló primero con `window.minerva.system.getVersion is not a function`: el
  `dist/linux-unpacked` lo había generado T89 ANTES de que T90 agregara el canal.
  Es la misma trampa que CLAUDE.md ya anota para `packaged.spec.ts` — si vas a
  verificar algo contra el empaquetado, reconstruilo (`npm run dist:dir`) o no
  estás verificando lo que creés.
- **2 fallos de `detach.spec.ts` que NO eran regresión.** La corrida completa con
  T91–T93 dentro falló en los dos tests de la ventana desacoplada (timeouts de
  10s sobre el cursor de streaming) y tardó 11.2m contra 8.1m de la corrida
  anterior. Diagnóstico: contención de CPU, no código — los dos pasan aislados
  en 54.8s, `TitleBar` (lo único que T93 tocó que podría influir) solo se monta
  en `App.tsx` y NO en la ventana didáctica, y una corrida limpia posterior dio
  35/35 en 8.0m. Lección repetida del proyecto: ante un fallo e2e, primero
  aislar el spec y recién después culpar al código.
- **Hueco de producto destapado por un test mal escrito (T94).** El spec de
  `notify` clickeaba "Buscar actualizaciones" y se colgaba: en `unsupported`
  ese botón NO se renderizaba (la fila de chequeo solo existía en
  `idle`/`checking`/`error`). El bug del spec era real, pero al mirarlo de
  cerca el problema de fondo era del producto: la decisión 5 de F17 es "chequeo
  manual desde Settings", y en `unsupported` esa vía desaparecía — un usuario
  de macOS abría Settings y no tenía forma de pedir el chequeo, tenía que
  esperar al tick del scheduler para que apareciera "Ver la release". Fix en la
  UI (el botón vive también en `unsupported`), NO en el mock: poblar `available`
  en el `init` del guion habría tapado el hueco y encima habría hecho divergir
  el mock del comportamiento real.
- **Un `npm run build` piped a `tail -2` esconde que falló.** Tras arreglar el
  layout de `unsupported` la captura salía IDÉNTICA a la anterior: el build
  había fallado (comentario JSX puesto entre `&& (` y el `<div>`, posición
  inválida) y el spec corrió contra el bundle VIEJO, así que "verificó" la
  versión anterior del código sin decir nada. Ver el exit code de verdad
  (`npm run build > log; echo $?`) antes de creerle a una captura que no cambió.
- **El bump de versión rompe `packaged.spec.ts` hasta que se reconstruye.**
  Desde T94 ese spec afirma `getVersion() === package.json.version`, así que
  tras `npm version` hay que correr `npm run dist:dir` antes de la suite. Es
  a propósito: el binario viejo es exactamente lo que CLAUDE.md ya advierte que
  no sirve para verificar nada.
- **`responsive.spec.ts` tenía una carrera latente desde F16, y la destapó CI.**
  El test medía el `boundingBox()` del panel de diff INMEDIATAMENTE después de
  `setViewport`, pero el colapso del árbol de archivos a drawer lo dispara el
  `ResizeObserver` de `useElementWidth`, que es asíncrono. Al pasar de 1920x540
  a 960x540 la foto salía con el árbol todavía como columna: **580-260=320px**,
  el número exacto del fallo (run 30171070743). No se reproduce en local ni con
  la máquina saturada (3 corridas limpias + 1 con todos los cores ocupados) —
  en esta máquina el observer llega antes de la medición. Fix: `expect.poll`
  sobre la medición, SIN aflojar el umbral de 400px. Es el mismo gotcha 11 del
  CLAUDE.md visto desde el lado del test: si la UI reacciona por
  ResizeObserver, una medición única es una foto sacada demasiado pronto.

### T95 — el bug que solo aparecía en producción (2026-07-25)

**El auto-updater de v0.7.0 estaba MUDO en producción y todos los tests en
verde.** Lo cazó T95 corriendo la AppImage publicada de verdad, que es
exactamente para lo que existía esa tarea.

- **Síntoma**: la AppImage real (capacidad `auto`, `$APPIMAGE` definido y
  escribible) devolvía `{phase:'idle'}` **sin `lastCheckedAt`** ante un
  `updater:check`, y el log no tenía NI UNA línea `[updater]`. O sea:
  `checkForUpdates()` nunca corría, ni siquiera emitía `checking-for-update`.
- **Causa raíz**: `electron-updater` es CommonJS y exporta `autoUpdater` con
  `Object.defineProperty(exports, 'autoUpdater', { get: () => ... })` — getter
  con ARROW function. `cjs-module-lexer` (lo que usa Node para derivar los
  named exports de un CJS importado desde ESM) reconoce el patrón que emite
  TypeScript (`get: function () { return X }`) pero NO ese. Nuestro bundle de
  main es ESM ⇒ `mod.autoUpdater` llegaba `undefined` y el objeto solo existía
  en `mod.default.autoUpdater`. Comprobado a mano bajo Electron 43:
  `typeof mod.autoUpdater === 'undefined'`, `typeof mod.default.autoUpdater ===
  'object'`; todos los demás exports (`AppUpdater`, `NsisUpdater`, …) SÍ se
  detectan — el único roto era justo el que necesitábamos.
- **Por qué NADA lo detectó**: `instance.autoDownload = false` sobre `undefined`
  lanzaba un TypeError, y el `catch` de `realCheckNow` se lo tragaba con el
  comentario "el listener 'error' ya transicionó el estado" — que es cierto
  para `checkForUpdates()` pero FALSO para `ensureRealAutoUpdater()`, que corre
  ANTES de que ese listener exista. Silencio absoluto. Y ningún test lo
  cubría porque dev y toda la suite e2e corren en `disabled` o con el mock:
  **el camino real no se ejecutaba en ninguna verificación automatizada**.
- **Fix**: `resolveAutoUpdaterExport()` (exportada y con test de regresión de
  los 3 casos) + separar el `try` del setup del `try` de la operación, para que
  un fallo de wiring transicione a `{phase:'error'}` en vez de desaparecer.
- **Lección para el resto del proyecto**: cualquier dependencia CJS consumida
  con `await import()` desde main puede perder named exports. Si el símbolo se
  exporta con un getter que no sea el patrón de TypeScript, hay que ir por
  `default`. Y un `catch {}` justificado por "otro ya reporta el error" tiene
  que verificar que ese otro EXISTA en ese punto del flujo.

### T95 — cierre: el ciclo real, medido de punta a punta (2026-07-25)

Con v0.7.1 publicada y el fix del interop en ambos lados, se ejercitó el ciclo
completo con una AppImage empaquetada de verdad (`npm run dist` en 0.7.0, es
decir una versión MENOR que la publicada) corriendo bajo Xvfb contra el feed
real de GitHub:

| paso | evidencia |
|---|---|
| detecta | `{"phase":"available","info":{"version":"0.7.1","releaseUrl":"…/releases/tag/v0.7.1"}}` — la URL la construyó main, no vino del feed |
| descarga | **diferencial**: `Full: 134,513.25 KB, To download: 144.66 KB (0%)` por rangos de bytes. El blockmap embebido en el AppImage funciona |
| instala al salir | `Auto install update on quit` + `Install: isSilent: true, isForceRunAfter: false` |
| reemplaza el binario | `Minerva-0.7.0.AppImage` desaparece y queda `Minerva-0.7.1.AppImage` (AppImageUpdater RENOMBRA al nombre de la versión nueva) |
| integridad | sha512 del archivo resultante == el publicado en `latest-linux.yml` |
| arranca actualizado | la nueva instancia reporta `0.7.1` y su chequeo devuelve `idle` con `lastCheckedAt` |

Dos gotchas nuevos, ambos de método:

- **`pkill`/SIGTERM NO dispara la instalación al salir.** El primer intento
  mató el proceso y el archivo quedó intacto: `autoInstallOnAppQuit` cuelga del
  evento `quit` de Electron, que un SIGTERM se saltea. Hay que cerrar la
  VENTANA (acá: `curl .../json/close/<target>` por CDP → `window-all-closed` →
  `app.quit()`). Si alguna vez esto "no anda", primero comprobar que la app se
  cerró de verdad y no que la mataron.
- **Un sufijo de prerelease define un CANAL en electron-updater.** El primer
  build de prueba fue `0.7.1-t95.0` y el chequeo murió con `No published
  versions on GitHub`: la versión instalada tenía canal `t95` y no hay
  releases en ese canal. Con `allowPrerelease: true` esto tiene una
  consecuencia REAL de producto: quien instale un `X.Y.Z-rc.N` se queda en el
  canal `rc` y NO recibe la estable `X.Y.Z` automáticamente. Para probar
  contra el canal estable hay que versionar la prueba sin sufijo.

## F18 — GitHub CLI como único modo de acceso + selector de cuenta (2026-07-25, rama feature/gh-multi-account)

> Motivación (del usuario, 2026-07-25): en una máquina con VARIAS cuentas
> autenticadas en `gh`, Minerva no dejaba elegir cuál usar — tomaba siempre la
> activa del CLI. Y, a la vez: OAuth "a largo plazo resultó no ser tan
> conveniente como el CLI", así que había que ocultar esa opción.
>
> Decisiones tomadas con el usuario antes de escribir código:
> 1. **Ocultar la UI de OAuth, NO borrar el código.** El camino OAuth queda
>    detrás de `MINERVA_GITHUB_ACCESS=oauth` para quien no pueda instalar `gh`
>    (equipo administrado). Borrarlo dejaría a esa persona sin ninguna vía y
>    volver atrás sería rehacerlo.
> 2. **La elección de cuenta es SOLO de Minerva.** Nada de `gh auth switch`:
>    eso mutaría la sesión del CLI del usuario para todo el sistema (git, otras
>    terminales, scripts). Con `gh auth token --user <login>` se puede tener gh
>    en la cuenta del trabajo y Minerva revisando PRs con la personal.

- [x] **T96. Retirar el modo persistido; `gh-cli` por defecto**
  - `main/settings/store.ts`: `resolveGithubAccessMode()` — env
    `MINERVA_GITHUB_ACCESS` o `'gh-cli'`. **Ya NO se lee de disco**: un
    `githubAccessMode: "oauth"` escrito por una versión ≤0.6.x dejaría esa
    instalación en un modo que ninguna pantalla muestra ni permite cambiar
    (estado invisible). La clave se sigue ACEPTANDO al leer, para no invalidar
    el archivo entero, y desaparece en la próxima escritura.
  - Se retiran `setGithubAccessMode()`, el canal `settings:setGithubAccessMode`,
    su validador y su método de preload. Efecto colateral bueno: el gotcha de
    F14 ("los setters construyen el objeto a mano y deben arrastrar
    `githubAccessMode`") se muda a `githubAccount`, no se duplica.

- [x] **T97. Puente de token multicuenta**
  - `shared/types.ts`: `GhAccount { login, active, valid }`;
    `AuthStatus.ghAccount?` (login que se le pidió a gh, solo si se eligió a
    mano — nunca el token).
  - `main/auth/gh-accounts.ts` (NUEVO): parsers PUROS
    `parseGhAccountsJson` (camino preferido, `gh auth status --json hosts`) y
    `parseGhAccountsText` (fallback para gh sin `--json`). Toda la fragilidad
    de parsear la salida de un CLI ajeno queda en un módulo testeable, aparte
    del spawn.
  - `main/auth/gh-cli-auth.ts`: `--user <login>` en `gh auth token`;
    `listAccounts()` con cache/single-flight propios; `invalidate()`.
  - `settings.json` gana `githubAccount?` (el NOMBRE, jamás el token).

- [x] **T98. UI: sección "Acceso a GitHub" reescrita**
  - Fuera el toggle de dos cards. Queda: guía de instalación + feedback del
    probe + selector de cuenta (cards tipo radio) + botón "Actualizar".
  - En modo oauth (escape hatch) la sección lo DICE en vez de mostrar
    controles de gh que no aplican.
  - `use-gh-accounts.ts` (NUEVO), `use-settings.setGithubAccount`.

- [x] **T99. Verificación**
  - `npm run verify` verde (40 archivos, 734 tests). Suite e2e completa verde
    (39/39; `packaged.spec.ts` exigió `npm run dist:dir` — el binario de
    `dist/` era 0.7.0 contra un `package.json` 0.7.1).
  - `e2e/github-mode.spec.ts` reescrito: default gh-cli sin rastro de OAuth,
    selector de cuenta, y un segundo test que lanza su propia app con
    `MINERVA_GITHUB_ACCESS=oauth` para cubrir el escape hatch.

### Bitácora F18 — gotchas

1. **`gh auth status` sin `--json` escribe a STDERR y sale con 1** en cuanto
   UNA cuenta tiene el token vencido — que es EXACTAMENTE el caso que el
   selector viene a resolver. Tratar el exit code como fallo, o leer solo
   stdout, deja la lista vacía justo cuando más se la necesita. El fallback de
   texto junta stdout+stderr e ignora el exit code; la única señal que usa es
   la FORMA de la salida. (Con `--json hosts` sí es stdout + exit 0 siempre,
   por eso es el camino preferido.)
2. **`parseGhAccountsJson` devuelve `null`, no `[]`, cuando el JSON no tiene la
   forma esperada.** Es la diferencia entre "gh no habla este formato, probá el
   fallback de texto" y "gh no tiene ninguna cuenta en este host". Colapsarlas
   a `[]` hace que un `gh` viejo se vea como "sin cuentas" y el fallback nunca
   corra.
3. **La cache TTL del probe tiene que llevar la cuenta con la que se calculó.**
   Si no, cambiar de cuenta sirve hasta 5s el `AuthStatus` de la identidad
   ANTERIOR — y peor, `getToken()` sigue entregando su token a la ruta de
   datos. `cachedForAccount` cubre cualquier camino; `invalidate()` desde el
   handler cubre el explícito.
4. **`invalidate()` NO borra `lastToken`** a propósito: dejar un hueco donde
   `getToken()` devuelve `null` produce un 401 evitable en la ruta de datos.
   El probe siguiente lo pisa.
5. Gotcha 11 del CLAUDE.md, versión hook: `react-hooks/set-state-in-effect`
   rechaza el `setState` síncrono en el cuerpo de un efecto, incluido el de la
   rama "deshabilitado". La salida es derivar el estado en el `return`
   (`accounts === null` ⇒ `loading`) y hacer `setState` solo dentro del
   callback de la promesa — mismo criterio que ya seguían `useAuth`/`useSettings`.
6. Un `null` que es un VALOR legítimo ("seguir la cuenta activa de gh") no
   puede ser también el sentinel de "nada en vuelo". En `GithubAccessSection`
   el estado `saving` es `string | null | undefined`: `undefined` = idle.

7. **Hacer `gh-cli` el default puso una llamada de RED en el arranque.**
   `main/index.ts` hacía `await ghCliAuth.getStatus()` — barato mientras el
   modo era opt-in, pero desde F18 lo paga TODO arranque, y el probe incluye
   `GET /user`. Bajo Xvfb eso reventó por timeout specs que no tienen nada que
   ver (updater ×3, responsive, packaged): la ventana no aparecía a tiempo. El
   síntoma engañaba — parecía contención de recursos, no una regresión propia.
   Arreglo doble: el warm-up ya no se espera (`void`; el single-flight lo hace
   igual de útil) y `fetchGithubUser` lleva `AbortSignal.timeout(10s)`, porque
   una promesa colgada ahí se propagaría por la cache single-flight a TODOS
   los `auth:getStatus` siguientes.
8. **`pkill -f "[e]lectron"` también mata a `electron-builder`** — el truco del
   corchete evita que el patrón matchee tu propio shell, no que matchee
   `electron-builder`. Y electron-builder REESCRIBE `package.json` del repo
   durante el empaquetado (le saca `scripts` y `devDependencies`) para
   restaurarlo al terminar: matarlo a mitad deja el archivo truncado y
   `npm run dev` responde `Missing script: "dev"`. Se recupera con
   `git checkout -- package.json`. Antes de un `pkill` así, comprobar que no
   hay un build en vuelo.
9. **Una lista que todavía carga NO es una lista vacía.** La card "esta cuenta
   ya no está en gh" se derivaba de `!accounts.some(...)`, y durante el primer
   `auth:listGhAccounts` (que spawnea `gh auth status`, con red de por medio)
   `accounts` es `[]` — así que TODA cuenta elegida se acusaba, un instante, de
   haber desaparecido, con el tono más alarmante de la sección. Va gateada por
   `!loading`. Lo encontró la verificación visual, no los tests: el e2e pasaba
   porque su cuenta fantasma efectivamente no existe, y Playwright espera.

## F19 — Catálogo de modelos dinámico también para Claude Code (2026-07-25)

> Motivación (del usuario, 2026-07-25): «Claude Code ya tiene disponible Opus 5
> y no aparece en la lista. El objetivo es que la lista se llene con los modelos
> más nuevos de manera automática, y no tener que desplegar un release solo para
> actualizar la lista de modelos por proveedor.»
>
> Diagnóstico: de los tres proveedores, Codex (T35) y OpenCode (T57) YA tenían
> catálogo dinámico. Claude Code era el único que no: `provider-models.ts`
> devolvía `AI_PROVIDER_CATALOG['claude-code'].models` tal cual, con el
> comentario "no hay nada que refrescar". O sea: el problema no era general, era
> ese hueco puntual — y su consecuencia exacta era la que reportó el usuario.

- [x] **T100. Catálogo dinámico de Claude Code**
  - `main/ai/providers/claude-code-model-catalog.ts` (NUEVO): `query()` del
    Agent SDK en modo STREAMING INPUT con un generador que nunca yieldea →
    `supportedModels()` (control request del protocolo, NO una llamada al
    modelo: cero tokens) → `ModelInfo[]` mapeado a `AiModelOption[]`. Sesión
    inyectable (`openSession`) para testear sin spawnear, igual que
    `createClient` en `codex-model-catalog.ts`. `abortController.abort()` en el
    `finally` + timeout de 15s.
  - Verificado EMPÍRICAMENTE contra `claude` 2.1.220 + Agent SDK 0.3.203: 647 ms,
    devuelve `opus[1m]`/`claude-fable-5[1m]`/`sonnet`/`haiku` y no deja procesos
    huérfanos (`pgrep -c claude` idéntico antes y después).
  - `provider-models.ts`: los tres proveedores pasan por `DYNAMIC_FETCHERS`
    (desaparece la rama "estático"), misma cache TTL de 60s por proveedor.

- [x] **T101. Las opciones del modelo activo se resuelven contra el catálogo dinámico**
  - Bug latente desde T35 que F19 habría vuelto crónico: `resolveModelOptions`
    (`main/ai/env.ts`) buscaba los descriptores SOLO en el catálogo curado. Un
    modelo que solo existe en el dinámico —o sea, todo modelo nuevo— no
    matcheaba, así que el `effort`/`variant` elegido en Settings se descartaba en
    silencio: la UI mostraba el selector (ella sí ve la lista dinámica) y main
    mandaba el análisis sin la opción.
  - `main/ai/providers/model-catalog-snapshot.ts` (NUEVO): último catálogo
    dinámico por proveedor, leíble SÍNCRONAMENTE (`getEffectiveAiSelection()` lo
    es, y volverla async obligaría a propagar el await por los tres servicios).
    `provider-models.ts` deposita cada resultado; `env.ts` lo consulta antes del
    curado.
  - `ipc/handlers.ts`: el handler de análisis hace `await warmProviderModels(...)`
    antes de resolver, para que un arranque en frío (usuario que nunca abrió
    Settings) no le toque justo al análisis.

- [x] **T102. Matcheo por alias (`aliasFor`)**
  - El catálogo dinámico devuelve filas ALIAS (`sonnet`, `opus[1m]`) mientras en
    `settings.json` puede estar persistido el id canónico que el curado ofrecía
    (`claude-sonnet-5`). `AiModelOption.aliasFor` (de `resolvedModel` del SDK) +
    `findModelInList` (exacto primero, alias después) lo resuelven en los dos
    lados: `env.ts` y `ProviderModelPanel.tsx`.
  - La fila `value: 'default'` del SDK se DESCARTA: resuelve al mismo modelo que
    una fila concreta, y dejarla haría que dos cards se leyeran como "Activo".

- [x] **T103. Verificación**
  - `npm run verify` verde (41 archivos, 757 tests) + suite e2e completa
    (`packaged.spec.ts` exigió `npm run dist:dir`: el binario de `dist/` era
    0.6.3 contra un `package.json` 0.8.0 — mismo tropiezo que T99).
  - Captura ANTES/DESPUÉS del tab Claude Code (por bisección con `git stash`,
    ver gotcha 3): main mostraba `claude-fable-5`/`claude-opus-4-8`/… sin Opus 5;
    con F19 muestra `opus[1m]` (Opus 5) primero, con su selector de razonamiento.

### Bitácora F19 — gotchas

1. **`supportedModels()` exige modo STREAMING INPUT y un generador que NO
   yieldee.** Con `prompt` como string no hay objeto `Query` sobre el que pedir
   control requests; con un generador que cierra de inmediato, el CLI ve EOF en
   stdin y puede salir antes de responder. El generador correcto se queda
   esperando el `abort` y termina ahí. Como no yieldea, `eslint require-yield`
   protesta: el disable va en su propia línea, pegado a la función (un comentario
   multilínea entre el disable y el `function` rompe el targeting de
   `eslint-disable-next-line` y el disable queda "unused" **y** el error sigue).
2. **El fallback curado también envejece.** Dejarlo con ids versionados
   (`claude-opus-4-8`) reproduce el bug original en el caso "CLI ausente". La
   primera entrada es ahora el ALIAS DE FAMILIA `opus`, que resuelve siempre al
   Opus más nuevo de la cuenta. Corolario: agregar modelos a mano a
   `shared/ai-providers.ts` ya NO es necesario para que aparezcan.
3. **Un aviso raro en una captura no es automáticamente tu regresión.** La
   captura de verificación mostraba «No se encontró el CLI `claude`» en el tab de
   Claude Code *mientras* el picker mostraba los modelos que ese mismo CLI acaba
   de reportar. Antes de investigarlo como propio: `git stash -u` + build +
   correr el MISMO test contra `main` — el aviso ya estaba. Es un desacuerdo
   preexistente entre `cli-probe.ts` y `resolve-cli.ts` bajo Xvfb, sin relación
   con F19 (queda pendiente, ver abajo).
4. **Calentar el catálogo en TODO análisis rompió un spec que no tiene nada que
   ver — otra vez el patrón del gotcha 7 de F18.** La primera versión de T101
   hacía `await warmProviderModels(provider)` sin condición al empezar cada
   análisis. Con OpenCode activo eso arranca su server (segundos en frío) ANTES
   de que el streaming empiece, y `harness-activity.spec.ts` —que muestrea 14
   veces cada 120 ms, o sea una ventana de 1,7 s— no llegaba a ver ni un solo
   evento: `midState` quedaba `null` y el error hablaba de `activity`, no de
   latencia. La lección repetida: **un await nuevo en un camino caliente se paga
   en specs ajenos y el síntoma no lo señala.** Arreglo:
   `providerNeedingCatalogWarmup()` devuelve `null` salvo que NINGÚN catálogo
   (dinámico ni curado) conozca el modelo activo — el caso "modelo nuevo, app
   recién arrancada", que es el único donde calentar aporta algo.
5. **Un e2e que elige su dato del catálogo ESTÁTICO deja de ser determinista en
   cuanto ese catálogo se vuelve dinámico.** `settings.spec.ts` tomaba
   `snapshot.catalog['claude-code'].models[0].id` y después clickeaba la card con
   ese texto: con F19 las cards ya no son las curadas. Ahora el target sale del
   MISMO canal que puebla el picker (`ai:getProviderModels`), que degrada al
   curado si el CLI no está — determinista con y sin `claude` instalado.

### Pendiente detectado en F19 (no es parte de F19)

- **`cli-probe.ts` reporta `not-found` para `claude` en un entorno donde
  `resolve-cli.ts` SÍ lo encuentra** (reproducido bajo Xvfb, presente en `main`
  desde antes de F19). Efecto: el tab de Claude Code muestra la guía "instalá el
  CLI" aunque el CLI funcione y sus modelos se listen. Vale una tarea propia:
  los dos módulos resuelven el binario por el mismo camino, así que la
  divergencia apunta al `execFile(path, ['--version'])` con
  `PROBE_TIMEOUT_MS = 4000` (arranque frío del CLI) o a la interacción con
  `clearCliPathCache`.

## F20 — Fuga de servers `opencode serve` huérfanos (2026-07-25)

> Motivación (del usuario, 2026-07-25, con captura de btop): 53 procesos
> `opencode` huérfanos y 14,4 GB de RAM ocupada tras las corridas de e2e.
> «Podemos revisar la causa o agregar una limpieza al final de los tests».
> Se hizo lo primero (era un bug de PRODUCCIÓN, no de los tests) y también lo
> segundo, como red.

- [x] **T104. Causa raíz: el hijo no quedaba registrado hasta estar "ready"**
  - `main/ai/providers/opencode-runtime.ts` asignaba `serverChild = child` DENTRO
    del handler de stdout, al parsear la línea `opencode server listening`.
    Durante todo el arranque —segundos en frío: el wrapper de omarchy resuelve el
    binario por npx— `serverChild` seguía en `null`, así que
    `stopOpencodeServer()` (que arranca con `const child = serverChild`) era un
    **no-op**. Cerrar la app en esa ventana dejaba el proceso vivo, y
    `detached: true` (necesario para el kill de GRUPO) lo hace líder de su propio
    grupo, así que tampoco se lo llevaba la muerte del padre: quedaba reparentado
    a init (`ppid=1`), ~300 MB, para siempre.
  - Arreglo: registrar `serverChild` INMEDIATAMENTE después del `spawn`, con un
    `unregister()` en los tres caminos de fallo (timeout, `error`, `exit` antes de
    ready) para no pisar un server posterior. En el handler de ready, si el
    registro ya no apunta a este hijo, el server está condenado (recibió el
    SIGTERM) y se rechaza en vez de publicarlo como singleton vivo — antes eso
    habría dejado una URL muerta en la cache.
  - **No era un problema solo de tests:** cualquier usuario que cerrara Minerva
    mientras el server arrancaba dejaba el mismo huérfano de 300 MB.
  - Por qué escalaba tanto en e2e: `DidacticAnalysisArea` pide
    `ai:getProviderStatus` al montarse, y `probeOpencode()` levanta el server
    local — o sea, **cada uno de los 39 launches spawnea uno**, incluso con
    `MINERVA_MOCK_AI=1` (ese flag corta antes de la IA, no antes del probe de
    CLIs).

- [x] **T104.b Segunda mitad: cancelar el arranque que todavía no spawneó**
  - Con T104 la suite completa bajó de decenas de huérfanos a **uno**, y el log
    del teardown (diseñado para ser ruidoso) lo delató. Causa: `spawnOpencodeServer`
    espera `findEphemeralPort()` —async, abre y cierra un socket— ANTES del
    `spawn`. Un `stopOpencodeServer()` en esa ventana limpiaba el singleton y
    devolvía sin nada que matar, y la promesa en vuelo seguía adelante creando el
    proceso DESPUÉS, con la app ya cerrándose: huérfano garantizado.
  - Arreglo: contador `spawnGeneration`, que `stopOpencodeServer()` incrementa;
    el intento en vuelo compara su generación justo antes de spawnear y se
    rechaza si cambió. "No hay nada que matar" ya no puede significar "el proceso
    se va a crear en un segundo y nadie lo va a matar".

- [x] **T105. Red de seguridad: barrido por test + `globalTeardown`**
  - `e2e/opencode-sweep.ts` (NUEVO): mata servers huérfanos con selección
    deliberadamente estrecha — SOLO si (a) tiene `PLAYWRIGHT_TEST=1` en
    `/proc/<pid>/environ` (lo pone `fixtures.ts`), así la sesión de `opencode` del
    usuario o la de Minerva en dev nunca entran, y (b) `ppid === 1`, así nunca se
    le toca el server a una app que todavía vive. Mata el GRUPO (pid negativo).
    Solo Linux (`/proc`); en otras plataformas devuelve `[]` y quien llama lo DICE,
    en vez de fingir que barrió.
  - Se llama en `closeMinerva` (**por test**, no solo al final) para que un leak
    no se arrastre por los 10 min de suite, y en `e2e/global-teardown.ts` +
    `globalTeardown` del config como red para el test que ni llega a su teardown.
  - Loguea CUÁL test lo dejó (derivado de `MINERVA_USER_DATA_DIR`): un barrido
    silencioso taparía la regresión siguiente. Fue justamente ese log el que
    identificó al último superviviente en un minuto (ver gotcha 4).

- [x] **T106. Verificación (bisección, no confianza)**
  - Sonda e2e temporal que cierra la app EN PLENA ventana de arranque del server:
    con el código viejo → `LEAKED = 1` (y el teardown lo reportó y lo mató, lo que
    validó la red en la misma corrida); con el arreglo → `LEAKED = 0` y teardown
    en silencio. La sonda se borró después.
  - Test de regresión en `opencode-runtime.test.ts`: `stopOpencodeServer()` manda
    `SIGTERM` al grupo de un server que todavía no imprimió su línea de ready, y
    el arranque que termina después se rechaza en vez de publicarse.
  - `npm run verify` verde (758 tests) + suite e2e completa, midiendo procesos y
    RAM antes/después.
  - Los 53 huérfanos acumulados se mataron con el mismo criterio del teardown
    (`PLAYWRIGHT_TEST=1`): RAM de 14,4 GB a 2 GB.

### Bitácora F20 — gotchas

1. **`detached: true` convierte "el padre murió" en "el hijo vive para siempre".**
   Se puso para poder matar el GRUPO (robustez ante wrappers que no hagan `exec`),
   y el precio es que el hijo NO hereda la muerte del padre. Con eso, cualquier
   camino en el que el registro del pid esté vacío no es "no había nada que
   matar": es un huérfano garantizado. Dos reglas para futuros spawns `detached`:
   registrar el pid en el MISMO tick del spawn (nunca cuando el proceso "esté
   listo"), y hacer CANCELABLE todo lo asíncrono que ocurra ANTES del spawn — un
   `await` previo (acá `findEphemeralPort()`) es una ventana en la que el killer
   no ve nada y el proceso todavía va a nacer.
2. **`MINERVA_MOCK_AI=1` no evita spawnear CLIs de IA.** Corta en
   `createAiService` (main/ai/index.ts), que está DESPUÉS del probe de estado de
   los proveedores. El panel didáctico pide ese probe al montarse, así que hasta
   el test más ajeno a la IA levanta un `opencode serve` de 300 MB. Si alguna vez
   hace falta bajar el consumo de la suite, ese es el lugar — no el teardown.
3. **Un teardown que barre en silencio esconde la regresión que viene.** El
   `console.log` con la cuenta es parte del diseño: la red existe para que la
   máquina no se llene, no para que nadie note que la limpieza real se rompió.
4. **`dist/linux-unpacked` es un TERCER build que hay que rehacer.** Con T104 +
   T104.b aplicados, la suite seguía reportando exactamente 1 superviviente por
   corrida. No era una tercera causa: `packaged.spec.ts` corre el binario de
   `dist/`, empaquetado ANTES del arreglo, o sea con el main viejo. `npm run build`
   no lo toca — hace falta `npm run dist:dir`. Dos corridas de 10 minutos se
   fueron persiguiendo ese fantasma; lo que lo resolvió fue hacer que el barrido
   dijera de QUÉ test venía el huérfano (un minuto). Regla: cuando se arregla algo
   del proceso main y `packaged.spec.ts` está en juego, `dist:dir` también hay que
   rehacerlo — es el mismo tropiezo que la versión desalineada de T99/T103, con
   otra cara.
