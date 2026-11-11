# Plotter Cutter

Print-and-cut sheet builder for a Skycut plotter with SignCut-style registration marks: nested sticker sheets with
kiss and die (easy-peel) cut lines, business cards, vouchers, card decks, Morgana CardXtra, guillotine sheets,
vinyl and pen cutting, SVG to PLT, and a PLT modifier.

Everything runs in the browser. Nothing is uploaded; the page loads nothing from other sites.

## Running with Docker

```bash
cp .env.example .env
```

Edit `.env`: set at least `AUTH_PASSWORD` (or better `AUTH_PASSWORD_HASH`, see the comments in the file). Then:

```bash
docker compose up -d --build
```

Open http://localhost:8080 (or the computer's address on your network) and sign in.

- Saved settings live in the `plotter-data` Docker volume (`/data/presets.json`), so they survive updates and
  restarts. Back them up with:

  ```bash
  docker compose cp plotter-cutter:/data/presets.json ./presets-backup.json
  ```

- To update after pulling new code: `docker compose up -d --build`.
- Changing the password signs everyone out. Wrong passwords lock an address out for 15 minutes after 5 tries.
- Over the internet, put it behind a reverse proxy with HTTPS (Caddy, Traefik, nginx) and set
  `COOKIE_SECURE=true` and `TRUST_PROXY=true`.
- The container runs as a normal user on a read-only filesystem with no extra privileges; only `/data` is writable.

### Settings

| Variable | Default | |
| --- | --- | --- |
| `AUTH_USERNAME` | `admin` | user name for signing in |
| `AUTH_PASSWORD` / `AUTH_PASSWORD_FILE` / `AUTH_PASSWORD_HASH` | (required) | the password, a file holding it (Docker secrets), or its scrypt hash |
| `PORT` | `8080` | port inside the container |
| `SESSION_DAYS` | `30` | how long a sign-in lasts |
| `COOKIE_SECURE` | `false` | `true` behind HTTPS |
| `TRUST_PROXY` | `false` | `true` behind a reverse proxy that sets `X-Forwarded-For` |
| `SESSION_SECRET` | generated into `/data` | key for signing sessions |
| `AUTH_DISABLED` | `false` | local development only: no login at all |

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

CI (GitHub Actions) runs all checks on every push and pull request, and builds and smoke-tests the Docker image.

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
