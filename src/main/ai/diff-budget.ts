/**
 * Presupuesto de tamaño para los diffs que se mandan al modelo. Un PR grande
 * puede tener patches de cientos de miles de caracteres — mandarlos enteros
 * revienta el contexto (y el costo) de la llamada al proveedor de IA activo.
 * Este módulo arma, por archivo, un bloque de texto para el prompt,
 * respetando un presupuesto total: trunca el patch del archivo que lo agota
 * y omite del todo los archivos que ya no entran.
 */
import type { DiffFile } from '../../shared/types'

/** ~60k chars total repartidos entre todos los patches del PR. */
export const TOTAL_DIFF_BUDGET_CHARS = 60_000

const TRUNCATION_NOTE = '\n[truncado por límite de tamaño del prompt]'

export interface DiffBudgetResult {
  /** Un bloque de texto por archivo incluido (con o sin truncar), en el orden original. */
  blocks: string[]
  /** Paths de archivos que no entraron en absoluto por falta de presupuesto. */
  omittedFiles: string[]
}

function fileHeader(file: DiffFile): string {
  const rename = file.previousPath ? ' (antes: ' + file.previousPath + ')' : ''
  return '### ' + file.path + rename + ' — ' + file.status + ' (+' + file.additions + '/-' + file.deletions + ')\n'
}

/**
 * Reparte `TOTAL_DIFF_BUDGET_CHARS` entre los archivos en el orden en que
 * vienen (se asume que el `ScmProvider` ya los devuelve en un orden razonable,
 * p. ej. el de GitHub). Un archivo sin `patch` (binario, o sin diff de texto)
 * se incluye solo con su header, sin consumir presupuesto de patch.
 */
export function buildDiffBudget(files: DiffFile[]): DiffBudgetResult {
  let remaining = TOTAL_DIFF_BUDGET_CHARS
  const blocks: string[] = []
  const omittedFiles: string[] = []

  for (const file of files) {
    const header = fileHeader(file)

    if (file.isBinary || !file.patch) {
      blocks.push(header + '(sin patch de texto — archivo binario u omitido por GitHub)\n')
      continue
    }

    if (remaining - header.length <= 0) {
      omittedFiles.push(file.path)
      continue
    }

    const availableForPatch = remaining - header.length
    let patch = file.patch

    if (patch.length > availableForPatch) {
      const cutAt = Math.max(0, availableForPatch - TRUNCATION_NOTE.length)
      patch = patch.slice(0, cutAt) + TRUNCATION_NOTE
    }

    blocks.push(header + '```diff\n' + patch + '\n```\n')
    remaining -= header.length + patch.length
    // Si se truncó, `remaining` queda en (o cerca de) cero: los archivos
    // siguientes se omiten por el chequeo de arriba, sin lógica especial acá.
  }

  return { blocks, omittedFiles }
}
