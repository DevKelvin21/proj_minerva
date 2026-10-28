/** Shared by `Card` and `SelectableCard`: one radius, one border, one padding scale. */

export type CardPadding = 'sm' | 'md'

export const CARD_BASE = 'flex min-w-0 flex-col rounded-lg border'

export const CARD_PADDING: Record<CardPadding, string> = {
  sm: 'gap-1.5 p-2.5',
  md: 'gap-2 p-3',
}
