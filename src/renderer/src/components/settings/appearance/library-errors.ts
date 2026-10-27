import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { MAX_CUSTOM_THEMES } from '../../../../../shared/theme/appearance'
import { ThemeLibraryError } from '../../../../../shared/theme/library'
import { ThemeFileError } from '../../../../../shared/theme/themes'

/** Translated text for a theme library refusal. */
export function useLibraryErrorText(): (error: ThemeLibraryError) => string {
  const { t } = useTranslation()
  return useCallback(
    (error: ThemeLibraryError) => {
      switch (error.code) {
        case 'tooMany':
          return t('settings.appearance.errors.tooMany', { max: MAX_CUSTOM_THEMES })
        case 'missingVariant':
          return t('settings.appearance.errors.missingVariant')
        case 'readOnly':
          return t('settings.appearance.errors.readOnly')
        default:
          return t('settings.appearance.errors.notFound')
      }
    },
    [t],
  )
}

/** Translated text for anything an import can throw (theme file, VS Code theme, library). */
export function useImportErrorText(): (error: unknown) => string {
  const { t } = useTranslation()
  const libraryText = useLibraryErrorText()
  return useCallback(
    (error: unknown) => {
      if (error instanceof ThemeLibraryError) return libraryText(error)
      if (error instanceof SyntaxError) return t('settings.appearance.import.errors.invalidJson')
      if (!(error instanceof ThemeFileError)) return t('settings.appearance.import.errors.unknown')
      const vars = error.vars
      switch (error.code) {
        case 'version':
          return t('settings.appearance.import.errors.version')
        case 'name':
          return t('settings.appearance.import.errors.name')
        case 'appearance':
          return t('settings.appearance.import.errors.appearance')
        case 'unknownRole':
          return t('settings.appearance.import.errors.unknownRole', { role: vars.role ?? '' })
        case 'invalidColor':
          return t('settings.appearance.import.errors.invalidColor', { role: vars.role ?? '' })
        case 'noColors':
          return t('settings.appearance.import.errors.noColors')
        case 'id':
          return t('settings.appearance.import.errors.id')
        case 'reservedId':
          return t('settings.appearance.import.errors.reservedId', { id: vars.id ?? '' })
        case 'noEditorBackground':
          return t('settings.appearance.import.errors.noEditorBackground')
        default:
          return t('settings.appearance.import.errors.notTheme')
      }
    },
    [t, libraryText],
  )
}
