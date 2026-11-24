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
import { MAX_LINE_CHARS, MAX_LINES, addDiff, capHunks, hunksOfNewFile, hunksOfPatch, sideBySide } from '../hooks/diff'
import { shellChanges } from '../hooks/rows'
import { movedTop } from '../hooks/viewer'

const PANE = {
  plugin: 'flightdeck',
  component: 'Pane',
  requestId: 'flightdeck',
  props: {
    title: 'Flightdeck',
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
  const shell = shellChanges({
    stdout: '',
    bashEditDiff: {
      files: [
        { filePath: '/r/a.ts', hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: ['-x', '+y', '+z'] }] },
        { filePath: '/r/b.ts', hunks: [], created: true },
        { filePath: '/r/c.ts', hunks: [{ oldStart: 1, oldLines: 1, newStart: 0, newLines: 0, lines: ['-gone'] }], deleted: true },
      ],
      moreFiles: 2,
      changedFiles: ['/r/a.ts', '/r/b.ts', '/r/c.ts', '/r/d.ts', '/r/e.ts'],
    },
  })
  expect(shell?.files.map(file => [file.path, file.added, file.removed, file.isNew, file.isGone])).toEqual([
    ['/r/a.ts', 2, 1, false, false],
    ['/r/b.ts', 0, 0, true, false],
    ['/r/c.ts', 0, 1, false, true],
  ])
  expect(shell?.files[0]?.hunks).toEqual([{ oldStart: 1, newStart: 1, lines: ['-x', '+y', '+z'] }])
  expect(shell?.more).toBe(2)
  expect(shell?.others).toEqual(['/r/d.ts', '/r/e.ts'])
  expect(shellChanges({ stdout: '' })).toBe(null)

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
  const hunks = hunksOfPatch([
    { oldStart: 10, oldLines: 4, newStart: 10, newLines: 3, lines: [' keep', '-old one', '-old two', '+new one', ' tail'] },
  ])
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

const BAND = {
  plugin: 'flightdeck',
  component: 'AbovePrompt',
  requestId: 'band',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 19 },
    view: {},
  },
} as const

test('long diffs are cut by lines and by line length', () => {
  const wide = capHunks([{ oldStart: 1, newStart: 1, lines: ['+' + 'x'.repeat(5000)] }])
  expect(wide.hunks[0]?.lines[0]?.length).toBe(MAX_LINE_CHARS + 2)
  expect(wide.hunks[0]?.lines[0]?.endsWith('…')).toBe(true)

  const tall = capHunks(hunksOfNewFile(Array.from({ length: 5000 }, (_, i) => `l${i}`).join('\n')))
  expect(tall.hunks[0]?.lines.length).toBe(MAX_LINES)
  expect(tall.isCut).toBe(true)
})

test('the eye opens a side-by-side diff in the band above the prompt', async ($, on) => {
  mock.clock(on)
  on('fs.exists', (_, e) => ({ value: e.path === '/work/api-server/.git' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: EDIT_RESULT }))
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

  const quiet = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await quiet.find({ type: 'Text', text: /Before/ })).toBeUndefined()
  await quiet.unmount()

  const panel = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await panel.press({ key: 't-d1' })
  expect(await panel.find({ type: 'Text', text: /1 modified/ })).toBeDefined()
  await panel.press({ key: 'v-d1' })
  await panel.unmount()

  const row = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await row.find({ type: 'Text', text: /Before/ })).toBeDefined()
  expect(await row.find({ type: 'Text', text: /^old$/ })).toBeDefined()
  expect(await row.find({ type: 'Text', text: /^new$/ })).toBeDefined()
  await row.press({ key: 'diff-f0' })
  expect(await row.find({ type: 'Text', text: /^new$/ })).toBeDefined()
  expect(await row.find({ type: 'Text', text: /rows 1–/ })).toBeDefined()
  await row.press({ key: 'diff-close' })
  expect(await row.find({ type: 'Text', text: /Before/ })).toBeUndefined()
  await row.unmount()
})

