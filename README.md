# Plotter Cutter

Print-and-cut sheet builder for a Skycut plotter with SignCut-style registration marks: nested sticker sheets with
kiss and die (easy-peel) cut lines, business cards, vouchers, card decks, Morgana CardXtra, guillotine sheets,
vinyl and pen cutting, SVG to PLT, and a PLT modifier.

Everything runs in the browser. Nothing is uploaded; the page loads nothing from other sites.

## Running in Portainer

The image is published to `ghcr.io/rafal-hacus/plotter-cutter` by GitHub Actions (for normal PCs/servers and for
ARM boards like a Raspberry Pi or many NAS boxes) on every push to the default branch, so Portainer only pulls it.

1. **Stacks → Add stack**, name it e.g. `plotter-cutter`.
2. **Web editor**: paste the contents of [`compose.yaml`](compose.yaml).
   (Or **Repository**: this repo's URL, compose path `compose.yaml`.)
3. **Deploy the stack**. No variables are needed (optional: `HOST_PORT` if 8080 is taken).
4. Open `http://<server>:8080`. The first visit shows **Set up the login**: enter the setup code from the
   container log (**Containers → …plotter-cutter… → Logs**), then choose a user name and password. The login is
   stored (hashed) in the data volume.

Instead of the setup page you can fix the login in the stack's **Environment variables**: `AUTH_USERNAME` and
`AUTH_PASSWORD` (8+ characters, avoid the `$` sign) or `AUTH_PASSWORD_HASH`; these always win. To make a hash, open
the running container (**Console → Connect**, `/bin/sh`) and run `node server/hash-password.js`.
Forgot the password? Set `AUTH_PASSWORD` in the stack, or in the container console run `rm /data/auth.json` and
restart the container to get the setup page (with a new code in the log) again.

- **Updating**: in the stack, **Update the stack** with **Re-pull image** switched on. Saved settings are in the
  `plotter-data` volume and stay. To update only when you choose, set `IMAGE` to a version tag
  (e.g. `ghcr.io/rafal-hacus/plotter-cutter:0.3.0`, published from git tags `v0.3.0`).
- **If the image can't be pulled** (`denied` or `unauthorized`): images of a private repository are private on
  GitHub. Either make the package public (GitHub → your profile → Packages → plotter-cutter → Package settings →
  Change visibility; the image contains no secrets), or add the registry in Portainer: **Registries → Add registry →
  Custom**, URL `ghcr.io`, your GitHub user name and a personal access token with the `read:packages` scope.
- The stack is for a normal Docker environment in Portainer (not Swarm). Images exist for amd64 (PCs, servers),
  arm64 (Raspberry Pi 4/5 with a 64-bit OS, most NAS) and arm/v7 (32-bit Raspberry Pi OS).

## Running with Docker Compose

```bash
cp .env.example .env
```

Edit `.env` if you want to fix the login there (otherwise the first visit shows the setup page; the setup code
is in `docker compose logs`). Then:

```bash
docker compose up -d
```

That pulls the published image. To build it from this checkout instead:

```bash
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

Open http://localhost:8080 (or the computer's address on your network) and sign in.

- Saved settings live in the `plotter-data` Docker volume (`/data/presets.json`), so they survive updates and
  restarts. Back them up with:

  ```bash
  docker compose cp plotter-cutter:/data/presets.json ./presets-backup.json
  ```

- Changing the password signs everyone out. Wrong passwords lock an address out for 15 minutes after 5 tries.
- Over the internet, put it behind a reverse proxy with HTTPS (Caddy, Traefik, nginx) and set
  `COOKIE_SECURE=true` and `TRUST_PROXY=true`.
- The container runs as a normal user on a read-only filesystem with no extra privileges; only `/data` is writable.

### Settings

| Variable | Default | |
| --- | --- | --- |
| `AUTH_USERNAME` | `admin` | user name for signing in |
| `AUTH_PASSWORD` / `AUTH_PASSWORD_FILE` / `AUTH_PASSWORD_HASH` | (setup page) | the password, a file holding it (Docker secrets), or its hash from `node server/hash-password.js` |
| `HOST_PORT` | `8080` | port on the host (compose) |
| `IMAGE` | `ghcr.io/rafal-hacus/plotter-cutter:latest` | image to run (compose) |
| `PORT` | `8080` | port inside the container |
| `SESSION_DAYS` | `30` | how long a sign-in lasts |
| `COOKIE_SECURE` | `false` | `true` behind HTTPS |
| `TRUST_PROXY` | `false` | `true` behind a reverse proxy that sets `X-Forwarded-For` |
| `SESSION_SECRET` | generated into `/data` | key for signing sessions |
| `AUTH_DISABLED` | `false` | local development only: no login at all |

## Perforated die cut (business cards)

**Perforated die cut (no cutting mat)** under Business cards cuts every cut line in pieces with small uncut
bridges (default: 6 mm cuts, 0.8 mm bridges). The sheet stays in one piece while it feeds through the plotter
without a mat; afterwards the cards pop out by hand. Bridges sit only on straight edges and every corner (square or
rounded) is cut through, so the cards come out with clean corners; the small waste pieces between cards keep a
bridge too, so nothing falls into the plotter. Works with straight lines across the sheet and with a rectangle
(or rounded rectangle) around each card. Set the die cut force to go all the way through the card.

## Saved settings

The panel at the top of the side panel saves the current mode and every setting (cut lines, forces and speeds,
sheet, layout, card sizes, bleed, CardXtra size, back-side shift, …) on the server under a name. Picking one from
the list switches to its mode and applies everything. **Make default** loads it when the app opens. After an edit,
the panel shows *changed*; **Update** saves the edit into the selected one. Loaded files (SVGs, PDFs, images) are
not part of saved settings.

## Getting started (development)

Needs Node.js 22 or newer.

```bash
npm install
```

```bash
npm run dev
```

Open the address it prints (http://localhost:5173). Saved settings need the server too: run
`AUTH_DISABLED=true npm start` in a second terminal and start the dev server with `PC_SERVER=http://localhost:8080 npm run dev`.

For a version to keep or host anywhere:

```bash
npm run build
```

The finished app is in `dist/`; serve that folder with any static web server (it works from a subfolder too).
It needs to be served, not opened as a file, because the browser won't load modules from `file://`.
`npm run preview` serves the build locally.

## Checks

| Command | What it does |
| --- | --- |
| `npm run lint` | ESLint, including undefined names across modules |
| `npm test` | Unit tests (Vitest) for the geometry, PLT, zip, sanitizer, image and marks code, and the server (login, lockout, sessions, file access, saved-settings API) |
| `npm run test:e2e` | Browser tests (Playwright) against the production build |
| `npm run check` | All of the above plus the build |

The browser tests check what reaches the plotter: the easy-peel line sits the set margin outside the kiss line
(±0.06 mm), stickers keep their spacing, the PLT traces the cut SVG to 1/40 mm, the PLT modifier keeps every outline,
cards from images find their bleed per side, Morgana fills its 20 slots, a hostile SVG runs nothing, no mode
throws errors or makes outside requests, and signing in, saving, picking, updating, defaulting and deleting saved
settings works against the real server.

`tests/golden/` holds exported cut files (SVG and PLT) for fixed inputs, compared byte for byte. If one changes on
purpose, look at the difference first, then refresh them:

```bash
UPDATE_GOLDEN=1 npm run test:e2e -- golden
```

CI (GitHub Actions, started by hand for now: Actions → CI → Run workflow) runs all checks and starts the stack from `compose.yaml` (built from that commit) and smoke-tests it. A second workflow publishes the image to GitHub's container registry.

## Notes on the cut paths

- The easy-peel (die) line is the kiss outline grown by the margin. Notches narrower than "join cut lines closer
  than" are filled in and rounded; set it to 0 to follow every notch.
- PLT: 40 units per mm, origin at the centre of the bottom-right registration mark, X up the sheet, Y to the left.
  With a blade offset set, the blade tip stays within 0.07 mm of the line. Set the cutter's own blade offset to 0,
  otherwise corners are compensated twice.
- Each PLT starts with a short V cut along the printed start arrow (outside the marks) to set the blade direction.

## Cards from images

Business cards, vouchers, guillotine, card deck and Morgana CardXtra accept PNG/JPG/WebP images as well as PDFs
(first image = front, second = back). Scaling: 100 % (size from the image's dpi), fit to the card keeping
proportions, or stretch. With 100 % and fit, whatever reaches past the card size is used as bleed per side, so a
file with bleed only on the top and bottom works; sides without bleed can be filled by repeating the edge pixels.
In Morgana mode the cut size always comes from the CardXtra setting, and the CardXtra template values are the
calibrated originals.

See [ARCHITECTURE.md](ARCHITECTURE.md) for how the code is organised.
