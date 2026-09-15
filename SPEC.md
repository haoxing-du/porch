# Neozulip: usable MVP specification

Status: implementation handoff. “Neozulip” is a working name, not a branding decision.

## 1. Product and outcome

Build a web chat app for small, trusted groups of friends who make things together with coding agents. The first users can be a small group from the founder’s Surplus incubator batch. The product should be useful for ordinary conversation and for collaborating with an agent in the same topic.

The inspiration is Zulip’s channels and named topics, combined with the founder’s previous workflow of operating Claude Code bots and personal agent sessions through Zulip. Preserve the natural conversational interaction while removing the SSH, terminal-session management, manual listener setup, and unreliable chat integration.

**MVP success:** a user invites a friend, connects a local project, mentions a bot in a topic, and both people collaborate with that bot on a real code change. After initial setup, neither person opens a terminal to start, resume, or manage the bot’s session. They can leave and return to the topic without losing the conversation or silently starting over.

This is a pilot product for trusted groups, not an enterprise Slack migration project. Ship the complete small workflow before adding breadth.

## 2. Authority and implementation discretion

The decisions in section 3 are explicitly agreed product requirements. The concrete defaults elsewhere resolve remaining details so the implementing agent can proceed without another product questionnaire. Defaults can be adjusted for demonstrated implementation constraints, but preserve the agreed behavior and document meaningful changes.

Do not turn this handoff into an endless planning exercise. Build working software, test the actual chat-to-Codex path, and report any remaining external setup honestly. Do not call a mocked agent demonstration a completed MVP.

### 2.1 Explicitly deferred

- Claude Code and additional agent harnesses.
- Windows and Linux personal companion applications.
- A desktop chat client; the companion is not a second chat application.
- App-provided cloud coding machines, automated VM provisioning, and billing for compute.
- Cross-topic agent memory, vector databases, knowledge graphs, and bespoke memory summarizers.
- Embedded application previews, collaborative editors, terminal sharing, and remote desktop.
- Voice/video, DMs, private channels, federation, enterprise SSO, and enterprise permission matrices.
- Autonomous multi-agent orchestration and agents automatically delegating to other bots.
- Automatic GitHub PR creation, deployment, or other dedicated integrations beyond what Codex can already do in the configured project.
- Imports from Discord, Slack, or Zulip.
- Message editing/deletion, global search, and advanced notification preferences. Messages are immutable in this MVP; this also makes agent context delivery unambiguous.

## 3. Agreed product decisions

| Area | Requirement |
| --- | --- |
| First audience | Small groups of friends building things with agents; recruit the first pilot from Surplus if useful. |
| Main client | Web app. People can join through a link without installing software. |
| Conversation structure | Workspaces contain channels; channels contain named topics. |
| Agent invocation | Mention a bot, such as `@SHODAN`, as one would mention a human. |
| Shared bots | Run on a communal machine configured and maintained by a bot owner. |
| Personal bots | Run on a user’s own machine through a companion. |
| First harness | Codex only. Keep the adapter boundary clear for a later Claude Code implementation. |
| First personal host platform | macOS. |
| Conversation participation | An initial mention invites a bot into a topic. It follows subsequent conversation until explicitly dismissed. |
| Trust | Any workspace member in the topic can direct an invited bot, including a bot running on another person’s machine. Do not add per-person execution approvals. |
| Human-only messages | `/nb` and `/nobots` mark individual messages as excluded from all agent-facing context paths. |
| Continuity | Reinviting the same bot into the same topic resumes its previous session by default. A deliberate “Start fresh” action creates a new session. |
| Project selection | Each bot has a configured default project folder. A topic may select another project registered by that bot’s owner. |
| Agent visibility | Show whether a bot is working, waiting for input, following, unavailable, or offline. |

## 4. Core model

Keep these concepts distinct in both the implementation and the UI:

- **Workspace:** an invite-only group. All members can access every channel and topic in that workspace for the MVP.
- **Channel:** a broad subject or project area, such as `#general` or `#weekend-builds`.
- **Topic:** a named conversation inside a channel, such as “Build a recipe app.” It is a first-class destination with a stable URL, not a reply drawer attached to one message.
- **Bot:** a persistent, mentionable identity with a name, owner, host machine, and default project. SHODAN remains SHODAN across its separate sessions.
- **Host:** a paired machine running the companion and Codex.
- **Project:** an owner-registered local folder on a host. The server uses an opaque project ID and friendly label; resolving the filesystem path is the host’s responsibility.
- **Topic bot session:** one bot’s Codex conversation for a particular topic and session generation. A topic can have several bots; each has independent state.
- **Run:** one invocation/turn of Codex for a batch of incoming messages. Many runs can occur within one session.

