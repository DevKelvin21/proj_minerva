/**
 * Spanish UI text (neutral Latin American Spanish, "tú"). Same shape as
 * `en.ts`: a missing or extra key is a typecheck error.
 */
import type { MessageShape } from '../../../../shared/locale'
import type { en } from './en'

export const es: MessageShape<typeof en> = {
  common: {
    appName: 'Minerva',
    cancel: 'Cancelar',
    close: 'Cerrar',
    retry: 'Reintentar',
    save: 'Guardar',
    saving: 'Guardando…',
    loading: 'Cargando…',
    copy: 'Copiar',
    copied: 'Copiado',
    refresh: 'Actualizar',
    dismiss: 'Descartar',
    unknownError: 'Algo salió mal.',
  },
  layout: {
    titleBar: {
      prListToggle: 'Lista de PRs',
      searchPrs: 'Buscar PRs',
      searchPlaceholder: 'Buscar por título, repo, rama o #número',
      closeSearch: 'Cerrar búsqueda',
      didacticPanel: 'Panel didáctico',
      connectionTitle: 'Control de versiones: {{status}}',
      connectionIpcError: 'Sin conexión con el proceso principal.',
      connection: {
        connected: 'Conectado',
        partial: 'Conectado en parte',
        signed_out: 'Sin sesión',
        no_providers: 'Ningún origen activo',
        error: 'Sin conexión',
        checking: 'Comprobando…',
      },
      providerLine: '{{provider}}: {{state}}',
      providerState: {
        ready: 'sesión iniciada como {{who}}',
        checking: 'comprobando…',
        not_configured: 'sin organización configurada',
        cli_unavailable: 'no se encontró la CLI',
        signed_out: 'sin sesión',
      },
    },
    settingsChip: {
      settings: 'Configuración',
      updateAvailable: 'Hay una actualización disponible',
      title: 'Configuración — {{provider}} · {{model}} · origen: {{source}}',
      titleWithEffort:
        'Configuración — {{provider}} · {{model}} · Razonamiento: {{effort}} · origen: {{source}}',
      modelSource: {
        settings: 'configuración',
        env: 'entorno',
        default: 'predeterminado',
      },
    },
    auth: {
      viaGhCli: 'vía GitHub CLI',
      managedByGhCli: 'El acceso lo gestiona GitHub CLI; cambia la cuenta en Configuración',
      ghCliNotFound: 'No se encontró GitHub CLI',
      azCliNotFound: 'No se encontró Azure CLI',
      managedByAz:
        'El acceso usa tu credencial de Azure CLI; cambia la organización en Configuración',
      via: {
        ghCli: 'vía GitHub CLI',
        envPat: 'vía AZURE_DEVOPS_EXT_PAT',
        azDevopsPat: 'vía PAT de az devops',
        azEntra: 'vía az login (Entra)',
      },
      notConfigured: 'Sin organización',
      notConfiguredTitle:
        'Azure DevOps está activado pero todavía no tiene organización. Agrega una en Configuración.',
      openSettings: 'Abrir configuración',
      copyCommand: 'Copiar comando',
      copyCommandNamed: 'Copiar comando: {{command}}',
      waitingForSession: 'Esperando la sesión…',
    },
    sidebar: {
      ariaLabel: 'Lista de pull requests',
      viewSwitch: 'Vista de la columna izquierda',
      views: {
        list: 'Pull requests',
        stacks: 'Stacks',
      },
      orphans_one: '{{count}} PR huérfano',
      orphans_other: '{{count}} PRs huérfanos',
      refresh: 'Actualizar',
      stateFilter: {
        open: 'Abiertos',
        closed: 'Cerrados',
        all: 'Todos',
      },
      empty: {
        open: 'No hay PRs abiertos.',
        closed: 'No hay PRs cerrados.',
        all: 'No hay PRs.',
      },
      noMatches: 'No hay PRs que coincidan con "{{query}}".',
      searchTipGithub:
        'Consejo: la búsqueda de GitHub acepta cualificadores, p. ej. <code>org:mi-org</code> o <code>repo:owner/nombre</code>.',
      searchTipAzure:
        'Consejo: la búsqueda de Azure DevOps compara el título, el repositorio, la rama, el autor o el <code>#número</code>.',
      azureNotConfigured:
        'Azure DevOps está activado pero todavía no tiene organización. Agrega una en Configuración.',
      noProvidersTitle: 'No hay ningún control de versiones activado',
      noProvidersHint: 'Activa GitHub o Azure DevOps en Configuración para listar pull requests.',
      loadFailed: 'No se pudo cargar la lista de PRs: {{error}}',
      loading: 'Cargando PRs…',
      accountNoSession:
        'La cuenta <mono>{{account}}</mono> no tiene una sesión de gh válida. Elige otra en Configuración o renuévala con <mono>{{command}}</mono>.',
      signInWithGhCli: 'Inicia sesión con GitHub CLI: ejecuta <mono>{{command}}</mono> en una terminal.',
      signInWithAz:
        'Inicia sesión con Azure CLI: ejecuta <cmd>{{command}}</cmd> en una terminal y pega un PAT con permiso Code (Read & Write).',
      installAz:
        'Instala Azure CLI con la extensión azure-devops y luego ejecuta <cmd>{{command}}</cmd> (o define <mono>AZURE_DEVOPS_EXT_PAT</mono>).',
      openSettings: 'Abrir configuración',
    },
    center: {
      choosePrTitle: 'Elige un Pull Request',
      choosePrHint:
        'Selecciona un PR de la lista de la izquierda para ver su conversación y sus archivos.',
      loadFailed: 'No se pudo cargar el PR',
      loading: 'Cargando PR…',
      tabs: {
        conversation: 'Conversación',
        files: 'Archivos',
        filesWithCount: 'Archivos ({{count}})',
        comments: 'Comentarios',
        commentsWithCount: 'Comentarios ({{count}})',
      },
      openThreads_one: '{{count}} hilo abierto',
      openThreads_other: '{{count}} hilos abiertos',
    },
  },
  prList: {
    review: {
      approved: 'Aprobado',
      changesRequested: 'Cambios solicitados',
      waitingForAuthor: 'Esperando al autor',
      rejected: 'Rechazado',
      reviewRequired: 'Revisión pendiente',
    },
    state: {
      draft: 'Borrador',
      merged: 'Mergeado',
      closed: 'Cerrado',
      open: 'Abierto',
      mergedBadge: 'mergeado',
      closedBadge: 'cerrado',
    },
    unseenChanges: 'Cambios sin ver',
    newComments: 'Comentarios nuevos',
    comments_one: '{{count}} comentario',
    comments_other: '{{count}} comentarios',
    ci: {
      success: 'CI en verde',
      failure: 'CI en rojo',
      pending: 'CI pendiente',
    },
  },
  prDetail: {
    header: {
      changeTargetBranch: 'Cambiar rama destino…',
      commitCount_one: '{{count}} commit',
      commitCount_other: '{{count}} commits',
      openIn: 'Abrir en {{provider}}',
      reviewers: 'Revisores',
      required: 'obligatorio',
      workItems: 'Work items',
      labels: 'Etiquetas',
      tags: 'Etiquetas',
      draft: 'Borrador',
      details: 'Detalles',
      autoComplete: 'Autocompletar activado por {{name}}',
      autoCompleteTitle:
        'Este pull request se completa solo en cuanto pasen todas las directivas obligatorias.',
      mergeStatus: {
        clean: 'Sin conflictos de merge',
        conflicts: 'Conflictos de merge',
        checking: 'Comprobando el merge…',
        blocked: 'Bloqueado por una directiva',
        failed: 'Falló la comprobación de merge',
      },
      branchPolicies: 'Directivas de rama',
      checks: 'Comprobaciones',
      optional: 'opcional',
      checkStatus: {
        success: 'Aprobada',
        failure: 'Falló',
        pending: 'Pendiente',
        not_applicable: 'No aplica',
      },
    },
    reviewerVote: {
      approved: 'Aprobado',
      approved_with_suggestions: 'Aprobado con sugerencias',
      none: 'Sin voto todavía',
      changes_requested: 'Cambios solicitados',
      waiting_for_author: 'Esperando al autor',
      rejected: 'Rechazado',
    },
    files: {
      loadError: 'No se pudieron cargar los archivos: {{error}}',
      loading: 'Cargando archivos…',
      empty: 'Este pull request no tiene archivos cambiados.',
      truncatedOfTotal:
        'Se muestran {{shown}} de {{total}} archivos: el proveedor limitó la lista. Abre el pull request en {{provider}} para ver el resto.',
      truncatedFirst:
        'Se muestran los primeros {{shown}} archivos: el proveedor limitó la lista. Abre el pull request en {{provider}} para ver el resto.',
    },
    fileTree: {
      fileCount_one: '{{count}} archivo',
      fileCount_other: '{{count}} archivos',
      treeView: 'Vista de árbol',
      listView: 'Vista de lista',
    },
    fileStatus: {
      added: 'Añadido',
      removed: 'Eliminado',
      renamed: 'Renombrado',
      modified: 'Modificado',
    },
    fileContent: {
      binary: 'Archivo binario.',
      tooLarge: 'Archivo demasiado grande para mostrarlo.',
      noContent: 'Sin contenido.',
    },
    toolbar: {
      showFiles: 'Ver los archivos del PR',
      showFilesCount_one: 'Ver los archivos del PR ({{count}} archivo)',
      showFilesCount_other: 'Ver los archivos del PR ({{count}} archivos)',
      split: 'Vista split',
      splitTooNarrow:
        'Vista split (necesita ~{{width}}px de ancho; cierra el panel didáctico o agranda la ventana)',
      inline: 'Vista inline',
      wordWrap: 'Ajuste de línea',
    },
    diff: {
      tooLarge: 'Diff no mostrado: el archivo es demasiado grande para compararlo aquí.',
      overBudget:
        'Diff no mostrado: este pull request es demasiado grande para comparar todos sus archivos. Ábrelo en el proveedor para ver este.',
      noPreview: 'Vista previa no disponible.',
      loadingUnplaced_one: 'Cargando el código alrededor de {{count}} comentario…',
      loadingUnplaced_other: 'Cargando el código alrededor de {{count}} comentarios…',
      unplacedLoadError:
        'No se pudo cargar el archivo para mostrar estos comentarios en su lugar ({{error}}). Cada uno muestra el código al que se refiere.',
      unplaced_one: '{{count}} comentario no está en una línea que muestre este diff.',
      unplaced_other: '{{count}} comentarios no están en una línea que muestre este diff.',
    },
    expander: {
      moreBelow: 'Más líneas abajo',
      hiddenLines_one: '{{count}} línea oculta',
      hiddenLines_other: '{{count}} líneas ocultas',
      loadError: 'No se pudo cargar el archivo: {{error}}',
      show: 'Mostrar',
      showMore_one: 'Mostrar {{count}} más',
      showMore_other: 'Mostrar {{count}} más',
      showAll_one: 'Mostrar las {{count}}',
      showAll_other: 'Mostrar las {{count}}',
      downTitle_one: 'Mostrar {{count}} línea más después del código de arriba',
      downTitle_other: 'Mostrar {{count}} líneas más después del código de arriba',
      downLabel_one: 'Expandir {{count}} línea hacia abajo',
      downLabel_other: 'Expandir {{count}} líneas hacia abajo',
      upTitle_one: 'Mostrar {{count}} línea más antes del código de abajo',
      upTitle_other: 'Mostrar {{count}} líneas más antes del código de abajo',
      upLabel_one: 'Expandir {{count}} línea hacia arriba',
      upLabel_other: 'Expandir {{count}} líneas hacia arriba',
    },
  },
  comments: {
    threadStatus: {
      active: 'Activo',
      pending: 'Pendiente',
      resolved: 'Resuelto',
      wont_fix: 'No se corregirá',
      closed: 'Cerrado',
      by_design: 'Por diseño',
    },
    conversation: {
      openedThisPr: 'abrió este PR',
      loadError: 'No se pudieron cargar los comentarios: {{error}}',
      loading: 'Cargando comentarios…',
      empty: 'Todavía no hay comentarios.',
      generalCommentLabel: 'Comentario general',
      placeholder: 'Escribe un comentario para este PR…',
      postError: 'No se pudo publicar: {{error}}',
      posting: 'Publicando…',
      submit: 'Comentar',
    },
    tab: {
      filterGroup: 'Filtrar hilos',
      filterOpen: 'Abiertos',
      filterAll: 'Todos',
      loadError: 'No se pudieron cargar los comentarios: {{error}}',
      loading: 'Cargando comentarios…',
      empty: 'Este pull request todavía no tiene comentarios.',
      noMatch: 'Ningún hilo coincide con este filtro.',
      general: 'General',
      notInDiff: 'no está en el diff',
      notInDiffTitle:
        'El archivo no está en la lista de archivos de este pull request (puede estar limitada o venir de un push anterior)',
    },
    thread: {
      fileComment: 'Comentario de archivo',
      line: 'Línea {{line}}',
      lines: 'Líneas {{lines}}',
      generalComment: 'Comentario general',
      commentCount_one: '{{count}} comentario',
      commentCount_other: '{{count}} comentarios',
      statusError: 'No se pudo cambiar el estado: {{error}}',
      statusLabel: 'Estado del hilo',
      showLineInFiles: 'Mostrar esta línea en la pestaña Archivos',
      outdated: 'Desactualizado',
      outdatedTitle: 'Se dejó en una versión anterior del código',
      copyLink: 'Copiar el enlace al comentario en {{provider}}',
      replyLabel: 'Responder en este hilo',
      replyPlaceholder: 'Responder…',
      reply: 'Responder',
    },
    composer: {
      postError: 'No se pudo publicar: {{error}}',
      suggestionLoadError: 'No se pudieron cargar las líneas para la sugerencia: {{error}}',
      insertSuggestionTitle: 'Insertar un cambio sugerido con las líneas comentadas ya cargadas',
      insertSuggestion: 'Insertar sugerencia',
      loadingLines: 'Cargando líneas…',
      posting: 'Publicando…',
    },
    suggestion: {
      title: 'Cambio sugerido',
      removeLines: '(eliminar estas líneas)',
      originalUnavailable: 'líneas originales no disponibles',
      mayHaveChanged: 'el código puede haber cambiado desde entonces',
      needsLine:
        'Las sugerencias necesitan una línea de código: comenta una línea en la pestaña Archivos.',
      oldSideComment:
        'Las sugerencias cambian la versión nueva del archivo; este comentario está en la anterior.',
      noText: 'El archivo no tiene texto sobre el cual sugerir.',
      pastEnd: 'La línea {{line}} está más allá del final del archivo.',
    },
    excerpt: {
      outdatedNote:
        'Este comentario se dejó en una versión anterior del archivo. El código de abajo es de la versión más reciente alrededor de la línea {{line}}; puede haber cambiado desde entonces.',
      loading: 'Cargando código…',
      loadError: 'No se pudo cargar el código: {{error}}',
      pastEndBase:
        'La línea {{line}} está más allá del final del archivo en su versión base (antes del cambio).',
      pastEndLatest:
        'La línea {{line}} está más allá del final del archivo en su versión más reciente.',
      label: 'Código en {{path}}:{{line}}',
    },
    line: {
      addComment: 'Agregar un comentario en esta línea',
      showComments_one: 'Mostrar los comentarios de esta línea ({{count}})',
      showComments_other: 'Mostrar los comentarios de esta línea ({{count}})',
      hideComments: 'Ocultar los comentarios de esta línea',
      hideCommentsTitle:
        'Ocultar los comentarios de esta línea (el ícono del margen los vuelve a mostrar)',
      suggestionOldSide:
        'Las sugerencias cambian la versión nueva del archivo; esta línea está en la anterior.',
      commentOnLine: 'Comentar la línea {{line}}',
      placeholder: 'Comenta la línea {{line}}…',
      placeholderOld: 'Comenta la línea {{line}} (versión anterior)…',
      submit: 'Comentar',
    },
  },
  stacks: {
    view: {
      loadFailed: 'No se pudieron cargar los stacks: {{error}}',
      loading: 'Cargando stacks…',
      loadingHint:
        'Esto lee todos los PR abiertos del alcance, así que puede tardar unos segundos.',
      noMatch: 'Ningún stack coincide con "{{query}}".',
      noneMine: 'Ninguno de tus pull requests está en un stack.',
      empty: 'No hay pull requests apilados.',
      emptyHint:
        'Un stack aparece cuando un PR apunta a la rama de otro PR abierto, o cuando un PR sigue apuntando a la rama de un PR que ya se completó.',
      mineOnly: 'Solo los míos',
      mineOnlyTitle: 'Solo los stacks que contienen un PR de tu lista de pull requests',
      orphaned_one: '{{count}} huérfano',
      orphaned_other: '{{count}} huérfanos',
      refresh: 'Actualizar stacks',
      intro:
        'Cada PR apunta a la rama del que está encima. Revisa de arriba hacia abajo: el diff de un hijo solo muestra lo que agrega sobre su padre.',
      refreshFailed: 'No se pudo actualizar: {{error}}',
      providerError: '{{provider}}: {{message}}',
      stackAriaLabel: 'Stack en {{repo}} desde #{{number}}',
      prCount_one: '{{count}} PR',
      prCount_other: '{{count}} PR',
      sameFeature_one: 'Misma funcionalidad en {{count}} repo',
      sameFeature_other: 'Misma funcionalidad en {{count}} repos',
    },
    tree: {
      draft: 'Borrador',
      open: 'Abierto',
      draftChip: 'borrador',
      orphaned: 'Huérfano',
      inYourList: 'En tu lista de pull requests',
      orphanExplanation:
        'El padre #{{parent}} se completó en {{mergedInto}}, pero este PR sigue apuntando a {{base}}.',
      orphanBranchGone:
        'El padre #{{parent}} se completó en {{mergedInto}}, pero este PR sigue apuntando a {{base}}. Esa rama ya no existe.',
    },
    context: {
      ariaLabel: 'Stack',
      mapAriaLabel: 'Mapa del stack',
      title: 'Stack',
      position: '· {{position}} de {{total}}',
      thisPr: 'Este PR',
      builtOnTop:
        'Construido sobre #{{number}} (<branch>{{branch}}</branch>): este diff solo muestra lo que este PR agrega encima.',
      firstInStack: 'Primero del stack: apunta directamente a <branch>{{base}}</branch>.',
      descendants_one:
        '{{numbers}} se construye sobre este; los cambios de aquí se propagan hacia él.',
      descendants_other:
        '{{numbers}} se construyen sobre este; los cambios de aquí se propagan hacia ellos.',
      sameFeatureIn: 'Misma funcionalidad en',
      relatedNumbers: '({{numbers}})',
      listSeparator: ', ',
    },
    retarget: {
      targetBranch: 'Rama destino:',
      consequenceOrphan:
        'El diff se recalculará contra <branch>{{branch}}</branch>, así que los cambios que ya entraron a través de #{{parent}} desaparecen y solo queda el trabajo propio de este PR. Minerva te pide confirmación antes de escribir.',
      consequenceManual:
        'El diff se recalculará contra <branch>{{branch}}</branch>. Los archivos y los comentarios de línea pueden moverse. Minerva te pide confirmación antes de escribir.',
      waiting:
        'Esperando tu confirmación… luego se cambia el destino a <branch>{{branch}}</branch>',
      couldNotRetarget: 'No se pudo cambiar el destino de #{{number}}.',
      dismiss: 'Descartar',
      retargetTo: 'Cambiar destino a {{branch}}',
      retargetNumber: 'Cambiar destino de #{{number}}',
      retarget: 'Cambiar destino',
      cancel: 'Cancelar',
      ownHead: 'Un pull request no puede apuntar a su propia rama de origen.',
      formAriaLabel: 'Cambiar la rama destino',
      newTargetBranch: 'Nueva rama destino',
      typeBranch: 'Escribe la rama en la que este PR debería fusionarse.',
      retargeted:
        '<pr>#{{number}}</pr> ahora apunta a <branch>{{base}}</branch> (antes <branch>{{oldBase}}</branch>). Su diff ahora es contra <branch>{{base}}</branch>.',
      branchProblems: {
        empty: 'Escribe un nombre de rama.',
        invalidChars: 'Los nombres de rama no pueden tener espacios ni ninguno de ~ ^ : ? * [ \\',
        doubleDot: 'Los nombres de rama no pueden contener "..".',
        atBrace: 'Los nombres de rama no pueden contener "@{".',
        at: '"@" no es un nombre de rama válido.',
        leadingDash: 'Los nombres de rama no pueden empezar con "-".',
        slashes: 'Los nombres de rama no pueden empezar ni terminar con "/" ni contener "//".',
        trailingDot: 'Los nombres de rama no pueden terminar con ".".',
        dotOrLock:
          'Ninguna parte de un nombre de rama puede empezar con "." ni terminar en ".lock".',
      },
      failures: {
        conflict:
          'El pull request cambió desde que se cargó esta vista (alguien pudo haberle cambiado el destino, completado o abandonado). Los datos se actualizaron; revísalos e inténtalo de nuevo.',
        notFound: 'La rama {{branch}} no existe en este repositorio.',
        forbidden:
          'Tu credencial no puede modificar este pull request (Azure DevOps necesita el alcance Code (Read & write)).',
        signIn: 'Vuelve a iniciar sesión desde Configuración y reintenta.',
        unchanged: 'La rama destino no cambió.',
      },
    },
  },
  didactic: {
    panel: {
      title: 'Panel didáctico',
      open: 'Abrir panel didáctico',
      close: 'Cerrar panel didáctico',
      openInWindow: 'Abrir en ventana',
      resize: 'Redimensionar panel didáctico',
      resizeHint: 'Arrastra para redimensionar; doble clic restaura el ancho por defecto',
    },
    placeholder: {
      intro: 'Aquí verás el análisis con IA del PR seleccionado:',
      itemSummary: 'Resumen didáctico del cambio',
      itemC4: 'Diagrama C4 si toca arquitectura',
      itemEndpoints: 'Documentación de endpoints nuevos, con ejemplo para probarlos en local',
      itemEr: 'Diagrama ER si hay cambios de esquema',
      analyze: 'Analizar PR',
      selectPrFirst: 'Selecciona un PR primero',
    },
    sections: {
      summary: 'Resumen',
      setup: 'Cómo levantar la app',
      architecture: 'Arquitectura',
      endpoint: 'Endpoint',
      schema: 'Esquema',
      cloud: 'Infraestructura cloud',
    },
    cloudDiagram: {
      fullSystem: 'Sistema completo',
      prImpact: 'Dónde incide este PR',
      numbered: 'Diagrama {{number}}',
    },
    resources: {
      expandDiagram: 'Expandir diagrama',
      expandSnippet: 'Expandir snippet',
      expandSection: 'Ver esta sección en grande (incluye tablas)',
      expandSectionLabel: 'Ver esta sección en grande',
      wideViewTitle: '{{title}} — vista amplia',
      diagramTitle: '{{section}} — {{diagram}}',
    },
    analysis: {
      failed: 'No se pudo analizar el PR: {{error}}',
      checkingCache: 'Buscando un análisis ya hecho…',
      exploring: 'Explorando el repositorio…',
      analyzing: 'Analizando PR con IA…',
      reanalyze: 'Re-analizar',
      reanalyzeHint:
        'Descarta el análisis cacheado y vuelve a pedirlo (útil tras cambiar de modelo en la configuración)',
      staleNotice:
        'Este PR recibió commits nuevos desde que se generó este resumen ({{from}} → {{to}}).',
      update: 'Actualizar',
      languageMismatch:
        'Este análisis está en {{analysisLanguage}}. ¿Regenerarlo en {{uiLanguage}}?',
      regenerate: 'Regenerar',
    },
    languageNames: {
      en: 'inglés',
      es: 'español',
    },
    modelHint: {
      via: 'vía',
      title: 'Proveedor y modelo activos: {{summary}}',
    },
    mermaid: {
      unrenderable: 'Diagrama no renderizable.',
      zoomOut: 'Reducir zoom',
      zoomIn: 'Aumentar zoom',
      fit: 'Ajustar al contenedor',
      reset: 'Restablecer zoom',
    },
    noCli: {
      title: 'Necesitas al menos un CLI de IA',
      body: 'El análisis didáctico corre sobre un CLI agéntico que ya tengas instalado y con sesión iniciada en tu máquina — Minerva no trae ninguno propio ni pide una API key. Instala e inicia sesión en al menos uno de estos tres para empezar:',
      install: 'instalación',
      recheck: 'Volver a comprobar',
    },
  },
  settings: {
    modal: {
      title: 'Configuración',
      close: 'Cerrar configuración',
    },
    language: {
      title: 'Idioma',
      description: 'Idioma de la interfaz, de los diálogos nativos y de los nuevos análisis de IA.',
      label: 'Idioma de la interfaz',
      saveError: 'No se pudo cambiar el idioma. Inténtalo de nuevo.',
    },
    providerStatus: {
      unavailable: 'No disponible',
      installed: 'Instalado, sin sesión',
      authenticated: 'Conectado',
      checking: 'Comprobando estado…',
    },
    providerTabs: {
      ariaLabel: 'Proveedor de IA',
      activeProvider: '(proveedor activo)',
    },
    activeConfig: {
      title: 'En uso',
      reasoning: 'Razonamiento: {{effort}}',
      envOverride:
        'Definido por MINERVA_AI_MODEL en tu entorno. Elegir un modelo aquí lo reemplaza.',
      providerDefault: 'Usando el valor por defecto del proveedor (todavía no elegiste un modelo).',
    },
    models: {
      intro:
        'Elige el modelo que analiza los Pull Requests. Al elegirlo, {{provider}} pasa a ser el proveedor activo.',
      refreshFailed:
        'No se pudo actualizar la lista de modelos ({{error}}); mostrando el catálogo curado.',
      active: 'Activo',
      custom: 'Otro (avanzado)',
      customPlaceholderOpencode:
        'slug <provider>/<modelo> de tu opencode, p. ej. anthropic/claude-sonnet-5',
      use: 'Usar',
      activateError: 'No se pudo activar el modelo. Inténtalo de nuevo.',
      reasoningOnActive: 'El razonamiento se configura sobre el modelo activo.',
    },
    modelOptions: {
      effort: 'Razonamiento',
      variant: 'Variante',
      saveError: 'No se pudo guardar la opción. Inténtalo de nuevo.',
      levels: {
        low: 'Bajo',
        medium: 'Medio',
        high: 'Alto',
        xhigh: 'Muy alto',
        max: 'Máximo',
        ultra: 'Ultra',
        minimal: 'Mínimo',
        none: 'Ninguno',
      },
      levelDescriptions: {
        low: 'Respuestas más rápidas, con menos razonamiento.',
        medium: 'Equilibrio entre velocidad y profundidad de razonamiento.',
        high: 'Razonamiento más profundo; respuestas más lentas.',
        xhigh: 'Razonamiento extendido para tareas complejas.',
        max: 'El máximo razonamiento disponible; la opción más lenta.',
        ultra: 'Razonamiento máximo con delegación automática de tareas.',
      },
    },
    cliGuide: {
      probeFailed:
        'Encontramos el CLI <mono>{{binary}}</mono> pero no respondió a la comprobación (versión demasiado vieja, o no terminó a tiempo — p. ej. justo después de una actualización del CLI). Prueba <mono>{{binary}} --version</mono> en una terminal y vuelve a comprobar aquí.',
      probeFailedAt:
        'Encontramos el CLI <mono>{{binary}}</mono> en <path>{{path}}</path> pero no respondió a la comprobación (versión demasiado vieja, o no terminó a tiempo — p. ej. justo después de una actualización del CLI). Prueba <mono>{{binary}} --version</mono> en una terminal y vuelve a comprobar aquí.',
      notFound:
        'No se encontró el CLI <mono>{{binary}}</mono> ni en tu PATH ni en las ubicaciones de instalación comunes. Instálalo desde <docs>la documentación oficial</docs> y vuelve a intentarlo.',
      opencodeNoProvider:
        'OpenCode está instalado pero no tiene ningún proveedor de modelos conectado. Ejecuta <mono>{{command}}</mono> en una terminal para conectar uno (no es un login del CLI: agrega credenciales de un proveedor de IA, ver <docs>la documentación oficial</docs>) y vuelve a comprobar aquí.',
      noSession:
        'El CLI está instalado pero no detectamos una sesión iniciada. Ejecuta <mono>{{command}}</mono> en una terminal y vuelve a comprobar aquí.',
      connected:
        'Conectado{{details}}. Si cerraste sesión desde la terminal, vuelve a comprobar para reflejarlo aquí.',
      planDetail: ' · plan {{plan}}',
      recheck: 'Volver a comprobar',
    },
    github: {
      title: 'Acceso a GitHub',
      intro:
        'Minerva usa tu sesión de <mono>gh</mono> (GitHub CLI): no hay un login aparte que autorizar. Las organizaciones enterprise que bloquean apps OAuth de terceros suelen permitir GitHub CLI.',
      enable: 'Activar GitHub',
      demoMode:
        'Modo demo (MINERVA_MOCK): los datos son simulados; esta configuración se aplica cuando vuelvas a los datos reales.',
      install:
        'Instala GitHub CLI desde <link>cli.github.com</link> y ejecuta <mono>gh auth login</mono> en una terminal.',
      cliNotFound:
        'No se encontró GitHub CLI. Instálalo desde el enlace de arriba y vuelve a intentarlo.',
      noSession: "No hay sesión de gh: ejecuta 'gh auth login' en una terminal.",
      signedInAs: 'Sesión iniciada como {{login}} vía gh.',
      account: 'Cuenta',
      refresh: 'Actualizar',
      followGh: 'Cuenta activa de gh',
      followGhNow: 'Sigue la cuenta que gh tenga activa (ahora: {{login}}).',
      followGhResolved: 'Sigue la cuenta que gh resuelva por su cuenta.',
      validSession: 'Sesión de gh válida.',
      invalidSession: 'gh informa que su token es inválido o venció.',
      tokenExpired: 'Token vencido',
      goneFromGh: 'Elegida antes, pero gh ya no la lista. Elige otra cuenta.',
      noLongerInGh: 'Ya no está en gh',
      listUnreadable:
        'No se pudo leer la lista de cuentas de gh. Con una sola cuenta con sesión iniciada esto no cambia nada: Minerva usa la cuenta que gh resuelva.',
      switchError: 'No se pudo cambiar de cuenta. Inténtalo de nuevo.',
      active: 'Activa',
    },
    azure: {
      intro:
        'Minerva usa tu credencial de Azure CLI (<mono>az devops login</mono> con un PAT que tenga el alcance Code Read & Write). La credencial nunca sale del proceso principal.',
      enable: 'Activar Azure DevOps',
      demoMode:
        'El modo demo lista la organización simulada "contoso", sin importar lo que se guarde aquí.',
      organization: 'Organización',
      organizationPlaceholder: 'p. ej. Contoso',
      loadProjects: 'Cargar proyectos',
      organizationHint: 'El nombre en https://dev.azure.com/<mono>organización</mono>.',
      projects: 'Proyectos',
      projectsAriaLabel: 'Proyectos de Azure DevOps',
      loadProjectsFirst:
        'Carga los proyectos de la organización y luego elige los que quieras revisar.',
      noProjects: 'Esta organización no tiene proyectos que puedas ver.',
      pickProject: 'Elige al menos un proyecto para listar sus pull requests.',
      save: 'Guardar',
      saving: 'Guardando…',
      usingAzDefaults: 'Usando los valores por defecto de az devops configure.',
      signedIn: 'Sesión iniciada como {{who}}.',
      signedInVia: 'Sesión iniciada como {{who}} vía {{source}}.',
      unknownUser: 'usuario desconocido',
      disabled: 'Azure DevOps está desactivado.',
      cliNotFound: 'No se encontró Azure CLI (az).',
      noCredential: 'No hay credencial de Azure DevOps. Ejecuta: az devops login',
      credentialSource: {
        ghCli: 'GitHub CLI',
        envPat: 'la variable AZURE_DEVOPS_EXT_PAT',
        azDevopsPat: 'el PAT guardado por az devops login',
        azEntra: 'az login (Microsoft Entra)',
      },
    },
  },
  updater: {
    title: 'Actualizaciones',
    intro: 'Minerva revisa si hay una versión nueva; la descarga solo empieza con tu confirmación.',
    installedVersion: 'Versión instalada: <mono>{{version}}</mono>',
    upToDate: 'Estás al día.',
    lastChecked: 'Último chequeo: {{date}}',
    checking: 'Buscando actualizaciones…',
    lastSuccessfulCheck: 'Último chequeo con éxito: {{date}}',
    retry: 'Reintentar',
    check: 'Buscar actualizaciones',
    available: 'Disponible v{{version}}',
    download: 'Descargar (130 MB)',
    downloading: 'Descargando v{{version}}…',
    installOnQuit: 'Se instalará al salir de Minerva.',
    restartNow: 'Reiniciar ahora',
    unsupported: 'Esta instalación no puede actualizarse sola: {{reason}}.',
    unsupportedReasons: {
      macUnsigned: 'la versión de macOS todavía no está firmada',
      notAppimage: 'esta instalación no es la AppImage oficial',
      notWritable: 'Minerva no puede escribir sobre su propio archivo',
    },
    viewRelease: 'Ver la release',
  },
  errors: {
    boundary: {
      title: 'Algo salió mal en la interfaz',
      retry: 'Reintentar',
    },
    openPrFailed: 'No se pudo abrir #{{number}}: {{error}}',
  },
}
