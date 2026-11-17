// Flightdeck: a minimal developer HUD for Claude Code.
//
// This module only wires events to the pieces beside it:
//   state.ts   the values the panel and viewer draw from
//   engine.ts  every call that asks the engine for something
//   panel.tsx  the Flightdeck panel
//   viewer.tsx the side-by-side diff viewer, in the band above the prompt
//   rows.tsx   the compact rows edits and shell commands draw in the chat
//   diff.ts    diffs: reading hunks and laying them out side by side
//   lib.ts     pure helpers
//
// Every hook here observes: it returns what `next(e)` returns, and a failure
// of its own bookkeeping never reaches the tool call or the turn it watched.

import type { Register } from 'claude-code'

import type { DiffFile, FileChange, Turn } from '../types'
import { addDiff, capHunks, hunksOfNewFile, hunksOfPatch } from './diff'
import type { Snapshot } from './engine'
import {
  changedBetween,
  describeControls,
  forgetRequestEffort,
  sawRequestEffort,
  gitDiff,
  loadAvailable,
  loadControls,
  loadBreakdown,
  loadMeter,
  locate,
  snapshot,
} from './engine'
import { EDIT_TOOLS, addTokens, classify, estimateTokens, firstSentence, firstWords, readEdit, tally } from './lib'
import type { Mark } from './lib'
import { drawPanel } from './panel'
import { drawViewer, scrollViewer } from './viewer'
import { drawEditRow, drawScriptRow, isScript, shellChanges, withoutShellDiff } from './rows'
import {
  PANE,
  changeControls,
  changeDiffs,
  changeExtensions,
  changeMeter,
  changeTotals,
  changeTurns,
} from './state'

const TITLE = 'Flightdeck'
const KEPT_TURNS = 50

const KEPT_DIFFS = 20

/** Adds a response's diffs, keeping the latest responses' only. */
async function keepDiff(
  $: Parameters<typeof changeDiffs>[0],
  turnId: string,
  files: readonly DiffFile[],
) {
  if (files.length === 0) {
    return
  }
  await changeDiffs($, old => {
    const next = { ...old, [turnId]: files.reduce(addDiff, old[turnId] ?? []) }
    const ids = Object.keys(next)

    return ids.length <= KEPT_DIFFS
      ? next
      : Object.fromEntries(ids.slice(-KEPT_DIFFS).map(id => [id, next[id] ?? []]))
  })
}

let seenEffort: string | null = null

// The skill whose instructions are still to arrive: they come as rows of
// their own beside the Skill call's result. Cleared by the next tool call
// and by each new turn, so later rows are never put down to it.
let skillMarks: readonly Mark[] | null = null

/** Shows a level a request or hook event reported, once per change. */
function saw($: Parameters<typeof changeControls>[0], level: unknown): void {
  if (typeof level !== 'string' || level === seenEffort) {
    return
  }
  seenEffort = level
  void sawRequestEffort($, level).catch(() => {})
  void changeControls($, old => ({ ...old, effort: level })).catch(() => {})
}