### 4.1 Personal bot identity: implementation default

A personal bot belongs to a particular person and is visibly named accordingly, for example `@alex-codex`, with “Runs on Alex’s Mac” in its profile. Mentioning Alex’s bot always uses Alex’s configured host, including when Sam mentions it.

Do not implement a generic `@codex` identity that silently routes to different machines depending on who mentioned it. If Alex and Sam want their own agents in the same topic, they invite two separately identifiable bots.

Shared and personal are ownership/presentation distinctions, not two execution architectures. For the initial pilot, a communal machine can be an always-on Mac running the same companion. Supporting a Linux communal runner can follow later; do not make it a prerequisite for demonstrating shared bots.

## 5. Essential user journeys

### 5.1 Join and chat

1. The group creator signs in, creates a workspace, and receives an invitation link.
2. A friend opens the link, signs in, and joins the workspace in their browser.
3. They open a channel, create or select a topic, and send a message.
4. Other members see the message immediately and can respond in the same topic.
5. Unread state and stable topic links make it easy to return later.

Default authentication: GitHub OAuth, appropriate for the initial builder audience. Use a maintained authentication integration. Keep identity behind an interface so another sign-in provider can be added later. Provide development-only seeded accounts for automated/local tests; never enable that bypass in a deployed pilot.

### 5.2 Connect a personal bot

1. In web settings, choose “Connect my Mac.”
2. Download and open the companion.
3. Pair the companion with the signed-in account using a short-lived pairing flow.
4. The companion detects a usable Codex installation and checks whether it is signed in.
5. If needed, offer a guided Codex installation and its supported sign-in flow. The product goal is no required terminal commands for normal setup.
6. Select a local project with a native folder picker and give it a friendly label.
7. Choose a bot name, confirm enabling that bot for the trusted workspace, and finish.
8. The bot appears in mention suggestions with its availability.

Detecting installations in a GUI process requires more than reading the interactive shell PATH. Handle common installation locations and offer an explicit executable picker as a fallback. Do not assume everyone has the Codex desktop app installed.

Use the provider’s supported authentication path. Never copy authentication secrets into the chat service or promise that every account/subscription supports every integration mode. If sign-in or installation requires external configuration, show the specific next step rather than failing silently.

### 5.3 Set up a shared bot

1. An owner pairs a communal Mac and registers its project folder(s).
2. They create a shared bot, such as SHODAN, on that host.
3. Other workspace members can invite and direct SHODAN without installing a companion.
4. Its owner can change its configuration, stop it, or disconnect the host.

### 5.4 Build together

1. Alex opens `#weekend-builds` → “Recipe app.”
2. Alex sends `@SHODAN make a simple page for saving recipes`.
3. The topic shows SHODAN as starting, then working, with its selected project visible.
4. SHODAN runs Codex on its configured machine and posts user-facing progress/results.
5. Sam says “Use a dark background and make the recipe cards smaller.” No new mention is required while SHODAN is following.
6. SHODAN incorporates that message in the ongoing session.
7. Alex sends `/nb I think Sam is going to redesign this three more times`. Humans see it; agents do not receive it.
8. A member dismisses SHODAN. It stops following the topic.
9. Later, someone mentions SHODAN again. It resumes the same session unless they explicitly choose “Start fresh.”

## 6. Web chat requirements

### 6.1 Layout and navigation

- Desktop: workspace/channel navigation, a visible topic list for the selected channel, and the selected topic’s conversation.
- Topic header: topic title, channel, participating bots with compact status, and a discoverable bot/project control.
- Narrow screens: collapse navigation into panels without losing access to topics. Responsive chat is required; companion setup remains a Mac workflow.
- Preserve browser back/forward behavior and deep links to topics/messages.
- Show a useful empty state that offers creating a channel/topic or connecting/inviting a bot.

Use a readable, polished interface with clear grouping and comfortable spacing. Topics should be easy to discover, create, and switch between. Human conversation remains the main surface; agent activity must not turn the timeline into a wall of terminal output.

### 6.2 Messages and composition

- Plain text and a safe Markdown subset: paragraphs, lists, links, inline code, and code blocks.
- Named human and bot mentions with autocomplete and structured identity IDs. Display names are not routing identifiers.
- Enter sends; Shift+Enter inserts a newline. Preserve unfinished drafts per topic locally.
- Show author, timestamp, delivery state, and a clear bot identity marker.
- Default message text limit: 8,000 characters, configurable server-side. Show the limit before send and validate it on the service. This keeps a single triggering message within the initial agent-context budget.
- Optimistic human sends use a client-generated idempotency key; retries cannot create duplicate messages.
- Paginate history and restore sensible scroll position. Do not yank the user to the bottom while they are reading older messages.
- Show a new-message indicator when appropriate.
- Basic image and file attachments, including upload progress, preview for supported images, download links, and recoverable upload failures. Default maximum: 20 MB per file, configurable server-side.
- Do not execute uploaded HTML/SVG or render arbitrary untrusted HTML in the chat origin.

