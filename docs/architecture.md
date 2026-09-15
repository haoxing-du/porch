# Architecture and invariants

Porch uses a single Node service and PostgreSQL. Browsers connect with session cookies. Each companion makes an outbound authenticated WebSocket connection. Codex app-server stays local on stdio.

## Message path

A transaction locks the topic, checks the client idempotency key, assigns its next sequence, saves the immutable message and structured mentions, finalizes its attachments, and records runnable requests. Realtime events contain IDs and categories; browsers fetch authorized history. A failed agent cannot roll back the human message.

Each topic bot binding has a generation and an epoch. A generation selects one Codex conversation and one registered project. Stop and dismiss increment the epoch; fresh also increments the generation. Incoming results are checked against both before publication. Stale results cannot become new chat messages or resume a canceled request.

## Human-only boundary

`/nb`, `/nobots`, and the composer toggle persist the same immutable flag. The service excludes flagged rows before loading agent-facing mentions or attachments. Every dispatch goes through `projectContext`, which filters again and provides bounded, attributed request/background messages. Agent attachment grants independently check the message flag, topic, session generation, run epoch, and bot/host availability.

The companion has a host credential, not a user cookie. It cannot read unfiltered chat. It records only filtered dispatches and allowlisted events. It does not forward Codex reasoning, authentication data, raw protocol responses, or command output. Activity shows safe event categories. A human can still copy a human-only message into ordinary text; this boundary does not claim to prevent that.

## Delivery and recovery

The service stores the dispatch ID, request mapping, and eligible context before sending. The host records that dispatch and exact thread before acknowledging acceptance. Only this acknowledgment advances the context cursor. The host records the turn ID before reporting working state, and persists events before sending them. Event IDs and run/item IDs deduplicate replayed transport messages.

The host uses an atomic, synced journal. Invalid or partial journal content blocks work. Local work is serialized by the folder’s canonical filesystem identity (`device + inode`), so symlink aliases cannot bypass the lock. Different folders can run in parallel.

A lost connection requests interruption and prevents new starts. Requests made offline stay as chat and need an explicit retry. A reconnect reads recorded Codex turn history; it publishes confirmed results, interrupts active work, or reports uncertainty. It never silently starts an unknown request again. Exact-once shell side effects across crashes are not promised.

## Authentication and trust

GitHub OAuth uses the maintained Fastify OAuth integration. The service stores opaque session token hashes. Invitations are random, expire after seven days, and can be revoked. Pairing challenges expire after five minutes and are single use. Host credential hashes are separate from user sessions; their plaintext is saved only in macOS Keychain.

Any workspace member may direct an enabled bot. Owners control pairing, registered folders, bot configuration, and enablement. The enablement form states that members can cause Codex to run commands with the Mac’s configured access. A registered folder is a working directory, not a security boundary.

## Operations

Run one service replica. Durable state is in PostgreSQL and the selected attachment store. Keep PostgreSQL and uploads in persistent volumes and back them up together. The service fails closed on invalid payloads, stale epochs, authorization errors, and scheduler failures. Use the read-only health endpoint for process/database health; monitor restarts and disk usage separately.
