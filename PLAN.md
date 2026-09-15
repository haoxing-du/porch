# Execution plan

Authority: SPEC.md. The old design handoff does not apply.

## Milestones

- [ ] 1. Persistent human chat: GitHub sign-in, invites, membership, channels/topics, realtime, mentions, unread state, Markdown, attachments, responsive browser UI.
- [ ] 2. Real local Codex loop: pinned app-server adapter; create, resume, stream, interrupt; verify reply/wait/silent and a real project edit with two users.
- [ ] 3. Participation and recovery: one eligible projection, durable dispatches, cursor acknowledgment, stop/dismiss/fresh fences, local folder serialization, offline/reconnect reconciliation.
- [ ] 4. Mac companion: secure pairing, local credentials, project/executable pickers, setup and recovery, menu-bar controls, installable build.
- [ ] 5. Handoff: migrations, reproducible setup, deployment and packaging instructions, acceptance evidence and limitations.

## Working method

Write a failing behavior test, implement the behavior, then run the test. Commit and push coherent steps to main. Record evidence and remaining requirements here. Stop and ask Beat when a decision is uncertain.

## External setup and known limits

- GitHub OAuth registration and deployment credentials must be supplied for a hosted pilot. Development sign-in must remain local-only.
- Apple signing/notarization credentials are needed for public companion distribution. Record unsigned local build status separately.
- Do not claim the MVP is complete until the real Codex and Mac installation gates pass.

## Evidence

- Repository started from existing remote main (README and license).
- Local PostgreSQL 16.9 is running; local Codex CLI reports 0.153.1.
