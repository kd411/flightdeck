# Draws the README's picture of Flightdeck: a terminal mockup on a character
# grid, in the default dark theme's colours, with made-up data only.
#
#   python3 docs/mockup.py docs
#
# writes docs/flightdeck.svg and one picture per feature in docs/features/.
import os
import re
import sys
from xml.sax.saxutils import escape

CW, RH, FS = 9.6, 19, 16          # cell width, row height, font size
LEFT, TOP = 14, 52                 # grid origin (below the title bar)
COLS, ROWS = 164, 46
W, H = round(LEFT * 2 + COLS * CW), TOP + ROWS * RH + 10

C = dict(bg='#000000', text='#d3d7cf', dim='#949494', dimmer='#767676', claude='#d78787',
         border='#696b67', rule='#808080', blue='#afd7ff', green='#87d787', pink='#ff87af',
         yellow='#ffd700', purple='#afafff', white='#ffffff', added='#5f875f',
         removed='#875f87', inverse='#eeeeec', prompt='#373737', bar='#2e2e2e')

out = []
def x(col): return LEFT + col * CW
def y(row): return TOP + row * RH

def rect(col, row, cols, rows, fill):
    out.append(f'<rect x="{x(col):.1f}" y="{y(row):.1f}" width="{cols*CW:.1f}" height="{rows*RH:.1f}" fill="{fill}"/>')

def text(col, row, s, color='text', bold=False, bg=None, wide=False):
    if s == '':
        return
    if bg:
        rect(col, row, len(s), 1, C.get(bg, bg))
    weight = ' font-weight="700"' if bold else ''
    # Renderers collapse runs of spaces, so every run of words is placed at
    # its own column, and stretched to exactly the cells it takes.
    for run in re.finditer(r'\S+(?: \S+)*', s):
        part = run.group(0)
        fit = '' if wide else f' textLength="{len(part)*CW:.1f}" lengthAdjust="spacingAndGlyphs"'
        out.append(f'<text x="{x(col + run.start()):.1f}" y="{y(row)+14.5:.1f}" fill="{C.get(color, color)}"{weight}{fit}>{escape(part)}</text>')

def line(c0, r, c1, color='border'):   # a horizontal rule through the middle of a row
    out.append(f'<line x1="{x(c0):.1f}" y1="{y(r)+RH/2:.1f}" x2="{x(c1):.1f}" y2="{y(r)+RH/2:.1f}" stroke="{C[color]}" stroke-width="1"/>')

def box(c0, r0, c1, r1, color='border'):  # a rounded frame around cells c0..c1, rows r0..r1
    out.append(f'<rect x="{x(c0)+CW/2:.1f}" y="{y(r0)+RH/2:.1f}" width="{(c1-c0)*CW:.1f}" height="{(r1-r0)*RH:.1f}" rx="6" fill="none" stroke="{C[color]}" stroke-width="1.2"/>')

def strip(col, row, cols, color):   # a bar segment: a thick line through the row
    out.append(f'<rect x="{x(col):.1f}" y="{y(row)+RH/2-1.5:.1f}" width="{cols*CW:.1f}" height="3" fill="{C.get(color, color)}"/>')

def right(col_end, row, s, color='text', bold=False):
    text(col_end - len(s), row, s, color, bold)

# ── window chrome ────────────────────────────────────────────────────────────
out.append(f'<rect width="{W}" height="{H}" fill="{C["bg"]}"/>')
out.append(f'<rect width="{W}" height="34" fill="{C["bar"]}"/>')
out.append(f'<rect x="10" y="6" width="170" height="28" rx="6" fill="{C["bg"]}"/>')
out.append(f'<circle cx="26" cy="20" r="6" fill="{C["claude"]}"/>')
out.append(f'<text x="40" y="25" fill="{C["white"]}" font-size="14">Terminal</text>')
for i, glyph in enumerate(['✕', '□', '—']):
    out.append(f'<text x="{W-30-i*46}" y="24" fill="{C["dim"]}" font-size="14">{glyph}</text>')

