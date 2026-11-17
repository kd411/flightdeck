// Everything that asks the engine for something: reading the session's
// figures, changing the model or effort, finding a file's repository,
// jumping to a response, and reading what changed in the working tree.
// Each read is guarded: a figure the engine cannot give is left as it was.

import type { EngineInterface } from 'claude-code'

import type { Category, ChangeKind, DiffFile, ExtKind, FileChange } from '../types'
import { capHunks, hunksOfUnified } from './diff'
import { band } from './viewer'
import {
  basename,
  classify,
  dirname,
  normalize,
  relative,
} from './lib'
import {
  changeBreakdown,
  changeControls,
  changeDiffView,
  changeExtensions,
  changeMeter,
  changeView,
} from './state'

type Engine = EngineInterface

const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']

async function attempt<T>(work: () => Promise<T>): Promise<T | undefined> {
  try {
    return await work()
  } catch {
    return undefined
  }
}

/** Reads the context fill and rate-limit windows, as the status line has them. */
export async function loadMeter($: Engine): Promise<void> {
  const usage = await attempt(() => $.session.usage())
  if (usage === undefined) {
    return
  }
  await changeMeter($, () => ({
    tokens: usage.context.tokens ?? null,
    window: usage.context.window,
    percent: usage.context.percent ?? null,
    limits: usage.rateLimits.map(limit => ({ ...limit })),
    startedAt: usage.startedAt,
  }))
}

/** Estimates the context window by category. Local: sends no request. */
export async function loadBreakdown($: Engine): Promise<void> {
  const usage = await attempt(() => $.session.usage({ breakdown: 'summary' }))
  const found = usage?.context.breakdown
  if (found === undefined) {
    return
  }
  const used: Category[] = found.categories
    .filter(category => category.kind === 'used' && category.tokens > 0)
    .map(({ name, tokens, color }) => ({ name, tokens, color }))
  await changeBreakdown($, () => used)
}

/** Reads the model, the effort level and the ways a press can change them. */
export async function loadControls($: Engine): Promise<void> {
  const [model, rows, commands] = await Promise.all([
    attempt(() => $.session.model()),
    attempt(() => $.config.list()),
    attempt(() => $.command.list()),
  ])
  const found = await findEffort($)
  const modelRow = rows?.find(row => row.key === 'model' && !row.isLocked)
  const effortRow = rows?.find(row => /effort/i.test(row.key) && !row.isLocked)
  const names = new Set((commands ?? []).map(command => command.name))
  const hasEffortCommand = names.has('effort')
  const rowLevels = [...(effortRow?.options ?? [])]

  await changeControls($, old => ({
    model: model ?? old.model,
    effort:
      typeof effortRow?.value === 'string'
        ? effortRow.value
        : (found?.level ?? null),
    modelKey: modelRow?.key ?? null,
    modelOptions: [...(modelRow?.options ?? [])],
    effortKey: effortRow?.key ?? null,
    effortOptions:
      rowLevels.length > 0 ? rowLevels : hasEffortCommand ? EFFORT_LEVELS : [],
    hasModelCommand: names.has('model'),
    hasEffortCommand,
  }))
}

/** Where the effort level in force was read from. */
export type EffortSource =
  | 'request'
  | 'last seen'
  | 'CLAUDE_CODE_EFFORT_LEVEL'
  | 'CLAUDE_EFFORT'
  | 'model settings'
  | 'settings'

function isLevel(value: unknown): value is string {
  return typeof value === 'string' && EFFORT_LEVELS.includes(value)
}

/** The level the user settings save for one model, under `modelSettings`. */
function levelForModel(saved: unknown, model: string | undefined): string | null {
  if (typeof saved !== 'object' || saved === null || model === undefined) {
    return null
  }
  const byModel = saved as Record<string, { effortLevel?: unknown } | undefined>
  const id = model.replace(/\[[^\]]*\]$/, '')
  const level = byModel[model]?.effortLevel ?? byModel[id]?.effortLevel

  return isLevel(level) ? level : null
}

