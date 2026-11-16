// The diff viewer: a row placed in the chat that shows one response's file
// changes side by side, before on the left and after on the right. One file
// at a time, picked from the tabs at the top.

import type { EngineInterface, RenderInput } from 'claude-code'

import type { DiffFile } from '../types'
import { plain, sideBySide } from './diff'
import type { Side } from './diff'
import { KIND_MARK, basename, clip } from './lib'
import { changeDiffView, readDiffs, readDiffView, readTurns } from './state'

/** Rows of one file drawn at once; the rest are a press away. */
const PAGE = 120

export async function drawViewer($: EngineInterface, e: RenderInput<'Placed'>) {
  const [look, diffs, list] = await Promise.all([
    readDiffView($),
    readDiffs($),
    readTurns($),
  ])
  if (look.row !== e.props.id || look.turn === null) {
    return null
  }

  const { Box, Text, Button } = $.ui.resolve(e)
  const files = diffs[look.turn] ?? []
  const turn = list.find(one => one.id === look.turn)
  const at = Math.min(Math.max(0, look.file), Math.max(0, files.length - 1))
  const file: DiffFile | undefined = files[at]
  const columns = e.viewport?.columns ?? 120

  const close = () => changeDiffView($, () => ({ row: null, turn: null, file: 0, page: 0 }))
  const pick = (index: number) => () =>
    changeDiffView($, old => ({ ...old, file: index, page: 0 }))
  const page = (by: number) => () =>
    changeDiffView($, old => ({ ...old, page: Math.max(0, old.page + by) }))

  const header = (
    <Box justifyContent="space-between">
      <Text color="claude" bold>
        Changes · {clip(turn?.title ?? 'response', Math.max(10, columns - 40))}
      </Text>
      <Button key="diff-close" plain onPress={close}>
        <Text dimColor>✕ Close</Text>
      </Button>
    </Box>
  )

  if (file === undefined) {
    return (
      <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
        {header}
        <Text dimColor>No diff was recorded for this response.</Text>
      </Box>
    )
  }

  const tabs = (
    <Box flexWrap="wrap" columnGap={2}>
      {files.map((one, index) => {
        const mark = KIND_MARK[one.kind]
        const label = clip(basename(one.path), 28)

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
    </Box>
  )

  const rows = sideBySide(file.hunks)
  const pages = Math.max(1, Math.ceil(rows.length / PAGE))
  const current = Math.min(look.page, pages - 1)
  const shown = rows.slice(current * PAGE, (current + 1) * PAGE)
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

  return (
    <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
      {header}
      {tabs}
      <Text dimColor>{'─'.repeat(Math.max(10, columns - 8))}</Text>
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
      {(pages > 1 || file.isCut) && (
        <Box columnGap={2}>
          {pages > 1 && (
            <Button key="diff-prev" plain onPress={page(-1)}>
              <Text dimColor={current === 0}>‹ Previous</Text>
            </Button>
          )}
          {pages > 1 && (
            <Text dimColor>
              rows {current * PAGE + 1}–{Math.min(rows.length, (current + 1) * PAGE)} of{' '}
              {rows.length}
            </Text>
          )}
          {pages > 1 && (
            <Button key="diff-next" plain onPress={page(1)}>
              <Text dimColor={current >= pages - 1}>Next ›</Text>
            </Button>
          )}
          {file.isCut && <Text dimColor>long diff: only its first lines were kept</Text>}
        </Box>
      )}
    </Box>
  )
}
