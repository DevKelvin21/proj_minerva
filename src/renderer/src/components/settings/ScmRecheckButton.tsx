import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../../stores/app-store'
import { errorText } from '../../lib/error-text'
import { Button } from '../ui/Button'

/**
 * "Check again" of a source-control page's Connection row: asks main for the
 * auth status now (`scm:getAuthStatus`) instead of waiting for the poll in
 * `use-scm-auth.ts`, and stores it where every surface reads it.
 */
export function ScmRecheckButton(): React.JSX.Element {
  const { t } = useTranslation()
  const setScmAuth = useAppStore((s) => s.setScmAuth)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function recheck(): Promise<void> {
    setChecking(true)
    setError(null)
    try {
      setScmAuth(await window.minerva.scm.getAuthStatus())
    } catch (err: unknown) {
      setError(errorText(err))
    } finally {
      setChecking(false)
    }
  }

  return (
    <span className="flex min-w-0 flex-col items-end gap-1">
      <Button
        size="sm"
        onClick={() => void recheck()}
        disabled={checking}
        icon={<RefreshCw size={12} className={checking ? 'animate-spin' : ''} aria-hidden />}
      >
        {t('settings.scmPage.recheck')}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </span>
  )
}
