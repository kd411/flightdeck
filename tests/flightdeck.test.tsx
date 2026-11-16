import { expect, mock, test } from 'claude-code/testing'

import {
  bar,
  byRepo,
  classify,
  fmtTokens,
  firstSentence,
  readEdit,
  span,
  kindCounts,
  mergeFiles,
} from '../hooks/lib'
import { parseNameStatus, parseNumstat } from '../hooks/engine'
import { addDiff, hunksOfNewFile, hunksOfUnified, sideBySide } from '../hooks/diff'

const PANE = {
  plugin: 'flightdeck',
  component: 'Pane',
  requestId: 'flightdeck',
  props: {
    title: 'Control panel',
    isFocused: false,
    bodyColumns: 44,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const EDIT_RESULT = {
  filePath: '/work/api-server/src/auth/session.ts',
  structuredPatch: [{ lines: [' keep', '-old', '+new', '+more'] }],
}

test('helpers format, count and classify', () => {
  expect(fmtTokens(950)).toBe('950')
  expect(fmtTokens(18234)).toBe('18.2k')
  expect(fmtTokens(205000)).toBe('205k')
  expect(fmtTokens(1200000)).toBe('1.2M')
  expect(bar(10, 0.38)).toEqual(['━━━━', '━━━━━━'])
  expect(span(130 * 60_000)).toBe('2h 10m')
  expect(readEdit(EDIT_RESULT)).toEqual({ added: 2, removed: 1, isNew: false })
  expect(classify('mcp__claude_ai_Gmail__create_draft', null)).toEqual([
    { kind: 'connector', name: 'Gmail' },
  ])
  expect(classify('mcp__plugin_atlassian_atlassian__search', null)).toEqual([
    { kind: 'plugin', name: 'atlassian' },
  ])
  expect(classify('mcp__github__get_issue', null)).toEqual([
    { kind: 'mcp', name: 'github' },
  ])
  expect(classify('Skill', { skill: 'docs:write' })).toEqual([
    { kind: 'skill', name: 'docs:write' },
    { kind: 'plugin', name: 'docs' },
  ])
  expect(firstSentence('Added rotation. Then ran the tests.')).toBe('Added rotation.')
  expect(
    byRepo([
      { repo: 'a', path: 'x.ts', added: 2, removed: 1, kind: 'modified' },
      { repo: 'a', path: 'x.ts', added: 1, removed: 0, kind: 'modified' },
      { repo: 'b', path: 'y.ts', added: 5, removed: 0, kind: 'added' },
    ]),
  ).toEqual([
    { repo: 'a', files: 1, added: 3, removed: 1 },
    { repo: 'b', files: 1, added: 5, removed: 0 },
  ])
})

test('the panel lists a response with its tokens and files', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'flightdeck' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: EDIT_RESULT }))
  on('fs.exists', (_, e) => ({ value: e.path === '/work/api-server/.git' }))


  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'rotate the refresh tokens', turnId: 't1' })
  await $.tool.call({
    tool: 'Edit',
    file_path: '/work/api-server/src/auth/session.ts',
    old_string: 'old',
    new_string: 'new',
  })
  await $.turn.complete({
    turnId: 't1',
    answer: 'Rotation is in place. '.repeat(12),
    durationMs: 1000,
    isAborted: false,
    reason: 'answer',
    usage: {
      model: 'm',
      input_tokens: 1200,
      output_tokens: 300,
      cache_read_input_tokens: 9000,
      cache_creation_input_tokens: 500,
    },
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect(await ui.find({ type: 'Text', text: /CHAT HISTORY/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Rotation is in/ })).toBeDefined()
    expect(await ui.find({ key: 'j-t1' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 file/ })).toBeDefined()

    await ui.press({ key: 't-t1' })
    expect(await ui.find({ type: 'Text', text: /api-server/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 modified/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Rotation is in place\.$/ })).toBeDefined()
    expect(await ui.find({ key: 'j-t1' })).toBeDefined()
    await ui.press({ key: 't-t1' })
    await ui.unmount()
  }
})

test('a narrow, inline pane draws a glance', async $ => {
  const ui = await $.ui.mount({
    ...PANE,
    surface: 'terminal',
    props: { ...PANE.props, bodyColumns: 30, placement: 'inline' },
  })

  expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /EXTENSIONS/ })).toBeUndefined()
  await ui.unmount()
})

test('an edit draws one compact row, and ctrl+o the full one', async ($, on) => {
  on('fs.exists', (_, e) => ({ value: e.path === '/work/api-server/.git' }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine row</Text>
  })
  const row = {
    plugin: 'flightdeck',
    component: 'ToolUse',
    requestId: 'tu1',
    surface: 'terminal',
    props: {
      tool_use_id: 'tu1',
      tool: 'Edit',
      input: { file_path: '/work/api-server/src/auth/session.ts' },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
      output: EDIT_RESULT,
    },
  } as const

  const compact = await $.ui.mount(row)
  expect(await compact.find({ type: 'Text', text: /Update session\.ts/ })).toBeDefined()
  expect(await compact.find({ type: 'Text', text: /api-server/ })).toBeDefined()
  expect(await compact.find({ type: 'Text', text: /\+2/ })).toBeDefined()
  await compact.unmount()

  const full = await $.ui.mount({ ...row, props: { ...row.props, isExpanded: true } })
  expect(await full.find({ type: 'Text', text: /engine row/ })).toBeDefined()
  await full.unmount()
})

