import type { MessageShape } from '../../../shared/locale'
import type { en } from './en'

/** Spanish messages of the main process; same shape as `en.ts` (a missing key is a type error). */
export const es: MessageShape<typeof en> = {
  ai: {
    chat: {
      empty: 'La IA terminó sin responder tu mensaje. Intenta enviarlo de nuevo.',
      busy: 'La IA todavía está respondiendo en esta conversación. Espera a que termine, o detenla primero.',
      notFound: 'Esta conversación ya no existe.',
      notRetryable: 'No hay una respuesta fallida o detenida que reintentar en esta conversación.',
      tooMany: 'La IA ya está respondiendo en otras conversaciones. Espera a que termine una, o detenla.',
    },
    errors: {
      inactivityTimeout:
        '{{provider}} dejó de enviar datos: sin ningún fragmento nuevo por más de {{seconds}} s (timeout de inactividad).',
      totalTimeout: '{{provider}} no respondió a tiempo (timeout total de {{seconds}} s).',
      providerError: '{{provider}} devolvió un error: {{detail}}',
      spawnFailed: 'No se pudo lanzar el proceso "{{binary}}": {{detail}}',
      noValidSection: 'Ninguna sección del stream del modelo tuvo un formato válido.',
      cancelled: 'Cancelado.',
    },
    provider: {
      notLoggedIn:
        'El proveedor de IA activo ({{provider}}) está instalado pero sin sesión iniciada. Ejecuta «{{binary}} login» en una terminal y vuelve a intentarlo, o elige otro proveedor en Configuración (engranaje de la barra de título).',
      cliNotFound:
        'No se encontró el CLI «{{binary}}» del proveedor de IA activo ({{provider}}) en esta máquina. Instálalo y vuelve a intentarlo, o elige otro proveedor en Configuración (engranaje de la barra de título).',
      opencodeNoUpstream:
        'OpenCode está instalado pero no reporta ningún proveedor de modelos conectado. Ejecuta «opencode auth login» en una terminal para conectar uno (OpenRouter, Anthropic, etc.) y vuelve a intentarlo, o elige otro proveedor en Configuración (engranaje de la barra de título).',
      opencodeNotFound:
        'No se encontró el CLI «opencode» del proveedor de IA activo (OpenCode) en esta máquina (o su versión es más vieja que la mínima soportada). Instálalo o actualízalo (https://opencode.ai/docs/) y vuelve a intentarlo, o elige otro proveedor en Configuración (engranaje de la barra de título).',
    },
    claude: {
      cliNotFound:
        'No se encontró el CLI "claude" instalado: instala Claude Code (ver https://code.claude.com/docs/en/setup) y ejecuta «claude login» antes de analizar con este proveedor.',
      authFailed:
        'Claude Code no tiene una sesión válida: ejecuta «claude login» en una terminal (con la cuenta Pro/Max que quieras usar) y vuelve a intentar el análisis.',
      billing: 'La cuenta de Claude autenticada reportó un problema de facturación.',
      rateLimit: 'Rate limit de Claude Code: intenta de nuevo en unos minutos.',
      overloaded: 'Claude está sobrecargado en este momento: intenta de nuevo más tarde.',
      modelNotFound:
        'El modelo de Claude Code seleccionado no existe o no está disponible para esta cuenta.',
      maxOutputTokens: 'Claude Code cortó la respuesta por límite de tokens de salida.',
      errorCode: 'Claude Code devolvió un error ({{code}}).',
      noExecutable: 'Claude Code (Agent SDK) no encontró un binario ejecutable: {{detail}}',
      noStreamingContent:
        'Claude Code no devolvió contenido de streaming (revisa que la sesión siga activa: «claude login»).',
    },
    codex: {
      loginHint:
        'Codex no tiene una sesión válida: ejecuta «codex login» en una terminal (con tu cuenta ChatGPT Plus/Pro) y vuelve a intentar el análisis.',
      noThreadId: 'codex app-server no devolvió un id de thread en la respuesta a "thread/start".',
      turnError: 'Codex devolvió un error durante el turno.',
      turnFailed: 'El turno de Codex terminó en estado "failed".',
      spawnFailed: 'Codex no se pudo lanzar: {{detail}}',
      noStreamingContent:
        'Codex no devolvió contenido de streaming (revisa que la sesión siga activa: «codex login»).',
      binaryNotInPath:
        'No se encontró el binario "{{binary}}" en el PATH. Instala el Codex CLI oficial de OpenAI (paquete "@openai/codex" o el instalador de tu plataforma) y vuelve a intentarlo.',
      binaryNotInstalled:
        'No se encontró el binario "{{binary}}" instalado. Instala el Codex CLI oficial de OpenAI (paquete "@openai/codex" o el instalador de tu plataforma), ejecuta «codex login» y vuelve a intentarlo.',
      processExited:
        'El proceso "codex app-server" terminó inesperadamente (code={{code}}, signal={{signal}}).',
      clientClosed: 'El cliente de codex app-server ya está cerrado.',
      requestTimeout: 'codex app-server no respondió a "{{method}}" dentro de {{ms}} ms.',
      cancelled: 'Análisis cancelado: se cerró el proceso de codex app-server.',
    },
    opencode: {
      noProviderConnected:
        'OpenCode no tiene un proveedor de IA conectado: ejecuta «opencode auth login» en una terminal y conecta un proveedor, o elige otro modelo en Configuración.',
      noProviderConnectedNamed:
        'OpenCode no tiene un proveedor de IA conectado ({{provider}}): ejecuta «opencode auth login» en una terminal y conecta un proveedor, o elige otro modelo en Configuración.',
      unknownError: 'OpenCode devolvió un error desconocido.',
      sessionErrorNoDetail: 'error de sesión sin detalle.',
      unknownSessionError: 'error desconocido de OpenCode.',
      badModelSlug:
        'El modelo de OpenCode "{{model}}" no tiene el formato <proveedor>/<modelo> esperado. Elige un modelo válido en Configuración.',
      eventsClosed: 'OpenCode cerró la conexión de eventos antes de terminar el análisis.',
      noStreamingContent:
        'OpenCode no devolvió contenido de streaming (revisa que el server siga activo y que el modelo elegido responda).',
      binaryNotInstalled:
        'No se encontró el binario "opencode" instalado. Instala OpenCode (ver https://opencode.ai/docs/) y vuelve a intentarlo.',
      binaryNotInPath:
        'No se encontró el binario "{{binary}}" en el PATH. Instala OpenCode (https://opencode.ai/docs/) y vuelve a intentarlo.',
      serverSpawnFailed: 'No se pudo lanzar el server de OpenCode ("{{binary}}"): {{detail}}',
      versionUnparseable:
        'No se pudo interpretar la versión de OpenCode a partir de la salida "{{output}}".',
      versionTooOld:
        'La versión instalada de OpenCode ({{version}}) es menor a la mínima requerida ({{min}}). Actualízala con tu gestor de paquetes o «opencode upgrade» y vuelve a intentarlo.',
      noFreePort: 'No se pudo obtener un puerto TCP libre para el server de OpenCode.',
      startCancelled: 'El arranque del server de OpenCode se canceló antes de lanzarlo.',
      serverStartTimeout: 'El server de OpenCode no arrancó dentro de {{ms}} ms.',
      serverStoppedWhileStarting: 'El server de OpenCode se detuvo mientras arrancaba.',
      processExitedEarly:
        'El proceso de OpenCode terminó antes de quedar listo (code={{code}}, signal={{signal}}).',
    },
    mock: {
      unknownPr:
        'La IA en modo demo solo tiene análisis para los PRs de ejemplo; no conoce {{pr}}. Configura un proveedor de IA en Configuración (engranaje de la barra de título).',
    },
    activity: {
      readFailedDetail: 'Falló al leer {{detail}}',
      readFailed: 'Falló al leer un archivo',
      readDoneDetail: 'Leyó {{detail}}',
      readDone: 'Leyó un archivo',
      readingDetail: 'Leyendo {{detail}}',
      reading: 'Leyendo un archivo…',
      searchFailed: 'Falló una búsqueda',
      searchDoneDetail: 'Buscó "{{detail}}"',
      searchDone: 'Buscó en el repo',
      searchingDetail: 'Buscando "{{detail}}"',
      searching: 'Buscando…',
      listFailed: 'Falló un listado',
      listDoneDetail: 'Listó {{detail}}',
      listDone: 'Listó la estructura',
      listingDetail: 'Listando {{detail}}',
      listing: 'Listando la estructura…',
      thought: 'Pensó',
      thinking: 'Pensando…',
      toolFailed: 'Falló una herramienta',
      toolDoneDetail: 'Usó {{detail}}',
      toolDone: 'Exploró el repositorio',
      usingToolDetail: 'Usando {{detail}}',
      usingTool: 'Explorando el repositorio…',
    },
  },
  common: {
    cancel: 'Cancelar',
  },
  activity: {
    notification: {
      commentTitle: '#{{number}} {{title}}',
      commentBody: '{{author}} comentó: {{excerpt}}',
      replyBody: '{{author}} respondió: {{excerpt}}',
      orphanTitle: '#{{number}} {{title}}',
      orphanBody: 'Su PR base #{{parent}} se fusionó. Cambia su destino a {{base}}.',
      manyTitle: '{{count}} novedades en tus pull requests',
      manyBody: 'En {{prs}} pull requests. Abre la Bandeja para verlas.',
      manyBodyOnePr: 'En un pull request. Abre la Bandeja para verlas.',
      reviewTitle: '#{{number}} {{title}}',
      requestTitle: 'Revisión solicitada: #{{number}}',
      requestBody: 'Te pidieron revisar "{{title}}".',
      requestBodyOptional: 'Te agregaron como revisor opcional de "{{title}}".',
      vote: {
        approved: '{{reviewer}} aprobó tu pull request.',
        approved_with_suggestions: '{{reviewer}} aprobó con sugerencias.',
        changes_requested: '{{reviewer}} pidió cambios.',
        rejected: '{{reviewer}} rechazó tu pull request.',
      },
    },
  },
  windows: {
    didacticTitle: 'Minerva — Análisis {{repo}}#{{number}}',
  },
  dialogs: {
    merge: {
      message: '¿Hacer merge del PR #{{number}}?',
      messageComplete: '¿Completar el PR #{{number}}?',
      confirm: 'Hacer merge',
      confirmComplete: 'Completar',
      branches: '{{from}} → {{to}}',
      strategyLine: '{{strategy}} · head {{sha}}',
      deletesBranch: 'Borra {{branch}} después',
      completesWorkItems: 'Completa {{count}} work item(s) vinculado(s)',
      setBy: 'Activado por {{name}}',
    },
    autoComplete: {
      onMessage: '¿Activar autocompletar en el PR #{{number}}?',
      onExplain: 'Se completa solo cuando pasen todas las directivas obligatorias.',
      onConfirm: 'Activar',
      offMessage: '¿Cancelar autocompletar en el PR #{{number}}?',
      offConfirm: 'Cancelar autocompletar',
    },
    autoMerge: {
      onMessage: '¿Activar auto-merge en el PR #{{number}}?',
      onExplain: 'GitHub hace el merge cuando se cumplan todos los requisitos.',
      onConfirm: 'Activar',
      offMessage: '¿Desactivar auto-merge en el PR #{{number}}?',
      offConfirm: 'Desactivar auto-merge',
    },
    retarget: {
      message: '¿Cambiar la rama base del PR #{{number}}?',
      detail: 'Repositorio: {{repo}}\nTítulo: {{title}}\n\nRama base: {{from}} → {{to}}',
      confirm: 'Cambiar base',
    },
    azureCredential: 'Minerva usará tu credencial de Azure DevOps (de az) con {{urls}}.',
    azureProjects: {
      message: '¿Cargar los proyectos de la organización de Azure DevOps {{organization}}?',
      azureOff: 'Azure DevOps está desactivado en Configuración.',
      confirm: 'Cargar proyectos',
    },
    azureAddOrg: {
      messageOne: '¿Agregar la organización de Azure DevOps {{organizations}}?',
      messageMany: '¿Agregar las organizaciones de Azure DevOps {{organizations}}?',
      unknownOne: 'Todavía no está configurada y az no la conoce.',
      unknownMany: 'Todavía no están configuradas y az no las conoce.',
      confirm: 'Agregar',
    },
  },
  scm: {
    merge: {
      notOpen: 'El pull request #{{number}} ya no está abierto.',
      headMoved:
        'Llegaron commits nuevos al pull request #{{number}} (el head ahora es {{current}}, revisaste {{expected}}). No se hizo el merge. Recarga para revisarlos primero.',
      noPermission: 'No tienes permiso para hacer merge en {{branch}}.',
      conflicts: 'El pull request #{{number}} tiene conflictos con {{branch}}. Resuélvelos primero.',
      checksFailing: 'Falló un check obligatorio en el pull request #{{number}}.',
      checksPending: 'Los checks obligatorios del pull request #{{number}} siguen corriendo.',
      approvalsMissing: 'Al pull request #{{number}} le faltan aprobaciones o directivas obligatorias.',
      draft: 'El pull request #{{number}} es un borrador.',
      behind: 'Primero hay que actualizar el pull request #{{number}} con {{branch}}.',
      checking: 'El proveedor aún revisa si #{{number}} puede hacer merge. Inténtalo en un momento.',
      blocked: 'Las reglas del repositorio bloquean el pull request #{{number}}.',
      strategyNotAllowed: '{{strategy}} no está permitido en este pull request.',
      noWorkItems: 'Este proveedor no tiene work items vinculados que completar.',
      autoMergeAlreadyOff: 'El auto-merge ya está desactivado en el pull request #{{number}}.',
      autoMergeOff: 'El auto-merge está desactivado en la configuración de {{repo}}.',
      nothingToWaitFor: 'No hay nada pendiente, así que el auto-merge no aplica: haz el merge ahora.',
      strategy: {
        merge: 'Commit de merge',
        squash: 'Squash',
        rebase: 'Rebase',
        rebase_merge: 'Merge semilineal',
      },
    },
    providerDisabled: 'El proveedor de control de código no está habilitado: {{provider}}',
    invalidSettings: 'La configuración de control de código no es válida.',
    prNotFound: 'No se encontró el pull request: {{repo}}#{{number}}',
    threadNotFound: 'No se encontró el hilo de comentarios: {{id}}',
    fileNotAtVersion: '{{path}} no existe en esa versión.',
    commitNotInPr: 'Ese commit no es parte de este pull request.',
    snapshotFinalize: 'No se pudo finalizar la copia de {{repo}}@{{sha}} (falló el renombrado).',
    noAgenticAnalysis: 'No se puede generar un análisis agéntico para este PR.',
    retarget: {
      notOpen: 'El pull request #{{number}} ya no está abierto.',
      baseMoved:
        'El pull request #{{number}} ahora apunta a {{current}}, no a {{expected}}. ' +
        'Actualiza e inténtalo de nuevo.',
      alreadyTargets: 'El pull request ya apunta a {{branch}}.',
      ownSource: 'Un pull request no puede apuntar a su propia rama de origen.',
      branchMissing: 'La rama {{branch}} no existe en {{repo}}.',
    },
    orgAccess: {
      busy: 'Ya hay otra confirmación abierta.',
      projectsDenied: 'No se permitió cargar los proyectos de {{organization}}.',
    },
  },
  github: {
    mergeRefused: 'GitHub rechazó el merge en {{repo}}: {{reason}}',
    mergeHeadMoved: 'El head del pull request cambió en GitHub. No se hizo el merge. Recarga e inténtalo de nuevo.',
    notGithubRepo: 'No es un repositorio de GitHub: {{repo}}',
    thisRepository: 'este repositorio',
    tokenInvalid: 'Sin autenticar: el token de GitHub no es válido o expiró.',
    signInRequired: "Sin autenticar: inicia sesión con 'gh auth login' y vuelve a intentarlo.",
    reauth:
      "Sin autenticar en GitHub CLI: ejecuta 'gh auth login' en una terminal y vuelve a intentarlo.",
    noSession: "No hay sesión de gh. Ejecuta 'gh auth login' en una terminal.",
    accountNoSession:
      'La cuenta de gh seleccionada "{{account}}" no tiene una sesión válida. ' +
      "Ejecuta 'gh auth login' para esa cuenta o elige otra en Configuración.",
    cliNotFound:
      "No se encontró GitHub CLI. Instálalo (https://cli.github.com) y ejecuta 'gh auth login'.",
    rateLimited: 'Se alcanzó el límite de uso de GitHub; vuelve a intentarlo en {{minutes}} min',
    forbidden: 'Sin permiso para {{repo}}',
    notFoundOrForbidden: 'Sin permiso para {{repo}} (o no existe)',
    httpError: 'Error de GitHub (estado {{status}})',
    unreachable: 'No se pudo conectar con GitHub: {{error}}',
    unknown: 'Error desconocido al comunicarse con GitHub',
    threadNotFoundInPr: 'No se encontró el hilo de comentarios en {{repo}}#{{number}}: {{id}}',
    generalCommentsUnresolvable:
      'En GitHub no se pueden resolver los comentarios generales de un PR.',
    notAFile: 'No es un archivo: {{path}}',
    tarballTooLarge:
      'El repositorio {{repo}} es demasiado grande para copiarlo localmente (tarball de más de {{mb}} MB).',
    extractedTooLarge:
      'El repositorio {{repo}} es demasiado grande para copiarlo localmente (más de {{mb}} MB descomprimido).',
    mockMissingAtBase: '{{path}} no existe en el commit base.',
    mockMissingAtHead: '{{path}} no existe en el commit head.',
  },
  azure: {
    completeRefused: 'Azure DevOps rechazó completar el pull request: {{reason}}',
    notAzureRepo: 'No es un repositorio de Azure DevOps: {{repo}}',
    invalidRepo: 'No es un repositorio válido de Azure DevOps: {{repo}}',
    unknownThread: 'Hilo desconocido: {{value}}',
    orgNotConfigured:
      'La organización de Azure DevOps {{organization}} no está configurada en Configuración.',
    projectNotConfigured:
      'El proyecto de Azure DevOps {{project}} no está configurado para {{organization}} en Configuración.',
    turnedOff: 'Desactivado en Configuración.',
    noOrganization:
      'No hay ninguna organización de Azure DevOps configurada. Agrega una en Configuración.',
    unauthenticatedDetail:
      '{{message}}. Ejecuta: {{command}} con un PAT que tenga el alcance Code (Read & Write).',
    noIterations: 'El pull request {{number}} todavía no tiene iteraciones.',
    commentCapped:
      'No se puede comentar {{path}} desde Minerva: el pull request cambia {{total}} archivos ' +
      'y solo se cargan los primeros {{loaded}}. Coméntalo en Azure DevOps.',
    commentCappedAtLeast:
      'No se puede comentar {{path}} desde Minerva: el pull request cambia más de {{total}} ' +
      'archivos y solo se cargan los primeros {{loaded}}. Coméntalo en Azure DevOps.',
    commentNotInIteration:
      'No se puede comentar {{path}}: el archivo no forma parte de la última iteración.',
    threadWithoutComments: 'Azure DevOps devolvió un hilo sin comentarios.',
    baseCommitMissing: 'Azure DevOps no informó el commit base.',
    headCommitMissing: 'Azure DevOps no informó el commit head.',
    notCommitId: 'No es un id de commit: {{value}}',
    notOrganizationUrl: 'No es una URL de organización de Azure DevOps: {{url}}',
    cliNotFound:
      'No se encontró Azure CLI (az). Instálalo con la extensión azure-devops y luego ejecuta: ' +
      '{{command}} (o define AZURE_DEVOPS_EXT_PAT).',
    credentialRejected:
      'Azure DevOps rechazó la credencial guardada para {{organization}} (expiró o le faltan ' +
      'alcances). Ejecuta: {{command}} y pega un PAT con el alcance Code (Read & Write).',
    noCredential:
      'No se encontró una credencial de Azure DevOps para {{organization}}. Ejecuta: {{command}} ' +
      'y pega un PAT con el alcance Code (Read & Write).',
    invalidUrlSegment: 'Segmento de URL de Azure DevOps no válido.',
    refusingCredentials: 'Se rechazó enviar credenciales a {{host}}',
    downloadTooLarge: 'Descarga de más de {{mb}} MB.',
    timeout: 'Azure DevOps no respondió a tiempo.',
    unreachable: 'No se pudo conectar con Azure DevOps.',
    status: {
      rejected: 'Azure DevOps rechazó la credencial',
      forbidden: 'Azure DevOps no lo permite (falta un permiso o un alcance del PAT)',
      notFound: 'No se encontró en Azure DevOps (o no tienes acceso)',
      conflict: 'Conflicto: el elemento cambió en Azure DevOps',
      rateLimited: 'Se alcanzó el límite de uso de Azure DevOps',
      other: 'Error de Azure DevOps (HTTP {{status}})',
      server: 'Azure DevOps: {{message}}',
    },
    zip: {
      tooManyEntries: 'El archivo del repositorio tiene {{count}} entradas (límite {{limit}}).',
      expandsPastLimit: 'El archivo del repositorio supera el límite de tamaño al descomprimirse.',
      tooLarge: 'El archivo del repositorio pesa más de {{mb}} MB.',
      corrupt: 'El archivo del repositorio no es un zip válido: {{error}}',
      unsafe: 'El archivo del repositorio no es seguro: {{error}}',
      unsafePath: 'El archivo del repositorio tiene una ruta no segura ({{reason}}).',
      extractedTooLarge: 'El repositorio ocupa más de {{mb}} MB descomprimido.',
      pathOutside: 'El archivo del repositorio tiene una ruta fuera de la copia.',
    },
  },
  updater: {
    unknownError: 'Error desconocido al buscar actualizaciones.',
    invalidVersion:
      'El feed de actualizaciones devolvió una versión con formato inválido ("{{version}}"); ' +
      'no se puede continuar de forma segura.',
    missingExport:
      'electron-updater no expuso autoUpdater (ni como export nombrado ni en default); ' +
      'el auto-update no puede inicializarse.',
    manifestMissing:
      'La última release no tiene manifiesto de actualización para esta plataforma ({{file}}), ' +
      'así que Minerva todavía no puede comparar versiones.',
    noReleases: 'Todavía no hay ninguna release publicada en GitHub.',
    feedUnreachable:
      'No se pudo contactar a GitHub para buscar actualizaciones. Revisa tu conexión e intenta de nuevo.',
    feedUnavailable: 'GitHub no respondió a la búsqueda de actualizaciones (HTTP {{status}}). Intenta más tarde.',
    feedUnreadable: 'GitHub devolvió una lista de releases que Minerva no pudo leer.',
  },
  themes: {
    openVsx: {
      tooLarge: 'Open VSX envi\u00f3 m\u00e1s datos de los que Minerva acepta para un tema.',
      unreachable:
        'No se pudo conectar con Open VSX. Revisa tu conexi\u00f3n e int\u00e9ntalo de nuevo.',
      untrustedRedirect:
        'Open VSX redirigi\u00f3 a una direcci\u00f3n inesperada, as\u00ed que se detuvo la descarga.',
      unavailable:
        'Open VSX no est\u00e1 disponible en este momento. Int\u00e9ntalo m\u00e1s tarde.',
      unreadable: 'Open VSX devolvi\u00f3 un tema que Minerva no pudo leer.',
      license: 'La licencia de esa extensi\u00f3n no permite importar sus temas aqu\u00ed.',
      checksum: 'La extensi\u00f3n descargada no pas\u00f3 la verificaci\u00f3n de integridad.',
      unsafePackage: 'No es seguro abrir el paquete de la extensi\u00f3n.',
      mismatch: 'El paquete descargado no coincide con la extensi\u00f3n elegida.',
      noThemes: 'Esa extensi\u00f3n no contiene temas de color.',
      tooManyThemes: 'Esa extensi\u00f3n tiene demasiados temas de color para importarlos.',
      busy: 'Otra solicitud a Open VSX sigue en curso. Inténtalo de nuevo en un momento.',
    },
  },
}
