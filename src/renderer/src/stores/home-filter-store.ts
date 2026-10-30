/**
 * The Home filter bar's state: the active filter (session only: it is gone
 * on the next launch, like the repo page's role filter) and the saved views
 * (this computer only, in `localStorage`, validated on read by
 * `parseSavedViews`: the stored text is untrusted). Views are a
 * prototype-less `id -> { name, filter }` map, like the custom feature names.
 */
import { create } from 'zustand'
import {
  addValue,
  cloneViews,
  emptyFilter,
  isFilterActive,
  isViewId,
  newViewId,
  normalizeViewName,
  parseSavedViews,
  removeValue,
  toggleValue,
  VIEWS_MAX,
  type FacetId,
  type FilterValue,
  type HomeFilter,
  type SavedViews,
} from '../lib/home-filter'

const VIEWS_KEY = 'minerva.homeViews'

function readViews(): Record<string, SavedViewEntry> {
  try {
    return parseSavedViews(window.localStorage.getItem(VIEWS_KEY))
  } catch {
    return Object.create(null)
  }
}

function writeViews(views: SavedViews): void {
  try {
    window.localStorage.setItem(VIEWS_KEY, JSON.stringify(views))
  } catch {
    // Session-only when storage is unavailable.
  }
}

type SavedViewEntry = SavedViews[string]

interface HomeFilterState {
  filter: HomeFilter
  /** The saved view last applied (or saved); `null` = none. Kept while the filter is edited. */
  activeViewId: string | null
  views: SavedViews
  setText: (text: string) => void
  /** Replaces the whole filter (typed tokens resolved into chips). */
  setFilter: (filter: HomeFilter) => void
  addValue: (facet: FacetId, value: FilterValue) => void
  removeValue: (facet: FacetId, key: string) => void
  toggleValue: (facet: FacetId, value: FilterValue) => void
  /** Back to the overview: no chips, no text, no active view. */
  clear: () => void
  /** Applies a view; applying the active one again clears the filter. */
  applyView: (id: string) => void
  /** Saves the current filter under `name`; returns the new id, or `null` when nothing was saved. */
  saveView: (name: string) => string | null
  /** Overwrites the active view's filter with the current one. */
  updateView: (id: string) => void
  deleteView: (id: string) => void
}

export const useHomeFilterStore = create<HomeFilterState>((set, get) => ({
  filter: emptyFilter(),
  activeViewId: null,
  views: readViews(),

  setText: (text) => set((state) => ({ filter: { ...state.filter, text } })),
  setFilter: (filter) => set({ filter }),
  addValue: (facet, value) => set((state) => ({ filter: addValue(state.filter, facet, value) })),
  removeValue: (facet, key) => set((state) => ({ filter: removeValue(state.filter, facet, key) })),
  toggleValue: (facet, value) =>
    set((state) => ({ filter: toggleValue(state.filter, facet, value) })),
  clear: () => set({ filter: emptyFilter(), activeViewId: null }),

  applyView: (id) =>
    set((state) => {
      if (!Object.hasOwn(state.views, id)) return {}
      if (state.activeViewId === id) return { filter: emptyFilter(), activeViewId: null }
      return { filter: state.views[id].filter, activeViewId: id }
    }),

  saveView: (name) => {
    const state = get()
    const clean = normalizeViewName(name)
    if (clean === null || !isFilterActive(state.filter)) return null
    if (Object.keys(state.views).length >= VIEWS_MAX) return null
    const id = newViewId(state.views)
    const next = cloneViews(state.views)
    next[id] = { name: clean, filter: state.filter }
    writeViews(next)
    set({ views: next, activeViewId: id })
    return id
  },

  updateView: (id) =>
    set((state) => {
      if (!isViewId(id) || !Object.hasOwn(state.views, id) || !isFilterActive(state.filter)) {
        return {}
      }
      const next = cloneViews(state.views)
      next[id] = { name: state.views[id].name, filter: state.filter }
      writeViews(next)
      return { views: next }
    }),

  deleteView: (id) =>
    set((state) => {
      if (!Object.hasOwn(state.views, id)) return {}
      const next = cloneViews(state.views)
      delete next[id]
      writeViews(next)
      return { views: next, activeViewId: state.activeViewId === id ? null : state.activeViewId }
    }),
}))
