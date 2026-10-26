/** GitHub endpoints and host used by the `gh` token bridge. */

export const GITHUB_USER_API_URL = 'https://api.github.com/user'

/**
 * GitHub host passed to `gh auth token --hostname` (`gh` can hold sessions for
 * several hosts, GHES included). Only `github.com` for now; GHES would be a
 * matter of parameterizing this constant.
 */
export const GH_HOSTNAME = 'github.com'
