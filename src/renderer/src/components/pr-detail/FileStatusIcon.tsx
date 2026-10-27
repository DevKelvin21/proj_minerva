import { ArrowRightLeft, FileDiff, FileMinus2, FilePlus2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DiffFileStatus } from '../../../../shared/types'

interface FileStatusIconProps {
  status: DiffFileStatus
  size?: number
}

/** Icono de status por archivo: A verde, M amarillo, D rojo, R azul. */
export function FileStatusIcon({ status, size = 14 }: FileStatusIconProps): React.JSX.Element {
  const { t } = useTranslation()
  switch (status) {
    case 'added':
      return <FilePlus2 size={size} className="shrink-0 text-success" aria-label={t('prDetail.fileStatus.added')} />
    case 'removed':
      return <FileMinus2 size={size} className="shrink-0 text-danger" aria-label={t('prDetail.fileStatus.removed')} />
    case 'renamed':
      return (
        <ArrowRightLeft
          size={size}
          className="shrink-0 text-info"
          aria-label={t('prDetail.fileStatus.renamed')}
        />
      )
    default:
      return <FileDiff size={size} className="shrink-0 text-warning" aria-label={t('prDetail.fileStatus.modified')} />
  }
}