export const register: Register = (on, options) => {
  const isCompact = options.compactEdits !== false
  const isOpenOnStart = options.openOnStart !== false

  // The main loop's turn in progress, its prompt, and its first reply row.
  let live: {
    id: string
    anchor: string | null
    before: Promise<Snapshot | null>
  } | null = null

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'flightdeck',
      description: 'Show or hide the Flightdeck panel',
      argumentHint: '[debug]',
    })
    if (e.isInteractive && isOpenOnStart) {
      void $.ui.open({
        id: PANE,
        title: TITLE,
        columns: 46,
        backgroundColor: 'transparent',
      }).catch(() => {})
    }
    void Promise.all([
      loadMeter($),
      loadControls($),
      loadAvailable($),
      loadBreakdown($),
    ]).catch(
      () => {},
    )

    return next(e)
  })

  on('command.run', { command: 'flightdeck' }, async ($, e) => {
    if (e.args.trim() === 'debug') {
      return { text: await describeControls($) }
    }
    const isUp = (await $.ui.panes()).some(pane => pane.id === PANE)
    if (isUp) {
      await $.ui.close({ id: PANE })

      return { text: 'Flightdeck panel closed.' }
    }
    const opened = await $.ui.open({
        id: PANE,
        title: TITLE,
        columns: 46,
        backgroundColor: 'transparent',
      })

    return {
      text: opened.isPlaced
        ? 'Flightdeck panel opened.'
        : 'Flightdeck panel will show once there is room for it.',
    }
  })

  // The effort in force: read off each request, and off the engine's own
  // hook events, whichever this build reports it on.
  on('classic.PostToolUse', ($, e, next) => {
    saw($, (e as { effort?: { level?: unknown } }).effort?.level)

    return next(e)
  })
  on('classic.Stop', ($, e, next) => {
    saw($, (e as { effort?: { level?: unknown } }).effort?.level)

    return next(e)
  })
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      saw($, e.effort)
    }

    return yield* next(e)
  })

  // `/effort` and `/model` change what is in force: read it again at once,
  // from the settings they write, not from the last request.
  on('command.run', { command: ['effort', 'model'] }, async ($, e, next) => {
    const ran = await next(e)
    seenEffort = null
    void forgetRequestEffort($)
      .then(() => loadControls($))
      .catch(() => {})

    return ran
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) {
      return next(e)
    }
    skillMarks = null
    try {
      live = {
        id: e.turnId,
        anchor: null,
        // Not awaited: the turn does not wait on git.
        before: snapshot($).catch(() => null),
      }
      const turn: Turn = {
        id: e.turnId,
        title: firstWords(e.text) || 'Response',
        summary: '',
        startedAt: await $.clock.now(),
        tokens: 0,
        isRunning: true,
        anchors: [],
        files: [],
        uses: {},
      }
      await changeTurns($, list =>
        [
          ...list
            .filter(one => one.id !== turn.id)
            .map(one => (one.isRunning ? { ...one, isRunning: false } : one)),
          turn,
        ].slice(-KEPT_TURNS),
      )
      void loadControls($).catch(() => {})
    } catch {
      // The panel misses a turn; the turn itself goes on.
    }

    return next(e)
  })

  // Tokens a skill's instructions bring in beside its call (a call's own
  // result is counted at tool.call).
  on('session.append', async ($, e, next) => {
    const kept = await next(e)
    try {
      // A skill's instructions: the user-side rows that follow its call.
      const marks = skillMarks
      const isBeside =
        e.door === 'tool-message' || e.door === 'attachment' || e.door === 'hook-context'
      if (marks !== null && e.agentId === undefined && isBeside && e.message.role === 'user') {
        const spent = estimateTokens(e.message.content)
        if (spent > 0) {
          await changeExtensions($, old => ({
            ...old,
            tokens: addTokens(old.tokens ?? {}, marks, spent),
          }))
        }
      }
    } catch {
      // The estimate misses this row; the row itself is kept.
    }

    return kept
  })

  // The first row of a reply is where "Jump to response" lands.
  on('session.append', { door: 'response' }, (_, e, next) => {
    if (e.agentId === undefined && live !== null && live.anchor === null) {
      live.anchor = e.uuid
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId === undefined) {
      skillMarks =
        String(e.tool) === 'Skill'
          ? classify('Skill', e).filter(mark => mark.kind !== 'tool')
          : null
    }
    const ran = await next(e)
    try {
      const tool = String(e.tool)
      const marks = classify(tool, e)
      const turnId = live?.id
      const anchor = live?.anchor ?? null
      let change: FileChange | null = null
      let diff: DiffFile | null = null

      if (EDIT_TOOLS.includes(tool) && ran.deny === undefined && !ran.isError) {
        const input = e as { file_path?: unknown; notebook_path?: unknown }
        const file = input.file_path ?? input.notebook_path
        const edit = readEdit(ran.result)
        if (typeof file === 'string' && edit !== null) {
          change = {
            ...(await locate($, file)),
            added: edit.added,
            removed: edit.removed,
            kind: edit.isNew ? 'added' : 'modified',
          }
          const result = (ran.result ?? {}) as { structuredPatch?: unknown; content?: unknown }
          let hunks = hunksOfPatch(result.structuredPatch)
          if (hunks.length === 0 && edit.isNew && typeof result.content === 'string') {
            hunks = hunksOfNewFile(result.content)
          }
          const capped = capHunks(hunks)
          diff = {
            repo: change.repo,
            path: change.path,
            kind: change.kind,
            hunks: capped.hunks,
            isCut: capped.isCut,
            isSinceCommit: false,
          }
        }
      }

      if (turnId !== undefined) {
        await changeTurns($, list =>
          list.map(one => {
            if (one.id !== turnId) {
              return one
            }
            const anchors = new Set(one.anchors)
            if (anchor !== null) {
              anchors.add(anchor)
            }
            if (e.agentId === undefined && anchors.size < 2) {
              anchors.add(e.tool_use_id)
            }

            return {
              ...one,
              anchors: [...anchors],
              files: change === null ? one.files : [...one.files, change],
              uses: tally(one.uses, marks),
            }
          }),
        )
      }
      if (turnId !== undefined && diff !== null) {
        await keepDiff($, turnId, [diff])
      }
      if (marks.some(mark => mark.kind !== 'tool')) {
        // What the call brought in: its result as the model reads it, and
        // any context the engine attached after it.
        const spent =
          ran.deny === undefined
            ? estimateTokens(ran.text ?? ran.result) + estimateTokens(ran.context ?? [])
            : 0
        await changeExtensions($, old => ({
          ...old,
          used: tally(old.used, marks, mark => mark.kind !== 'tool'),
          tokens: addTokens(old.tokens ?? {}, marks, spent),
        }))
      }
    } catch {
      // Counting failed; the call's own result stands.
    }

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    try {
      const usage = e.usage
      if (usage !== undefined) {
        await changeTotals($, old => ({
          input:
            old.input + usage.input_tokens + usage.cache_creation_input_tokens,
          output: old.output + usage.output_tokens,
          cacheRead: old.cacheRead + usage.cache_read_input_tokens,
        }))
      }
      if (e.agentId === undefined) {
        const spent =
          usage === undefined
            ? 0
            : usage.input_tokens +
              usage.cache_creation_input_tokens +
              usage.output_tokens
        const anchor = live?.id === e.turnId ? live.anchor : null
        const before = live?.id === e.turnId ? live.before : null
        let done: Turn | undefined
        await changeTurns($, list =>
          list.map(one => {
            if (one.id !== e.turnId) {
              return one
            }
            const anchors =
              anchor === null || one.anchors.includes(anchor)
                ? one.anchors
                : [anchor, ...one.anchors]
            done = {
              ...one,
              anchors,
              tokens: spent,
              isRunning: false,
              title: firstWords(e.answer) || one.title,
              summary: firstSentence(e.answer),
            }

            return done
          }),
        )
        if (live?.id === e.turnId) {
          live = null
        }
        // Local estimate: keeps the open component list current for free.
        void loadBreakdown($).catch(() => {})
        if (done !== undefined) {
          const turn: Turn = done
          // After the turn, off its path: files changed by shell commands.
          void (async () => {
            let files = turn.files
            const was = before === null ? null : await before
            const now = was === null ? null : await snapshot($)
            if (was !== null && now !== null) {
              const known = new Set(files.map(file => `${file.repo}/${file.path}`))
              const extra = (await changedBetween($, was, now)).filter(
                file => !known.has(`${file.repo}/${file.path}`),
              )
              if (extra.length > 0) {
                files = [...files, ...extra]
                await changeTurns($, list =>
                  list.map(one => (one.id === turn.id ? { ...one, files } : one)),
                )
                const read = await Promise.all(
                  extra.slice(0, 20).map(file => gitDiff($, was, now, file)),
                )
                await keepDiff(
                  $,
                  turn.id,
                  read.filter((one): one is DiffFile => one !== null),
                )
              }
            }
          })().catch(() => {})
        }
      }
    } catch {
      // The history misses this turn's figures; the turn's end stands.
    }

    return next(e)
  })

  // The engine raises this when the context fill or a limit window moves.
  on('session.measure', async ($, e, next) => {
    try {
      await changeMeter($, old => ({
        ...old,
        tokens: e.context.tokens ?? null,
        window: e.context.window,
        percent: e.context.percent ?? null,
        limits: e.rateLimits.map(limit => ({ ...limit })),
      }))
    } catch {
      // Keep the last reading.
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) =>
    drawPanel($, e),
  )

  // While the viewer is open the band does not scroll: its code rows do.
  on('ui.scroll', async ($, e, next) => {
    try {
      if (await scrollViewer($, e)) {
        return {}
      }
    } catch {
      // The band scrolls as it would.
    }

    return next(e)
  })

  // The diff viewer, in the band above the prompt: its own scrolling box.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    return (await drawViewer($, e)) ?? next(e)
  })

  // Edits, and shell scripts that carry code: one compact row in place of
  // the diff or the script. ctrl+o still shows it all.
  on('ui.render', { component: 'ToolUse' }, ($, e, next) => {
    if (!isCompact || e.props.isExpanded === true) {
      return next(e)
    }
    if (EDIT_TOOLS.includes(e.props.tool)) {
      return drawEditRow($, e)
    }
    if (
      String(e.props.tool) === 'Bash' &&
      (isScript(e.props.input) || shellChanges(e.props.output) !== null)
    ) {
      return drawScriptRow($, e)
    }

    return next(e)
  })

  on('ui.render', { component: 'ToolResult' }, ($, e, next) => {
    if (!isCompact || e.props.isExpanded === true || e.props.isErrored) {
      return next(e)
    }
    // A shell command's output stays; the file diff under it goes, as the
    // command's row already lists each file with its line counts.
    if (e.props.tool === 'Bash') {
      return shellChanges(e.props.output) === null
        ? next(e)
        : next({ ...e, props: { ...e.props, output: withoutShellDiff(e.props.output) } })
    }
    if (!EDIT_TOOLS.includes(e.props.tool)) {
      return next(e)
    }
    const { Box } = $.ui.resolve(e)

    return <Box />
  })
}