test('file changes keep how each file changed', () => {
  const status = parseNameStatus(
    ['M', 'a.ts', 'A', 'b.ts', 'D', 'c.ts', 'R087', 'old.ts', 'new.ts', ''].join('\0'),
  )
  expect(status.get('a.ts')).toEqual({ kind: 'modified' })
  expect(status.get('b.ts')).toEqual({ kind: 'added' })
  expect(status.get('c.ts')).toEqual({ kind: 'deleted' })
  expect(status.get('new.ts')).toEqual({ kind: 'renamed', from: 'old.ts' })

  const counts = parseNumstat(['3\t1\ta.ts', '0\t9\tc.ts', '2\t2\t', 'old.ts', 'new.ts', ''].join('\0'))
  expect(counts.get('a.ts')).toEqual({ added: 3, removed: 1 })
  expect(counts.get('new.ts')).toEqual({ added: 2, removed: 2 })

  const merged = mergeFiles([
    { repo: 'r', path: 'x.ts', added: 10, removed: 0, kind: 'added' },
    { repo: 'r', path: 'x.ts', added: 2, removed: 1, kind: 'modified' },
    { repo: 'r', path: 'y.ts', added: 1, removed: 0, kind: 'modified' },
    { repo: 'r', path: 'y.ts', added: 0, removed: 5, kind: 'deleted' },
  ])
  expect(merged).toEqual([
    { repo: 'r', path: 'x.ts', added: 12, removed: 1, kind: 'added' },
    { repo: 'r', path: 'y.ts', added: 1, removed: 5, kind: 'deleted' },
  ])
  expect(kindCounts(merged)).toBe('1 added, 1 deleted')
})

test('diffs are laid out side by side', () => {
  const hunks = hunksOfUnified(
    ['diff --git a/x b/x', '@@ -10,4 +10,4 @@ fn', ' keep', '-old one', '-old two', '+new one', ' tail'].join('\n'),
  )
  expect(hunks).toEqual([
    { oldStart: 10, newStart: 10, lines: [' keep', '-old one', '-old two', '+new one', ' tail'] },
  ])
  expect(sideBySide(hunks)).toEqual([
    { kind: 'hunk', oldStart: 10, newStart: 10 },
    { kind: 'line', left: { no: 10, text: 'keep', mark: ' ' }, right: { no: 10, text: 'keep', mark: ' ' } },
    { kind: 'line', left: { no: 11, text: 'old one', mark: '-' }, right: { no: 11, text: 'new one', mark: '+' } },
    { kind: 'line', left: { no: 12, text: 'old two', mark: '-' }, right: null },
    { kind: 'line', left: { no: 13, text: 'tail', mark: ' ' }, right: { no: 12, text: 'tail', mark: ' ' } },
  ])
  expect(hunksOfNewFile('a\nb\n')).toEqual([{ oldStart: 0, newStart: 1, lines: ['+a', '+b'] }])

  const one = { repo: 'r', path: 'x', kind: 'added' as const, hunks: hunksOfNewFile('a'), isCut: false, isSinceCommit: false }
  const two = { ...one, kind: 'modified' as const, hunks: hunks }
  const merged = addDiff(addDiff([], one), two)
  expect(merged.length).toBe(1)
  expect(merged[0]?.kind).toBe('added')
  expect(merged[0]?.hunks.length).toBe(2)
})

test('the eye opens a side-by-side diff in the chat', async ($, on) => {
  mock.clock(on)
  on('fs.exists', (_, e) => ({ value: e.path === '/work/api-server/.git' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: EDIT_RESULT }))
  const placed: string[] = []
  on('ui.place', (_, e) => {
    placed.push(e.id)

    return { value: { isPlaced: true, requestId: e.id } }
  })
  on('ui.scroll', () => ({}))

  await $.turn.start({ text: 'edit', turnId: 'd1' })
  await $.tool.call({
    tool: 'Edit',
    file_path: '/work/api-server/src/auth/session.ts',
    old_string: 'old',
    new_string: 'new',
  })
  await $.turn.complete({
    turnId: 'd1',
    answer: 'Changed the session.',
    durationMs: 10,
    isAborted: false,
    reason: 'answer',
  })

  const panel = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await panel.press({ key: 't-d1' })
  expect(await panel.find({ type: 'Text', text: /1 modified/ })).toBeDefined()
  await panel.press({ key: 'v-d1' })
  await panel.unmount()
  expect(placed.length).toBe(1)

  const row = await $.ui.mount({
    plugin: 'flightdeck',
    component: 'Placed',
    requestId: placed[0] ?? '',
    surface: 'terminal',
    props: { id: placed[0] ?? '', plugin: 'flightdeck' },
  })
  expect(await row.find({ type: 'Text', text: /Before/ })).toBeDefined()
  expect(await row.find({ type: 'Text', text: /^old$/ })).toBeDefined()
  expect(await row.find({ type: 'Text', text: /^new$/ })).toBeDefined()
  await row.press({ key: 'diff-close' })
  expect(await row.find({ type: 'Text', text: /Before/ })).toBeUndefined()
  await row.unmount()
})

test('the effort in force is read from the settings for the session model', async ($, on) => {
  on('command.register', () => ({ value: { command: 'flightdeck' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.model', () => ({ value: 'claude-fable-5-2' }))
  on('config.list', () => ({ value: [] }))
  on('command.list', () => ({
    value: [
      { name: 'effort', description: '', source: 'builtin' },
      { name: 'model', description: '', source: 'builtin' },
    ],
  }))
  on('env.get', () => ({ value: undefined }))
  on('settings.read', () => ({
    value: { modelSettings: { 'claude-fable-5-2': { effortLevel: 'medium' } } },
  }))

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const debug = await $.command.run({ command: 'flightdeck', args: 'debug' })
  expect(debug.text).toContain('effort in force: medium (from model settings)')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^ med(ium)? $/ })).toBeDefined()
  await ui.unmount()
})