# ── chat ─────────────────────────────────────────────────────────────────────
CHAT = 108
rect(0, 0, CHAT, 1, C['prompt'])
text(0, 0, '> add refresh-token rotation to the session service, with tests', 'text')
text(0, 2, '●', 'white'); text(2, 2, "I'll rotate the refresh token on every use, then cover it with tests.")
rows = [
    (4, 'Update session.ts', [('src/auth/session.ts', '+18', '−4')]),
    (6, 'Create refresh.test.ts', [('test/auth/refresh.test.ts', '+96', 'new')]),
    (8, 'Rename the token helpers', [('src/auth/tokens.ts', '+12', '−12'), ('src/auth/session.ts', '+3', '−3')]),
]
for row, title, files in rows:
    text(0, row, '●', 'green'); text(2, row, title)
    for i, (path, add, rem) in enumerate(files):
        r = row + 1 + i
        text(2, r, '⎿ ', 'dim'); text(4, r, 'api-server', 'blue'); text(14, r, ' › ' + path, 'dim')
        c = 14 + 3 + len(path) + 2
        text(c, r, add, 'green'); text(c + len(add), r, ' ' + rem, 'dim' if rem == 'new' else 'pink')
text(0, 11, '●', 'green'); text(2, 11, 'Run the auth tests')
text(2, 12, '⎿ ', 'dim'); text(4, 12, 'Tests  42 passed · 0 failed · 3.1s', 'dim')
text(0, 14, '●', 'white'); text(2, 14, 'Rotation is in place: each refresh issues a new token and revokes the old one,')
text(2, 15, 'and a reused token signs the whole session out. The new tests cover both paths.')
text(0, 17, '✻ Baked for 1m 12s', 'dimmer')

# ── diff viewer, in the band above the prompt ────────────────────────────────
D0, D1, R0, R1 = 0, 106, 19, 39
box(D0, R0, D1, R1)
text(107, R0 + 1, '[-]', 'dim')
text(2, R0 + 1, 'Changes · Rotated tokens on refresh', 'claude', bold=True)
text(76, R0 + 1, 'wheel or ↑↓ scrolls', 'dim'); text(98, R0 + 1, '✕ Close', 'dim')
text(2, R0 + 2, ' M session.ts ', 'bg', bold=True, bg='inverse')
text(18, R0 + 2, 'A', 'green', bold=True); text(20, R0 + 2, 'refresh.test.ts')
text(37, R0 + 2, 'M', 'yellow', bold=True); text(39, R0 + 2, 'tokens.ts')
line(2, R0 + 3, 104, 'dimmer')
text(2, R0 + 4, 'M ', 'yellow', bold=True); text(4, R0 + 4, 'api-server', 'blue'); text(14, R0 + 4, ' › src/auth/session.ts', 'dim')
right(104, R0 + 4, 'modified', 'dim')
HALF = 51
text(7, R0 + 5, 'Before', 'dim', bold=True); text(2 + HALF + 5, R0 + 5, 'After', 'dim', bold=True)
code = [
    ('hunk', '@@ line 40 → 40'),
    ((40, ' ', 'export async function refresh(token: string) {'), (40, ' ', 'export async function refresh(token: string) {')),
    ((41, ' ', '  const session = await sessions.find(token)'), (41, ' ', '  const session = await sessions.find(token)')),
    ((42, '-', '  if (!session) throw new Unauthorized()'), (42, '+', '  if (!session || session.revoked) {')),
    (None, (43, '+', '    await sessions.revokeFamily(token)')),
    (None, (44, '+', '    throw new Unauthorized()')),
    (None, (45, '+', '  }')),
    ((43, '-', '  return session.token'), (46, '+', '  const next = await tokens.rotate(session)')),
    (None, (47, '+', '  return next.value')),
    ((44, ' ', '}'), (48, ' ', '}')),
    ('hunk', '@@ line 72 → 76'),
    ((72, ' ', 'export function expire(session: Session) {'), (76, ' ', 'export function expire(session: Session) {')),
]
def half(col, r, side):
    if side is None:
        return
    no, mark, src = side
    text(col, r, f'{no:>3} ', 'dimmer')
    if mark != ' ':
        text(col + 4, r, mark, 'pink' if mark == '-' else 'green')
    room = HALF - 6
    src = src if len(src) <= room else src[:room - 1] + '…'
    text(col + 5, r, src, 'text', bg=('removed' if mark == '-' else 'added' if mark == '+' else None))