### 6.3 Channels, topics, and unread state

- Members can create and rename channels/topics.
- All messages belong to a topic. The composer should not send a topicless channel message.
- Creating a topic asks for a short title, without mandatory extra metadata.
- Topic lists show recent activity and unread state; channels aggregate unread indicators.
- Persist a per-user read cursor. Reading in another browser should eventually clear the same unread state.
- Distinguish human mentions from general unread messages.
- Native desktop notifications, push notifications, and email digests are optional follow-up work, not MVP completion requirements.

### 6.4 Membership

- Invite links are unguessable and revocable; use an expiry by default.
- Workspace creator can issue/revoke invites and remove a member.
- Require workspace membership for every history, attachment, mutation, and realtime subscription request.
- Removing a member revokes their workspace access and disables their bots in that workspace. Other workspace bots and their owners are unaffected.
- Bot configuration is owner-controlled. This is separate from the agreed rule that any member can converse with and direct an available bot.

## 7. Agent participation and lifecycle

### 7.1 Invite and follow

- A structured mention of a bot in a normal human message invites that bot into the topic.
- If there is no session, resolve the project and create one. If a session exists and was dismissed, resume it.
- While following, subsequent eligible human messages in that topic are candidates for delivery without another mention.
- Following does not imply replying to every message. The agent may decide no response or action is warranted.
- Other bots’ messages do not automatically trigger runs. They may be included as context on the next human-triggered run, subject to the same topic/history restrictions. This prevents bot-to-bot loops.
- Renaming a bot/topic does not create a new session.
- Being offline does not itself dismiss the bot.

### 7.2 Initial history and catch-up

- First invitation: include the channel/topic names and up to the most recent 50 eligible topic messages, with a configurable total text cap of 24,000 characters. Always include the triggering message. Trim older content first and explicitly indicate that older history was omitted.
- Further turns: send only newly eligible context since the acknowledged cursor, including author names, message IDs, timestamps, and structured mentions. Do not repeatedly send the entire topic.
- Reinvitation: include eligible messages since the last cursor, including discussion while the bot was dismissed, within the same bounded context policy. These older messages are background, not instructions that all need retrospective execution. The new mention is the current request.
- If a catch-up exceeds the cap, send the bounded recent window with an omission notice. Never pretend omitted context was supplied.
- The triggering message must appear exactly once even if it also falls within a history window.
- Each bot tracks its own delivery cursor and session generation.

### 7.3 Follow-up scheduling

- Debounce eligible human messages for approximately 750 ms so a burst becomes one ordered input batch.
- An explicit mention can schedule immediately when no run is active.
- Default concurrency: one active run per topic bot session, and one active run per registered project folder on a host across all bots/topics.
- While a run is active, queue new messages durably and show that follow-ups are queued. Deliver them in order after the current run completes. Mid-turn steering can be added only if reliably supported by the pinned Codex adapter; it is not required for the MVP.
- Project-level serialization prevents two app-managed sessions from editing the same folder simultaneously. External editors and unrelated terminal sessions are outside this lock.
- Key the local project lock by canonical folder identity, not just a server-side project ID, so registering the same folder twice cannot bypass serialization.
- Do not hold a project lock while an agent is merely following or waiting for a human reply.
- Idle following has no polling LLM loop. A new eligible human message is the event that may start a turn.

### 7.4 Actions and exact semantics

| Action | Allowed actor | Effect |
| --- | --- | --- |
| Mention/invite | Any workspace member | Join or resume the bot in the topic. |
| Stop current work | Any workspace member | Request interruption, clear pending runnable requests for this session, retain its history, and keep it following future messages. The initiating actor is visible. |
| Dismiss from topic | Any workspace member | Mark it dismissed, cancel pending requests, and request interruption of current work. Retain the session for later resumption. |
| Start fresh | Any workspace member | If work is active, explain it will be stopped. After confirmation, create a new session generation for this topic bot using the selected project. Keep the chat history visible. |
| Change topic project | Any workspace member | Select from the bot’s owner-registered projects. Require a fresh session; do not silently move the old session to a different folder. |
| Configure/disable bot or disconnect machine | Bot/host owner | Change ownership-level configuration or halt availability. |

