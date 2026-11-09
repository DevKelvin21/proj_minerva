import { ICON_PX, type IconSize } from './icons'
import { PROVIDER_MARKS, type ProviderMarkName } from './provider-marks'

interface ProviderMarkProps {
  mark: ProviderMarkName
  size?: IconSize
  /**
   * The brand's own color where it has one (Azure, Claude). Off = the mark
   * in `currentColor`, like every other icon: use that in rows and chips.
   */
  color?: boolean
  className?: string
}

/** A provider's logo at one of the icon sizes; decorative (the caller names it). */
export function ProviderMark({
  mark,
  size = 'sm',
  color = false,
  className,
}: ProviderMarkProps): React.JSX.Element {
  const data = PROVIDER_MARKS[mark]
  const px = ICON_PX[size]
  return (
    <svg
      width={px}
      height={px}
      viewBox={data.viewBox}
      aria-hidden
      focusable="false"
      className={'shrink-0 ' + (className ?? '')}
    >
      <path d={data.d} fill={color && data.color ? data.color : 'currentColor'} />
    </svg>
  )
}