for i, entry in enumerate(code):
    r = R0 + 6 + i
    if entry[0] == 'hunk':
        text(2, r, entry[1], 'blue'); continue
    half(2, r, entry[0]); half(2 + HALF, r, entry[1])
text(2, R1 - 1, 'rows 1–12 of 31 · ↓ more below', 'dim')

# ── prompt ───────────────────────────────────────────────────────────────────
line(0, 41, COLS, 'rule'); text(0, 42, '❯', 'text'); line(0, 43, COLS, 'rule')
text(0, 44, '⏵⏵ auto mode on', 'yellow'); text(15, 44, ' (shift+tab to cycle)', 'dim')

# ── the Flightdeck panel ─────────────────────────────────────────────────────
P0, P1 = 112, 162          # frame columns
I0, I1 = 114, 160          # inner text columns
out.append(f'<line x1="{x(110.5):.1f}" y1="{y(0):.1f}" x2="{x(110.5):.1f}" y2="{y(40):.1f}" stroke="{C["blue"]}" stroke-opacity="0.6" stroke-width="1.2"/>')
box(P0, 0, P1, 40)
def prule(r): line(I0, r, I1, 'border')
text(I0, 1, 'Flightdeck', 'claude', bold=True)
text(I0, 2, '~/projects/api-server', 'dim')
prule(3)
text(I0, 4, 'MODEL', 'dim'); right(I1, 4, 'claude-sonnet-5-5 ▾')
text(I0, 5, 'EFFORT', 'dim')
levels = [('low', False), ('medium', True), ('high', False), ('xhigh', False), ('max', False)]
c = I1 - sum(len(l) + 1 for l, _ in levels) + 1
for level, on in levels:
    text(c, 5, level, 'bg' if on else 'text', bg=('claude' if on else None)); c += len(level) + 1
prule(6)
text(I0, 7, 'SESSION', 'dim'); right(I1, 7, '52m')
def meter(r, label, share, pct, reset):
    text(I0, r, label)
    filled = round(18 * share)
    strip(I0 + 9, r, filled, 'claude'); strip(I0 + 9 + filled, r, 18 - filled, 'dim')
    text(I0 + 29, r, pct); right(I1, r, reset, 'dim')
meter(8, '5h limit', 0.38, '38%', 'resets 2h 10m')
meter(9, 'Weekly', 0.21, '21%', 'resets 3d 4h')
text(I0, 10, 'Size 205k'); right(I1, 10, 'in 182k · out 23.1k', 'dim')
prule(11)
text(I0, 12, 'CONTEXT', 'dim'); right(I1, 12, '43% 86k / 200k')
parts = [('blue', 1), ('green', 4), ('yellow', 1), ('purple', 1), ('claude', 2), ('pink', 11)]
c = I0
for color, n in parts:
    strip(c, 13, n, color); c += n
strip(c, 13, I1 - c, 'dimmer')
for i, (color, _) in enumerate(parts):
    text(I0 + i, 14, '■', color)
text(I0 + 7, 14, '6 components ▾', 'dim')
box(I0, 15, I1 - 1, 22, 'border')
cats = [('blue', 'System prompt', '3.1k', '2%'), ('green', 'System tools', '17.8k', '9%'),
        ('yellow', 'MCP tools', '1.2k', '1%'), ('purple', 'MCP server instructions', '0.9k', '0%'),
        ('claude', 'Skills', '2.4k', '1%'), ('pink', 'Messages', '60.6k', '30%')]
for i, (color, name, tok, pct) in enumerate(cats):
    r = 16 + i
    text(I0 + 2, r, '■', color); text(I0 + 4, r, name)
    text(I1 - 12 - len(tok), r, tok); right(I1 - 3, r, pct, 'dim')
prule(23)
text(I0, 24, 'CHAT HISTORY', 'dim'); right(I1, 24, '↑ jump    diff · tokens · files', 'dim')
text(I1 - 24, 24, '👀', 'text', wide=True)
history = [('Explored the auth module', False, '18.2k', '—'), ('Mapped the session store', False, '9.6k', '—'),
           ('Added refresh rotation', True, '52.3k', '3 files'), ('Wrote the refresh tests', True, '31.7k', '2 files'),
           ('Fixed the expiry check', True, '12.4k', '1 file'), ('Answered a token question', False, '3.3k', '—'),
           ('Rotated tokens on refresh', True, '40.4k', '4 files')]