For “Start fresh,” start without the old Codex session or automatically replaying the whole topic. Show a local topic marker, “SHODAN started a fresh session.” The next eligible message supplies the new request; subsequent input is collected after that marker. This action does not delete or reset project files, installed dependencies, or project instructions.

Dismissal should be a discoverable topic control, not dependent on an LLM interpreting “go away.” Natural-language dismissal commands may be added later. Acknowledge interruption only after the host confirms it; while offline, display that stopping is pending rather than claiming a remote process has stopped.

### 7.5 Observable state

Represent connection state, participation state, and run state separately internally. Compose them into understandable UI labels:

| Display | Meaning |
| --- | --- |
| Offline | The host is not connected; no new work can start. |
| Needs setup | Codex, its sign-in, or the selected project needs attention. |
| Following | Invited, connected, and idle; eligible follow-ups will be received. |
| Queued | Accepted work awaits the host or another run on the project. |
| Starting | Creating/resuming the Codex session. |
| Working | Codex has an active run. |
| Waiting for you | The agent asked a question and awaits an eligible human reply. |
| Stopping | Interruption requested, not yet confirmed. |
| Dismissed | No longer following; can be reinvited. |
| Error | A specific run or session operation failed, with a recovery action. |

The bot profile can summarize host availability; a single global “working” bit is insufficient for a bot present in several topics. Topic status belongs to its session.

## 8. Human-only messages: `/nb` and `/nobots`

This is a core behavioral requirement, enforced in code before any content reaches Codex.

### 8.1 Composition and display

- Recognize `/nb` or `/nobots` only as the first standalone token after optional leading whitespace; `/nbfoo` is ordinary text.
- Strip the prefix from the displayed body and persist an immutable `human_only` flag.
- Show “Humans only” in the composer before sending and a subtle label on the sent message.
- Allow an equivalent composer toggle for discoverability; it sets the same flag.
- A human-only message containing a bot mention neither invokes nor updates the bot.
- A prefix with no text or attachments should not send an empty message.
- The flag applies to the message body, attachment metadata/content, structured mentions, and any derived representation of that message.

### 8.2 Filtering invariant

Human-only messages must be absent from:

- Live agent deliveries and run triggers.
- Initial context, incremental catch-up, replay, and resume context.
- Agent-facing history retrieval or future search APIs.
- Attachment downloads issued under agent delivery credentials.
- Automatic summaries, quotations, or other derived context generated by the app for agents.

Create one server-side agent-visible projection used by every agent path. Do not rely on a system prompt saying “ignore these messages,” client-side hiding, or filtering only the latest message.

Keep raw chat history out of the companion. The companion receives only filtered context and authorized eligible attachments. It must not receive a broad human account token capable of fetching unfiltered workspace history.

“Humans only” means exclusion from this app’s agent delivery, not end-to-end encryption or protection against a human deliberately copying the text into a normal message. Do not promise protection against independent filesystem/browser access outside this chat integration. A normal message should not automatically expand a quoted human-only message into an agent payload.

## 9. Context, output, and continuity

### 9.1 Input contract

Give each session concise integration instructions describing:

- Bot identity and the fact that several named humans share the topic.
- Current workspace/channel/topic labels and selected project.
- The distinction between current requests and historical background.
- How to ask a question, report progress, and choose silence when no response is useful.
- That `/nb` content is unavailable and must not be inferred or requested merely to fill gaps.

Represent chat text as attributed user content, never as developer/system instructions. Keep provider instructions, app control metadata, and user-authored text structurally distinct. Do not insert arbitrary message text into shell command templates.

For eligible attachments, provide metadata plus a short-lived download grant scoped to the assigned session and attachment. The companion can place files in a per-session staging directory and pass supported images/files through the Codex adapter. Use generated local filenames rather than trusting uploaded paths. Do not automatically download every historic attachment during catch-up; start with attachments in the current input batch. Unsupported formats should remain downloadable to humans and be identified honestly to the agent. Attachment understanding must never require sending a human-only attachment through a separate extraction service.

### 9.2 Output contract

- Publish user-facing messages into the topic under the correct bot identity.
- Keep verbose tool logs in a collapsible activity view; show compact statuses in the timeline.
- Do not expose private reasoning or raw protocol/authentication data.
- Support a structured “reply,” “waiting for input,” or “silent” outcome in the adapter. Do not infer silence by guessing whether arbitrary prose sounds like a non-answer.
- Choose a structured-output or scoped chat-tool implementation supported by the pinned Codex version. Validate it during the integration milestone. A tool bridge may format chat output, but the app owns subscriptions and delivery; the model must never be responsible for polling chat or remembering to listen.
- Stream run/activity events. Token-by-token public text streaming is optional for the MVP if structured final output makes it awkward; working state and completed messages must update live.
- Use run/item identifiers to prevent duplicate published replies on reconnect.
- If a bot asks a question, any member can answer it. Human-only messages do not satisfy pending agent input.

