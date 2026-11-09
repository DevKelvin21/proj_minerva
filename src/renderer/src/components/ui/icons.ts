/**
 * The one way into the UI icon set: a MEANING maps to a Lucide glyph, so the
 * same idea always shows the same picture. Components render these through
 * `<Icon icon={icons.retry} size="sm" />` (`./Icon.tsx`); importing
 * `lucide-react` anywhere else in the renderer is a lint error.
 *
 * Adding an icon: pick the meaning first. If a key already says it, reuse
 * it; otherwise add one key here (Lucide's current name, not a deprecated
 * alias) with a line saying what it means. Two keys may share a glyph when
 * they are different ideas (`stack` and `walkthrough` are both layers), but
 * one meaning never gets two glyphs.
 *
 * Brand marks (GitHub, Azure DevOps, Claude, OpenAI, OpenCode) are not here:
 * see `ScmProviderIcon` / `AiProviderIcon` and `provider-marks.ts`.
 */
import {
  Archive,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  ArrowUp,
  ArrowUpToLine,
  Bell,
  BookOpen,
  Bookmark,
  BookmarkPlus,
  Building2,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleQuestionMark,
  CircleSlash,
  Clock,
  Cloud,
  CodeXml,
  Columns2,
  Copy,
  Cpu,
  Database,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileBraces,
  FileCode,
  FileDiff,
  FileMinusCorner,
  FilePlusCorner,
  FolderTree,
  Funnel,
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestArrow,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Globe,
  GraduationCap,
  History,
  House,
  Info,
  Languages,
  Layers,
  Lightbulb,
  Link,
  List,
  ListTodo,
  LoaderCircle,
  LogIn,
  Maximize,
  Maximize2,
  MessageSquare,
  MessageSquarePlus,
  MessageSquareWarning,
  MessagesSquare,
  Minus,
  Moon,
  Paintbrush,
  Palette,
  PanelLeft,
  PanelLeftClose,
  Pencil,
  Play,
  PlugZap,
  Plus,
  RefreshCw,
  Reply,
  Rocket,
  RotateCcw,
  Search,
  SearchX,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Square,
  Sun,
  Tag,
  Terminal,
  TextAlignJustify,
  TextWrap,
  Trash2,
  TriangleAlert,
  UnfoldVertical,
  UserRound,
  WandSparkles,
  Workflow,
  X,
  type LucideIcon,
} from 'lucide-react'

/** A glyph from the registry (what `<Icon icon>` and icon-taking props accept). */
export type IconGlyph = LucideIcon

/**
 * The four icon sizes: `xs` inside text, badges and chips; `sm` in buttons
 * and rows (the default); `md` in toolbars, the title bar and tabs; `lg` in
 * empty states and page headers. No other size exists.
 */
export type IconSize = 'xs' | 'sm' | 'md' | 'lg'

export const ICON_PX: Readonly<Record<IconSize, number>> = { xs: 12, sm: 14, md: 16, lg: 20 }

/** One line weight at every size: pixels, with `absoluteStrokeWidth`. */
export const ICON_STROKE = 1.25