for i, (title, eye, tok, files) in enumerate(history):
    r = 25 + i
    text(I0, r, '▸', 'dim'); text(I0 + 2, r, title if len(title) <= 22 else title[:21] + '…')
    text(I1 - 19, r, '↑', 'claude', bold=True)
    if eye:
        text(I1 - 18, r, '👀', 'text', wide=True)
    text(I1 - 15, r, f'{tok:>6}'); right(I1, r, files, 'dim')
prule(33)
text(I0, 34, 'EXTENSIONS', 'dim'); text(I1 - 15, 34, f'{"tokens":>6}{"calls":>9}', 'dim')
ext = [('Skills', '2 used', '9.4k', '3 runs'), ('Connectors', '1 of 2 used', '2.1k', '4 calls'),
       ('Plugins', '1 of 3 used', '640', '2 calls'), ('MCP', '2 of 4 used', '18k', '9 calls')]
for i, (name, used, tok, calls) in enumerate(ext):
    r = 35 + i
    text(I0, r, '▸', 'dim'); text(I0 + 2, r, name); text(I0 + 13, r, used, 'dim')
    text(I1 - 15, r, f'{tok:>6}'); right(I1, r, calls, 'dim')

HEAD = (f'font-family="\'DejaVu Sans Mono\', Menlo, Consolas, \'Liberation Mono\', monospace" '
        f'font-size="{FS}" role="img"')
BODY = '\n'.join(out)

def write(path, label, view=None):
    vx, vy, vw, vh = view or (0, 0, W, H)
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{vw:.0f}" height="{vh:.0f}" '
           f'viewBox="{vx:.1f} {vy:.1f} {vw:.1f} {vh:.1f}" {HEAD} aria-label="{escape(label)}">\n'
           f'<rect x="{vx:.1f}" y="{vy:.1f}" width="{vw:.1f}" height="{vh:.1f}" fill="{C["bg"]}"/>\n'
           + BODY + '\n</svg>\n')
    open(path, 'w').write(svg)

def cells(c0, r0, c1, r1, pad=8, vpad=None):
    """The pixel box around grid cells c0..c1, rows r0..r1, with a margin.
    A crop between rows keeps `vpad` small, so no sliver of the next row shows."""
    vpad = pad if vpad is None else vpad
    return (x(c0) - pad, y(r0) - vpad, (c1 - c0) * CW + 2 * pad, (r1 - r0) * RH + 2 * vpad)

def panel(r0, r1):
    """Rows r0..r1 of the panel, inside its frame."""
    return cells(I0 - 0.4, r0, I1 + 0.6, r1, pad=4, vpad=2)

# One picture per feature, cut from the same drawing, in the order the
# README's feature tour shows them.
FEATURES = {
    'where-you-are': ('The Flightdeck header with the session directory', panel(1, 3)),
    'model-effort': ('The model and effort rows', panel(4, 6)),
    'session': ('Session time, plan usage bars and session size', panel(7, 11)),
    'context': ('Context fill, the coloured bar and its breakdown', panel(12, 23)),
    'chat-history': ('Chat history rows with tokens and files', panel(24, 32)),
    'jump': ('The jump arrows on chat history rows', panel(26, 29)),
    'diff-viewer': ('The side-by-side diff viewer above the prompt', cells(0, 18.5, 110, 40, pad=4)),
    'extensions': ('Extensions with tokens and calls', panel(34, 39)),
    'compact-rows': ('Compact rows for edits and a shell command', cells(0, 4, 60, 13, vpad=2)),
}

if __name__ == '__main__':
    folder = sys.argv[1] if len(sys.argv) > 1 else 'docs'
    os.makedirs(os.path.join(folder, 'features'), exist_ok=True)
    write(os.path.join(folder, 'flightdeck.svg'),
          'Flightdeck in a fullscreen terminal, with made-up sample data')
    for name, (label, view) in FEATURES.items():
        write(os.path.join(folder, 'features', f'{name}.svg'), label, view)
    print(f'wrote flightdeck.svg and {len(FEATURES)} feature pictures to {folder}')
