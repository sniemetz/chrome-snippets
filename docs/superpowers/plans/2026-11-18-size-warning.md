# Large Snippet Warning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. One small task.

**Goal:** Warn (never block) when a snippet is saved above 20 kB.

**Decision (user, 2026-11-18):** no hard limit; let the user decide; warn above 20 kB (about 6-7 pages: a very long email or a small document; a typical long email is 1-2 kB). Chosen because search cost grows with the whole library (400 snippets of 20 kB = about 8 MB) and large snippets make sync files and pastes heavier. Import and sync accept any size silently.

**Spec:** `docs/spec.md` decision #6 ("No max length") gains "warning above 20 kB".

## Global Constraints
- Threshold constant `LARGE_SNIPPET_BYTES = 20000` (UTF-8 bytes of `content`).
- Message text exactly: `"This snippet is large (N kB). Large snippets slow search, sync and pasting."` with buttons `Cancel` and `Save anyway`; `N` = size in kB rounded to a whole number.
- Inline confirmation in the footer confirm row; no `confirm()`.
- Plain commit message, no attribution.

## Task 1: Warn on large save

**Files:** Create `extension/lib/limits.js`; Modify `extension/popup/popup.js`, `docs/spec.md`, `README.md`; Test `test/limits.test.js`

**Interfaces:**
- Produces: `LARGE_SNIPPET_BYTES: number`; `contentBytes(text: string): number` (UTF-8 length via `TextEncoder`); `largeWarning(content: string): string | null` — returns the exact message above when `contentBytes(content) > LARGE_SNIPPET_BYTES`, else `null`.

- [ ] **Step 1: Write failing tests:** `contentBytes("aé")` is 3; 20,000 ASCII characters → `null`; 20,001 → message with `N` = 20; 120,000 bytes → `N` = 120; multi-byte text counts bytes, not characters.
- [ ] **Step 2: Run** `node --test test/limits.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement `limits.js`.**
- [ ] **Step 4: In `popup.js` Save handler:** before `store.add`/`update`/re-create, `const warn = largeWarning(form.content)`; when non-null and not yet confirmed for this save, call `askConfirm(warn, "Cancel", "Save anyway", () => doSave(true))` and return; `doSave` skips the check when called with `true`. Saving below the threshold is unchanged.
- [ ] **Step 5: Run** `npm test`. Expected: PASS.
- [ ] **Step 6: Manual check** (user): paste a text over 20 kB, Save shows the inline question; "Save anyway" saves; "Cancel" keeps editing; a small snippet saves without a question.
- [ ] **Step 7: Docs:** `docs/spec.md` #6 and README note the warning. Commit `feat: warn when saving a snippet above 20 kB`.
