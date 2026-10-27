# PLAN — proj_minerva

> Sandbox del plan de la tarea actual. Se actualiza al empezar/terminar cada fase.
> Control de tareas y bitácora: `TASKS.md`. Estrategia multi-agente: `WORKFLOW.md`.

## Iteración actual (2026-07-25): F17 — Auto-updater (v0.7.0)

Rama `feature/auto-updater` (desde `main`, post-merge de F16). Pedido de Edilson
(2026-07-25): *"quiero trabajar en una nueva rama para solucionar el autoupdater.
Este feature sí es un breaking change por lo tanto vamos a subir la versión a
v0.7.0"*.

**Breaking change de verdad, y por eso el bump de minor:** el auto-update solo
existe **de v0.7.0 en adelante**. Quien tenga 0.6.x instalada no tiene updater y
nunca se va a enterar de que hay versión nueva — necesita reinstalar a mano UNA
vez. Eso va explícito en las notas de la release.

### Diagnóstico: no es "arreglar" el updater, es que no existe — ni él ni su feed

`grep -rniE "autoupdat|electron-updater|feed.?url"` sobre `src/` sale limpio (los
hits son de `cli-probe.ts`, que habla de actualizar los CLIs de IA). Pero el
hueco no es solo de código: **la infraestructura de release tampoco puede
alimentar un updater**.

1. **`electron-builder.yml` no tiene sección `publish`.** Sin ella no se genera
   `app-update.yml` dentro del paquete ⇒ `electron-updater` lanza error en
   runtime apenas arranca. Es el primer bloqueante, no un detalle.
2. **El feed se genera pero nunca se sube.** `dist/latest-linux.yml` existe en
   local (quedó de la build de v0.1.0) — electron-builder lo escribe SIEMPRE,
   incluso con `--publish never`. `release.yml` sube solo `dist/*.AppImage` /
   `*.exe` / `*.dmg` con `gh release upload`, así que los `latest*.yml` y los
   `*.blockmap` (los que habilitan el update diferencial) se quedan en el runner.
   Verificado contra la release v0.6.0: 4 assets, ninguno de metadata.
3. **mac solo produce `dmg`.** Squirrel.Mac necesita **`zip`** además del dmg; sin
   él `latest-mac.yml` no sirve para nada.
4. **Versión y tags divergen**: `package.json` = 0.6.3, última release = v0.6.0.
   Hoy el mismatch es un `::warning::` que nadie lee. Con updater, un tag que no
   coincide con `package.json` publica un feed que apunta a una versión que la
   app instalada nunca va a reconocer ⇒ tiene que ser **fallo duro**.
5. **Ventana de feed roto**: el trigger es `on: release published`, así que la
   release existe ~10 min sin assets. Un cliente que chequee en esa ventana ve la
   versión nueva y un 404 del binario.

### Opciones evaluadas (2026-07-25) y por qué electron-updater

| Opción | Veredicto |
|---|---|
| `autoUpdater` nativo + `update.electronjs.org` (el link de la doc oficial) | **Descartada.** La doc lo dice explícito: macOS y Windows; **Linux no aparece**. Linux/AppImage es la plataforma principal de Edilson. Además exige Squirrel.Windows (hoy empaquetamos NSIS) y code-signing en macOS |
| Servidor propio (Hazel/Nuts/electron-release-server, o provider `generic` sobre S3/R2) | **Descartada** para producción: solo se justifica con repo privado o canales finos. `amiedygg/proj_minerva` es PÚBLICO. *(Se conserva como truco de testing local, ver T95)* |
| Check-and-notify sin descarga (API de releases + abrir el navegador) | **No como solución única**, pero SÍ como degradación obligatoria: hay instalaciones que físicamente no pueden auto-actualizarse |
| **`electron-updater` 6.8.9 + provider `github`** | **Elegida.** Es el updater del ecosistema electron-builder, que ya usamos (26.15.3). AppImage con delta por blockmap, NSIS, y macOS cuando haya firma. Sin servidor propio: el feed son los assets de la release pública. Valida SHA512 por archivo |

### Decisiones de producto (cerradas con Edilson, 2026-07-25)

| # | Decisión | Consecuencia técnica |
|---|---|---|
| 1 | **macOS: notify-only** por ahora; el Developer ID llega después | detectar app sin firmar ⇒ estado `unsupported` + link a la release. Aun así se agrega el target `zip` YA, para que el día del Developer ID sea solo firmar |
| 2 | **Windows: sin firmar** | el auto-update funciona igual; lo único que se pierde es quitar el aviso de SmartScreen. Integridad = SHA512 del `latest.yml` sobre HTTPS de github.com |
| 3 | **Descarga con consentimiento explícito** | `autoDownload: false` + UI de progreso. Son **130 MB** (medido en v0.6.0), no se bajan a espaldas del usuario |
| 4 | **Instalar al salir** | `autoInstallOnAppQuit: true`. Jamás un reinicio forzado a mitad de una review |
| 5 | **Al arrancar + cada 6 h + botón manual** en Settings | check inicial con delay de 60 s: no competir con el login ni con la carga de PRs |
| 6 | **tag → draft → publish** | mata la ventana de feed roto: la release nace draft (invisible para el updater) y se publica cuando los 3 SOs terminaron de subir |
| 7 | **Aceptar pre-releases** | `allowPrerelease: true`. Minerva es software beta; la constante vive en `updater/config.ts` para poder cambiarla en una línea |

