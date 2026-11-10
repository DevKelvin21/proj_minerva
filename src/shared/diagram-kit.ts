/**
 * The diagram kit: the stylesheet every AI-written HTML diagram gets inside
 * its sandboxed iframe (`renderer/src/lib/diagram-document.ts`), and the
 * vocabulary the analysis prompt teaches the model (`main/ai/prompts/
 * analyze-pr.ts`). Shared so both sides name the same classes; a unit test
 * checks every class the prompt mentions exists here.
 *
 * Colors only come from the active theme: the document sets the `--theme-*`
 * properties of `shared/theme/appearance.ts` (`themeCssVariables`) on `:root`
 * and this sheet derives the short names the model uses (`--text`,
 * `--accent`, `--success-soft`, ...), with the same contrast formulas as
 * `renderer/src/styles.css`.
 *
 * Plain CSS in a quoted string (no backticks, gotcha 3), no `url()`: the
 * iframe's CSP blocks every fetch anyway.
 */

/** Short names the model may use in its own `<style>` or `style=""`. */
export const DIAGRAM_KIT_VARIABLES = [
  '--bg',
  '--panel',
  '--raised',
  '--text',
  '--muted',
  '--border',
  '--accent',
  '--accent-fg',
  '--success',
  '--danger',
  '--warning',
  '--info',
  '--merged',
  '--code-bg',
  '--accent-soft',
  '--success-soft',
  '--danger-soft',
  '--warning-soft',
  '--info-soft',
  '--merged-soft',
  '--font-sans',
  '--font-mono',
  '--radius',
] as const

/** Classes of the kit, as the prompt lists them. */
export const DIAGRAM_KIT_CLASSES = [
  'diagram',
  'row',
  'col',
  'grid',
  'node',
  'name',
  'meta',
  'new',
  'changed',
  'removed',
  'focus',
  'external',
  'group',
  'label',
  'edge',
  'down',
  'both',
  'tag',
  'legend',
  'entities',
  'entity',
  'pk',
  'fk',
  'rel',
  'steps',
  'actor',
  'msg',
  'note',
  'mono',
  's-node',
  's-new',
  's-changed',
  's-removed',
  's-focus',
  's-edge',
  's-arrowhead',
  's-label',
  's-muted',
] as const

const LINE = '1.5px'
const HEAD = '8px'

