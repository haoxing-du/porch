# Execution plan

Authority: SPEC.md. The old design handoff does not apply.

## Milestones

- [x] 1. Persistent human chat: GitHub sign-in, invites, membership, channels/topics, realtime, mentions, unread state, Markdown, attachments, responsive browser UI.
- [x] 2. Real local Codex loop: pinned app-server adapter; create, resume, stream, interrupt; verify reply/wait/silent and a real project edit with two users.
- [x] 3. Participation and recovery: one eligible projection, durable dispatches, cursor acknowledgment, stop/dismiss/fresh fences, local folder serialization, offline/reconnect reconciliation.
- [ ] 4. Mac companion: secure pairing, local credentials, project/executable pickers, setup and recovery, menu-bar controls, installable build.
- [x] 5. Handoff: migrations, reproducible setup, deployment and packaging instructions, acceptance evidence and limitations.

## Working method

Write a failing behavior test, implement the behavior, then run the test. Commit and push coherent steps to main. Record evidence and remaining requirements here. Stop and ask Beat when a decision is uncertain.

## External setup and known limits

- GitHub OAuth registration and deployment credentials must be supplied for a hosted pilot. Development sign-in must remain local-only.
- Apple signing/notarization credentials are needed for public companion distribution. Record unsigned local build status separately.
- Do not claim the MVP is complete until the real Codex and Mac installation gates pass.

## Evidence

- Repository started from existing remote main (README and license).
- Local PostgreSQL 16.9 is running; local Codex CLI reports 0.153.1.

### Human-chat checkpoint

- 15 tests pass against isolated PostgreSQL schemas: two-member invite flow, concurrent ordering, send retries, retained history after service restart, membership denial, human-only parsing/projection, monotonic read cursors, revoked invites and removed membership.
- Browser test passes with two separate contexts: live messages, human-only display, page reload, and 390 px topic navigation/send. Desktop and phone screenshots were inspected.
- Production web build passes. GitHub OAuth is implemented but the real provider callback still needs an OAuth app registration.
- Node 22.12+ is required. Updated vulnerable initial package selections; dependency audit reports zero vulnerabilities.

### Real Codex and recovery checkpoint

- Real check passed on 2026-09-15 with Codex 0.153.1, PostgreSQL, two Chromium browser contexts, outbound host WebSocket, and stdio app-server. Evidence: `docs/real-codex-evidence.json`.
- A mention created a real file in a disposable Git repository. A second user appended a line in the same Codex thread after the first browser closed. Reply, silent, and wait outcomes passed.
- The real human-only canary was absent from dispatch context and the host journal.
- Recovery tests cover stale output after fresh sessions, dismiss/reinvite continuity, explicit offline retry, deduplicated output, folder aliases, and corrupt journals.
- Fixed a contributing factor found during testing: a stop arriving before its dispatch had no acknowledgment. The host now persists a cancellation marker and acknowledges that no work started.

### Companion and browser hardening

- Built unsigned ARM64 DMG/ZIP. No valid Developer ID certificate is available; notarization is pending external credentials.
- Verified the official pinned Codex download, SHA-512 integrity, complete runtime resources, initialization, existing sign-in, and a real Mac Keychain credential round trip.
- Native companion UI launched with fresh settings, paired, and detected Codex. Folder selection is blocked by the locked Mac; an unlock request is pending. The test was stopped and its temporary data/credential removed.
- Added red/green fixes for UTF-8 split across stdio chunks, simultaneous settings saves, lost-response retries across refresh, old message links, and human-only draft visibility.
- Deployment, environment, packaging, pilot, limitations, and evidence documents are in docs/. External gates remain open as listed in docs/limitations.md.