// The level the last request of the main loop went out with: the one
// reading that is never stale. Also kept per model in `$.store`, so a reload
// or the next session starts from it before its first request.
let fromRequest: string | null = null

function seenKey(model: string): string {
  return `effort:${model.replace(/\[[^\]]*\]$/, '')}`
}

/** Drops the last request's level once the person changes it. */
export async function forgetRequestEffort($: Engine): Promise<void> {
  fromRequest = null
  const model = await attempt(() => $.session.model())
  if (model !== undefined) {
    await attempt(() => $.store.set(seenKey(model), null))
  }
}

export async function sawRequestEffort($: Engine, level: string): Promise<void> {
  if (!isLevel(level)) {
    return
  }
  fromRequest = level
  const model = await attempt(() => $.session.model())
  if (model !== undefined) {
    await attempt(() => $.store.set(seenKey(model), level))
  }
}

/**
 * The effort level in force: what the last request used, the environment,
 * the level the last request on this model used (this session or an earlier
 * one), what the settings save for the session's model (where `/effort`
 * writes it), then a level saved for every model. Null when none says: the
 * model then runs at its own default, which shows from the first request.
 */
export async function findEffort(
  $: Engine,
): Promise<{ level: string; source: EffortSource } | null> {
  if (fromRequest !== null) {
    return { level: fromRequest, source: 'request' }
  }
  const model = await attempt(() => $.session.model())
  const [envLevel, turnLevel, seen, byModel, anyModel] = await Promise.all([
    attempt(() => $.env.get('CLAUDE_CODE_EFFORT_LEVEL')),
    attempt(() => $.env.get('CLAUDE_EFFORT')),
    model === undefined ? undefined : attempt(() => $.store.get(seenKey(model))),
    attempt(() => $.settings.read({ key: 'modelSettings' })),
    attempt(() => $.settings.read({ key: 'effortLevel' })),
  ])
  if (isLevel(envLevel)) {
    return { level: envLevel, source: 'CLAUDE_CODE_EFFORT_LEVEL' }
  }
  if (isLevel(turnLevel)) {
    return { level: turnLevel, source: 'CLAUDE_EFFORT' }
  }
  if (isLevel(seen)) {
    return { level: seen, source: 'last seen' }
  }
  const saved = levelForModel(byModel, model)
  if (saved !== null) {
    return { level: saved, source: 'model settings' }
  }
  if (isLevel(anyModel)) {
    return { level: anyModel, source: 'settings' }
  }

  return null
}

/** What the mod can see of the session's controls, for troubleshooting. */
export async function describeControls($: Engine): Promise<string> {
  const [rows, commands, env, legacy, setting, byModel, model, effort] =
    await Promise.all([
      attempt(() => $.config.list()),
      attempt(() => $.command.list()),
      attempt(() => $.env.get('CLAUDE_EFFORT')),
      attempt(() => $.env.get('CLAUDE_CODE_EFFORT_LEVEL')),
      attempt(() => $.settings.read({ key: 'effortLevel' })),
      attempt(() => $.settings.read({ key: 'modelSettings' })),
      attempt(() => $.session.model()),
      attempt(() => findEffort($)),
    ])
  const keys = (rows ?? [])
    .filter(row => /model|effort|think/i.test(row.key))
    .map(row => `${row.key}=${String(row.value)} (${row.kind}${row.isLocked ? ', locked' : ''}; ${(row.options ?? []).length} options)`)
  const names = (commands ?? [])
    .map(command => command.name)
    .filter(name => /^(model|effort)$/.test(name))

  return [
    `model: ${model ?? 'unknown'}`,
    `config rows: ${rows === undefined ? 'unavailable' : keys.join('; ') || 'none for model or effort'}`,
    `commands: ${names.join(', ') || 'none'}`,
    `effort in force: ${
      effort ? `${effort.level} (from ${effort.source})` : "the model's default (none set)"
    }`,
    `  last request: ${fromRequest ?? 'none yet'}`,
    `  CLAUDE_CODE_EFFORT_LEVEL: ${legacy ?? 'unset'}`,
    `  CLAUDE_EFFORT: ${env ?? 'unset'}`,
    `  modelSettings for ${model ?? 'this model'}: ${levelForModel(byModel, model) ?? 'unset'}`,
    `  effortLevel (all models): ${typeof setting === 'string' ? setting : 'unset'}`,
  ].join('\n')
}

