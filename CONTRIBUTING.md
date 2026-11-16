# Contributing

Thanks for helping. Issues and pull requests are welcome.

## Before you open a pull request

1. Run the checks:

   ```
   claude plugin validate .
   claude plugin test .
   ```

2. Add or update a test in `tests/` for any change in behaviour.
3. Keep the mod light. The design rules are:
   - No model calls. Everything the panel shows comes from figures Claude Code already has, or from local work.
   - Every hook observes: it returns what `next(e)` returns, and a failure in the mod's own bookkeeping must never break a tool call or a turn.
   - Guard every read from the engine. A figure that is not available is hidden, not guessed.
   - Size every drawing to the columns it is given. Check the panel at 30, 44 and 60 columns.
4. If you change the fields of a stored value, change its `shape` tag in `hooks/state.ts` so values stored by an older version are declined.

## Never commit

- Keys, tokens or credentials of any kind.
- Internal hostnames, URLs, project names or code from an employer or client.
- Transcripts or screenshots of real sessions. Use made-up sample data.

## Reporting a bug

Include your Claude Code version (`claude --version`), your terminal and its width in columns, and what you expected to see. Run with `claude --debug` and include any line that starts with `flightdeck:`, after removing anything private.