export const icons = {
  // ── App chrome and navigation ─────────────────────────────────────────
  /** Home dashboard. */
  home: House,
  /** Settings. */
  settings: Settings,
  /** Search field / command palette. */
  search: Search,
  /** Close or dismiss (dialogs, chips, notes). */
  close: X,
  /** Go back one level (breadcrumb, Settings page, leave focus mode). */
  back: ArrowLeft,
  /** Previous item in a stepper (stack, layer, walkthrough). */
  previous: ChevronLeft,
  /** Next item in a stepper. */
  next: ChevronRight,
  /** "Continue to" / "becomes": a primary forward action or a from → to pair. */
  forward: ArrowRight,
  /** Separator between breadcrumb / location segments. */
  breadcrumb: ChevronRight,
  /** Disclosure that is closed (click to open). */
  collapsed: ChevronRight,
  /** Disclosure that is open (click to close). */
  expanded: ChevronDown,
  /** Opens a menu or picker (select caret, split-button arrow). */
  dropdown: ChevronDown,
  /** Show the sidebar. */
  sidebar: PanelLeft,
  /** Hide the sidebar. */
  sidebarCollapse: PanelLeftClose,
  /** Open something larger (diagram full view). */
  expand: Maximize2,
  /** Opens outside this view (browser, detached window). */
  openExternal: ExternalLink,
  /** Command palette: commands group. */
  commands: Terminal,
  /** Sidebar: review queue. */
  queue: ListTodo,
  /** Activity inbox and its notifications. */
  inbox: Bell,

  // ── Actions ───────────────────────────────────────────────────────────
  /** Add / create. */
  add: Plus,
  /** Rename or edit. */
  edit: Pencil,
  /** Delete. */
  delete: Trash2,
  /** Copy to the clipboard. */
  copy: Copy,
  /** Checked / confirmed / copied (a plain tick, not a status). */
  check: Check,
  /** Download, install or export. */
  download: Download,
  /** Archive an inbox item. */
  archive: Archive,
  /** Mark everything read / all caught up. */
  markAllRead: CheckCheck,
  /** Show (unhide). */
  show: Eye,
  /** Hide. */
  hide: EyeOff,
  /** Filter. */
  filter: Funnel,
  /** A saved view. */
  savedView: Bookmark,
  /** Save the current view. */
  saveView: BookmarkPlus,
  /** A label / tag. */
  tag: Tag,
  /** Reload data (refresh a list, re-check a CLI, regenerate). */
  reload: RefreshCw,
  /** Try a failed thing again. */
  retry: RotateCcw,
  /** Put a diagram back to its initial zoom/position. */
  resetView: RotateCcw,
  /** Zoom in. */
  zoomIn: Plus,
  /** Zoom out. */
  zoomOut: Minus,
  /** Fit to the container. */
  fit: Maximize,
  /** Send a message. */
  send: ArrowUp,
  /** Stop a running answer. */
  stop: Square,
  /** Start a run (review a whole stack). */
  start: Play,
  /** Sign in. */
  signIn: LogIn,
  /** Copy a link. */
  link: Link,
  /** Reply in a thread. */
  reply: Reply,
  /** Generate from a seed (theme palette) — not AI. */
  generate: WandSparkles,

  // ── Settings and appearance ───────────────────────────────────────────
  /** General preferences. */
  preferences: SlidersHorizontal,
  /** Appearance / themes. */
  appearance: Palette,
  /** Create a custom theme. */
  customTheme: Paintbrush,
  /** A JSON theme file. */
  jsonFile: FileBraces,
  /** Light mode. */
  lightMode: Sun,
  /** Dark mode. */
  darkMode: Moon,
  /** The UI / analysis language. */
  language: Languages,
  /** AI providers (the CLIs). */
  aiProvider: Cpu,

  // ── Review domain ─────────────────────────────────────────────────────
  /** AI: anything the model wrote or will do. */
  ai: Sparkles,
  /** The didactic analysis (learning view). */
  didactic: GraduationCap,
  /** A comment, or a count of comments. */
  comment: MessageSquare,
  /** Discussions as a set: review threads, AI chat conversations. */
  threads: MessagesSquare,
  /** Add something as a new comment. */
  addComment: MessageSquarePlus,
  /** Comments that need attention (cannot be placed on the diff). */
  commentWarning: MessageSquareWarning,
  /** A reviewer asked for changes. */
  changesRequested: MessageSquareWarning,
  /** A suggestion (suggested change block). */
  suggestion: Lightbulb,
  /** An open pull request. */
  pullRequest: GitPullRequest,
  /** A draft pull request. */
  pullRequestDraft: GitPullRequestDraft,
  /** A closed (unmerged) pull request. */
  pullRequestClosed: GitPullRequestClosed,
  /** Merge, or a merged pull request. */
  merge: GitMerge,
  /** An orphaned / retarget-needed pull request. */
  orphan: GitPullRequestArrow,
  /** A branch. */
  branch: GitBranch,
  /** A stack of dependent PRs. */
  stack: Layers,
  /** The guided walkthrough (its layers). */
  walkthrough: Layers,
  /** A diagram (Mermaid). */
  diagram: Workflow,
  /** A file (path, file group). */
  file: FileCode,
  /** A code selection. */
  code: CodeXml,
  /** Changed files / a modified file. */
  changedFiles: FileDiff,
  /** File added. */
  fileAdded: FilePlusCorner,
  /** File removed. */
  fileRemoved: FileMinusCorner,
  /** File renamed. */
  fileRenamed: ArrowRightLeft,
  /** File tree view. */
  treeView: FolderTree,
  /** Flat list view. */
  listView: List,
  /** Side-by-side diff. */
  splitView: Columns2,
  /** Unified diff. */
  unifiedView: TextAlignJustify,
  /** Wrap long lines. */
  wrapLines: TextWrap,
  /** Show more context lines. */
  expandContext: UnfoldVertical,
  /** Expand context upward. */
  expandUp: ArrowUpToLine,
  /** Expand context downward. */
  expandDown: ArrowDownToLine,
  /** Code as it was (outdated thread excerpt). */
  history: History,
  /** A person (author, account). */
  user: UserRound,
  /** Your review was requested / waiting on you. */
  reviewRequested: Eye,
  /** Approved. */
  approved: CircleCheck,
  /** Auto-merge / auto-complete is scheduled. */
  autoMerge: Clock,
  /** Nothing matched / the page's subject does not exist. */
  notFound: SearchX,
  /** No source-control provider connected. */
  disconnected: PlugZap,

  // ── Didactic sections ─────────────────────────────────────────────────
  summary: BookOpen,
  setup: Rocket,
  architecture: Building2,
  endpoint: Globe,
  schema: Database,
  cloud: Cloud,

  // ── Status ────────────────────────────────────────────────────────────
  /** Success / passed. */
  success: CircleCheck,
  /** Warning. */
  warning: TriangleAlert,
  /** Error / failed / rejected. */
  error: CircleAlert,
  /** Neutral information. */
  info: Info,
  /** Pending / running checks. */
  pending: CircleDashed,
  /** Skipped / neutral check. */
  skipped: CircleSlash,
  /** Unsure / needs a closer look. */
  unsure: CircleQuestionMark,
  /** Loading (render it through `Spinner`, never directly). */
  loading: LoaderCircle,
} as const satisfies Record<string, IconGlyph>

export type IconName = keyof typeof icons