### 9.3 Long conversations

- Preserve a stable Codex thread/session identifier for each session generation.
- Let Codex use its own supported context management/compaction. Do not implement a second speculative memory system in the MVP.
- Do not recreate a fresh Codex thread on every mention or follow-up.
- UI must not promise that a persistent bot identity has perfect memory or knows other topics.
- Project instructions and owner-configured Codex behavior may still affect a new session; starting fresh resets this app’s conversation session, not the contents of the machine.
- If the stored Codex session is missing or cannot resume, show the error and offer an explicit fresh session. Never silently replace it and claim continuity.

## 10. Companion and host behavior

### 10.1 Form factor

A small macOS menu-bar application that manages the local connection. It needs only pairing/setup, project registration, status, diagnostics, start-at-login preference, and stop/disconnect controls. All conversation happens in the browser.

Target a one-time setup of a few minutes when Codex is already installed and signed in. This is a usability target, not a guaranteed installation duration. Use native folder selection and browser-based sign-in.

The same application can serve an always-on communal Mac. The app does not provision that machine for the user.

### 10.2 Connection topology

```text
Browser(s) <--- authenticated HTTPS / realtime ---> Chat service
                                                       ^
                                                       |
                                          outbound authenticated WSS
                                                       |
                                                Mac companion
                                                       |
                                             local stdio transport
                                                       |
                                              Codex app-server
                                                       |
                                                local project
```

- The companion initiates an outbound authenticated connection to the chat service.
- No user-configured SSH tunnel, port forwarding, public listener, or local browser-to-daemon CORS setup is required.
- Keep Codex app-server local using stdio. Do not expose the raw Codex server to the internet or use it as the app’s public relay.
- Closing the browser does not stop the companion or an active agent.
- Sleeping/shutting down the Mac makes it unavailable. Show this honestly in the browser.

### 10.3 Pairing and credentials

- Issue a short-lived, single-use pairing challenge, bound to the initiating account and workspace.
- Complete pairing through a browser flow or device-code confirmation that identifies the machine. Rate-limit attempts and reject replay/expired challenges.
- Store the resulting host credential in macOS Keychain. It identifies a host and its assigned bots; it is not a general workspace-user credential.
- Keep Codex provider credentials in Codex’s supported local storage.
- The server stores a verifier/hash for opaque host credentials rather than logging their plaintext. Support revocation.
- Disconnect/revoke prevents new deliveries immediately and instructs a connected companion to interrupt active app-managed runs.

### 10.4 Project configuration

- Owners register projects using a folder picker on the host.
- Persist the canonical local path on the host and sync only its ID/label/availability needed by the web app.
- Each bot has a default project and an explicit set of owner-registered projects that topics may select.
- Topic overrides are per bot, not one shared filesystem path for every bot in the topic.
- Browser requests cannot supply arbitrary working-directory paths or executables.
- Missing/moved folders produce a “Project unavailable” state and an owner repair action.
- If a bot is reconfigured to a different host, old sessions remain tied to their old host; migration is out of scope. Offer a fresh session on the new host rather than claiming transparent resumption.

### 10.5 Trusted execution model

Honor the user’s requested social trust model: workspace members can direct one another’s enabled bots without per-command or per-person approval prompts.

During bot enablement, plainly state that workspace members can cause Codex to run commands using that host’s configured execution access. Provide stop/disable controls. This is a one-time ownership decision, not a recurring approval workflow.

Configure execution policy explicitly for app-managed Codex sessions to match this trusted-group behavior, using supported options in the pinned version. Do not rewrite the user’s global Codex configuration. If provider/managed policy disallows the required execution mode, report that constraint rather than silently weakening it or repeatedly hanging on invisible approval requests.

Registering a project chooses the working directory; it is not a promise that full-access Codex is sandboxed to that folder. Do not describe it as such. The companion itself must still validate host/bot/project bindings and refuse arbitrary relay control commands.

### 10.6 Lifecycle and reconnects

