# Porch

A web chat app for friends who build with coding agents. Workspaces contain channels and named topics. Mention an owner’s bot to invite it; it follows until dismissed. Codex runs on a paired Mac.

`SPEC.md` is the product authority. The previous design handoff does not apply.

## Current status

Human chat and the real Codex loop work locally. The automated checks cover privacy, persistence, access control, session transitions, retries, and folder serialization. A real two-browser check created and changed a file through the same Codex thread; reply, waiting, and silent outcomes passed. See [test evidence](docs/real-codex-evidence.json).

The Mac companion produces an **unsigned Apple Silicon DMG and ZIP**. Public distribution still needs Apple signing/notarization. See [remaining verification and external setup](docs/limitations.md). Do not treat a development build as a finished public onboarding flow.

## Run locally

Use Node **22.12+**, npm, and PostgreSQL **16+**. No Redis is required.

```sh
npm ci
createdb porch
cp .env.example .env
npm run migrate
npm run dev
```

Open [localhost:5173](http://localhost:5173). Use **Continue as Alex** and **Continue as Sam** in separate browser profiles. Create a workspace, invite the second account, then open a topic. Use `/nb` or the **Humans only** switch for messages that must stay out of agent context.

If PostgreSQL uses a different role or password, set `DATABASE_URL` in `.env`. Local authentication is restricted to loopback and non-production mode. The app refuses to expose the development bypass on a deployed service.

## Connect this Mac

```sh
npm run companion
```

In the web app, open **Workspace settings → Create pairing code**. Enter the service address and code in the companion. Choose a project folder, then connect. Create your bot in web settings and confirm the workspace trust statement. Mention it using the composer’s suggestions.

The companion checks Codex **0.153.1**, its sign-in, and the selected folder. It can install the pinned official release with an integrity check, use a detected installation, or let you select an executable. It uses the available configured model. Host credentials are stored in macOS Keychain. Codex credentials remain in Codex’s local storage.

[Companion setup and packaging](docs/companion.md) · [Deployment](docs/deployment.md) · [Pilot checklist](docs/pilot.md) · [Architecture](docs/architecture.md)

## Check the code

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run companion:build
```

Service tests create and remove isolated schemas. `TEST_DATABASE_URL` defaults to `postgres://localhost/postgres`; the test role must be allowed to create schemas. Browser tests use the local development database and make test workspaces.

To repeat the real provider check, sign into the pinned Codex runtime and run:

```sh
npm run build
CODEX_EXECUTABLE=/path/to/codex node --import tsx scripts/real-codex.ts
```

This uses your Codex account to make small changes in a temporary repository. It never edits the Porch repository. It removes the temporary project and service test schema afterward. Provider-side thread history stays in Codex’s local history.

## Build the Mac installer

```sh
npm run companion:package
```

Outputs are in `release/`. Signing is automatic when a valid Developer ID identity and notarization credentials are configured. Without them, the output is an unsigned local test artifact.

## Repository

- `apps/web`: React chat client.
- `apps/server`: Fastify service, PostgreSQL migrations, realtime and scheduling.
- `apps/companion`: Electron menu-bar application and durable local runtime.
- `packages/contracts`: validated versioned protocol and eligible-context projection.
- `packages/codex-adapter`: isolated stdio adapter and generated pinned schemas.
- `packages/test-support`: isolated PostgreSQL/app fixtures.
- `docs`: setup, evidence, pilot gates, and remaining work.
