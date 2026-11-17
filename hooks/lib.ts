// Pure helpers: formatting, counting and classifying. No engine calls here,
// so everything in this file is cheap and unit-testable.

import type { ChangeKind, ExtKind, FileChange } from '../types'

export const EDIT_TOOLS: readonly string[] = [
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit',
]

/** 950 -> "950", 18234 -> "18.2k", 1200000 -> "1.2M". */
export function fmtTokens(count: number): string {
  if (!Number.isFinite(count) || count <= 0) {
    return '0'
  }
  if (count < 1000) {
    return String(Math.round(count))
  }
  if (count < 999_950) {
    return trimZero((count / 1000).toFixed(count < 100_000 ? 1 : 0)) + 'k'
  }

  return trimZero((count / 1_000_000).toFixed(1)) + 'M'
}

function trimZero(text: string): string {
  return text.endsWith('.0') ? text.slice(0, -2) : text
}

/** A bar of `width` cells split at `fraction` (0 to 1): [filled, empty]. */
export function bar(width: number, fraction: number): [string, string] {
  const cells = Math.max(0, Math.floor(width))
  const share = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0))
  let filled = Math.round(cells * share)
  if (share > 0 && filled === 0 && cells > 0) {
    filled = 1
  }

  return ['━'.repeat(filled), '━'.repeat(cells - filled)]
}

/** Cuts `text` to `width` cells, an ellipsis at the cut. */
export function clip(text: string, width: number): string {
  if (width <= 0) {
    return ''
  }

  return text.length <= width ? text : text.slice(0, Math.max(0, width - 1)) + '…'
}

/** Clips, then pads to exactly `width` cells. */
export function fit(text: string, width: number): string {
  return clip(text, width).padEnd(Math.max(0, width))
}

type Hunk = { lines?: readonly string[] }

/** Lines added and removed across the hunks of a structured patch. */
export function countPatch(hunks: readonly Hunk[] | undefined): {
  added: number
  removed: number
} {
  let added = 0
  let removed = 0
  for (const hunk of hunks ?? []) {
    for (const line of hunk.lines ?? []) {
      if (line.startsWith('+')) {
        added += 1
      } else if (line.startsWith('-')) {
        removed += 1
      }
    }
  }

  return { added, removed }
}

/** Reads an edit tool's result: line counts and whether the file is new. */
export function readEdit(
  output: unknown,
): { added: number; removed: number; isNew: boolean } | null {
  if (typeof output !== 'object' || output === null) {
    return null
  }
  const record = output as {
    type?: unknown
    content?: unknown
    structuredPatch?: readonly Hunk[]
    gitDiff?: { additions?: unknown; deletions?: unknown; status?: unknown }
  }
  const isNew = record.type === 'create' || record.gitDiff?.status === 'added'
  if (
    typeof record.gitDiff?.additions === 'number' &&
    typeof record.gitDiff.deletions === 'number'
  ) {
    return {
      added: record.gitDiff.additions,
      removed: record.gitDiff.deletions,
      isNew,
    }
  }
  const counted = countPatch(record.structuredPatch)
  if (isNew && counted.added === 0 && typeof record.content === 'string') {
    counted.added = record.content === '' ? 0 : record.content.split('\n').length
  }

  return { ...counted, isNew }
}

export function normalize(path: string): string {
  return path.replace(/\\/g, '/')
}

export function dirname(path: string): string {
  const cut = path.lastIndexOf('/')
  if (cut <= 0) {
    return cut === 0 ? '/' : ''
  }

  return path.slice(0, cut)
}

export function basename(path: string): string {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path

  return trimmed.slice(trimmed.lastIndexOf('/') + 1)
}

/** `path` relative to `root` when it lies beneath it, else unchanged. */
export function relative(path: string, root: string): string {
  const base = root.endsWith('/') ? root : root + '/'

  return path.startsWith(base) ? path.slice(base.length) : path
}

export type Mark = { kind: ExtKind | 'tool'; name: string }

/**
 * What one tool call counts as: a skill run, a connector, plugin or MCP
 * server call, or a plain tool. A plugin's skill counts for both.
 */
export function classify(tool: string, input: unknown): Mark[] {
  if (tool === 'Skill') {
    const skill = (input as { skill?: unknown } | null)?.skill
    const name = typeof skill === 'string' && skill !== '' ? skill : 'skill'
    const marks: Mark[] = [{ kind: 'skill', name }]
    const owner = name.includes(':') ? name.slice(0, name.indexOf(':')) : ''
    if (owner !== '') {
      marks.push({ kind: 'plugin', name: owner })
    }

    return marks
  }
  if (tool.startsWith('mcp__')) {
    const server = tool.slice(5).split('__')[0] ?? ''
    if (server.startsWith('claude_ai_')) {
      return [{ kind: 'connector', name: server.slice(10).replace(/_/g, ' ') }]
    }
    if (server.startsWith('plugin_')) {
      return [{ kind: 'plugin', name: server.slice(7).split('_')[0] ?? server }]
    }

    return [{ kind: 'mcp', name: server }]
  }

  return [{ kind: 'tool', name: tool }]
}

/** Adds one to each mark's count in a `<kind>:<name>` tally. */
export function tally(
  counts: Readonly<Record<string, number>>,
  marks: readonly Mark[],
  only?: (mark: Mark) => boolean,
): Record<string, number> {
  const next = { ...counts }
  for (const mark of marks) {
    if (only === undefined || only(mark)) {
      const key = `${mark.kind}:${mark.name}`
      next[key] = (next[key] ?? 0) + 1
    }
  }

  return next
}

