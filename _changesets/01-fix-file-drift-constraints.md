# Fix: File-write reliability, truncation, and drift constraints

## Summary

The AI-driven "write mode" file-apply pipeline (`rool-agent.ts` → `patcher.ts` → `index.ts`)
was rewriting entire files on every requested change, using a homegrown text delimiter
protocol streamed from the model. This turned out to be fragile in several distinct ways,
each of which caused real data loss or corruption during testing. This changeset captures
the issues found, root causes, and the fixes applied, in order, as a reference for future work.

## Background: why this exists

`@rool-dev/sdk`'s native file APIs (`MachineFiles`, `/space/*`, `/rool-drive/*`) only operate
on Rool's own remote "Machine" sandbox filesystem, not the user's local disk. There is no
built-in bridge for a Rool agent to read/write the local machine directly, so this CLI has to:

1. Feed local file contents into the prompt as context.
2. Ask the model to return complete, updated file contents in its response.
3. Parse that response and write the result back to disk locally.

Everything in this changeset is about hardening step 3, which is inherently more fragile
than native structured tool-calling (see "Structured output experiment" below).

## Issues found (chronological)

### 1. Truncated streams silently written as if complete

`extractFileChanges`'s regex used `(?:<<<END_FILE>>>|$)` as a fallback terminator. If the
model's response was cut short (hit max output tokens, errored, was cancelled, ran out of
credits), the regex matched to the end of whatever text had arrived and treated it as a
complete file. `promptAndApplyChanges` then wrote that partial blob straight over the real
file — the reported symptom was "it cuts off the stream prematurely and deletes the whole file."

**Fix:**
- `runAgentTask` (`rool-agent.ts`) now tracks the SDK's `completed`/`error`/`cancelled` events
  and their `finish` reason, and **throws** instead of returning partial text when the run
  didn't end with `stop`/`tool_calls`.
- `extractFileChanges` (`patcher.ts`) marks any file block missing a closing tag as
  `isTruncated`, and `promptAndApplyChanges` filters those out before writing, as
  defense-in-depth even if the upstream check is somehow bypassed.

### 2. Rogue `...` file written to workspace root

The system prompt contained the literal example text `<<<FILE: ...>>>` (using `...` as an
English placeholder) several times. When the model echoed that instruction back verbatim
(e.g. explaining what it would/wouldn't do), the parser treated `...` as a real target path.
`path.resolve(rootDir, "...")` treats three dots as a literal filename (not `..` traversal),
so a file literally named `...` got written to the project root.

**Fix:**
- Removed literal tag examples from the static system prompt; the concrete tag/path example
  now only appears in prose-free form, and the *real* tag format (see nonce fix below) is
  never baked into reusable static text.
- Added `isPlausibleTargetPath()` in `patcher.ts`: rejects paths made of only dots/slashes/
  whitespace, and rejects any path that would resolve outside `rootDir` (also closes a
  path-traversal write vulnerability for hallucinated `../../` paths).

### 3. Nested delimiter collision when editing the CLI's own source

After fix #2, editing `rool-agent.ts` itself (which defines the system prompt describing the
tag format) still corrupted the file. The model's real response legitimately contained a
worked example of `<<<FILE: ...>>>` / `<<<END_FILE>>>` *inside* the file content being
generated (because that's literally what `AGENT_SYSTEM_PROMPT` documents). The regex is
non-greedy, so it terminated at the first `<<<END_FILE>>>` it found — the nested example —
not the real closing tag at the end of the file. Crucially, `isTruncated` was `false` here
because *a* closing tag existed, just the wrong one.

**Fix:**
- `runAgentTask` generates a random nonce (`randomUUID().slice(0, 8)`) per request and gives
  the model one-time tags (`<<<FILE:{nonce}: path>>>` / `<<<END_FILE:{nonce}>>>`) in a
  `[FILE WRITE FORMAT]` section that is never part of the reusable system prompt text.
- `extractFileChanges` requires the exact nonce in both open/close tags to recognize a block
  at all — nonce-less tag-like text (instructions, examples, quoted docs) can never match.

### 4. Subtle unrelated diffs still appearing after the above fixes

Even with truncation/collision fixed, diffs still showed small unintended changes.
Two separate causes:

- **Normalization asymmetry (real bug):** `newContent` was always normalized with
  `trimEnd() + '\n'`, but `oldContent` (read from disk) was not. Any file whose trailing
  whitespace/blank-line count differed slightly from the model's regenerated version showed
  a spurious final-line diff that had nothing to do with the model's actual behavior.
  Fixed via shared `normalizeForDiff()` / `readExistingFile()` helpers applied identically to
  both sides, in all three extraction paths (structured, tag-based, markdown fallback).
- **Inherent LLM drift (not fully fixable, only mitigated):** asking a model to reproduce an
  entire file from its own understanding will always carry some risk of incidental
  reformatting (quote style, reordering, whitespace) since it's regeneration, not patching.
  Mitigated by adding an explicit "preserve byte-for-byte outside the requested change, no
  drive-by cleanups" rule to both the system prompt and the structured-output schema
  description. Not eliminated — see Known limitations.

## Structured output experiment

`MachineConversationPromptOptions.responseSchema` + a `"json"` content-part type exist in the
SDK, suggesting schema-validated structured output may be supported as an alternative to
free-text + delimiters. Implemented as an additive, gracefully-degrading path:

- `runAgentTask` passes `responseSchema: FILE_EDIT_RESPONSE_SCHEMA` (`{ summary, files: [{
  path, content }] }`) when in write mode, and captures `output.delta` events with
  `content.type === 'json'` in addition to `'text'`.
- `patcher.ts`'s new `structuredFilesToChanges()` builds `ProposedFileChange[]` directly from
  the structured array — no regex, no delimiters, no truncation ambiguity — still passing
  every path through `isPlausibleTargetPath()`.
- `index.ts` prefers `structuredFiles` when present, falls back to the legacy tag-based
  `extractFileChanges` otherwise. If `responseSchema` is unsupported/ignored server-side,
  behavior is unchanged from before this experiment.
- Also fixed a latent dead-code bug found while touching this function: the turn-listing
  fallback checked `typeof content === 'string'`, but `MachineConversationTurn.content` is
  always an array of content parts per the SDK types — that branch could never have been hit.

**Result so far:** reduced but did not fully eliminate incidental diff noise (see issue #4).

## Known limitations / possible follow-ups

- Whole-file regeneration is inherently more drift-prone than true diff/patch application.
  The next real lever, if drift is still a problem, is moving to a patch/hunk-based edit
  format instead of asking for complete file contents — a bigger redesign, not attempted here.
- `responseSchema` support is unconfirmed against the live API beyond "it didn't error and the
  fallback path still works." Worth re-checking if Rool's SDK/docs clarify its behavior.
- No automated tests were added for `patcher.ts`'s extraction functions; verification so far
  has been manual (interactive CLI runs + reviewing diffs).

## Files touched

- `src/app/lib/rool-agent.ts` — finish-reason handling, nonce-based tags, structured-output
  schema + parsing, anti-drift prompt rules, `getAccountUsage()` (unrelated feature added in
  the same working period).
- `src/app/lib/patcher.ts` — truncation flag, path-plausibility guard, nonce-aware tag
  matching, `structuredFilesToChanges()`, shared diff-normalization helpers.
- `src/app/index.ts` — wiring for nonce + structured results, usage footer/menu (unrelated
  feature added in the same working period).