- Provide a clear start-at-login setting; recommend it during setup.
- Heartbeat approximately every 15 seconds; mark the host offline after approximately 45 seconds without a heartbeat. Make these tunable.
- Reconnect with exponential backoff and jitter; do not duplicate sessions or work.
- Host records dispatch acknowledgments and run/session IDs durably so a reconnect can reconcile in-flight work.
- When relay connectivity is lost, request interruption of app-managed active runs and stop starting new ones. Buffer any final events locally. Interruption is best-effort; do not promise rollback of already executed commands.
- A disconnected host cannot confirm a web-side stop. UI must distinguish “stop requested” from “stopped.”
- New work attempted while offline is saved as chat, marked “not sent to agent,” and requires an explicit retry after reconnect. Do not unexpectedly execute a backlog of old requests when a laptop wakes.
- On reconciliation, acknowledge previously accepted/running work, preserve completed output, and require explicit retry for interrupted/uncertain work. Follow-ups accumulated during an interruption do not silently auto-run.
- A new explicit request can include offline-period discussion as bounded background context, without replaying every old request as a separate command.

## 11. Suggested implementation architecture

These are implementation defaults, not new product requirements. Prefer an ordinary, maintainable stack over adding services for hypothetical scale.

- TypeScript throughout the web client, service, shared contracts, and companion integration.
- React web client with accessible components and responsive layouts.
- A Node.js service with HTTP endpoints and authenticated realtime connections; Fastify is a reasonable default.
- PostgreSQL for users, membership, chat history, read cursors, bot/session state, delivery records, and a transactional outbox/job queue.
- S3-compatible object storage for attachments, with a local development equivalent.
- An Electron menu-bar companion is a reasonable MVP default to reuse the TypeScript Codex adapter and bundle its runtime. Keep its renderer isolated, with narrowly exposed IPC and no arbitrary remote code loading.
- One service instance is sufficient for the pilot. Do not require Redis, Kubernetes, a vector database, or multiple backend microservices.
- Provide a shared versioned protocol package with runtime validation, not only compile-time TypeScript types.
- Use migrations and a repeatable local setup. Keep deployment-specific credentials out of source control.

Suggested repository shape:

```text
apps/web/                  browser client
apps/server/               HTTP, realtime, persistence, agent scheduling
apps/companion/            macOS UI, pairing, local runtime management
packages/contracts/       app protocol and validated schemas
packages/codex-adapter/    versioned Codex integration
packages/test-support/     deterministic fake host/adapter for tests
docs/                     setup, deployment, and pilot checklist
```

The browser and companion should depend on the app’s protocol rather than directly exposing Codex protocol details throughout the UI. Do not implement a generic plugin framework just to support one harness.

## 12. Persistence and protocol contracts

### 12.1 Minimum persisted entities

| Entity | Essential fields / constraints |
| --- | --- |
| User | ID, auth identity, display name, avatar. |
| Workspace | ID, name, creator. |
| Membership | Workspace/user unique pair, role for owner/member administration. |
| Invite | Workspace, token hash, expiry, revoked timestamp. |
| Channel | Workspace, name, stable ID. |
| Topic | Channel, title, stable ID, activity timestamp. |
| Message | Topic, topic-local ordered sequence, author type/ID, body, human-only flag, client idempotency key, creation time. |
| Mention | Message ID, target type and stable ID. |
| Attachment | Message ID, object key, filename, media type, size; visibility inherited from message. |
| Read cursor | User/topic unique pair, last-read sequence. |
| Host | Owner/workspace, friendly name, credential verifier, version, last-seen, revoked state. |
| Project | Host, opaque local project ID, label, availability. Local canonical path stays on host. |
| Bot | Workspace, owner, name/handle, shared/personal, host, default project, enabled state. |
| Bot project | Bot/project unique pair for selectable projects. |
| Topic bot binding | Topic/bot unique pair, project override, participation state, current generation. |
| Agent session | Binding, generation, host/project snapshot, Codex thread ID, eligible-context cursor, lifecycle state. |
| Run | Session, dispatch ID, trigger/batch references, Codex turn ID, status, timestamps, error/recovery metadata. |
| Outbox/event | Stable event ID, type, payload/reference, delivery status; support replay and deduplication. |

Store chat history separately from private runtime/protocol logs. Do not place provider authentication material or private reasoning in ordinary message/activity records.

### 12.2 Ordering and idempotency

- Assign server-authoritative per-topic message ordering in a transaction. Timestamps alone do not establish order.
- Persist a human message and its scheduling/outbox intent atomically.
- A delivery has a stable dispatch ID and explicit acknowledgment. Retrying transport delivery must not start a second run.
- Advance an agent’s delivery cursor only after the intended context batch is accepted and its mapping is durable.
- Record failed/canceled batches explicitly; do not mistake them for successfully executed requests.
- Context collected after a stop may include canceled messages as labeled background, but must not requeue them as pending tasks. Separate context inclusion from runnable-request state.
- Identify bot output by session/run/item IDs. Replayed events cannot duplicate visible messages.
- Treat execution as an at-least-once transport problem with deduplication and reconciliation; do not claim exactly-once shell side effects across crashes.
- If acceptance is uncertain, query/reconcile recorded Codex state before retrying. If certainty cannot be recovered, ask for an explicit retry in the UI.
- Dismissal, stop, and fresh-session transitions fence older dispatches using a generation/epoch. A stale delivery or late event cannot revive an old run or attach its output to a fresh session.

