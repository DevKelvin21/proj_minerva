/**
 * Constantes del auto-updater (T91, F17) + construcción/validación de la
 * `releaseUrl` que consume `UpdateInfoLite` (`../../shared/types.ts`).
 *
 * `ALLOW_PRERELEASE = true`: Minerva es beta y TODAS las releases existentes
 * hoy están marcadas pre-release (ver bitácora de F17 en `.agents/TASKS.md`)
 * — sin esto el updater nunca vería ninguna. Es la palanca de UNA línea para
 * el día que Minerva deje de ser beta (decisión 7 de `PLAN.md` § F17); un
 * toggle en Settings queda fuera de alcance de F17 a propósito.
 */
export const ALLOW_PRERELEASE = true

/** Chequeo periódico contra el feed, además del de arranque y el botón manual (decisión 5 de `PLAN.md` § F17). */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/** Delay del primer chequeo tras `app.whenReady()`: no competir con el login ni con la carga de PRs (decisión 5). */
export const STARTUP_DELAY_MS = 60 * 1000

/** Dueño/repo del feed de GitHub releases — mismo owner/repo que la sección `publish` de `electron-builder.yml` (T89). */
export const RELEASE_OWNER = 'DevKelvin21'
export const RELEASE_REPO = 'proj_minerva'

/**
 * Semver "clásico" (major.minor.patch con prerelease/build opcionales, RFC
 * de semver.org simplificada) — suficiente para validar que una `version`
 * (la del feed de `electron-updater`, o la que arma el guion del mock) es
 * segura de interpolar en una URL. Anclado (`^...$`) para que un string con
 * basura DESPUÉS de una porción válida ("1.2.3 && rm -rf") no pase.
 */
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

/** `true` if `version` has the classic semver shape above (shared with `./release-feed.ts`, which validates GitHub tag names with the same gate). */
export function isSemver(version: string): boolean {
  return SEMVER_RE.test(version)
}

/**
 * Construye la URL de la release en GitHub para `version` — **siempre**
 * desde esta plantilla hardcodeada con `RELEASE_OWNER`/`RELEASE_REPO`, jamás
 * con una URL que venga tal cual del feed de `electron-updater` (frontera de
 * seguridad de `PLAN.md` § F17). `undefined` si `version` no valida como
 * semver: decisión de F17 (ver `./updater.ts`) es que una versión que no
 * valida NO produce una `UpdateInfoLite` en absoluto — el estado pasa a
 * `error` en vez de a `available`/`unsupported` con una URL rota o ausente,
 * preferible fallar visible antes que ofrecer un link roto.
 */
export function buildReleaseUrl(version: string): string | undefined {
  if (!isSemver(version)) return undefined
  return `https://github.com/${RELEASE_OWNER}/${RELEASE_REPO}/releases/tag/v${version}`
}
