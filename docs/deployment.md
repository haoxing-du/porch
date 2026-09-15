# Deployment

## Required external setup

1. Choose the public HTTPS origin and a host for one Node service.
2. Create a GitHub OAuth app. Set its homepage to the origin and callback to `https://YOUR_ORIGIN/api/auth/github/callback`.
3. Provision PostgreSQL 16+ and a persistent upload volume, or a private S3-compatible bucket.
4. Configure the environment below. Never use `DEV_AUTH=true` for a deployed pilot.
5. Build and start the service behind an HTTPS reverse proxy. Forward WebSocket upgrades on `/api/hosts/connect` and `/api/workspaces/*/events`.
6. Publish a signed/notarized Mac companion when signing credentials are available.

## Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string; required. |
| `NODE_ENV` | Set to `production` when deployed. |
| `APP_ORIGIN` | Exact public HTTPS origin. The browser and service share this origin. |
| `HOST` | `0.0.0.0` in the container; `127.0.0.1` for local development. |
| `PORT` | Service port; default `3001`. |
| `DEV_AUTH` | Must be `false` in deployment. Loopback development only. |
| `GITHUB_CLIENT_ID` | GitHub OAuth app ID. |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app secret. |
| `UPLOAD_DIR` | Persistent local attachment directory when S3 is unset. |
| `S3_BUCKET` | Optional private S3-compatible bucket. |
| `S3_ENDPOINT` | Optional endpoint for non-AWS S3 storage. |
| `AWS_REGION` | S3 region; defaults to `us-east-1`. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Storage credentials, or use the host’s supported AWS credential provider. |
| `MAX_FILE_BYTES` | Upload limit, 1 byte–100 MiB; default `20971520` (20 MiB). |
| `MAX_MESSAGE_CHARS` | Message text limit, 1–24000; default `8000`. Batches remain within the context cap. |
| `COMPANION_DOWNLOAD_PATH` | Optional local DMG path. Locally defaults to the built ARM64 artifact in `release/`. |
| `COMPANION_DOWNLOAD_URL` | Optional public HTTPS URL for a signed/notarized companion; overrides the local download link. |
| `POSTGRES_PASSWORD` | Database password used by the included Compose example. |

The service stores opaque upload object keys and keeps the bucket private. Both human and agent downloads go through authorization checks. No public object ACL is needed. File bytes are served as downloads; only recognized bitmap signatures may preview inline. HTML/SVG is never executed in the chat origin.

## Node deployment

```sh
npm ci
npm run build
npm run migrate
NODE_ENV=production DEV_AUTH=false npm start
```

Set the other required environment variables using the hosting platform’s secret store. The entry point also applies pending migrations in a transaction with a migration lock. Back up before upgrading. Database connection errors stop startup rather than creating an empty local database.

## Container deployment

`Dockerfile` builds the browser and installs only service runtime dependencies in the final image. `compose.yml` adds PostgreSQL and persistent uploads. Set the required environment variables, then:

```sh
docker compose up --build -d
```

The example binds the service to loopback. Put your HTTPS proxy in front. Set its upload limit to at least the app’s file limit and its WebSocket idle timeout above the 15-second host heartbeat. Use one service replica. The container build was prepared but could not be run in the implementation environment because its Docker daemon was not available.

## Pilot checks

- `GET /api/health` returns `200` only when PostgreSQL can answer.
- Create two GitHub users’ sessions; verify invite and membership removal.
- Check HTTPS cookie flags and reject requests from another origin.
- Reconnect a Mac after sleep and confirm that old requests require retry.
- Restart the service during a run and follow the uncertainty/reconciliation flow.
- Check database and object-store backups. Restore them in a separate environment before relying on them.

## Operations follow-ups

Record and plan retention for expired pairing codes, unused uploads, old realtime events, completed local journals, and attachment staging files. These are not automatically purged in this pilot build. Watch disk usage. Do not delete live dispatch records or restore the database independently from its attachment store without checking references.
