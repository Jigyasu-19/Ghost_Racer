# Ghost Racer

Ghost Racer is a browser-based, top-down racing game built around replayable
solo runs and small private multiplayer tournaments. Race on hand-designed
tracks, improve your personal best, challenge replay ghosts, or invite friends
to a live race with a short join code.

> **Project status:** Ghost Racer is an actively developed functional
> prototype. The core account, solo racing, replay, leaderboard, and tournament
> flows are implemented. Production use still depends on correctly configured
> MongoDB, Redis, and durable replay storage; multiplayer reconnect and
> real-network input handling also need further hardening.

## Example Usage Video

Add a Google Drive link to an example gameplay video here. Replace the sample
URL with your shared video URL and make sure its sharing permissions allow
viewers with the link to watch it.

[Watch the example usage video](https://drive.google.com/drive/folders/1bARIywNz_yDrF3JGOfMbZLAplGdbdn8U?usp=drive_link)

## What You Can Do

### Solo racing

- Learn the controls and checkpoint rules on the **Training Oval** tutorial.
- Choose from three tracks and three cars with different handling,
  acceleration, and speed characteristics.
- Race with keyboard controls: **W / Up** to accelerate, **S / Down** to
  brake or reverse, and **A / D / Left / Right** to steer.
- Drive through checkpoints in order and cross the finish line to complete a
  valid run. Driving off track slows the car.
- Race alone or choose a saved replay ghost for the same track and car.

### Personal bests and leaderboards

- The server re-simulates submitted input replays before accepting a result.
- Each player keeps one fastest verified personal best per track and car;
  slower runs do not replace it.
- View public top-10 times for a selected track and car.
- Race against a public replay using a neutral ghost appearance. Public solo
  leaderboard entries show player names and times without revealing the car
  used to set the time.

### Private tournaments

- Any signed-in player can host a private race for **2–6 players**.
- Invite players with a **4- or 5-digit join code**.
- Players select a car and ready up; the host starts the race manually once
  everyone has joined and is ready.
- Tournament movement and results are simulated and validated by the server.
- View tournament results on a separate podium with player names and cars.
  Tournament results do not affect solo leaderboards.

## Tracks and Cars

| Track | Description |
| --- | --- |
| Training Oval | First-race tutorial and controls practice |
| Harbor Sprint | A shorter technical course |
| Grand Prix Circuit | A longer course with additional checkpoints |

| Car | Character |
| --- | --- |
| Sprinter 01 | Quick acceleration and easy recovery |
| Cruiser 02 | High top speed; strongly penalized off track |
| Phantom 03 | Responsive handling and a lighter off-track penalty |

Track geometry, checkpoint order, and car statistics are versioned shared
content in `packages/content`.

## Technology

- **Frontend:** React, TypeScript, Vite, Phaser, React Router
- **API:** Node.js, TypeScript, Express
- **Realtime multiplayer:** Socket.IO
- **Shared game rules:** fixed-step TypeScript simulation in `packages/game-core`
- **Validation and contracts:** Zod schemas in `packages/contracts`
- **Data:** MongoDB for accounts, sessions, personal-best metadata, and
  tournament results; Redis for active lobbies and rate limits
- **Replay files:** local filesystem in development; S3-compatible object
  storage or an explicitly configured persistent disk in production
- **Workspace:** npm workspaces

The browser collects controls and renders the race. The server owns
authentication, replay verification, tournament simulation, and result
placement. The browser does not submit trusted race positions or times.

## Repository Layout

```text
apps/
  web/                 React application, Phaser scenes, and browser API clients
  server/              Express API, Socket.IO server, and persistence adapters
packages/
  content/             Versioned tracks and car definitions
  contracts/           Shared request, response, and socket schemas
  game-core/           Shared fixed-step racing simulation
infra/
  docker-compose.yml   Local MongoDB and Redis services
```

## Run Locally

### Requirements

- Node.js and npm
- Docker Desktop (or another Docker Compose-compatible runtime) for local
  MongoDB and Redis

Node.js 22 or newer is recommended.

### Start dependencies

From the repository root:

```powershell
docker compose -f infra/docker-compose.yml up -d mongodb redis
```

### Configure the server

Create `apps/server/.env` for local development:

```dotenv
PORT=3001
NODE_ENV=development
MONGODB_URI=mongodb://127.0.0.1:27017/ghost-racer
REDIS_URL=redis://127.0.0.1:6379
REPLAY_STORAGE_DRIVER=local
```

The local values above are development defaults. Never put production
credentials in this file or commit `.env` files.

### Install and start

```powershell
npm ci
npm run dev
```

Open the Vite URL printed in the terminal (normally
`http://localhost:5173`). The web development server proxies API and Socket.IO
requests to the local server on port `3001`.

To stop the local database and cache containers:

```powershell
docker compose -f infra/docker-compose.yml stop mongodb redis
```

## Useful Commands

Run these from the repository root:

```powershell
npm run typecheck
npm run build
npm run verify --workspace=@ghost-racer/content
npm run verify --workspace=@ghost-racer/game-core
npm run verify --workspace=@ghost-racer/contracts
```

`npm run build` builds the web app. The workspace verification commands check
track/car definitions, shared simulation behavior, and shared API contracts.

## Deployment Overview

The current deployment layout is designed for:

- **Web app:** Vercel
- **Node.js API and Socket.IO:** Render
- **Database:** MongoDB-compatible hosted service
- **Active lobby/rate-limit storage:** Redis-compatible hosted service
- **Durable replays:** S3-compatible object storage (for example, Cloudflare R2)
  or a persistent disk attached to the server

The root `vercel.json` forwards `/api/*` and `/socket.io/*` requests to the
Render service, then serves the web app for client-side routes. The server
accepts same-origin Socket.IO traffic and the explicitly configured web
origins.

### Render server environment

Configure these values in the Render **server service**, not in the Vercel web
project:

- **Root directory:** repository root
- **Build command:**

  ```sh
  npm ci --include=dev && npm run build --workspaces --if-present
  ```

- **Start command:**

  ```sh
  npm run start --workspace=@ghost-racer/server
  ```

The current server start command runs TypeScript through `tsx`, which is a
workspace development dependency. Include development dependencies during the
Render build so the start command is available.

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | Hosted MongoDB connection string |
| `REDIS_URL` | Hosted Redis connection URL (`redis://` or `rediss://`) |
| `NODE_ENV` | Set to `production` |
| `WEB_ORIGINS` | Comma-separated trusted web origins, e.g. `https://ghostracer.vercel.app` |
| `S3_BUCKET` | Required when using S3-compatible replay storage |
| `S3_REGION` | Storage region; use the provider's documented value |
| `S3_ENDPOINT` | S3-compatible endpoint for providers that require one |
| `S3_ACCESS_KEY_ID` | Storage access key when required by the provider |
| `S3_SECRET_ACCESS_KEY` | Matching storage secret when required by the provider |

Keep the access key and secret private. If using a Render persistent disk
instead of object storage, set `REPLAY_STORAGE_DRIVER=local` and
`REPLAY_STORAGE_DIR` to the disk's mount directory. Do not select local replay
storage on an ephemeral filesystem: replays can be lost when the service
restarts or redeploys.

Render provides the server `PORT`; do not hard-code a conflicting production
port. The `/health` endpoint reports the MongoDB and Redis connectivity state.
After deployment, check it and test sign-in, a replay download, and a
two-player tournament from the deployed site.

### Deployment caveats

- The server will not start in production without a configured durable replay
  store (S3-compatible storage or a persistent local disk).
- Replay files are not automatically migrated when changing storage providers.
- Vercel-to-Render Socket.IO routing and the configured allowed web origin must
  both be deployed for online lobbies to connect.

## Current Development Focus

The application has working implementations of the primary product flows, but
it is not yet a hardened production multiplayer service. Current areas to
improve include:

- Input buffering and timing tolerance for tournaments on higher-latency
  networks.
- Rejoining a tournament after a refresh or temporary disconnect, and
  removing disconnected players from waiting lobbies.
- Recovering a lobby if race initialization fails after the host starts it.
- Automated integration tests for account, replay-storage, and multiplayer
  flows, including deployed Vercel/Render configuration.
- Operational checks for rate-limit behavior and S3-compatible storage in the
  actual hosting environment.

The game intentionally uses open track edges with an off-track speed penalty;
physical barriers are not part of the current design.

## Contributing

For code changes, keep the frontend, server, and shared simulation boundaries
separate. Game rules belong in `packages/game-core` or versioned content, not
in UI components. Validate untrusted HTTP and socket input with the shared
contracts, and preserve the rule that the server determines accepted times and
tournament results.

Before submitting a change, run the relevant workspace verification, then:

```powershell
npm run typecheck
npm run build
```

## License

No license is currently specified. All rights are reserved unless a license is
added to this repository.
