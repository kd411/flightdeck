// Diffs as the viewer needs them: hunks read from an edit tool's or a shell
// command's result, and laid out side by side. Pure, so all of it is
// testable without an engine.

import type { DiffFile, DiffHunk } from '../types'

/** Lines kept per file, and files kept per response. */
export const MAX_LINES = 600
export const MAX_FILES = 40

type PatchHunk = { oldStart?: unknown; newStart?: unknown; lines?: unknown }

/** Hunks from an edit tool's `structuredPatch`. */
export function hunksOfPatch(patch: unknown): DiffHunk[] {
  if (!Array.isArray(patch)) {
    return []
  }

  return patch.flatMap((hunk: PatchHunk) =>
    Array.isArray(hunk.lines)
      ? [
          {
            oldStart: typeof hunk.oldStart === 'number' ? hunk.oldStart : 1,
            newStart: typeof hunk.newStart === 'number' ? hunk.newStart : 1,
            lines: hunk.lines.filter((line): line is string => typeof line === 'string'),
          },
        ]
      : [],
  )
}

/** A whole new file as one hunk of added lines. */
export function hunksOfNewFile(content: string): DiffHunk[] {
  if (content === '') {
    return []
  }
  const lines = content.replace(/\n$/, '').split('\n')

  return [{ oldStart: 0, newStart: 1, lines: lines.map(line => '+' + line) }]
}

/** Keeps at most `MAX_LINES` lines across a file's hunks. */
export function capHunks(hunks: readonly DiffHunk[]): {
  hunks: DiffHunk[]
  isCut: boolean
} {
  const kept: DiffHunk[] = []
  let left = MAX_LINES
  for (const hunk of hunks) {
    if (left <= 0) {
      return { hunks: kept, isCut: true }
    }
    kept.push({ ...hunk, lines: hunk.lines.slice(0, left) })
    left -= hunk.lines.length
  }

  return { hunks: kept, isCut: left < 0 }
}

/** Adds one change to a response's diffs, merging edits of the same file. */
export function addDiff(files: readonly DiffFile[], next: DiffFile): DiffFile[] {
  const at = files.findIndex(
    file => file.repo === next.repo && file.path === next.path,
  )
  if (at < 0) {
    return [...files, next].slice(0, MAX_FILES)
  }
  const was = files[at] as DiffFile
  const capped = capHunks([...was.hunks, ...next.hunks])
  const merged: DiffFile = {
    ...was,
    kind: was.kind === 'added' || was.kind === 'renamed' ? was.kind : next.kind,
    hunks: capped.hunks,
    isCut: was.isCut || next.isCut || capped.isCut,
    isSinceCommit: was.isSinceCommit && next.isSinceCommit,
  }

  return files.map((file, index) => (index === at ? merged : file))
}

export type Side = { no: number; text: string; mark: ' ' | '-' | '+' }

/** One row of the side-by-side view: a hunk's heading, or a pair of lines. */
export type SideRow =
  | { kind: 'hunk'; oldStart: number; newStart: number }
  | { kind: 'line'; left: Side | null; right: Side | null }

/**
 * Lays hunks out side by side: unchanged lines on both sides, a run of
 * removed lines paired with the run of added lines after it.
 */
export function sideBySide(hunks: readonly DiffHunk[]): SideRow[] {
  const rows: SideRow[] = []
  for (const hunk of hunks) {
    rows.push({ kind: 'hunk', oldStart: hunk.oldStart, newStart: hunk.newStart })
    let oldNo = hunk.oldStart
    let newNo = hunk.newStart
    const lines = hunk.lines
    let at = 0
    while (at < lines.length) {
      const line = lines[at] ?? ''
      if (line.startsWith('-') || line.startsWith('+')) {
        const removed: string[] = []
        const added: string[] = []
        while (at < lines.length && (lines[at] ?? '').startsWith('-')) {
          removed.push((lines[at] ?? '').slice(1))
          at += 1
        }
        while (at < lines.length && (lines[at] ?? '').startsWith('+')) {
          added.push((lines[at] ?? '').slice(1))
          at += 1
        }
        for (let pair = 0; pair < Math.max(removed.length, added.length); pair += 1) {
          const gone = removed[pair]
          const come = added[pair]
          rows.push({
            kind: 'line',
            left: gone === undefined ? null : { no: oldNo++, text: gone, mark: '-' },
            right: come === undefined ? null : { no: newNo++, text: come, mark: '+' },
          })
        }
        continue
      }
      if (line.startsWith(' ')) {
        const text = line.slice(1)
        rows.push({
          kind: 'line',
          left: { no: oldNo++, text, mark: ' ' },
          right: { no: newNo++, text, mark: ' ' },
        })
      }
      at += 1
    }
  }

  return rows
}

/** Tabs to spaces, so a line keeps its width in a cell grid. */
export function plain(text: string): string {
  return text.replace(/\t/g, '  ').replace(/[\r\u0000-\u0008\u000b-\u001f]/g, '')
}