test('diffs are kept for the last 20 responses only', async ($, on) => {
  mock.clock(on)
  on('fs.exists', (_, e) => ({ value: e.path === '/work/api-server/.git' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: EDIT_RESULT }))

  for (let n = 1; n <= 21; n += 1) {
    await $.turn.start({ text: 'edit', turnId: `k${n}` })
    await $.tool.call({ tool: 'Edit', file_path: '/work/api-server/src/auth/session.ts', old_string: 'old', new_string: 'new' })
    await $.turn.complete({ turnId: `k${n}`, answer: 'Done.', durationMs: 1, isAborted: false, reason: 'answer' })
  }

  const tallk1 = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 100 } }, surface: 'terminal' })
  await tallk1.press({ key: 'v-k1' })
  await tallk1.unmount()
  const gone = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await gone.find({ type: 'Text', text: /No diff was recorded/ })).toBeDefined()
  await gone.unmount()

  const tallk2 = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 100 } }, surface: 'terminal' })
  await tallk2.press({ key: 'v-k2' })
  await tallk2.unmount()
  const kept = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await kept.find({ type: 'Text', text: /^new$/ })).toBeDefined()
  await kept.unmount()
})

test('the viewer scrolls its code rows under a header that stays put', async ($, on) => {
  mock.clock(on)
  on('fs.exists', (_, e) => ({ value: e.path === '/work/api-server/.git' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const long = Array.from({ length: 40 }, (_, i) => `+line ${i + 1}`)
  on('tool.call', () => ({
    result: { filePath: '/work/api-server/big.ts', structuredPatch: [{ lines: long }] },
  }))

  await $.turn.start({ text: 'edit', turnId: 'd2' })
  await $.tool.call({ tool: 'Edit', file_path: '/work/api-server/big.ts', old_string: 'a', new_string: 'b' })
  await $.turn.complete({ turnId: 'd2', answer: 'Grew it.', durationMs: 10, isAborted: false, reason: 'answer' })

  const panel = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await panel.press({ key: 'v-d2' })
  await panel.unmount()

  const row = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await row.find({ type: 'Text', text: /rows 1–11 of 41/ })).toBeDefined()
  expect(movedTop(0, 3, 41, 12)).toBe(3)
  expect(movedTop(5, -9, 41, 12)).toBe(0)
  expect(movedTop(0, 500, 41, 11)).toBe(30)
  expect(await row.find({ type: 'Text', text: /Before/ })).toBeDefined()
  expect(await row.find({ type: 'Text', text: /^line 10$/ })).toBeDefined()
  expect(await row.find({ type: 'Text', text: /^line 11$/ })).toBeUndefined()
  await row.unmount()
})

test('a shell script draws one compact row, and ctrl+o the full one', async $ => {
  const script = {
    plugin: 'flightdeck',
    component: 'ToolUse',
    requestId: 'sh1',
    surface: 'terminal',
    props: {
      tool: 'Bash',
      input: { command: "python3 - <<'EOF'\nprint(1)\nEOF", description: 'Patch the viewer' },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
    },
  } as never
  const ui = await $.ui.mount(script)
  expect(await ui.find({ type: 'Text', text: /^Patch the viewer$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /no files changed/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /print\(1\)/ })).toBeUndefined()
  await ui.unmount()
})

test('a shell command that changes files lists each with its line counts', async ($, on) => {
  on('fs.exists', (_, e) => ({ value: e.path === '/work/api-server/.git' }))
  const output = {
    stdout: 'patched',
    stderr: '',
    interrupted: false,
    bashEditDiff: {
      files: [
        {
          filePath: '/work/api-server/src/a.ts',
          hunks: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, lines: [' keep', '-old', '+new', '+more'] }],
        },
        {
          filePath: '/work/api-server/src/b.ts',
          created: true,
          hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: ['+fresh'] }],
        },
      ],
      moreFiles: 0,
    },
  }
  const row = await $.ui.mount({
    plugin: 'flightdeck',
    component: 'ToolUse',
    requestId: 'sh2',
    surface: 'terminal',
    props: {
      tool: 'Bash',
      input: { command: 'sed -i s/old/new/ src/a.ts', description: 'Rename old to new' },
      output,
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
    },
  } as never)
  expect(await row.find({ type: 'Text', text: /^Rename old to new$/ })).toBeDefined()
  expect(await row.find({ type: 'Text', text: /src\/a\.ts/ })).toBeDefined()
  expect(await row.find({ type: 'Text', text: /^\+2$/ })).toBeDefined()
  expect(await row.find({ type: 'Text', text: /^ −1$/ })).toBeDefined()
  expect(await row.find({ type: 'Text', text: /^ new$/ })).toBeDefined()
  await row.unmount()
})