/** Counts the connectors, plugins and MCP servers the session can use. */
export async function loadAvailable($: Engine): Promise<void> {
  const [tools, commands] = await Promise.all([
    attempt(() => $.tool.list()),
    attempt(() => $.command.list()),
  ])
  if (tools === undefined && commands === undefined) {
    return
  }
  const names: Record<ExtKind, Set<string>> = {
    skill: new Set(),
    connector: new Set(),
    plugin: new Set(),
    mcp: new Set(),
  }
  for (const tool of tools ?? []) {
    for (const mark of classify(tool.name, null)) {
      if (mark.kind !== 'tool' && mark.kind !== 'skill') {
        names[mark.kind].add(mark.name)
      }
    }
  }
  for (const command of commands ?? []) {
    if (command.plugin !== undefined) {
      names.plugin.add(command.plugin)
    }
  }
  // Spread what is there: the counts and token totals outlive a reload,
  // which runs this again.
  await changeExtensions($, old => ({
    ...old,
    available: {
      connector: names.connector.size,
      plugin: names.plugin.size,
      mcp: names.mcp.size,
    },
  }))
}

/** The model row: unfolds its options, or opens Claude Code's own picker. */
export async function pressModel($: Engine, options: number): Promise<void> {
  if (options > 0) {
    await changeView($, old => ({ ...old, isModelOpen: !old.isModelOpen }))

    return
  }
  const ran = await attempt(() => $.command.run({ command: 'model' }))
  if (ran === undefined) {
    $.ui.toast('Flightdeck: type /model to change the model')
  }
}

export async function pickModel(
  $: Engine,
  key: string,
  value: string,
): Promise<void> {
  const set = await attempt(() => $.config.set({ key, value }))
  if (set === undefined || set.deny !== undefined) {
    $.ui.toast(`Flightdeck: model not changed${reason(set?.deny)}`)
  }
  await changeView($, old => ({ ...old, isModelOpen: false }))
  await loadControls($)
}

export async function pickEffort(
  $: Engine,
  key: string | null,
  level: string,
): Promise<void> {
  if (key !== null) {
    const set = await attempt(() => $.config.set({ key, value: level }))
    if (set === undefined || set.deny !== undefined) {
      $.ui.toast(`Flightdeck: effort not changed${reason(set?.deny)}`)
    }
    await loadControls($)

    return
  }
  const ran = await attempt(() => $.command.run({ command: 'effort', args: level }))
  if (ran === undefined) {
    $.ui.toast('Flightdeck: type /effort to change the effort level')

    return
  }
  await forgetRequestEffort($)
  await changeControls($, old => ({ ...old, effort: level }))
}

function reason(deny: string | undefined): string {
  return deny === undefined ? '' : `: ${deny}`
}

/** Scrolls the chat to a response: the first of its rows the chat can show. */
export async function jump($: Engine, anchors: readonly string[]): Promise<void> {
  let why = 'nothing to scroll to'
  for (const requestId of anchors) {
    const moved = await attempt(() =>
      $.ui.scroll({ to: { requestId }, block: 'start' }),
    )
    if (moved !== undefined && moved.deny === undefined) {
      return
    }
    why = moved?.deny ?? why
  }
  $.ui.toast(`Flightdeck: could not jump (${why})`)
}

type Repo = { root: string; name: string }

