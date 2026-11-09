import { Icon, type IconSize } from './Icon'
import { icons } from './icons'
import { useTranslation } from 'react-i18next'
import type { CiStatus } from '../../../../shared/types'

interface CiStatusIconProps {
  status: CiStatus
  size?: IconSize
}

/** Icono de estado de CI: verde/rojo/ámbar, o nada si aún no hay chequeos. */
export function CiStatusIcon({ status, size = 'sm' }: CiStatusIconProps): React.JSX.Element | null {
  const { t } = useTranslation()
  if (status === 'success') {
    return (
      <Icon
        icon={icons.success}
        size={size}
        className="shrink-0 text-success"
        aria-label={t('prList.ci.success')}
      />
    )
  }
  if (status === 'failure') {
    return (
      <Icon icon={icons.error} size={size} className="shrink-0 text-danger" aria-label={t('prList.ci.failure')} />
    )
  }
  if (status === 'pending') {
    return (
      <Icon
        icon={icons.pending}
        size={size}
        className="shrink-0 text-warning"
        aria-label={t('prList.ci.pending')}
      />
    )
  }
  return null
}
