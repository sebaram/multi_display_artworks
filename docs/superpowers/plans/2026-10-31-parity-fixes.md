# Parity fixes and compact avatar editor

> **For agentic workers:** Use superpowers:subagent-driven-development for the independent fixes. The user requested a clean-context review after completion.

**Goal:** Repair F1–F7 from the deployment comparison and make the avatar dialog fit one desktop viewport.

**Architecture:** Keep the current FastAPI/React/Socket.IO implementation. Repair existing boundaries and callers; add no dependencies. Continue on `codex/gaussian-avatar-gaze` so the existing private preview and local model setup remain usable.

**Spec:** User request, `docs/reports/deployment-comparison-results.json` findings F1–F7, and `AGENTS.md`.

## Constraints and decisions

- Use focused regression tests and brief browser checks; no repeated full suites or performance matrix.
- Preserve the existing comparison report as historical evidence. Add a dated resolution record instead of rewriting its original findings.
- Do not reset the running shared test database. Backend route tests use mocked storage; actual browser writes create and remove owned temporary records.
- Desktop avatar layout: preview left, compact appearance controls right, footer actions always available. Mobile: responsive single column with usable controls and scrolling only when needed. Advanced gaze parameters remain expandable.
- Existing private Gaussian assets stay private. No device/ADB activity, deployment or push.

## Tasks

- [x] Room parity: F1 complete catalog/preserved appearance, F3 conditional wall refresh with draft/route protection, F4 unassigned artwork rendering without invented room authority. Focused room tests.
- [x] Admin parity: F2 optional-reference null serialization and F7 legacy new URL initialization. Focused form/route tests.
- [x] Backend compatibility: F6 bounded camera fallback separate from room presence; HEAD wall support for F3. Focused non-destructive route tests.
- [x] Pointer routing: F5 nearest visible surface, including nearer wall occlusion. Real Three intersection regression.
- [x] Compact avatar editor and preview sizing. Desktop/mobile browser smoke; keep saved controls and errors accessible.
- [x] Investigate current CI failures using focused reproductions; fix established causes within the affected flows and report external/unreproduced limits plainly.
- [x] Build after integration, run the changed-flow browser checks, then request a fresh `fork_turns=none` reviewer with requirements and baseline only. No actionable findings in the independent focused review; evidence recorded in `docs/reports/parity-fix-verification.json`.

## Review focus

- Name-only edits must preserve every existing avatar appearance field, including gaze.
- Refresh must not discard an unsaved transform, apply a stale route response, or repeatedly reconnect an unchanged scene.
- Null/optional parents must never join a fabricated valid room.
- Hidden/occluded walls must not receive pointer input.
- The dialog must retain keyboard close/focus behavior, visible Apply/Cancel, and usable mobile controls.