test('files a shell command changed join its response, diffs and all', async ($, on) => {
  mock.clock(on)
  on('fs.exists', (_, e) => ({ value: e.path === '/work/api-server/.git' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', () => ({
    result: {
      stdout: '',
      stderr: '',
      interrupted: false,
      bashEditDiff: {
        files: [
          {
            filePath: '/work/api-server/src/a.ts',
            hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-before', '+after'] }],
          },
        ],
        moreFiles: 1,
        changedFiles: ['/work/api-server/src/a.ts', '/work/api-server/src/b.ts'],
      },
    },
  }))

  await $.turn.start({ text: 'sed it', turnId: 's1' })
  await $.tool.call({ tool: 'Bash', command: 'sed -i s/before/after/ src/*.ts', tool_use_id: 'b1' } as never)
  await $.turn.complete({ turnId: 's1', answer: 'Replaced it.', durationMs: 10, isAborted: false, reason: 'answer' })

  const panel = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await panel.find({ type: 'Text', text: /2 files/ })).toBeDefined()
  await panel.press({ key: 'v-s1' })
  await panel.unmount()

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /^before$/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /^after$/ })).toBeDefined()
  await band.unmount()
})

test('the panel is headed Flightdeck, with the session directory under it', async ($, on) => {
  mock.clock(on)
  on('session.cwd', () => ({ value: '/home/pat/projects/api-server' }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/pat' : undefined }))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^Flightdeck$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^~\/projects\/api-server$/ })).toBeDefined()
  await ui.unmount()
})

test('the docked panel draws every section at 30, 44 and 60 columns', async ($, on) => {
  mock.clock(on)
  for (const bodyColumns of [30, 44, 60]) {
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns }, surface: 'terminal' })
    for (const heading of [/^Flightdeck$/, /^SESSION/, /^CONTEXT/, /^CHAT HISTORY$/, /^EXTENSIONS$/]) {
      expect(await ui.find({ type: 'Text', text: heading })).toBeDefined()
    }
    await ui.unmount()
  }
})

test('extensions count the tokens their calls bring in', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'flightdeck' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({ result: 'x'.repeat(4000) }))

  on('tool.list', () => ({ value: [] }))
  on('command.list', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.tool.call({ tool: 'mcp__github__get_issue', tool_use_id: 'm1' } as never)
  // A reload starts the session over: what it reads again must keep the totals.
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: false })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'x-mcp' })
  expect(await ui.find({ type: 'Text', text: /^ +1k$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ +1 calls$/ })).toBeDefined()
  await ui.unmount()
})

test("a skill's instructions count for it, and nothing after its turn does", async ($, on) => {
  mock.clock(on)
  mock.session(on)
  on('command.register', () => ({ value: { command: 'flightdeck' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ result: '' }))
  const instructions = (uuid: string) =>
    ({
      door: 'tool-message',
      origin: { kind: 'tool', tool: 'Skill' },
      uuid,
      message: { type: 'user', role: 'user', isMeta: true, content: [{ type: 'text', text: 'x'.repeat(400) }] },
    }) as never

  await $.turn.start({ text: 'chart it', turnId: 's1' })
  await $.tool.call({ tool: 'Skill', skill: 'dataviz', tool_use_id: 'k1' } as never)
  await $.session.append(instructions('i1'))
  await $.turn.start({ text: 'next', turnId: 's2' })
  await $.session.append(instructions('i2'))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'x-skill' })
  expect(await ui.find({ type: 'Text', text: /^ +100$/ })).toBeDefined()
  await ui.unmount()
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
  const debug = await $.command.run({
    command: 'flightdeck',
    args: 'debug',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })
  expect(debug.text).toContain('effort in force: medium (from model settings)')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^ med(ium)? $/ })).toBeDefined()
  await ui.unmount()
})