/**
 * Roughly how many tokens some content holds: its text at four characters a
 * token. Walks strings, arrays and the `text` and `content` fields of blocks;
 * media and other fields count nothing.
 */
export function estimateTokens(content: unknown): number {
  let chars = 0
  const walk = (value: unknown, depth: number): void => {
    if (depth > 8) {
      return
    }
    if (typeof value === 'string') {
      chars += value.length
    } else if (Array.isArray(value)) {
      for (const one of value) {
        walk(one, depth + 1)
      }
    } else if (value !== null && typeof value === 'object') {
      const block = value as { text?: unknown; content?: unknown }
      walk(block.text, depth + 1)
      walk(block.content, depth + 1)
    }
  }
  walk(content, 0)

  return Math.ceil(chars / 4)
}

/** Adds `tokens` to each non-tool mark's entry in a `<kind>:<name>` tally. */
export function addTokens(
  counts: Readonly<Record<string, number>>,
  marks: readonly Mark[],
  tokens: number,
): Record<string, number> {
  const next = { ...counts }
  if (tokens <= 0) {
    return next
  }
  for (const mark of marks) {
    if (mark.kind !== 'tool') {
      const key = `${mark.kind}:${mark.name}`
      next[key] = (next[key] ?? 0) + tokens
    }
  }

  return next
}

/** The entries of a tally for one kind, most used first. */
export function ofKind(
  counts: Readonly<Record<string, number>>,
  kind: string,
): { name: string; count: number }[] {
  const prefix = kind + ':'

  return Object.entries(counts)
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, count]) => ({ name: key.slice(prefix.length), count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

export type RepoTotal = {
  repo: string
  files: number
  added: number
  removed: number
}

/** File changes summed per repository, distinct files counted once. */
export function byRepo(files: readonly FileChange[]): RepoTotal[] {
  const totals = new Map<string, RepoTotal & { seen: Set<string> }>()
  for (const file of files) {
    const total = totals.get(file.repo) ?? {
      repo: file.repo,
      files: 0,
      added: 0,
      removed: 0,
      seen: new Set<string>(),
    }
    total.seen.add(file.path)
    total.files = total.seen.size
    total.added += file.added
    total.removed += file.removed
    totals.set(file.repo, total)
  }

  return [...totals.values()].map(({ seen: _seen, ...total }) => total)
}

/**
 * One entry per file, in the order first touched: line counts summed, and
 * the kind the file ends the response with (a file added, then edited, is
 * still added; one deleted last is deleted).
 */
export function mergeFiles(files: readonly FileChange[]): FileChange[] {
  const merged = new Map<string, FileChange>()
  for (const file of files) {
    const key = `${file.repo}/${file.path}`
    const was = merged.get(key)
    if (was === undefined) {
      merged.set(key, { ...file })
      continue
    }
    const kind: ChangeKind =
      file.kind === 'deleted'
        ? 'deleted'
        : was.kind === 'added' || was.kind === 'renamed'
          ? was.kind
          : file.kind
    merged.set(key, {
      ...was,
      kind,
      added: was.added + file.added,
      removed: was.removed + file.removed,
    })
  }

  return [...merged.values()]
}

/** The letter git marks each kind with, and the colour it is drawn in. */
export const KIND_MARK: Record<ChangeKind, { letter: string; color: string }> = {
  added: { letter: 'A', color: 'success' },
  modified: { letter: 'M', color: 'warning' },
  deleted: { letter: 'D', color: 'error' },
  renamed: { letter: 'R', color: 'suggestion' },
}

/** "2 modified, 1 added": the kinds in a list of files, most first. */
export function kindCounts(files: readonly FileChange[]): string {
  const counts = new Map<ChangeKind, number>()
  for (const file of files) {
    counts.set(file.kind, (counts.get(file.kind) ?? 0) + 1)
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([kind, count]) => `${count} ${kind}`)
    .join(', ')
}

export function countFiles(files: readonly FileChange[]): number {
  return new Set(files.map(file => `${file.repo}/${file.path}`)).size
}

/** "2h 10m", "45m", "3d 4h": the time from `now` until `resetsAt`. */
export function until(resetsAt: string | undefined, now: number): string {
  const at = resetsAt === undefined ? Number.NaN : Date.parse(resetsAt)
  if (!Number.isFinite(at) || at <= now) {
    return ''
  }

  return span(at - now)
}

export function span(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`
  }
  const days = Math.floor(hours / 24)

  return hours % 24 === 0 ? `${days}d` : `${days}d ${hours % 24}h`
}

export function limitLabel(kind: string): string {
  if (kind === 'five_hour') {
    return '5h limit'
  }
  if (kind === 'seven_day') {
    return 'Weekly'
  }
  if (kind === 'spend_limit') {
    return 'Spend'
  }

  return kind.replace(/_/g, ' ')
}

/** The first few words of a text, as a stand-in title. */
export function firstWords(text: string, words = 5): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_`>[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (plain === '') {
    return ''
  }

  return clip(plain.split(' ').slice(0, words).join(' '), 40)
}

/** The opening sentence of a response, as its summary. */
export function firstSentence(text: string, width = 200): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_`>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const end = plain.search(/[.!?](\s|$)/)

  return clip(end < 0 ? plain : plain.slice(0, end + 1), width)
}