// Directory -> its repository, or null for none. Rebuilt after a reload.
const repos = new Map<string, Repo | null>()

/** The git repository a file lies in, found by walking up to a `.git`. */
export async function repoOf($: Engine, file: string): Promise<Repo | null> {
  const walked: string[] = []
  let found: Repo | null = null
  let dir = dirname(normalize(file))
  for (let depth = 0; depth < 24 && dir !== '' && dir !== '/'; depth += 1) {
    const known = repos.get(dir)
    if (known !== undefined) {
      found = known
      break
    }
    walked.push(dir)
    const here = dir
    if ((await attempt(() => $.fs.exists(`${here}/.git`))) === true) {
      found = { root: dir, name: basename(dir) }
      break
    }
    dir = dirname(dir)
  }
  for (const each of walked) {
    repos.set(each, found)
  }

  return found
}

/** A file as the chat and panel name it: its repository and its path there. */
export async function locate(
  $: Engine,
  file: string,
): Promise<{ repo: string; path: string }> {
  const path = normalize(file)
  const repo = await repoOf($, path)
  if (repo !== null) {
    return { repo: repo.name, path: relative(path, repo.root) }
  }
  const root = normalize((await attempt(() => $.session.root())) ?? '')
  if (root !== '' && path.startsWith(root + '/')) {
    return { repo: basename(root), path: relative(path, root) }
  }

  return { repo: basename(dirname(path)) || 'files', path: basename(path) }
}

/** The session repository's working tree at one moment. */
export function parseNameStatus(
  out: string,
): Map<string, { kind: ChangeKind; from?: string }> {
  const kinds = new Map<string, { kind: ChangeKind; from?: string }>()
  const parts = out.split('\0')
  for (let at = 0; at < parts.length; ) {
    const status = parts[at] ?? ''
    if (status === '') {
      at += 1
      continue
    }
    const letter = status[0]
    if (letter === 'R' || letter === 'C') {
      const from = parts[at + 1] ?? ''
      const to = parts[at + 2] ?? ''
      if (to !== '') {
        kinds.set(to, letter === 'R' ? { kind: 'renamed', from } : { kind: 'added' })
      }
      at += 3
      continue
    }
    const path = parts[at + 1] ?? ''
    if (path !== '') {
      kinds.set(path, {
        kind: letter === 'A' ? 'added' : letter === 'D' ? 'deleted' : 'modified',
      })
    }
    at += 2
  }

  return kinds
}

/** Reads `git diff --numstat -z -M`: lines added and removed per path. */
export function parseNumstat(out: string): Map<string, { added: number; removed: number }> {
  const counts = new Map<string, { added: number; removed: number }>()
  const parts = out.split('\0')
  for (let at = 0; at < parts.length; ) {
    const head = parts[at] ?? ''
    if (head === '') {
      at += 1
      continue
    }
    const [added, removed, path] = head.split('\t')
    const lines = { added: Number(added) || 0, removed: Number(removed) || 0 }
    if (path === '') {
      // A rename: the old path and the new one follow.
      const to = parts[at + 2] ?? ''
      if (to !== '') {
        counts.set(to, lines)
      }
      at += 3
      continue
    }
    if (path !== undefined) {
      counts.set(path, lines)
    }
    at += 1
  }

  return counts
}

/**
 * The session repository's whole working tree at one moment, as a git tree:
 * tracked and untracked files alike, ignored ones left out. Written with an
 * index of the mod's own, so the person's staging area is never touched.
 */
export type Snapshot = { root: string; name: string; tree: string }

const GIT = { timeoutMs: 4000 }
const GIT_SLOW = { timeoutMs: 20000 }

/** The index file the mod snapshots with, inside the repository's git dir. */
async function indexFile($: Engine, root: string): Promise<string | null> {
  const ran = await attempt(() =>
    $.process.run(['git', '-C', root, 'rev-parse', '--git-path', 'flightdeck.index'], GIT),
  )
  const path = ran?.exitCode === 0 ? ran.stdout.trim() : ''
  if (path === '') {
    return null
  }

  return path.startsWith('/') ? path : `${root}/${path}`
}

