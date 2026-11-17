// The state contract of Flightdeck: every value the mod keeps in
// `$.state`, which the panel draws from. Self-contained: no imports.

/** How a response changed a file, in git's terms. */
export type ChangeKind = 'added' | 'modified' | 'deleted' | 'renamed'

/** One file a response created, changed, renamed or deleted. */
export type FileChange = {
  repo: string
  path: string
  added: number
  removed: number
  kind: ChangeKind
  /** The path before a rename. */
  from?: string
}

/** One of Claude's responses, as the chat history lists it. */
export type Turn = {
  id: string
  title: string
  summary: string
  startedAt: number
  /** Input, cache-written and output tokens of the turn. */
  tokens: number
  isRunning: boolean
  /** Transcript rows to scroll to, best first. */
  anchors: string[]
  /** No longer written; kept so turns saved by earlier versions still read. */
  last?: string
  files: FileChange[]
  /** Call counts keyed `<kind>:<name>`, kind as ExtKind or `tool`. */
  uses: Record<string, number>
}

export type ExtKind = 'skill' | 'connector' | 'plugin' | 'mcp'

/** What is unfolded in the panel. */
export type View = {
  openTurn: string | null
  isContextOpen: boolean
  openExt: ExtKind | null
  isModelOpen: boolean
}

export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

/** The status line's figures: context fill and rate-limit windows. */
export type Meter = {
  tokens: number | null
  window: number
  percent: number | null
  limits: Limit[]
  startedAt: number
}

/** Tokens the session has used, summed over its turns. */
export type Totals = { input: number; output: number; cacheRead: number }

export type Category = { name: string; tokens: number; color: string }

/** Extension usage: calls keyed `<kind>:<name>`, and how many exist. */
export type Extensions = {
  used: Record<string, number>
  /** Estimated tokens each extension's calls brought into the conversation. */
  tokens?: Record<string, number>
  available: Partial<Record<ExtKind, number>>
}

/** The model and effort controls, and how a press changes them. */
export type Controls = {
  model: string
  effort: string | null
  modelKey: string | null
  modelOptions: string[]
  effortKey: string | null
  effortOptions: string[]
  hasModelCommand: boolean
  hasEffortCommand: boolean
}

/** One hunk of a diff: where it starts on each side, and its lines. */
export type DiffHunk = { oldStart: number; newStart: number; lines: string[] }

/** One file's changes in a response, as the diff viewer shows them. */
export type DiffFile = {
  repo: string
  path: string
  kind: ChangeKind
  from?: string
  hunks: DiffHunk[]
  /** Only the first lines were kept. */
  isCut: boolean
  /** Changed by a shell command: the diff is against the last commit. */
  isSinceCommit: boolean
}

/** Which response's changes the viewer shows: its file, and the first code row in view. */
export type DiffView = {
  turn: string | null
  file: number
  top: number
}

declare module 'claude-code' {
  interface PluginState {
    'flightdeck': {
      turns: Shaped<Turn[]>
      view: Shaped<View>
      meter: Shaped<Meter>
      totals: Shaped<Totals>
      breakdown: Shaped<Category[]>
      extensions: Shaped<Extensions>
      controls: Shaped<Controls>
      diffs: Shaped<Record<string, DiffFile[]>>
      diffView: Shaped<DiffView>
    }
  }
}
