/**
 * English messages of the main process (source of truth): text main shows the
 * user directly (native dialogs, window titles) or sends to the renderer to
 * display (error messages). `es.ts` must have the same shape. `{{name}}` is
 * replaced by `mt()` (`../index.ts`). Developer log lines stay out of here.
 *
 * Plain quoted strings only (no backtick-delimited strings, gotcha 3).
 */

export const en = {
  ai: {
    chat: {
      empty: 'The AI finished without an answer to your message. Try sending it again.',
      busy: 'The AI is still answering in this conversation. Wait for it to finish, or stop it first.',
      notFound: 'This conversation no longer exists.',
      notRetryable: 'There is no failed or stopped answer to retry in this conversation.',
      tooMany: 'The AI is already answering in other conversations. Wait for one to finish, or stop it.',
    },
    errors: {
      inactivityTimeout:
        '{{provider}} stopped sending data: no new chunk for more than {{seconds}}s (inactivity timeout).',
      totalTimeout: '{{provider}} did not answer in time (total timeout of {{seconds}}s).',
      providerError: '{{provider}} returned an error: {{detail}}',
      spawnFailed: 'Could not launch the "{{binary}}" process: {{detail}}',
      noValidSection: 'None of the sections streamed by the model had a valid format.',
      cancelled: 'Cancelled.',
    },
    provider: {
      notLoggedIn:
        'The active AI provider ({{provider}}) is installed but not logged in. Run "{{binary}} login" in a terminal and try again, or pick another provider in Settings (gear in the title bar).',
      cliNotFound:
        'The "{{binary}}" CLI of the active AI provider ({{provider}}) was not found on this machine. Install it and try again, or pick another provider in Settings (gear in the title bar).',
      opencodeNoUpstream:
        'OpenCode is installed but reports no connected model provider. Run "opencode auth login" in a terminal to connect one (OpenRouter, Anthropic, etc.) and try again, or pick another provider in Settings (gear in the title bar).',
      opencodeNotFound:
        'The "opencode" CLI of the active AI provider (OpenCode) was not found on this machine (or its version is older than the minimum supported). Install or update it (https://opencode.ai/docs/) and try again, or pick another provider in Settings (gear in the title bar).',
    },
    claude: {
      cliNotFound:
        'The "claude" CLI is not installed: install Claude Code (see https://code.claude.com/docs/en/setup) and run "claude login" before analyzing with this provider.',
      authFailed:
        'Claude Code has no valid session: run "claude login" in a terminal (with the Pro/Max account you want to use) and try the analysis again.',
      billing: 'The logged-in Claude account reported a billing problem.',
      rateLimit: 'Claude Code rate limit: try again in a few minutes.',
      overloaded: 'Claude is overloaded right now: try again later.',
      modelNotFound:
        'The selected Claude Code model does not exist or is not available for this account.',
      maxOutputTokens: 'Claude Code cut the answer off at the output token limit.',
      errorCode: 'Claude Code returned an error ({{code}}).',
      noExecutable: 'Claude Code (Agent SDK) could not find an executable binary: {{detail}}',
      noStreamingContent:
        'Claude Code returned no streaming content (check that the session is still active: "claude login").',
    },
    codex: {
      loginHint:
        'Codex has no valid session: run "codex login" in a terminal (with your ChatGPT Plus/Pro account) and try the analysis again.',
      noThreadId: 'codex app-server returned no thread id in its answer to "thread/start".',
      turnError: 'Codex returned an error during the turn.',
      turnFailed: 'The Codex turn ended in the "failed" state.',
      spawnFailed: 'Codex could not be launched: {{detail}}',
      noStreamingContent:
        'Codex returned no streaming content (check that the session is still active: "codex login").',
      binaryNotInPath:
        'The "{{binary}}" binary was not found on the PATH. Install the official OpenAI Codex CLI (package "@openai/codex" or the installer for your platform) and try again.',
      binaryNotInstalled:
        'The "{{binary}}" binary is not installed. Install the official OpenAI Codex CLI (package "@openai/codex" or the installer for your platform), run "codex login" and try again.',
      processExited:
        'The "codex app-server" process exited unexpectedly (code={{code}}, signal={{signal}}).',
      clientClosed: 'The codex app-server client is already closed.',
      requestTimeout: 'codex app-server did not answer "{{method}}" within {{ms}}ms.',
      cancelled: 'Analysis cancelled: the codex app-server process was closed.',
    },
    opencode: {
      noProviderConnected:
        'OpenCode has no AI provider connected: run "opencode auth login" in a terminal and connect a provider, or pick another model in Settings.',
      noProviderConnectedNamed:
        'OpenCode has no AI provider connected ({{provider}}): run "opencode auth login" in a terminal and connect a provider, or pick another model in Settings.',
      unknownError: 'OpenCode returned an unknown error.',
      sessionErrorNoDetail: 'session error without details.',
      unknownSessionError: 'unknown OpenCode error.',
      badModelSlug:
        'The OpenCode model "{{model}}" does not have the expected <provider>/<model> format. Pick a valid model in Settings.',
      eventsClosed: 'OpenCode closed the event connection before the analysis finished.',
      noStreamingContent:
        'OpenCode returned no streaming content (check that the server is still running and that the chosen model answers).',
      binaryNotInstalled:
        'The "opencode" binary is not installed. Install OpenCode (see https://opencode.ai/docs/) and try again.',
      binaryNotInPath:
        'The "{{binary}}" binary was not found on the PATH. Install OpenCode (https://opencode.ai/docs/) and try again.',
      serverSpawnFailed: 'Could not launch the OpenCode server ("{{binary}}"): {{detail}}',
      versionUnparseable: 'Could not read the OpenCode version from the output "{{output}}".',
      versionTooOld:
        'The installed OpenCode version ({{version}}) is older than the minimum required ({{min}}). Update it with your package manager or "opencode upgrade" and try again.',
      noFreePort: 'Could not get a free TCP port for the OpenCode server.',
      startCancelled: 'The OpenCode server startup was cancelled before it launched.',
      serverStartTimeout: 'The OpenCode server did not start within {{ms}}ms.',
      serverStoppedWhileStarting: 'The OpenCode server stopped while starting.',
      processExitedEarly:
        'The OpenCode process exited before it was ready (code={{code}}, signal={{signal}}).',
    },
    mock: {
      unknownPr:
        'The demo AI only has analyses for the sample PRs; it does not know {{pr}}. Set up an AI provider in Settings (gear in the title bar).',
    },
    activity: {
      readFailedDetail: 'Failed to read {{detail}}',
      readFailed: 'Failed to read a file',
      readDoneDetail: 'Read {{detail}}',
      readDone: 'Read a file',
      readingDetail: 'Reading {{detail}}',
      reading: 'Reading a file…',
      searchFailed: 'A search failed',
      searchDoneDetail: 'Searched "{{detail}}"',
      searchDone: 'Searched the repo',
      searchingDetail: 'Searching "{{detail}}"',
      searching: 'Searching…',
      listFailed: 'A listing failed',
      listDoneDetail: 'Listed {{detail}}',
      listDone: 'Listed the structure',
      listingDetail: 'Listing {{detail}}',
      listing: 'Listing the structure…',
      thought: 'Thought',
      thinking: 'Thinking…',
      toolFailed: 'A tool failed',
      toolDoneDetail: 'Used {{detail}}',
      toolDone: 'Explored the repository',
      usingToolDetail: 'Using {{detail}}',
      usingTool: 'Exploring the repository…',
    },
  },
  common: {
    cancel: 'Cancel',
  },
  activity: {
    notification: {
      commentTitle: '#{{number}} {{title}}',
      commentBody: '{{author}} commented: {{excerpt}}',
      replyBody: '{{author}} replied: {{excerpt}}',
      orphanTitle: '#{{number}} {{title}}',
      orphanBody: 'Its base PR #{{parent}} was merged. Retarget it to {{base}}.',
      manyTitle: '{{count}} new updates on your pull requests',
      manyBody: 'On {{prs}} pull requests. Open the Inbox to see them.',
      manyBodyOnePr: 'On one pull request. Open the Inbox to see them.',
      reviewTitle: '#{{number}} {{title}}',
      requestTitle: 'Review requested: #{{number}}',
      requestBody: 'You were asked to review "{{title}}".',
      requestBodyOptional: 'You were added as an optional reviewer of "{{title}}".',
      vote: {
        approved: '{{reviewer}} approved your pull request.',
        approved_with_suggestions: '{{reviewer}} approved with suggestions.',
        changes_requested: '{{reviewer}} requested changes.',
        rejected: '{{reviewer}} rejected your pull request.',
      },
    },
  },
  windows: {
    didacticTitle: 'Minerva — Analysis {{repo}}#{{number}}',
  },
  dialogs: {
    retarget: {
      message: 'Retarget PR #{{number}}?',
      detail: 'Repository: {{repo}}\nTitle: {{title}}\n\nBase branch: {{from}} → {{to}}',
      confirm: 'Retarget',
    },
    azureCredential: 'Minerva will use your Azure DevOps credential (from az) with {{urls}}.',
    azureProjects: {
      message: 'Load the projects of Azure DevOps organization {{organization}}?',
      azureOff: 'Azure DevOps is turned off in Settings.',
      confirm: 'Load projects',
    },
    azureAddOrg: {
      messageOne: 'Add Azure DevOps organization {{organizations}}?',
      messageMany: 'Add Azure DevOps organizations {{organizations}}?',
      unknownOne: 'It is not configured yet and not known to az.',
      unknownMany: 'They are not configured yet and not known to az.',
      confirm: 'Add',
    },
  },
  scm: {
    providerDisabled: 'Source-control provider not enabled: {{provider}}',
    invalidSettings: 'Invalid source-control settings.',
    prNotFound: 'Pull request not found: {{repo}}#{{number}}',
    threadNotFound: 'Comment thread not found: {{id}}',
    snapshotFinalize: 'Could not finalize the snapshot of {{repo}}@{{sha}} (rename failed).',
    noAgenticAnalysis: 'An agentic analysis cannot be generated for this PR.',
    retarget: {
      notOpen: 'Pull request #{{number}} is no longer open.',
      baseMoved:
        'Pull request #{{number}} now targets {{current}}, not {{expected}}. Refresh and try again.',
      alreadyTargets: 'The pull request already targets {{branch}}.',
      ownSource: 'A pull request cannot target its own source branch.',
      branchMissing: 'Branch {{branch}} does not exist in {{repo}}.',
    },
    orgAccess: {
      busy: 'Another confirmation is already open.',
      projectsDenied: 'Loading projects of {{organization}} was not allowed.',
    },
  },
  github: {
    notGithubRepo: 'Not a GitHub repository: {{repo}}',
    thisRepository: 'this repository',
    tokenInvalid: 'Not authenticated: the GitHub token is invalid or expired.',
    signInRequired: "Not authenticated: sign in with 'gh auth login' and retry.",
    reauth: "Not authenticated with GitHub CLI: run 'gh auth login' in a terminal and retry.",
    noSession: "No gh session. Run 'gh auth login' in a terminal.",
    accountNoSession:
      'The selected gh account "{{account}}" has no valid session. ' +
      "Run 'gh auth login' for it or pick another account in Settings.",
    cliNotFound:
      "GitHub CLI not found. Install it (https://cli.github.com) and run 'gh auth login'.",
    rateLimited: 'GitHub rate limit reached, try again in {{minutes}} min',
    forbidden: 'No permission for {{repo}}',
    notFoundOrForbidden: "No permission for {{repo}} (or it doesn't exist)",
    httpError: 'GitHub error (status {{status}})',
    unreachable: 'Could not reach GitHub: {{error}}',
    unknown: 'Unknown error talking to GitHub',
    threadNotFoundInPr: 'Comment thread not found in {{repo}}#{{number}}: {{id}}',
    generalCommentsUnresolvable: 'General PR comments cannot be resolved on GitHub.',
    notAFile: 'Not a file: {{path}}',
    tarballTooLarge: 'Repository {{repo}} is too large to copy locally (tarball over {{mb}} MB).',
    extractedTooLarge:
      'Repository {{repo}} is too large to copy locally (over {{mb}} MB uncompressed).',
    mockMissingAtBase: '{{path}} does not exist at the base commit.',
    mockMissingAtHead: '{{path}} does not exist at the head commit.',
    mockFileNotFound: 'File not found: {{path}}',
  },
  azure: {
    notAzureRepo: 'Not an Azure DevOps repository: {{repo}}',
    invalidRepo: 'Not a valid Azure DevOps repository: {{repo}}',
    unknownThread: 'Unknown thread: {{value}}',
    orgNotConfigured: 'Azure DevOps organization {{organization}} is not configured in Settings.',
    projectNotConfigured:
      'Azure DevOps project {{project}} is not configured for {{organization}} in Settings.',
    turnedOff: 'Turned off in Settings.',
    noOrganization: 'No Azure DevOps organization configured. Add one in Settings.',
    unauthenticatedDetail:
      '{{message}}. Run: {{command}} with a PAT that has Code (Read & Write) scope.',
    noIterations: 'Pull request {{number}} has no iterations yet.',
    commentCapped:
      'Cannot comment on {{path}} from Minerva: the pull request changes {{total}} files ' +
      'and only the first {{loaded}} are loaded. Comment on it in Azure DevOps.',
    commentCappedAtLeast:
      'Cannot comment on {{path}} from Minerva: the pull request changes more than {{total}} ' +
      'files and only the first {{loaded}} are loaded. Comment on it in Azure DevOps.',
    commentNotInIteration:
      'Cannot comment on {{path}}: the file is not part of the latest iteration.',
    threadWithoutComments: 'Azure DevOps returned a thread without comments.',
    baseCommitMissing: 'Azure DevOps did not report the base commit.',
    headCommitMissing: 'Azure DevOps did not report the head commit.',
    notCommitId: 'Not a commit id: {{value}}',
    notOrganizationUrl: 'Not an Azure DevOps organization URL: {{url}}',
    cliNotFound:
      'Azure CLI (az) was not found. Install it with the azure-devops extension, then run: ' +
      '{{command}} (or set AZURE_DEVOPS_EXT_PAT).',
    credentialRejected:
      'Azure DevOps rejected the stored credential for {{organization}} (expired or missing ' +
      'scopes). Run: {{command}} and paste a PAT with Code (Read & Write) scope.',
    noCredential:
      'No Azure DevOps credential found for {{organization}}. Run: {{command}} and paste a PAT ' +
      'with Code (Read & Write) scope.',
    invalidUrlSegment: 'Invalid Azure DevOps URL segment.',
    refusingCredentials: 'Refusing to send credentials to {{host}}',
    downloadTooLarge: 'Download larger than {{mb}} MB [{{endpoint}}]',
    timeout: 'Azure DevOps did not answer in time [{{endpoint}}]',
    unreachable: 'Could not reach Azure DevOps [{{endpoint}}]',
    status: {
      rejected: 'Azure DevOps rejected the credential',
      forbidden: 'Not allowed by Azure DevOps (missing permission or PAT scope)',
      notFound: 'Not found on Azure DevOps (or no access)',
      conflict: 'Conflict: the item changed on Azure DevOps',
      rateLimited: 'Azure DevOps rate limit reached',
      other: 'Azure DevOps error (HTTP {{status}})',
    },
    zip: {
      tooManyEntries: 'The repository archive has {{count}} entries (limit {{limit}}).',
      expandsPastLimit: 'The repository archive expands past the size limit.',
      tooLarge: 'The repository archive is larger than {{mb}} MB.',
      corrupt: 'The repository archive is not a valid zip: {{error}}',
      unsafe: 'The repository archive is unsafe: {{error}}',
      unsafePath: 'The repository archive has an unsafe path ({{reason}}).',
      extractedTooLarge: 'The repository expands to more than {{mb}} MB uncompressed.',
      pathOutside: 'The repository archive has a path outside the snapshot.',
    },
  },
  updater: {
    unknownError: 'Unknown error while checking for updates.',
    invalidVersion:
      'The update feed returned a version with an invalid format ("{{version}}"); ' +
      'it cannot continue safely.',
    missingExport:
      'electron-updater exposed no autoUpdater (neither as a named export nor on default); ' +
      'auto-update cannot start.',
    manifestMissing:
      'The latest release has no update manifest for this platform ({{file}}), ' +
      'so Minerva cannot compare versions yet.',
    noReleases: 'No published release was found on GitHub yet.',
    feedUnreachable: 'Could not reach GitHub to check for updates. Check your connection and try again.',
    feedUnavailable: 'GitHub did not answer the update check (HTTP {{status}}). Try again later.',
    feedUnreadable: 'GitHub returned a release list Minerva could not read.',
  },
  themes: {
    openVsx: {
      tooLarge: 'Open VSX sent more data than Minerva accepts for a theme.',
      unreachable: 'Could not reach Open VSX. Check your connection and try again.',
      untrustedRedirect:
        'Open VSX redirected to an unexpected address, so the download was stopped.',
      unavailable: 'Open VSX is unavailable right now. Try again later.',
      unreadable: 'Open VSX returned a theme Minerva could not read.',
      license: "That extension's license does not allow importing its themes here.",
      checksum: 'The downloaded extension failed its integrity check.',
      unsafePackage: 'The extension package is not safe to open.',
      mismatch: 'The downloaded package does not match the selected extension.',
      noThemes: 'That extension does not contain color themes.',
      tooManyThemes: 'That extension contains too many color themes to import.',
      busy: 'Another Open VSX request is still running. Try again in a moment.',
    },
  },
}
