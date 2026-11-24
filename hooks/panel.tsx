// The Flightdeck panel. One tree, sized to the columns the pane gives it, so it
// reflows from a narrow dock to a wide one. Docked it draws every section;
// placed inline (a narrow terminal) it draws a short glance instead.

import type { EngineInterface, RenderInput } from 'claude-code'

import type { ExtKind, Turn } from '../types'
import {
  loadBreakdown,
  jump,
  openViewer,
  pickEffort,
  pickModel,
  pressModel,
} from './engine'
import {
  bar,
  byRepo,
  clip,
  countFiles,
  kindCounts,
  mergeFiles,
  fit,
  fmtTokens,
  limitLabel,
  ofKind,
  span,
  until,
} from './lib'
import { changeView, readBreakdown, readControls, readExtensions, readMeter, readTotals, readTurns, readView } from './state'

// Told apart on any theme: the engine's own category colours start with
// greys that vanish on a dark terminal.
const PALETTE = [
  'suggestion',
  'success',
  'warning',
  'merged',
  'claude',
  'error',
  'planMode',
  'ide',
] as const

// The eye that opens a response's diffs; drawn two cells wide by terminals.
const EYE = '👀'
const EYE_W = 2

const USE_ROWS: readonly { kind: string; label: string }[] = [
  { kind: 'tool', label: 'Tools' },
  { kind: 'mcp', label: 'MCP' },
  { kind: 'connector', label: 'Connector' },
  { kind: 'plugin', label: 'Plugin' },
  { kind: 'skill', label: 'Skill' },
]

const EXT_ROWS: readonly { kind: ExtKind; label: string; unit: string }[] = [
  { kind: 'skill', label: 'Skills', unit: 'runs' },
  { kind: 'connector', label: 'Connectors', unit: 'calls' },
  { kind: 'plugin', label: 'Plugins', unit: 'calls' },
  { kind: 'mcp', label: 'MCP', unit: 'calls' },
]


function shortLevel(level: string, isTight: boolean): string {
  return isTight && level === 'medium' ? 'med' : level
}

// The home folder, read once: it does not change while the mod runs.
let homeDir: Promise<string | undefined> | null = null

/** The session's directory, with the home folder written as `~`. */
async function sessionPath($: EngineInterface): Promise<string> {
  homeDir ??= $.env.get('HOME').catch(() => undefined)
  const [cwd, home] = await Promise.all([$.session.cwd().catch(() => ''), homeDir])
  if (typeof home === 'string' && home !== '' && (cwd === home || cwd.startsWith(home + '/'))) {
    return '~' + cwd.slice(home.length)
  }

  return cwd
}

