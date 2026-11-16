// The compact row an edit draws in the chat, in place of its diff: what is
// being done, then the repository, the file and the lines changed.

import type { EngineInterface, RenderInput } from 'claude-code'

import { locate } from './engine'
import { basename, normalize, readEdit } from './lib'

function pathOf(input: unknown): string {
  const record = (input ?? {}) as { file_path?: unknown; notebook_path?: unknown }
  const path = record.file_path ?? record.notebook_path

  return typeof path === 'string' ? normalize(path) : ''
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
      <Box justifyContent="space-between" columnGap={2}>
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
