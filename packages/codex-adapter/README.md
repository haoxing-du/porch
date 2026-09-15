# Codex boundary

Pinned runtime: **codex-cli 0.153.1**. Request schemas were generated from that exact executable with `codex app-server generate-json-schema`. Only the operations Porch uses are checked in. AJV validates every outgoing operation. Incoming envelopes and published outcomes have runtime validation.

Reference: [official app-server documentation](https://learn.chatgpt.com/docs/app-server), checked 2026-09-15. The generated runtime schema takes precedence over examples in the documentation (notably sandbox enum spellings).

Transport: local stdio. No terminal screen scraping and no exposed app-server port. A thread uses the configured/default model. Porch sets an explicit per-thread execution policy and never edits global Codex configuration.

Public output comes only from validated `final_answer` JSON with `kind: reply | wait | silent`. Raw reasoning, protocol events, authentication material, command text, and tool output are never forwarded to the service. Activity is an allowlisted category. A missing session or ambiguous operation fails with a recovery action; it never creates a replacement thread automatically.