export async function drawPanel($: EngineInterface, e: RenderInput<'Pane'>) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const isDock = e.props.placement === 'dock'
  // Docked, the panel is framed: a border and a column of padding each side,
  // and one spare column so nothing sits under the dock's own edge.
  const full = Math.max(20, Math.floor(e.props.bodyColumns))
  const w = isDock ? Math.max(20, full - 5) : full
  const [list, look, gauge, sum, cats, ext, ctl, now] = await Promise.all([
    readTurns($),
    readView($),
    readMeter($),
    readTotals($),
    readBreakdown($),
    readExtensions($),
    readControls($),
    $.clock.now().catch(() => 0),
  ])
  const where = await sessionPath($)

  const percent = gauge.percent ?? 0
  const size = sum.input + sum.output
  const five = gauge.limits.find(limit => limit.kind === 'five_hour')
  const week = gauge.limits.find(limit => limit.kind === 'seven_day')

  // A narrow terminal seats the pane above the prompt: keep it to a glance.
  if (!isDock) {
    const facts = [
      ctl.model,
      ctl.effort,
      `ctx ${percent}%`,
      five && `5h ${Math.round(five.percentUsed)}%`,
      week && `wk ${Math.round(week.percentUsed)}%`,
      `${fmtTokens(size)} tok`,
    ].filter(fact => typeof fact === 'string' && fact !== '')

    return (
      <Box flexDirection="column">
        <Text wrap="truncate-end">{facts.join(' · ')}</Text>
        {list.slice(-3).map(turn => (
          <Button
            key={`t-${turn.id}`}
            plain
            onPress={() => jump($, turn.anchors)}
          >
            {turn.isRunning ? '◐ ' : '↑ '}
            {fit(turn.title, Math.max(8, w - 12))}{' '}
            <Text dimColor>{fmtTokens(turn.tokens).padStart(6)}</Text>
          </Button>
        ))}
      </Box>
    )
  }

  const rule = <Text dimColor>{'─'.repeat(w)}</Text>
  const isTight = w < 40

  // Model and effort
  const levels = ctl.effortOptions
  const controlsBlock = (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <Text dimColor>MODEL</Text>
        <Button
          key="model"
          plain
          onPress={() => pressModel($, ctl.modelKey ? ctl.modelOptions.length : 0)}
        >
          {clip(ctl.model || 'unknown', w - 9)} ▾
        </Button>
      </Box>
      {look.isModelOpen &&
        ctl.modelKey !== null &&
        ctl.modelOptions.map(option => (
          <Button
            key={`m-${option}`}
            plain
            onPress={() => pickModel($, ctl.modelKey ?? 'model', option)}
          >
            {option === ctl.model ? '  ● ' : '    '}
            {clip(option, w - 4)}
          </Button>
        ))}
      {levels.length > 0 && (
        <Box justifyContent="space-between" flexWrap="wrap">
          <Text dimColor>EFFORT</Text>
          <Box columnGap={1}>
            {levels.map(level => (
              <Button
                key={`e-${level}`}
                plain
                onPress={() => pickEffort($, ctl.effortKey, level)}
              >
                {level === ctl.effort ? (
                  <Text inverse color="claude" bold> {shortLevel(level, isTight)} </Text>
                ) : (
                  <Text dimColor>{shortLevel(level, isTight)}</Text>
                )}
              </Button>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  )

  // Session: plan limits and size
  const labelW = 9
  const pctW = 5
  const resetW = w >= 42 ? 15 : 0
  const barW = Math.max(4, w - labelW - pctW - resetW)
  const sessionBlock = (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <Text dimColor>SESSION</Text>
        <Text dimColor>
          {gauge.startedAt > 0 && now > 0 ? span(now - gauge.startedAt) : ''}
        </Text>
      </Box>
      {gauge.limits.map(limit => {
        const [filled, empty] = bar(barW, limit.percentUsed / 100)
        const left = until(limit.resetsAt, now)

        return (
          <Box>
            <Text>{fit(limitLabel(limit.kind), labelW)}</Text>
            <Text color={limit.percentUsed >= 85 ? 'warning' : 'claude'}>
              {filled}
            </Text>
            <Text dimColor>{empty}</Text>
            <Text bold>{`${Math.round(limit.percentUsed)}%`.padStart(pctW)}</Text>
            {resetW > 0 && (
              <Text dimColor>
                {(left === '' ? '' : `resets ${left}`).padStart(resetW)}
              </Text>
            )}
          </Box>
        )
      })}
      <Box justifyContent="space-between">
        <Box>
          <Text>Size </Text>
          <Text bold>{fmtTokens(size)}</Text>
        </Box>
        <Text dimColor>
          {w >= 34
            ? `in ${fmtTokens(sum.input)} · out ${fmtTokens(sum.output)}`
            : ''}
        </Text>
      </Box>
    </Box>
  )

  // Context: bar, then the components behind a press
  const window = gauge.window > 0 ? gauge.window : 1
  const catCells = cats.map((category, index) => ({
    ...category,
    color: PALETTE[index % PALETTE.length] ?? 'claude',
    cells: Math.max(1, Math.round((category.tokens / window) * w)),
  }))
  const usedCells = Math.min(
    w,
    catCells.reduce((cells, category) => cells + category.cells, 0),
  )
  const [filled, empty] = bar(w, percent / 100)
  const nameW = Math.max(6, w - 4 - 2 - 7 - 5)
  const contextBlock = (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <Text dimColor>CONTEXT</Text>
        <Box>
          <Text bold>{percent}%</Text>
          <Text dimColor>
            {' '}
            {fmtTokens(gauge.tokens ?? 0)} / {fmtTokens(gauge.window)}
          </Text>
        </Box>
      </Box>
      {cats.length > 0 ? (
        <Box>
          {catCells.map(category => (
            <Text color={category.color}>{'━'.repeat(category.cells)}</Text>
          ))}
          <Text dimColor>{'━'.repeat(Math.max(0, w - usedCells))}</Text>
        </Box>
      ) : (
        <Box>
          <Text color={percent >= 85 ? 'warning' : 'claude'}>{filled}</Text>
          <Text dimColor>{empty}</Text>
        </Box>
      )}
      <Button
        key="ctx"
        plain
        onPress={async () => {
          const next = await changeView($, old => ({
            ...old,
            isContextOpen: !old.isContextOpen,
          }))
          if (next.isContextOpen) {
            await loadBreakdown($)
          }
        }}
      >
        {catCells.map(category => (
          <Text color={category.color}>■</Text>
        ))}
        <Text dimColor>
          {cats.length > 0 ? ` ${cats.length} components ` : 'components '}
          {look.isContextOpen ? '▾' : '▸'}
        </Text>
      </Button>
      {look.isContextOpen && (
        <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
          {cats.length === 0 && <Text dimColor>Measuring…</Text>}
          {catCells.map(category => (
            <Box>
              <Text color={category.color}>■ </Text>
              <Text>{fit(category.name, nameW)}</Text>
              <Text>{fmtTokens(category.tokens).padStart(7)}</Text>
              <Text dimColor>
                {`${Math.round((category.tokens / window) * 100)}%`.padStart(5)}
              </Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )

  // Chat history
  const tokW = 6
  const fileW = 8
  const titleW = Math.max(8, w - 2 - 2 - EYE_W - tokW - fileW - 1)
  // The frame fills the dock's height; the history takes what the other
  // sections leave, and a taller panel scrolls.
  const rows = Math.max(0, Math.floor(e.props.scroll.bodyRows))
  // The header's path line takes one row of what the history could use.
  const historyRows = Math.max(6, rows - 35)
  const shown = list.slice(-historyRows)
  const historyBlock = (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <Text dimColor>CHAT HISTORY</Text>
        <Text dimColor>{w >= 44 ? `↑ jump ${EYE} diff · tokens · files` : 'tokens · files'}</Text>
      </Box>
      {shown.length === 0 && <Text dimColor>No responses yet.</Text>}
      {shown.map(turn => {
        const isOpen = look.openTurn === turn.id
        const files = countFiles(turn.files)
        const mark = turn.isRunning ? '◐' : isOpen ? '▾' : '▸'

        return (
          <Box flexDirection="column">
            <Box>
              <Button
                key={`t-${turn.id}`}
                plain
                onPress={() =>
                  changeView($, old => ({
                    ...old,
                    openTurn: old.openTurn === turn.id ? null : turn.id,
                  }))
                }
              >
                <Text color={isOpen || turn.isRunning ? 'claude' : undefined}>
                  {mark} {fit(turn.title, titleW)}
                </Text>
              </Button>
              <Text> </Text>
              <Button
                key={`j-${turn.id}`}
                plain
                onPress={() => jump($, turn.anchors)}
              >
                <Text color="claude" bold>
                  ↑
                </Text>
              </Button>
              {files > 0 ? (
                <Button
                  key={`v-${turn.id}`}
                  plain
                  onPress={() => openViewer($, turn.id)}
                >
                  <Text color="suggestion">{EYE}</Text>
                </Button>
              ) : (
                <Text>{' '.repeat(EYE_W)}</Text>
              )}
              <Text>{fmtTokens(turn.tokens).padStart(tokW)}</Text>
              <Text dimColor>
                {(files === 0
                  ? '—'
                  : `${files} file${files === 1 ? '' : 's'}`
                ).padStart(fileW + 1)}
              </Text>
            </Box>
            {isOpen && turnDetail(turn)}
          </Box>
        )
      })}
    </Box>
  )



  function turnDetail(turn: Turn) {
    return (
      <Box flexDirection="column" marginLeft={2}>
        {turn.summary !== '' ? (
          <Text>{turn.summary}</Text>
        ) : (
          turn.isRunning && <Text dimColor>Working…</Text>
        )}
        {byRepo(turn.files).map(repo => {
          const files = mergeFiles(turn.files).filter(file => file.repo === repo.repo)
          const counts = kindCounts(files)

          return (
            <Box justifyContent="space-between">
              <Box>
                <Text color="suggestion">
                  {clip(repo.repo, Math.max(6, w - 2 - counts.length - 14))}
                </Text>
                <Text>  {counts}</Text>
              </Box>
              <Box>
                {repo.added > 0 && <Text color="success">+{repo.added}</Text>}
                {repo.removed > 0 && <Text color="error"> −{repo.removed}</Text>}
              </Box>
            </Box>
          )
        })}
        {USE_ROWS.map(row => {
          const items = ofKind(turn.uses, row.kind)

          return items.length === 0 ? null : (
            <Text dimColor>
              {row.label}{'  '}
              {items.map(item => `${item.name} ×${item.count}`).join(' · ')}
            </Text>
          )
        })}
      </Box>
    )
  }

  // Extensions
  const extLabelW = 11
  const extBlock = (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <Text dimColor>EXTENSIONS</Text>
        <Text dimColor>{w >= 34 ? 'tokens'.padStart(tokW) + 'calls'.padStart(fileW + 1) : ''}</Text>
      </Box>
      {EXT_ROWS.map(row => {
        const items = ofKind(ext.used, row.kind)
        const calls = items.reduce((count, item) => count + item.count, 0)
        const total = ext.available[row.kind]
        const middle =
          total !== undefined && total >= items.length && total > 0
            ? `${items.length} of ${total} used`
            : `${items.length} used`
        const spent = items.reduce(
          (sum, item) => sum + (ext.tokens?.[`${row.kind}:${item.name}`] ?? 0),
          0,
        )
        // The same two columns the chat history ends in: tokens, then a
        // column as wide as its files one, so the figures line up.
        const tok = fmtTokens(spent).padStart(tokW)
        const callsText = `${calls} ${row.unit}`.padStart(fileW + 1)
        const isOpen = look.openExt === row.kind
        const middleW = Math.max(0, w - 2 - extLabelW - tokW - (fileW + 1))

        return (
          <Box flexDirection="column">
            <Button
              key={`x-${row.kind}`}
              plain
              onPress={() =>
                changeView($, old => ({
                  ...old,
                  openExt: old.openExt === row.kind ? null : row.kind,
                }))
              }
            >
              {isOpen ? '▾' : '▸'} {fit(row.label, extLabelW)}
              <Text dimColor>{fit(middle, middleW)}</Text>
              <Text>{tok}</Text>
              <Text dimColor>{callsText}</Text>
            </Button>
            {isOpen && items.length === 0 && (
              <Text dimColor>{'    '}none used yet</Text>
            )}
            {isOpen &&
              items.map(item => (
                <Box>
                  <Text>
                    {'    '}
                    {fit(item.name, Math.max(6, w - 4 - tokW - (fileW + 1)))}
                  </Text>
                  <Text dimColor>
                    {fmtTokens(ext.tokens?.[`${row.kind}:${item.name}`] ?? 0).padStart(tokW)}
                  </Text>
                  <Text dimColor>{`×${item.count}`.padStart(fileW + 1)}</Text>
                </Box>
              ))}
          </Box>
        )
      })}
    </Box>
  )

  return (
    <Box
      flexDirection="column"
      width={w + 4}
      minHeight={rows}
      borderStyle="round"
      borderDimColor
      paddingX={1}
    >
      <Text color="claude" bold>
        Flightdeck
      </Text>
      <Text dimColor wrap="truncate-start">
        {where}
      </Text>
      {rule}
      {controlsBlock}
      {rule}
      {sessionBlock}
      {rule}
      {contextBlock}
      {rule}
      {historyBlock}
      <Box flexGrow={1} />
      {rule}
      {extBlock}
    </Box>
  )
}