/**
 * Snapshots the working tree: `git add -A` into the mod's own index, then
 * `git write-tree`. The index is kept between turns, so only files that
 * changed are hashed again. Null outside a repository or if git fails.
 */
export async function snapshot($: Engine): Promise<Snapshot | null> {
  const repo = await attempt(() => $.session.repo())
  if (repo === undefined || repo === null) {
    return null
  }
  const root = normalize(repo.root)
  const index = await indexFile($, root)
  if (index === null) {
    return null
  }
  const env = { GIT_INDEX_FILE: index }
  const added = await attempt(() =>
    $.process.run(['git', '-C', root, 'add', '-A', '--', '.'], { ...GIT_SLOW, env }),
  )
  if (added === undefined || added.exitCode !== 0) {
    return null
  }
  const written = await attempt(() =>
    $.process.run(['git', '-C', root, 'write-tree'], { ...GIT, env }),
  )
  const tree = written?.exitCode === 0 ? written.stdout.trim() : ''

  return tree === '' ? null : { root, name: basename(root), tree }
}

/**
 * Every file that changed between two snapshots, however it was changed:
 * added, modified, renamed or deleted, with exact line counts.
 */
export async function changedBetween(
  $: Engine,
  before: Snapshot,
  after: Snapshot,
): Promise<FileChange[]> {
  if (before.tree === after.tree || before.root !== after.root) {
    return []
  }
  const range = [before.tree, after.tree]
  const [status, numstat] = await Promise.all([
    attempt(() =>
      $.process.run(
        ['git', '-C', after.root, 'diff-tree', '-r', '-z', '-M', '--name-status', ...range],
        GIT,
      ),
    ),
    attempt(() =>
      $.process.run(
        ['git', '-C', after.root, 'diff-tree', '-r', '-z', '-M', '--numstat', ...range],
        GIT,
      ),
    ),
  ])
  const kinds = parseNameStatus(status?.exitCode === 0 ? status.stdout : '')
  const counts = parseNumstat(numstat?.exitCode === 0 ? numstat.stdout : '')

  return [...kinds.entries()].slice(0, 200).map(([path, how]) => ({
    repo: after.name,
    path,
    ...(counts.get(path) ?? { added: 0, removed: 0 }),
    kind: how.kind,
    ...(how.from === undefined ? {} : { from: how.from }),
  }))
}

/** One file's diff between two snapshots: exactly what the response did. */
export async function gitDiff(
  $: Engine,
  before: Snapshot,
  after: Snapshot,
  change: FileChange,
): Promise<DiffFile | null> {
  const paths = change.from === undefined ? [change.path] : [change.from, change.path]
  const ran = await attempt(() =>
    $.process.run(
      ['git', '-C', after.root, 'diff', '-M', '-U3', before.tree, after.tree, '--', ...paths],
      GIT,
    ),
  )
  if (ran === undefined || ran.exitCode !== 0 || ran.stdout.length > 400_000) {
    return null
  }
  const capped = capHunks(hunksOfUnified(ran.stdout))

  return {
    repo: change.repo,
    path: change.path,
    kind: change.kind,
    ...(change.from === undefined ? {} : { from: change.from }),
    hunks: capped.hunks,
    isCut: capped.isCut,
    isSinceCommit: false,
  }
}

/**
 * Opens the diff viewer for one response in the band above the prompt: a
 * box of its own, scrolled by the wheel, so the chat never moves under it.
 */
export async function openViewer($: Engine, turn: string): Promise<void> {
  await changeDiffView($, () => ({ turn, file: 0, top: 0 }))
  if (band.isCollapsed) {
    $.ui.toast('Flightdeck: the band above the prompt is folded; ctrl+x ctrl+a shows the diff')
  }
}
