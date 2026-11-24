// The diff viewer: a box in the band above the prompt that shows one
// response's file changes side by side, before on the left and after on the
// right. One file at a time, picked from the tabs at the top.
//
// The band only hears the wheel while its tree is taller than it, so the
// tree is the box (exactly the band's window) and two blank rows under it.
// The mod takes the band's scroll events (wheel, arrows, page keys), keeps
// the band's window at the top, and moves only the code rows inside the box,
// under a header that stays put.

import type { EngineInterface, RenderInput, UiScrollInput } from 'claude-code'

import type { DiffFile } from '../types'
import { plain, sideBySide } from './diff'
import type { Side, SideRow } from './diff'
import { KIND_MARK, basename, clip } from './lib'
import { changeDiffView, readDiffView, readTurnDiffs, readTurns } from './state'

/** Rows the box spends on itself: border 2, title, tabs, rule, file, columns, footer. */
const CHROME = 8
/** The fewest code rows drawn, however short the band. */
const MIN_BODY = 3
/** Blank rows under the box, so the band scrolls and hears the wheel. */
const OVERHANG = 2
/** Code rows one wheel tick moves. */
const TICK = 3

/** The band as last drawn: whether it is folded, and its code rows. */
export const band = {
  isCollapsed: false,
  body: MIN_BODY,
  total: 0,
}

/**
 * The band's scroll while the viewer is open: moves the code rows by the
 * person's wheel or keys and leaves the band itself where it is.
 */
export async function scrollViewer(
  $: EngineInterface,
  e: UiScrollInput,
): Promise<boolean> {
  const look = await readDiffView($)
  if (look.turn === null || e.component !== 'AbovePrompt') {
    return false
  }
  await changeDiffView($, old => ({
    ...old,
    top: movedTop(
      old.top,
      e.origin.kind === 'person' && Math.abs(e.by) <= 2 ? e.by * TICK : e.by,
      band.total,
      band.body,
    ),
  }))

  return true
}

/** The first code row after a move of `by`, kept between the first and last page. */
export function movedTop(top: number, by: number, total: number, body: number): number {
  const last = Math.max(0, total - body)
  const step = Number.isFinite(by) ? Math.trunc(by) : 0

  return Math.min(last, Math.max(0, top + step))
}

/** The tabs that fit one row, keeping the picked one in view. */
function tabWindow(
  labels: readonly string[],
  at: number,
  width: number,
): { from: number; to: number } {
  const cost = (index: number) => (labels[index] ?? '').length + 4
  let from = at
  let to = at + 1
  let used = cost(at)
  // Room for the "‹ n" and "n ›" marks either side.
  const room = Math.max(10, width - 8)
  for (;;) {
    const grew = used
    if (to < labels.length && used + cost(to) <= room) {
      used += cost(to)
      to += 1
    }
    if (from > 0 && used + cost(from - 1) <= room) {
      from -= 1
      used += cost(from)
    }
    if (used === grew) {
      return { from, to }
    }
  }
}