export const DIAGRAM_KIT_CSS =
  ':root {' +
  '  --bg: var(--theme-canvas);' +
  '  --panel: var(--theme-surface);' +
  '  --raised: var(--theme-surface-raised, var(--theme-surface));' +
  '  --text: color-mix(in oklab, color-mix(in oklab, var(--theme-text) var(--appearance-contrast-base), var(--theme-canvas)), var(--appearance-contrast-target) var(--appearance-contrast-boost));' +
  '  --muted: color-mix(in oklab, color-mix(in oklab, var(--theme-text-muted) var(--appearance-contrast-base), var(--theme-canvas)), var(--appearance-contrast-target) var(--appearance-contrast-boost));' +
  '  --border: color-mix(in srgb, color-mix(in srgb, var(--theme-border) var(--appearance-contrast-base), transparent), var(--theme-text) var(--appearance-contrast-border-boost));' +
  '  --accent: var(--theme-accent);' +
  '  --accent-fg: var(--theme-accent-foreground);' +
  '  --success: var(--theme-success);' +
  '  --danger: var(--theme-error);' +
  '  --warning: var(--theme-warning);' +
  '  --info: var(--theme-info);' +
  '  --merged: var(--theme-merged);' +
  '  --code-bg: var(--theme-code-background);' +
  '  --accent-soft: color-mix(in oklab, var(--accent) 16%, var(--panel));' +
  '  --success-soft: color-mix(in oklab, var(--success) 16%, var(--panel));' +
  '  --danger-soft: color-mix(in oklab, var(--danger) 16%, var(--panel));' +
  '  --warning-soft: color-mix(in oklab, var(--warning) 16%, var(--panel));' +
  '  --info-soft: color-mix(in oklab, var(--info) 16%, var(--panel));' +
  '  --merged-soft: color-mix(in oklab, var(--merged) 16%, var(--panel));' +
  "  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;" +
  "  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;" +
  '  --radius: 8px;' +
  '}' +
  ":root[data-appearance='light'] { --appearance-contrast-target: black; color-scheme: light; }" +
  ":root[data-appearance='dark'] { --appearance-contrast-target: white; color-scheme: dark; }" +
  '*, *::before, *::after { box-sizing: border-box; }' +
  'html { margin: 0; padding: 4px; background: transparent; }' +
  'body { margin: 0; background: transparent; color: var(--text); font: 13px/1.45 var(--font-sans); overflow-wrap: anywhere; }' +
  'svg { max-width: 100%; height: auto; color: var(--text); font-family: var(--font-sans); }' +
  // Layout
  '.diagram { display: flex; flex-direction: column; gap: 12px; }' +
  '.row { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 6px; }' +
  '.col { display: flex; flex-direction: column; align-items: center; gap: 6px; }' +
  '.grid { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }' +
  // Nodes
  '.node { min-width: 0; max-width: 240px; padding: 8px 12px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--raised); text-align: center; }' +
  '.node .name { display: block; font-weight: 600; }' +
  '.node .meta { display: block; color: var(--muted); font-size: 11px; }' +
  '.node.new { border-color: var(--success); background: var(--success-soft); }' +
  '.node.changed { border-color: var(--warning); background: var(--warning-soft); }' +
  '.node.removed { border-color: var(--danger); background: var(--danger-soft); }' +
  '.node.removed .name { text-decoration: line-through; }' +
  '.node.focus { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }' +
  '.node.external { border-style: dashed; background: transparent; }' +
  // Groups
  '.group { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px dashed var(--border); border-radius: calc(var(--radius) + 2px); }' +
  '.group > .label { color: var(--muted); font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }' +
  // Edges: a labelled arrow between two siblings of a .row (or .col with .down)
  '.edge { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; min-width: 48px; max-width: 140px; color: var(--muted); font-size: 11px; line-height: 1.2; text-align: center; }' +
  '.edge::after { content: ""; display: block; align-self: stretch; height: ' + HEAD + '; background: currentColor;' +
  '  clip-path: polygon(0 calc(50% - 0.75px), calc(100% - ' + HEAD + ') calc(50% - 0.75px), calc(100% - ' + HEAD + ') 0, 100% 50%, calc(100% - ' + HEAD + ') 100%, calc(100% - ' + HEAD + ') calc(50% + 0.75px), 0 calc(50% + 0.75px)); }' +
  '.edge.both::after { clip-path: polygon(0 50%, ' + HEAD + ' 0, ' + HEAD + ' calc(50% - 0.75px), calc(100% - ' + HEAD + ') calc(50% - 0.75px), calc(100% - ' + HEAD + ') 0, 100% 50%, calc(100% - ' + HEAD + ') 100%, calc(100% - ' + HEAD + ') calc(50% + 0.75px), ' + HEAD + ' calc(50% + 0.75px), ' + HEAD + ' 100%); }' +
  '.edge.down { flex-direction: row; min-width: 0; max-width: none; min-height: 32px; align-self: center; }' +
  '.edge.down::after { order: -1; align-self: stretch; width: ' + HEAD + '; height: auto; min-height: 28px;' +
  '  clip-path: polygon(calc(50% - 0.75px) 0, calc(50% + 0.75px) 0, calc(50% + 0.75px) calc(100% - ' + HEAD + '), 100% calc(100% - ' + HEAD + '), 50% 100%, 0 calc(100% - ' + HEAD + '), calc(50% - 0.75px) calc(100% - ' + HEAD + ')); }' +
  '.edge.down.both::after { clip-path: polygon(50% 0, 100% ' + HEAD + ', calc(50% + 0.75px) ' + HEAD + ', calc(50% + 0.75px) calc(100% - ' + HEAD + '), 100% calc(100% - ' + HEAD + '), 50% 100%, 0 calc(100% - ' + HEAD + '), calc(50% - 0.75px) calc(100% - ' + HEAD + '), calc(50% - 0.75px) ' + HEAD + ', 0 ' + HEAD + '); }' +
  // Narrow panel (the frame's own width): a wrapped chain would leave arrows
  // pointing at nothing, so chains stack vertically and arrows point down.
  '@media (max-width: 520px) {' +
  '  .row { flex-direction: column; flex-wrap: nowrap; }' +
  '  .row > .group { align-self: stretch; }' +
  '  .row > .edge { flex-direction: row; min-width: 0; max-width: none; min-height: 32px; }' +
  '  .row > .edge::after { order: -1; align-self: stretch; width: ' + HEAD + '; height: auto; min-height: 28px;' +
  '    clip-path: polygon(calc(50% - 0.75px) 0, calc(50% + 0.75px) 0, calc(50% + 0.75px) calc(100% - ' + HEAD + '), 100% calc(100% - ' + HEAD + '), 50% 100%, 0 calc(100% - ' + HEAD + '), calc(50% - 0.75px) calc(100% - ' + HEAD + ')); }' +
  '  .row > .edge.both::after { clip-path: polygon(50% 0, 100% ' + HEAD + ', calc(50% + 0.75px) ' + HEAD + ', calc(50% + 0.75px) calc(100% - ' + HEAD + '), 100% calc(100% - ' + HEAD + '), 50% 100%, 0 calc(100% - ' + HEAD + '), calc(50% - 0.75px) calc(100% - ' + HEAD + '), calc(50% - 0.75px) ' + HEAD + ', 0 ' + HEAD + '); }' +
  '}' +
  '.edge.new { color: var(--success); }' +
  '.edge.changed { color: var(--warning); }' +
  '.edge.removed { color: var(--danger); }' +
  // Tags and legend
  '.tag { display: inline-block; padding: 0 6px; border: 1px solid var(--border); border-radius: 999px; color: var(--muted); font-size: 10px; font-weight: 600; line-height: 16px; vertical-align: middle; }' +
  '.tag.new { border-color: var(--success); color: var(--success); }' +
  '.tag.changed { border-color: var(--warning); color: var(--warning); }' +
  '.tag.removed { border-color: var(--danger); color: var(--danger); }' +
  '.legend { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; }' +
  // Entities (ER)
  '.entities { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: center; gap: 10px; }' +
  'table.entity { border-collapse: separate; border-spacing: 0; min-width: 0; border: 1px solid var(--border); border-radius: var(--radius); background: var(--raised); font-size: 12px; overflow: hidden; }' +
  'table.entity caption { padding: 6px 10px; border: 1px solid var(--border); border-bottom: 0; border-radius: var(--radius) var(--radius) 0 0; background: var(--panel); font-weight: 600; text-align: left; caption-side: top; }' +
  'table.entity td { padding: 3px 10px; border-top: 1px solid var(--border); }' +
  'table.entity td:nth-child(2) { color: var(--muted); font-family: var(--font-mono); font-size: 11px; }' +
  'table.entity tr.new td { background: var(--success-soft); }' +
  'table.entity tr.changed td { background: var(--warning-soft); }' +
  'table.entity tr.removed td { background: var(--danger-soft); text-decoration: line-through; }' +
  'table.entity.new { border-color: var(--success); }' +
  '.pk, .fk { margin-left: 4px; font-size: 9px; font-weight: 700; color: var(--accent); }' +
  '.fk { color: var(--info); }' +
  '.rel { align-self: center; color: var(--muted); font-family: var(--font-mono); font-size: 11px; }' +
  // Steps (sequence)
  'ol.steps { margin: 0; padding: 0; list-style: none; counter-reset: step; display: flex; flex-direction: column; gap: 4px; }' +
  'ol.steps > li { counter-increment: step; display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; padding: 5px 8px; border-left: 2px solid var(--border); background: var(--raised); border-radius: 0 6px 6px 0; }' +
  'ol.steps > li::before { content: counter(step); min-width: 16px; color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }' +
  'ol.steps > li.new { border-left-color: var(--success); }' +
  'ol.steps > li.changed { border-left-color: var(--warning); }' +
  'ol.steps > li.removed { border-left-color: var(--danger); }' +
  'ol.steps .actor { font-weight: 600; }' +
  'ol.steps .msg { color: var(--muted); font-family: var(--font-mono); font-size: 11px; }' +
  // Notes and code
  '.note { padding: 6px 10px; border-left: 3px solid var(--accent); border-radius: 0 6px 6px 0; background: var(--accent-soft); font-size: 12px; }' +
  '.mono, code { font-family: var(--font-mono); font-size: 0.92em; }' +
  // SVG helpers (CSS beats presentation attributes, so the model uses classes for color)
  '.s-node { fill: var(--raised); stroke: var(--border); stroke-width: 1; }' +
  '.s-new { fill: var(--success-soft); stroke: var(--success); }' +
  '.s-changed { fill: var(--warning-soft); stroke: var(--warning); }' +
  '.s-removed { fill: var(--danger-soft); stroke: var(--danger); }' +
  '.s-focus { stroke: var(--accent); stroke-width: 2; }' +
  '.s-edge { fill: none; stroke: var(--muted); stroke-width: ' + LINE + '; }' +
  '.s-arrowhead { fill: var(--muted); }' +
  '.s-label { fill: var(--text); font-size: 12px; }' +
  '.s-muted { fill: var(--muted); font-size: 11px; }'
