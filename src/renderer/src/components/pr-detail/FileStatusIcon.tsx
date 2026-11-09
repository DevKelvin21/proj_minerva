import { Icon, type IconSize } from '../ui/Icon'
import { icons } from '../ui/icons'
import { useTranslation } from 'react-i18next'
import type { DiffFileStatus } from '../../../../shared/types'

interface FileStatusIconProps {
  status: DiffFileStatus
  size?: IconSize
}

/** Icono de status por archivo: A verde, M amarillo, D rojo, R azul. */
export function FileStatusIcon({ status, size = 'sm' }: FileStatusIconProps): React.JSX.Element {
  const { t } = useTranslation()
  switch (status) {
    case 'added':
      return <Icon icon={icons.fileAdded} size={size} className="shrink-0 text-success" aria-label={t('prDetail.fileStatus.added')} />
    case 'removed':
      return <Icon icon={icons.fileRemoved} size={size} className="shrink-0 text-danger" aria-label={t('prDetail.fileStatus.removed')} />
    case 'renamed':
      return (
        <Icon
          icon={icons.fileRenamed}
          size={size}
          className="shrink-0 text-info"
          aria-label={t('prDetail.fileStatus.renamed')}
        />
      )
    default:
      return <Icon icon={icons.changedFiles} size={size} className="shrink-0 text-warning" aria-label={t('prDetail.fileStatus.modified')} />
  }
}
