# Prompts de IA — `src/main/ai/prompts/`

> **i18n:** the prompt instructions are in English (`analyze-pr.ts`,
> `buildAnalyzeSystemPrompt(language)`); only the output-language rule changes with the UI
> language (`en` default, `es`). The handler captures the language when the analysis starts,
> passes it to the service and seals it as `DidacticAnalysis.language`. The protocol tokens,
> the prompt-injection rules and the Mermaid rules are unchanged by the translation.


Los prompts del pipeline didáctico viven versionados aquí, para poder auditarlos como
cualquier otro cambio de código (ver `CLAUDE.md`: "Prompts de IA versionados en archivos,
no strings inline dispersos").

> Actualizado en T9-final: el diseño previo de este README (clasificador + un prompt por
> categoría, Anthropic Agent SDK) quedó descartado por la decisión del dueño del proyecto
> de usar OpenRouter (multi-LLM, API OpenAI-compatible) en una única llamada de chat que
> clasifica y genera todas las secciones a la vez (`analyze-pr.ts`). Ver `.agents/PLAN.md`.

## Por qué `.ts` que exporta un string, y no `.md` + `fs.readFileSync`

La opción obvia sería escribir el prompt en `analyze-pr.md` y leerlo con
`fs.readFileSync(join(import.meta.dirname, 'analyze-pr.md'))` desde `openrouter-service.ts`.
Se descartó por cómo empaqueta `electron-vite` (Rollup) el proceso `main`:

- `main` se compila a un único `out/main/index.js` (ver `electron.vite.config.ts`, un solo
  entry point). Rollup **no copia archivos arbitrarios** (como un `.md`) al directorio de
  salida solo porque algún módulo los referencie con `fs.readFileSync` — esa llamada es
  invisible para el bundler (es una ruta de string en runtime, no un `import`). El `.md`
  tendría que agregarse a mano como asset estático en la config de build, y mantenerse
  sincronizado con la ruta relativa a `import.meta.dirname` en dev **y** en build (que no
  son el mismo árbol de directorios: `src/main/ai/prompts/` en dev vs. donde sea que el
  build decida copiar el asset).
- Un `.ts` que exporta el string, en cambio, es código TypeScript normal: Rollup lo incluye
  en el bundle como cualquier otro módulo importado, sin configuración extra, sin importar
  si se corre en dev o en build, y con el beneficio de quedar tipado (`export function
  buildAnalyzeSystemPrompt(language): string`) en vez de ser un valor `unknown` hasta el
  `readFileSync`.

El costo es que el prompt no se puede editar como Markdown "puro" — vive dentro de un
`.ts` con comillas y concatenación (ver el comentario de cabecera de `analyze-pr.ts` sobre
por qué **no** se usa un template literal de backticks para el string largo: es el mismo
gotcha de `vite:esm-shim` documentado en `.agents/TASKS.md` para los fixtures mock). Se
considera un costo aceptable frente a la fragilidad de empaquetar un asset `.md` aparte.

## Diseño del pipeline

Una sola llamada de chat a OpenRouter (no un pipeline multi-paso clasificar→generar):
`analyze-pr.ts` (`buildAnalyzeSystemPrompt`) le pide al modelo, en un único turno, que
clasifique el PR (architecture/endpoint/schema) y genere directamente las secciones que
detecte. Justificación: los modelos actuales de OpenRouter (Claude, GPT, etc.) clasifican
y redactan igual de bien en un solo turno que en dos, y evita una segunda llamada
(latencia + costo) solo para decidir qué generar.

> Actualizado en T13 (streaming): la forma de salida pedida al modelo ya NO es un
> objeto JSON. Ver la sección siguiente.

## Protocolo de salida (T13): texto tagueado por líneas, no JSON

Hasta T13, el prompt de sistema pedía un único objeto `{ "sections": [...] }` y
`../json-extract.ts` + `../section-mapper.ts` (`mapSections`) lo extraían/validaban tras
esperar la respuesta completa. Eso se descartó al agregar streaming: un JSON no se puede
renderizar de forma incremental sin re-parsear el objeto entero en cada delta (un string a
medio escapar no es JSON válido hasta que cierra), así que la UI se hubiera quedado sin
mostrar nada hasta el último token.

El prompt ahora pide un protocolo de texto por líneas, tagueado con marcadores `@@@...`
(ver el bloque "Exact output format" de `analyze-pr.ts` para el contrato completo y un
ejemplo corto):

```
@@@SECTION kind=summary
...markdown...
@@@SECTION kind=walkthrough
...intro opcional...
@@@LAYER cohort="Apply-coupon endpoint" title="Route wiring" files="src/routes/carts.ts:13,20-27;src/a.ts"
...markdown de ESA capa (y un @@@MERMAID opcional, también de la capa)...
@@@SECTION kind=architecture
...markdown...
@@@MERMAID
C4Container
  ...
@@@END_MERMAID
...más markdown opcional...
@@@SECTION kind=endpoint
...markdown...
@@@SNIPPET label=curl language=curl
curl -X POST ...
@@@END_SNIPPET
```

Reglas: los marcadores van solos en su línea y empiezan con `@@@`; `kind` es uno de
`summary|walkthrough|setup|architecture|endpoint|schema|cloud`; `@@@MERMAID`/`@@@SNIPPET`
pertenecen siempre a la sección abierta en ese momento; `@@@LAYER` solo vale dentro de
`walkthrough` (abre una capa: el markdown y el mermaid siguientes son de esa capa; `files`
usa líneas del archivo NUEVO, del viejo si el archivo se borró); todo lo demás es Markdown
de esa sección; nada puede quedar fuera de una sección.

`../stream-parser.ts` (`StreamSectionParser`) es el parser incremental que consume este
protocolo delta a delta según llegan los chunks SSE de OpenRouter (`../openrouter-service.ts`):
mantiene un `snapshot()` navegable para pintar el panel en vivo y un `finalize()` que
reutiliza la misma validación de forma que antes vivía en `mapSections`
(`mapRawSection`/`mapSnippet`, `../section-mapper.ts`) — una sección o snippet malformado
se descarta sin tumbar el resto, pero si ninguna sección sobrevive se lanza un error claro.
`../mock-service.ts` reutiliza el mismo parser (vía `stringifySections`, el inverso del
protocolo) para simular streaming real sobre sus fixtures estáticas, sin key ni costo.

## Convención

- Un archivo por prompt de sistema, `kebab-case.ts`, que exporta una única constante
  `UPPER_SNAKE_CASE` con el string completo.
- Español, igual que el resto de la UI y del contenido generado.
- Contenido no confiable del PR (título, descripción, diffs) nunca se concatena a este
  string de sistema: va en el mensaje de usuario, delimitado en un bloque `<pr_data>` con
  instrucciones explícitas de tratarlo como dato (ver `buildUserMessage` en
  `../openrouter-service.ts`, que usa `../diff-budget.ts` para el presupuesto de tamaño).