### 12.3 Application-level operations

The exact URL names can vary. Implement these operations with server-side authorization and validated payloads:

- Authentication/session and workspace create/join/invite/revoke/remove-member.
- Channel/topic list/create/rename, paginated messages, send message, update read cursor.
- Attachment upload/finalize/download.
- Pair host, report status, revoke host, register/update project.
- Create/configure/disable bot; list mentionable bots and selectable projects.
- Invite/resume, stop, dismiss, start fresh, and change a topic bot’s project.
- Realtime message/state/read-cursor changes with reconnect/resume support.
- Host command delivery/acknowledgment, run events, output publication, and reconciliation.

An agent payload contains only the eligible projection for its assigned topic/session/project. It does not carry a privileged user session or raw database access.

## 13. Codex integration requirements

Use Codex app-server behind the local adapter, preferably over stdio. Official OpenAI documentation describes app-server as the integration surface for custom clients needing authentication, history, and streamed agent events. The local command/protocol has experimental aspects, so pin a tested Codex version and isolate this dependency.

Required capabilities to verify against that pinned version:

- Initialization handshake and capability negotiation.
- Read/check authentication status and initiate a supported local sign-in flow.
- Create a thread with the selected working directory and explicit execution policy.
- Resume the exact recorded thread.
- Start a turn and receive lifecycle, user-facing output, and activity events.
- Interrupt a turn and distinguish completed, failed, and interrupted outcomes.
- Reconcile a thread/turn after a companion reconnect or restart.
- Obtain a structured reply/wait/silent outcome using a verified mechanism.

Documented lifecycle methods include `initialize`, `thread/start`, `thread/resume`, `thread/read`, `turn/start`, and `turn/interrupt`; `turn/steer` is available for supported active-turn steering. Do not hard-code request shapes from memory: generate/use the schema matching the tested runtime and maintain fixtures for the adapter.

Use the user’s configured/default available model initially. Avoid a hard-coded model name or a new model-settings UI. Incompatible runtime versions should produce a clear upgrade/setup state, not an obscure protocol error in chat.

Do not screen-scrape terminal output, launch an interactive terminal and type into it, or ask Codex to maintain a “listen on chat” loop. The service and companion own event delivery, lifecycle, and filtering.

References checked for this handoff:

