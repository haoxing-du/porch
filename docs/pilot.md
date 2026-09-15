# Pilot walkthrough and completion gates

## Prepare

- [ ] Register GitHub OAuth and deploy the app on HTTPS with development sign-in disabled.
- [ ] Provide persistent PostgreSQL and attachments; verify backup/restore.
- [ ] Publish the signed/notarized Mac build, or label a controlled local test as unsigned.
- [ ] Follow `docs/companion.md` on an unlocked Mac. Pair, select a real disposable Git folder, and connect without a terminal.
- [ ] Create one enabled bot and confirm the workspace trust statement.

## Two people build together

1. Alex creates a workspace and sends an invitation link to Sam.
2. Sam signs in and joins from another browser session.
3. Create `#weekend-builds` and a topic named **Recipe app**.
4. Alex selects the bot from mention suggestions and asks it to create a small file.
5. Confirm the file exists in the owner’s selected folder and a bot reply appears in the topic.
6. Sam asks for a change without another mention. Confirm the same Codex thread performs it.
7. Close Alex’s chat tab. Confirm the companion and conversation continue.
8. Open another topic with the same bot. Confirm it has a different Codex thread.

## Privacy and recovery

- [ ] Send `/nb` and `/nobots` messages with unique canary text and attachments. Confirm they stay out of first-invite, follow-up, reinvite, fresh, reconnect payloads and agent grants.
- [ ] Confirm `/nbfoo`, a prefix in a code block, and a prefix in the middle of a sentence remain ordinary text.
- [ ] Save a human-only draft, switch topics, and reload. Confirm its visibility stays human-only.
- [ ] Stop a running task. Confirm it says stopping until the host acknowledges.
- [ ] Dismiss, discuss the project, then reinvite. Confirm the same thread resumes and intervening discussion is background.
- [ ] Start fresh. Confirm new generation/thread, retained chat, unchanged files, and no automatic replay.
- [ ] Select another registered project with a fresh session. Reject an arbitrary browser-supplied path.
- [ ] Queue two topics for one folder, including a symlink alias. Confirm serial execution. Check that a different folder can run independently.
- [ ] Disconnect during work. Send a new message offline, reconnect, and confirm it requires explicit retry.
- [ ] Drop a send response and refresh. Confirm one human message.
- [ ] Replay completion events and confirm one bot reply.
- [ ] Revoke a host and remove a member. Confirm immediate access denial and cancellation of that owner’s work.
- [ ] Test missing Codex, expired sign-in, unsupported runtime, moved folder, and missing local thread. Each must show a specific next step.

## Evidence already recorded

`docs/real-codex-evidence.json` records the real two-browser, real-file, same-thread, reply/wait/silent check. `docs/installer-evidence.json` records the official runtime download and Keychain check. Automated tests cover service, privacy, ordering, authorization, recovery, Unicode transport, draft visibility, and browser reconnection behavior.

The native-picker and distribution gates remain open until their actual environment checks pass. Record the machine, app signing status, account mode, version, date, and result; never replace these gates with a fake adapter demonstration.
