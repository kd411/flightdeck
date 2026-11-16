// The values the panel draws from, held in `$.state` so they outlive a hot
// reload. Change a `shape` tag whenever its value's fields change: the tag
// declines what an earlier version stored.

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type {
  Category,
  Controls,
  DiffFile,
  DiffView,
  Extensions,
  Meter,
  Totals,
  Turn,
  View,
} from '../types'

export const PANE = 'flightdeck'

const turns = atom(
  { plugin: 'flightdeck', key: 'turns' } as const,
  [],
  { shape: 'turns-2' },
)

const view = atom(
  { plugin: 'flightdeck', key: 'view' } as const,
  { openTurn: null, isContextOpen: true, openExt: null, isModelOpen: false },
  { shape: 'view-2' },
)

const meter = atom(
  { plugin: 'flightdeck', key: 'meter' } as const,
  { tokens: null, window: 0, percent: null, limits: [], startedAt: 0 },
  { shape: 'meter-1' },
)

const totals = atom(
  { plugin: 'flightdeck', key: 'totals' } as const,
  { input: 0, output: 0, cacheRead: 0 },
  { shape: 'totals-1' },
)

const breakdown = atom(
  { plugin: 'flightdeck', key: 'breakdown' } as const,
  [],
  { shape: 'breakdown-1' },
)

const extensions = atom(
  { plugin: 'flightdeck', key: 'extensions' } as const,
  { used: {}, available: {} },
  { shape: 'extensions-1' },
)

const controls = atom(
  { plugin: 'flightdeck', key: 'controls' } as const,
  {
    model: '',
    effort: null,
    modelKey: null,
    modelOptions: [],
    effortKey: null,
    effortOptions: [],
    hasModelCommand: false,
    hasEffortCommand: false,
  },
  { shape: 'controls-1' },
)

const diffs = atom(
  { plugin: 'flightdeck', key: 'diffs' } as const,
  {},
  { shape: 'diffs-1' },
)

const diffView = atom(
  { plugin: 'flightdeck', key: 'diffView' } as const,
  { row: null, turn: null, file: 0, page: 0 },
  { shape: 'diffview-1' },
)

// The state library's calls name their value where the engine's scan can
// read it, so every read and write of the mod goes through this file.

type Engine = EngineInterface

export function readTurns($: Engine) {
  return read($, turns)
}
export function changeTurns($: Engine, change: (value: Turn[]) => Turn[]) {
  return update($, turns, change)
}

export function readView($: Engine) {
  return read($, view)
}
export function changeView($: Engine, change: (value: View) => View) {
  return update($, view, change)
}

export function readMeter($: Engine) {
  return read($, meter)
}
export function changeMeter($: Engine, change: (value: Meter) => Meter) {
  return update($, meter, change)
}

export function readTotals($: Engine) {
  return read($, totals)
}
export function changeTotals($: Engine, change: (value: Totals) => Totals) {
  return update($, totals, change)
}

export function readBreakdown($: Engine) {
  return read($, breakdown)
}
export function changeBreakdown($: Engine, change: (value: Category[]) => Category[]) {
  return update($, breakdown, change)
}

export function readExtensions($: Engine) {
  return read($, extensions)
}
export function changeExtensions($: Engine, change: (value: Extensions) => Extensions) {
  return update($, extensions, change)
}

export function readControls($: Engine) {
  return read($, controls)
}
export function changeControls($: Engine, change: (value: Controls) => Controls) {
  return update($, controls, change)
}

export function readDiffs($: Engine) {
  return read($, diffs)
}
export function changeDiffs(
  $: Engine,
  change: (value: Record<string, DiffFile[]>) => Record<string, DiffFile[]>,
) {
  return update($, diffs, change)
}

export function readDiffView($: Engine) {
  return read($, diffView)
}
export function changeDiffView($: Engine, change: (value: DiffView) => DiffView) {
  return update($, diffView, change)
}