- [Official OpenAI documentation: Codex app-server](https://learn.chatgpt.com/docs/app-server)
- [Official OpenAI documentation: Codex SDK and local session control](https://learn.chatgpt.com/docs/codex-sdk)

Recheck version-specific protocol details while building. This document specifies behavior, not a frozen vendor API schema.

## 14. Reliability, responsiveness, and practical limits

- Save chat independently of agent availability. A Codex error never makes a human message disappear.
- Show connected-client message delivery promptly; aim for under 500 ms in a normal local/pilot environment, excluding network extremes.
- Show an agent acknowledgment/queued/starting state within roughly one second after message persistence. Distinguish application dispatch latency from Codex/model latency.
- Bound websocket buffers, file sizes, context size, and scheduling queues. Report overload instead of silently dropping requests.
- Limit one active run per registered project as specified above. Multiple different projects may run independently.
- Make failures actionable: offline machine, expired sign-in, unsupported Codex version, missing folder, provider limit, crashed process, and uncertain dispatch each get a distinct reason and next action.
- Logs should correlate message → dispatch → session → run without including credentials or human-only content in agent diagnostics.
- Do not claim project changes are reversible merely because the conversation/session can be restarted.
- Publish completed code-work results as ordinary bot messages, with changed-file summaries when Codex supplies them. Local files remain on their host; live previews and automatic source sync are deferred.

## 15. Milestones and completion gates

### Milestone 1: working human chat

Deliver authentication, invites, channels/topics, realtime persistent messages, mentions, unread state, safe Markdown, and attachments. Two browser sessions must converse and retain history across refresh/restart.

### Milestone 2: one real local Codex loop

Build a minimal host/adapter and connect one registered project. A web mention must create a real Codex session, make a requested change in a test repository, and return a response. Another member’s follow-up must use the same session. Validate the supported reply/wait/silent mechanism here before designing the full activity UI around it.

### Milestone 3: correct participation and recovery

Implement follow/dismiss/resume/start-fresh, `/nb` filtering on every path, durable deliveries, project-level serialization, stop behavior, and offline/reconnect handling. Deterministic fake adapters are useful for edge-case tests but do not replace the real integration gate.

### Milestone 4: installable Mac companion and pilot polish

Package the companion; implement pairing, Codex detection/setup, project picker, menu-bar status, login-item preference, and recovery UI. Support shared and personal bot creation. Verify the main user journey on a Mac starting from the installation instructions.

Produce a pilot artifact and explain any signing/notarization requirement. A development build can be tested locally, but it does not satisfy frictionless public distribution; do not describe unsigned-install workarounds as the final intended onboarding.

### Milestone 5: handoff and deployment readiness

Provide migrations, environment-variable documentation, build/run commands, deployment instructions, companion packaging instructions, and a concise pilot checklist. If hosting credentials, OAuth registration, object storage, or Apple signing credentials are unavailable, prepare the deployable artifacts and list the exact external steps remaining. Do not invent successful deployment or real-device verification.

## 16. Acceptance tests

These are meaningful behavior checks, not a requirement to mirror every UI component with a unit test.

### 16.1 Human chat

1. Two users join the same workspace through an invitation and exchange messages in a named topic in real time.
2. Refreshing either browser and restarting the service retain channels, topics, ordered messages, attachments, and read state.
3. Retrying a send after a dropped response produces one visible message.
4. A user outside the workspace cannot read its messages/attachments, subscribe to its realtime events, or invoke its bots.
5. A narrow browser viewport still supports topic navigation, reading, and sending.

### 16.2 Real agent behavior

6. Mentioning a connected bot creates a Codex thread on the configured host/project and makes a real, verifiable change in a disposable repository.
7. A second member directs that bot without a per-person execution approval, and the follow-up reaches the same thread.
8. Closing the chat browser does not end the companion or active session.
9. The same bot in a second topic has a different Codex thread.
10. Two topics targeting the same registered project queue rather than run concurrently; different projects can proceed independently.
11. Dismiss stops following, interrupts active work when connected, and retains the session. Reinvitation resumes its recorded thread.
12. Start fresh creates a new generation/thread, leaves prior chat visible, and does not automatically replay old instructions or reset files.
13. A topic project override uses an owner-registered project and requires a fresh session. An arbitrary browser-supplied path is rejected.
14. An agent can stay silent after casual chatter without publishing a sentinel, empty message, or raw structured envelope.
15. Bot replies do not automatically trigger other bots into a loop.

### 16.3 Human-only boundary

16. Both `/nb` and `/nobots` produce a visible human-only message that is absent from captured adapter inputs.
17. A human-only bot mention neither invites the bot nor schedules work.
18. Human-only text and attachments remain absent on first invitation, follow-up, dismissal/reinvitation, fresh-session handling, reconnect, and any history retrieval.
19. Put a unique canary string in a human-only message and assert it never appears in agent payloads, attachment grants, derived summaries, or companion logs. Test the actual projection/delivery path rather than only the prefix parser.
20. `/nbfoo`, `/nb` inside a code block, and `/nb` in the middle of a normal sentence do not accidentally mark the message human-only.

### 16.4 Host reliability

21. Pairing tokens expire and cannot be replayed; a revoked host cannot receive new work.
22. Disconnect/sleep makes the bot visibly unavailable. Chat still works. Offline requests do not execute automatically on reconnect.
23. A reconnect after dispatch acknowledgment does not create a duplicate run or bot message. Uncertain execution is shown as uncertain and reconciled or explicitly retried.
24. Stop/dismiss/fresh-session transitions reject stale deliveries and do not attach late output to a new generation.
25. A missing local session produces an explicit recovery choice, not a silent fresh start.
26. Missing Codex, expired sign-in, incompatible version, and missing project each produce a usable repair path.
27. A fresh Mac companion launch can pair, select a folder, and connect using the documented setup flow; record which installation/signing conditions were actually tested.

## 17. Definition of done and handoff deliverables

The MVP is done when the core journey works with two people/browser sessions and real Codex, the human-only and recovery checks pass, and a Mac user can install/connect the companion through the documented flow.

Deliver:

1. Working source code for the web app, service, companion, and Codex adapter.
2. Database migrations and reproducible development fixtures.
3. Meaningful automated tests for delivery/filtering/state transitions, plus a recorded real-Codex integration check.
4. An installable Mac build with its distribution/signing status clearly stated.
5. Local setup and deployment documentation, required external configuration, and a pilot walkthrough.
6. A short limitations report distinguishing deferred scope from incomplete requirements.

Keep the final product centered on ordinary conversation with useful agents. The user should not have to understand daemon processes, RPC, session identifiers, or delivery queues to build something with a friend.