**Nota sobre la 2 (para cuando se reabra):** desde junio 2023 el CA/Browser Forum
exige que la clave privada viva en hardware FIPS 140-2 L2, así que el flujo de
"`.pfx` en un secret de Actions" ya no existe. La vía moderna es Azure Artifact
Signing (ex Trusted Signing): ~10 USD/mes, sin token físico, integra con GitHub
Actions — el bloqueante ahí es la elegibilidad geográfica (US/Canadá/UE/UK), no
el precio. **Trap conocido:** si algún día firmamos y luego cambiamos de
certificado o de `publisherName`, los usuarios instalados quedan trabados con
*"New version is not signed by the application owner"* (electron-builder #5580,
#3667, #1773) y hay que reinstalar a mano.

### Arquitectura

#### Capacidad de actualización — el concepto central

Antes que cualquier otra cosa, main decide **qué puede hacer esta instalación**.
Sin esto el updater falla feo en la mitad de los escenarios reales:

```
'disabled'    → !app.isPackaged (dev y TODA la suite e2e), o MINERVA_UPDATER=off
'auto'        → linux con $APPIMAGE definido Y escribible (archivo + dir padre)
                win32
'notify'      → darwin (sin Developer ID — decisión 1)
                linux sin $APPIMAGE (linux-unpacked, paquete de distro)
                linux con $APPIMAGE no escribible (AppImageLauncher, /opt, root)
```

`notify` no es un error: es un estado de primera clase que consulta el feed,
compara semver y ofrece **abrir la página de la release**. Nunca descarga ni
instala.

#### Módulo `src/main/updater/`

- `config.ts` — constantes (`ALLOW_PRERELEASE`, `CHECK_INTERVAL_MS` 6 h,
  `STARTUP_DELAY_MS` 60 s, owner/repo).
- `capability.ts` — la tabla de arriba, pura y testeable (recibe
  `{ platform, isPackaged, env, accessSync }`, no toca `app` directo).
- `updater.ts` — singleton: cablea `electron-updater`, mantiene el
  `UpdaterStatus`, agenda los checks y hace broadcast a todas las ventanas.
- `mock-updater.ts` — guion determinista bajo `MINERVA_MOCK_UPDATER=1` (mismo
  criterio que `MINERVA_MOCK_AI`: es LA vía para ejercitar la UI en e2e, porque
  la app de la suite corre sin empaquetar y ahí el updater real está `disabled`).

#### Estado (contrato en `src/shared/types.ts`)

```ts
type UpdaterStatus =
  | { phase: 'disabled' }
  | { phase: 'unsupported'; reason: 'mac-unsigned' | 'not-appimage' | 'not-writable'
      ; available?: UpdateInfoLite }
  | { phase: 'idle'; lastCheckedAt?: string }
  | { phase: 'checking' }
  | { phase: 'available'; info: UpdateInfoLite }
  | { phase: 'downloading'; info: UpdateInfoLite; percent: number }
  | { phase: 'downloaded'; info: UpdateInfoLite }   // se instala al salir
  | { phase: 'error'; message: string; lastCheckedAt?: string }
```

#### Frontera de seguridad (lo que NO se hace)

- **Las release notes NO se renderizan.** Vienen de GitHub, son contenido no
  confiable, y `electron-updater` las entrega como **HTML crudo** ⇒ meterlas en
  el renderer es abrir un XSS por la puerta grande. En 0.7.0 se enlaza a la
  release y punto. (Recorte de alcance consciente, no olvido.)
- **La URL de la release la construye main**, desde una plantilla hardcodeada con
  owner/repo de `config.ts` y la versión **validada como semver**. Jamás se toma
  una URL que venga del feed.
- El preload expone funciones concretas (`window.minerva.updater.*`) y un método
  por evento (`onUpdaterStatus`), nunca `ipcRenderer` crudo — igual que
  `onAnalysisProgress`.
- Payloads validados por canal; los 4 canales nuevos son `void`, así que el
  validator rechaza cualquier cosa que no sea `undefined`.
- El updater corre en main ⇒ no toca la CSP del renderer.

#### UI

- **Sección "Actualizaciones" en Settings**: versión actual, botón "Buscar
  actualizaciones", estado, barra de progreso, "Se instalará al salir", link a la
  release. Hoy **no existe ningún "About"**: `app.getVersion()` no se muestra en
  ninguna parte de la app, así que el canal `minerva:getVersion` también es nuevo.
- **Badge discreto en el engrane de la TitleBar** cuando hay update disponible o
  descargada (reusa el patrón de "no leído" de la lista de PRs). **Nada de
  banners**: F16 dejó la TitleBar justa de ancho y el tier `sm` no tiene lugar.
- Ubicación en Settings: en una columna va al final; en dos columnas (≥980px, F16)
  va debajo de "Acceso a GitHub", la columna más corta. **Requisito duro
  heredado**: `github-mode.spec.ts` y `settings.spec.ts` exigen ciertos textos
  VISIBLES apenas abre el modal, sin clicks ⇒ prohibido un `<details>` cerrado o
  cualquier cosa que desmonte secciones.

#### Release pipeline (tag → draft → publish)

```
push tag v* ──► checks (typecheck+lint+test, 1 vez)
                  │
                  ▼
                draft: gh release create v$X --draft   ← crea el contenedor UNA vez
                  │                                       (evita la carrera de 3
                  ▼                                        runners creando drafts)
                build (matriz linux/win/mac, --publish always con GH_TOKEN)
                  │   sube instalador + latest*.yml + *.blockmap (+ zip en mac)
                  ▼
                publish: gh release edit v$X --draft=false
```

Con esto la release solo se vuelve visible para el updater cuando ya tiene TODO
subido. El check tag-vs-`package.json` pasa de warning a **fallo duro**.

`pr-dev-builds.yml` se queda con `--publish never`. Efecto secundario aceptado:
los dev builds ahora llevan `app-update.yml` embebido, así que una AppImage
`0.7.0-abc1234-dev` va a ofrecer actualizar a la 0.7.0 estable. Es correcto y
además útil.

### Verificación de la fase

1. `npm run verify` (typecheck + lint + test) en verde, con unit tests nuevos de
   `capability.ts` (matriz de plataforma/env) y de la construcción de la URL.
2. `npm run test:e2e` completo en verde bajo Xvfb, incluido `updater.spec.ts`
   nuevo (guion del mock: idle → checking → available → downloading → downloaded)
   **y su pasada tileada a 960×540**, donde la sección se alcanza por scroll
   (lección directa de F16: `scrollIntoViewIfNeeded()` es LA aserción de
   "contenido recortado").
3. **Prueba del update REAL sin quemar releases** (T95, la hace el orquestador):
   provider `generic` apuntando a un `python3 -m http.server` local que sirve un
   `dist/` con dos versiones, y la AppImage 0.7.0-rc corriendo de verdad (con
   `$APPIMAGE` definido). Es la única forma de comprobar que el reemplazo del
   archivo y el relanzamiento funcionan.
4. Capturas MIRADAS de la sección en sus estados (idle / disponible / bajando /
   descargada) y del badge en el engrane.
5. **Validación final ineludible**: publicar v0.7.0 y v0.7.1 de verdad, instalar
   la 0.7.0 a mano y ver que se actualiza sola. No hay atajo para esto y es de
   Edilson decidir cuándo se hace.

### Fuera de alcance (decidido, no olvidado)

- **Firmar** en macOS o Windows (decisiones 1 y 2). El código deja el hueco
  preparado: el target `zip` de mac ya se genera y `capability.ts` tiene el punto
  exacto donde `darwin` deja de ser `notify`.
- **Renderizar release notes** (ver frontera de seguridad). Si se pide, requiere
  sanitizado explícito, no `dangerouslySetInnerHTML`.
- **Toggle de canal beta/estable en Settings**: `allowPrerelease` es una constante
  en `config.ts`. Convertirla en setting es una tarea aparte cuando Minerva deje
  de ser beta.
- **Rollback a una versión anterior** y **staged rollouts** (`stagingPercentage`):
  electron-updater los soporta, no los necesitamos con esta base de usuarios.
- **Auto-update en paquetes de distro** (deb/rpm/pacman): requieren elevación con
  pkexec y no empaquetamos ninguno.

### Riesgos y cómo se vigilan

- **Publicar un feed roto es peor que no tener updater**: una release con
  `latest-linux.yml` pero sin el AppImage deja a todos los clientes en error. Lo
  ataca el pipeline draft→publish (T89), y la verificación es mirar los assets de
  la primera release real antes de publicarla.
- **Romper los specs de Settings**: la sección nueva entra en un modal que dos
  suites ya interrogan. Mitigación: no desmontar nada, y correr
  `settings.spec.ts` + `github-mode.spec.ts` SIN tocarlos.
- **El updater saliendo a la red durante la suite e2e**: imposible por
  construcción (`!app.isPackaged` ⇒ `disabled`), pero se refuerza con
  `MINERVA_UPDATER=off` explícito en las fixtures que no ejerciten el mock.
- **`electron-updater` en `dependencies`, no en `devDependencies`**:
  `externalizeDepsPlugin` la externaliza, así que si queda en dev el bundle de
  main hace `require` de un paquete que no viaja en el asar y la app **empaquetada**
  crashea al arrancar — mientras que en dev todo se ve perfecto. Es el tipo de bug
  que solo aparece después de `npm run dist`.
