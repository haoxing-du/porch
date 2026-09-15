# Remaining setup and verification

## Current completion boundary

The local human-chat and real Codex workflow is implemented and tested. This is a pilot build, not a completed public launch. The items below are still required before the specification’s complete install-and-invite journey can be signed off.

| Item | Status / next step |
| --- | --- |
| GitHub OAuth against the real provider | Code is implemented. Register an OAuth app, set its ID/secret and HTTPS callback, then test two real accounts. Local tests use the guarded development accounts. |
| Native Mac folder-picker selection | The fresh companion window launched, paired, detected Codex, and reported signed in. The native folder picker could not be operated because the Mac was locked. Unlock the Mac and repeat `scripts/check-companion.ts`; do not count a mocked picker as passing. |
| Separate fresh Mac onboarding | Not tested. Follow the pilot checklist on a second Mac. |
| Public Mac distribution | ARM64 DMG and ZIP build successfully. They are unsigned and not notarized; configure Developer ID signing and notarization, then verify Gatekeeper behavior. |
| Production deployment | Docker and Compose artifacts are prepared. The local Docker daemon was unavailable, so the container was not built or deployed here. |
| Production object storage | The S3 adapter is implemented. Local tests use private filesystem storage. Verify the chosen bucket and backup/restore procedure before launch. |
| Start at login across reboot | The native preference is implemented. An OS restart test remains. |
| Intel Mac | Source/installer detection supports x64. Only ARM64 packaging has been built here. |

## Scope intentionally deferred by the spec

Claude Code and other harnesses; Windows/Linux companions; a desktop chat client; hosted coding machines/billing; direct messages and private channels; voice/video; imports; global search; message edits/deletes; multi-agent orchestration; automatic PR/deploy integrations; cross-topic memory; live previews and source synchronization.

## Recorded follow-ups

- Add retention tools for expired tokens, unfinalized uploads, old realtime events, completed host journal entries, and staging files. Monitor disk usage meanwhile. Preserve records needed for replay and reconciliation.
- Split the main web component into smaller feature modules as the pilot grows.
- Measure message and dispatch latency on the deployed pilot; the sub-500 ms chat and roughly one-second acknowledgment targets have not been benchmarked over a public network.
- Tune heartbeat and debounce settings only after collecting pilot evidence. The current defaults are 15 seconds, 45 seconds, and 750 ms.

No claim is made about exactly-once shell side effects, rollback after interruption, perfect agent memory, or filesystem sandboxing to the registered folder.