export async function drawViewer($: EngineInterface, e: RenderInput<'AbovePrompt'>) {
  band.isCollapsed = e.props.isCollapsed
  // Closed, the band reads nothing else, so no other write redraws it.
  const look = await readDiffView($)
  if (look.turn === null) {
    return null
  }
  const [files, list] = await Promise.all([readTurnDiffs($, look.turn), readTurns($)])

  const { Box, Text, Button } = $.ui.resolve(e)
  const turn = list.find(one => one.id === look.turn)
  const at = Math.min(Math.max(0, look.file), Math.max(0, files.length - 1))
  const file: DiffFile | undefined = files[at]
  const columns = e.props.bodyColumns
  const height = Math.max(CHROME + MIN_BODY, e.props.scroll.bodyRows)
  const body = height - CHROME
  band.body = body

  const close = () =>
    changeDiffView($, () => ({ turn: null, file: 0, top: 0 }))
  const pick = (index: number) => () =>
    changeDiffView($, old => ({ ...old, file: index, top: 0 }))

  const header = (
    <Box justifyContent="space-between">
      <Text color="claude" bold wrap="truncate-end">
        Changes · {clip(turn?.title ?? 'response', Math.max(10, columns - 44))}
      </Text>
      <Box columnGap={2}>
        {columns >= 60 && <Text dimColor>wheel or ↑↓ scrolls</Text>}
        <Button key="diff-close" plain onPress={close}>
          <Text dimColor>✕ Close</Text>
        </Button>
      </Box>
    </Box>
  )

  if (file === undefined) {
    band.total = 0

    return (
      <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} height={height}>
        {header}
        <Text dimColor>No diff was recorded for this response.</Text>
      </Box>
    )
  }

  const labels = files.map(one => clip(basename(one.path), 28))
  const shownTabs = tabWindow(labels, at, columns)
  const tabs = (
    <Box columnGap={2}>
      {shownTabs.from > 0 && <Text dimColor>‹ {shownTabs.from}</Text>}
      {files.slice(shownTabs.from, shownTabs.to).map((one, offset) => {
        const index = shownTabs.from + offset
        const mark = KIND_MARK[one.kind]
        const label = labels[index] ?? ''

        return (
          <Button key={`diff-f${index}`} plain onPress={pick(index)}>
            {index === at ? (
              <Text inverse bold>
                {' '}
                {mark.letter} {label}{' '}
              </Text>
            ) : (
              <Text>
                <Text color={mark.color} bold>
                  {mark.letter}
                </Text>{' '}
                {label}
              </Text>
            )}
          </Button>
        )
      })}
      {shownTabs.to < files.length && <Text dimColor>{files.length - shownTabs.to} ›</Text>}
    </Box>
  )

  const rows: SideRow[] = sideBySide(file.hunks)
  band.total = rows.length
  const top = Math.min(Math.max(0, look.top), Math.max(0, rows.length - body))
  const shown = rows.slice(top, top + body)
  const lastNo = rows.reduce(
    (most, row) =>
      row.kind === 'line'
        ? Math.max(most, row.left?.no ?? 0, row.right?.no ?? 0)
        : most,
    0,
  )
  const gutter = Math.max(3, String(lastNo).length)
  const mark = KIND_MARK[file.kind]

  const half = (side: Side | null) => {
    if (side === null) {
      return (
        <Box width="50%">
          <Text dimColor>{' '.repeat(gutter + 1)}</Text>
        </Box>
      )
    }
    const tone =
      side.mark === '-' ? 'diffRemovedDimmed' : side.mark === '+' ? 'diffAddedDimmed' : undefined

    return (
      <Box width="50%">
        <Text dimColor>{String(side.no).padStart(gutter)} </Text>
        <Text
          color={side.mark === '-' ? 'error' : side.mark === '+' ? 'success' : undefined}
          dimColor={side.mark === ' '}
        >
          {side.mark === ' ' ? ' ' : side.mark}
        </Text>
        <Text backgroundColor={tone} wrap="truncate-end">
          {plain(side.text) || ' '}
        </Text>
      </Box>
    )
  }

  const footer =
    rows.length === 0
      ? ''
      : `rows ${top + 1}–${Math.min(rows.length, top + body)} of ${rows.length}` +
        (top > 0 ? ' · ↑ more above' : '') +
        (top + body < rows.length ? ' · ↓ more below' : '') +
        (file.isCut ? ' · long diff: only its first lines were kept' : '')

  const box = (
    <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} height={height}>
      {header}
      {tabs}
      <Text dimColor>{'─'.repeat(Math.max(10, columns - 4))}</Text>
      <Box justifyContent="space-between">
        <Box>
          <Text color={mark.color} bold>
            {mark.letter}{' '}
          </Text>
          <Text color="suggestion">{file.repo}</Text>
          <Text dimColor wrap="truncate-start">
            {' › '}
            {file.kind === 'renamed' && file.from !== undefined
              ? `${file.from} → ${file.path}`
              : file.path}
          </Text>
        </Box>
        <Text dimColor>
          {file.kind}
          {file.isSinceCommit ? ' · since last commit' : ''}
        </Text>
      </Box>
      <Box>
        <Box width="50%">
          <Text dimColor bold>
            {' '.repeat(gutter + 2)}Before
          </Text>
        </Box>
        <Box width="50%">
          <Text dimColor bold>
            {' '.repeat(gutter + 2)}After
          </Text>
        </Box>
      </Box>
      <Box flexDirection="column" height={body} overflow="hidden">
        {rows.length === 0 && (
          <Text dimColor>
            {file.kind === 'deleted'
              ? 'The file was deleted; its old content was not recorded.'
              : 'No line changes to show.'}
          </Text>
        )}
        {shown.map(row =>
          row.kind === 'hunk' ? (
            <Text color="suggestion" dimColor>
              {`@@ line ${row.oldStart} → ${row.newStart}`}
            </Text>
          ) : (
            <Box>
              {half(row.left)}
              {half(row.right)}
            </Box>
          ),
        )}
      </Box>
      <Text dimColor wrap="truncate-end">
        {footer}
      </Text>
    </Box>
  )

  return (
    <Box flexDirection="column">
      {box}
      {Array.from({ length: OVERHANG }, () => (
        <Text> </Text>
      ))}
    </Box>
  )
}
