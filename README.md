# Plotter Cutter

Print-and-cut sheet builder for a Skycut plotter with SignCut-style registration marks: nested sticker sheets with
kiss and die (easy-peel) cut lines, business cards, vouchers, card decks, Morgana CardXtra, guillotine sheets,
vinyl and pen cutting, SVG to PLT, and a PLT modifier.

Everything runs in the browser. Nothing is uploaded; the page loads nothing from other sites.

## Getting started

Needs Node.js 22 or newer.

```bash
npm install
```

```bash
npm run dev
```

Open the address it prints (http://localhost:5173). For a version to keep or host anywhere:

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
| `npm test` | Unit tests (Vitest) for geometry, PLT, zip, sanitizer, image and marks code |
| `npm run test:e2e` | Browser tests (Playwright) against the production build |
| `npm run check` | All of the above plus the build |

The browser tests check what reaches the plotter: the easy-peel line sits the set margin outside the kiss line
(±0.06 mm), stickers keep their spacing, the PLT traces the cut SVG to 1/40 mm, the PLT modifier keeps every outline,
cards from images find their bleed per side, Morgana fills its 20 slots, a hostile SVG runs nothing, and no mode
throws errors or makes outside requests.

`tests/golden/` holds exported cut files (SVG and PLT) for fixed inputs, compared byte for byte. If one changes on
purpose, look at the difference first, then refresh them:

```bash
UPDATE_GOLDEN=1 npm run test:e2e -- golden
```

CI (GitHub Actions) runs all checks on every push and pull request.

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
