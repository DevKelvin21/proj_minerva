/**
 * `GET /user` contra la API de GitHub, dado un token válido.
 *
 * Used by `./gh-cli-auth.ts` to validate the token from `gh auth token`.
 *
 * F18: lleva TIMEOUT. Mientras `gh-cli` fue opt-in, un `fetch` sin plazo era
 * tolerable; desde que es el modo por defecto, este `GET /user` está en el
 * camino de CADA arranque y de cada probe. Sin plazo, una red que no responde
 * (portal cautivo, VPN a medias) deja la promesa colgada para siempre — y
 * como `ghCliAuth` cachea la promesa en vuelo (single-flight), esa espera
 * infinita se propagaría a todos los `scm:getAuthStatus` siguientes.
 */
import { GITHUB_USER_API_URL } from './config'
import type { UserRef } from '../../../shared/types'

/** Plazo del `GET /user`: holgado para una red lenta, acotado para no colgar el probe. */
const GITHUB_USER_TIMEOUT_MS = 10_000

export async function fetchGithubUser(token: string): Promise<UserRef> {
  const response = await fetch(GITHUB_USER_API_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    },
    signal: AbortSignal.timeout(GITHUB_USER_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`GET /user respondió ${response.status}`)
  }
  const data = (await response.json()) as { login: string; avatar_url: string }
  return { login: data.login, avatarUrl: data.avatar_url }
}
