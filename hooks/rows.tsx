// The compact row an edit draws in the chat, in place of its diff: what is
// being done, then the repository, the file and the lines changed.

import type { EngineInterface, RenderInput } from 'claude-code'

import { locate } from './engine'
import { basename, countPatch, normalize, readEdit } from './lib'

function pathOf(input: unknown): string {
  const record = (input ?? {}) as { file_path?: unknown; notebook_path?: unknown }
  const path = record.file_path ?? record.notebook_path

  return typeof path === 'string' ? normalize(path) : ''
}

/** A shell command long enough to be code: a heredoc, or many lines. */
export function isScript(input: unknown): boolean {
  const command = (input as { command?: unknown } | null)?.command
  if (typeof command !== 'string') {
    return false
  }

  return /<<-?\s*['"]?\w+/.test(command) || command.split('\n').length > 6
}

/** One file a shell command changed, as Claude Code recorded it. */
export type ShellChange = {
  path: string
  added: number
  removed: number
  isNew: boolean
  isGone: boolean
}

/** The files a shell command changed (its `bashEditDiff`), with line counts. */
export function shellChanges(output: unknown): { files: ShellChange[]; more: number } | null {
  const diff = (output as { bashEditDiff?: unknown } | null)?.bashEditDiff as
    | {
        files?: { filePath?: unknown; hunks?: { lines?: unknown }[]; created?: true; deleted?: true }[]
        moreFiles?: unknown
      }
    | undefined
  if (diff === undefined || !Array.isArray(diff.files) || diff.files.length === 0) {
    return null
  }
  const files = diff.files.map(file => {
    const { added, removed } = countPatch(
      (file.hunks ?? []).map(hunk => ({
        lines: Array.isArray(hunk.lines)
          ? hunk.lines.filter((line): line is string => typeof line === 'string')
          : [],
      })),
    )

    return {
      path: typeof file.filePath === 'string' ? normalize(file.filePath) : '',
      added,
      removed,
      isNew: file.created === true,
      isGone: file.deleted === true,
    }
  })

  return { files, more: typeof diff.moreFiles === 'number' ? diff.moreFiles : 0 }
}

/** A shell result without the file diff Claude Code would draw under it. */
export function withoutShellDiff(output: unknown): unknown {
  if (output === null || typeof output !== 'object' || !('bashEditDiff' in output)) {
    return output
  }
  const { bashEditDiff: _dropped, ...rest } = output as Record<string, unknown>

  return rest
}

/** Files listed under a shell row before the rest are counted. */
const SHOWN_FILES = 5

/**
 * The compact row a shell command draws when it carries code or changes
 * files: what it does, in its own words, then each file it changed with the
 * lines added and removed. ctrl+o still shows the script and the diff.
 */
export async function drawScriptRow($: EngineInterface, e: RenderInput<'ToolUse'>) {
  const { Box, Text } = $.ui.resolve(e)
  const { input, output, isRunning, isErrored, isInterrupted } = e.props
  const record = (input ?? {}) as { command?: unknown; description?: unknown }
  const command = typeof record.command === 'string' ? record.command : ''
  const said = typeof record.description === 'string' ? record.description.trim() : ''
  const firstLine = command.split('\n')[0] ?? ''
  const title = said || (isScript(input) ? 'Ran a script' : firstLine)
  const dot = isErrored || isInterrupted ? 'error' : isRunning ? 'claude' : 'success'
  const changes = isRunning ? null : shellChanges(output)
  const files = changes?.files ?? []
  const where = await Promise.all(files.slice(0, SHOWN_FILES).map(file => locate($, file.path)))
  const hidden = files.length - where.length + (changes?.more ?? 0)

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={dot}>{isRunning ? '◐ ' : '● '}</Text>
        <Text wrap="truncate-end">{title}</Text>
        {isInterrupted && <Text dimColor> · interrupted</Text>}
        {isErrored && <Text color="error"> · failed</Text>}
      </Box>
      {files.length === 0 && (
        <Text dimColor>{isRunning ? '  ⎿ running…' : '  ⎿ no files changed'}</Text>
      )}
      {where.map((place, index) => {
        const file = files[index]

        return file === undefined ? null : (
          <Box columnGap={2}>
            <Box>
              <Text dimColor>{'  ⎿ '}</Text>
              <Text color="suggestion">{place.repo}</Text>
              <Text dimColor wrap="truncate-start">
                {' › '}
                {place.path}
              </Text>
            </Box>
            <Box>
              {file.isGone ? (
                <Text color="error">deleted</Text>
              ) : (
                <Box>
                  <Text color="success">+{file.added}</Text>
                  {file.isNew ? (
                    <Text dimColor> new</Text>
                  ) : (
                    <Text color="error"> −{file.removed}</Text>
                  )}
                </Box>
              )}
            </Box>
          </Box>
        )
      })}
      {hidden > 0 && (
        <Text dimColor>
          {'    '}and {hidden} more file{hidden === 1 ? '' : 's'}
        </Text>
      )}
    </Box>
  )
}

export async function drawEditRow(
  $: EngineInterface,
  e: RenderInput<'ToolUse'>,
) {
  const { Box, Text } = $.ui.resolve(e)
  const { tool, input, output, isRunning, isErrored, isInterrupted } = e.props
  const file = pathOf(input)
  const where = await locate($, file)
  const edit = isRunning || isErrored ? null : readEdit(output)
  const isNew = edit?.isNew === true

  const verb = isRunning
    ? tool === 'Write'
      ? 'Writing'
      : 'Updating'
    : isNew
      ? 'Create'
      : 'Update'
  const dot = isErrored || isInterrupted ? 'error' : isRunning ? 'claude' : 'success'

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={dot}>{isRunning ? '◐ ' : '● '}</Text>
        <Text>
          {verb} {basename(file) || 'file'}
        </Text>
      </Box>
      <Box columnGap={2}>
        <Box>
          <Text dimColor>{'  ⎿ '}</Text>
          <Text color="suggestion">{where.repo}</Text>
          <Text dimColor wrap="truncate-start">
            {' › '}
            {where.path}
          </Text>
        </Box>
        {isInterrupted ? (
          <Text dimColor>interrupted</Text>
        ) : isErrored ? (
          <Text color="error">failed</Text>
        ) : edit === null ? (
          <Text dimColor>{isRunning ? 'editing…' : ''}</Text>
        ) : (
          <Box>
            <Text color="success">+{edit.added}</Text>
            {!isNew && <Text color="error"> −{edit.removed}</Text>}
            {isNew && <Text dimColor> new</Text>}
          </Box>
        )}
      </Box>
    </Box>
  )
}
