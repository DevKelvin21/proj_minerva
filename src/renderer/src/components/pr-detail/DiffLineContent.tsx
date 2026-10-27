import { tokenClass, tokenStyle, type HighlightToken } from '../../lib/highlighter'

interface DiffLineContentProps {
  content: string
  tokens?: HighlightToken[]
}

/**
 * Renderiza el contenido de una línea de diff. Si ya hay tokens de Shiki
 * disponibles los pinta como `<span>` con sus colores claro/oscuro como
 * custom properties inline (nunca HTML de
 * shiki vía `dangerouslySetInnerHTML`: el contenido del patch es entrada no
 * confiable). Si todavía no hay tokens (highlighting async en curso, o
 * lenguaje no soportado), cae a texto plano.
 */
export function DiffLineContent({ content, tokens }: DiffLineContentProps): React.JSX.Element {
  if (!tokens || tokens.length === 0) {
    return <>{content.length === 0 ? ' ' : content}</>
  }

  return (
    <>
      {tokens.map((token, index) => (
        <span key={index} className={tokenClass(token)} style={tokenStyle(token)}>
          {token.content}
        </span>
      ))}
    </>
  )
}
