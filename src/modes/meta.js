// What each mode is called and which of the shared side panel settings it uses.
// The "uses" lists come from what each mode's code reads from readOpts() (and pltOpts / speedTokens / the template):
// a row is hidden only in modes whose layout and exports never read it. Hidden fields keep their values.

// title: the heading and the page title; lede: the line under it; files: the heading of the file panel the mode
// shares with others (stickers, vinyl, pen); drop: the hint on the empty sheet
export const MODE_META = {
  stickers: { title: 'Sticker sheets', lede: 'Add SVGs or PDFs, set their height, and get a nested sheet with kiss and die cut lines around every sticker.', files: 'Stickers', drop: 'Drop SVG or PDF files here to start filling the sheet (a PDF with a CutContour line is cut along that line).' },
  cards: { title: 'Business cards', lede: 'A double-sided card PDF on a sheet with registration marks: print it, then cut it on the Skycut.', drop: 'Drop the card PDF here (page 1 front, page 2 back).' },
  vouchers: { title: 'Vouchers', lede: 'Folded vouchers on a sheet with registration marks, with a perforated fold, cut on the Skycut.', drop: 'Drop the voucher PDF here (page 1 outside, page 2 inside).' },
  winietka: { title: 'Winietki', lede: 'Place cards from PDFs or a list of names, printed with registration marks and cut on the Skycut.', drop: 'Drop the winietki PDFs here (one card per page).' },
  roll: { title: 'Roll print and cut', lede: 'Signs, labels and banners packed across the roll with registration marks: a print PDF and a PLT per section.', drop: 'Drop the PDFs here (signs, labels, banners).' },
  guillotine: { title: 'Guillotine sheets', lede: 'Copies of a PDF on a plain sheet with crop marks and the cut positions, for the guillotine.', drop: 'Drop the PDF here (page 1 front, page 2 back).' },
  deck: { title: 'Card deck', lede: 'A multi-page card PDF in complete sets on double-sided sheets with crop marks, for the guillotine.', drop: 'Drop the multi-page card PDF here (front, back, front, back…).' },
  gang: { title: 'Print sheets', lede: 'Photos and PDFs of one format together on 310 × 440 sheets, with crop marks and a cut plan for the guillotine.', drop: 'Drop photos and PDFs here.' },
  morgana: { title: 'Morgana CardXtra', lede: 'Business cards 20-up on the CardXtra SRA3 template, with the reading mark on both sides.', drop: 'Drop the PDF here (page 1 front, page 2 back).' },
  duplex: { title: 'Duplex test', lede: 'A two-page test PDF to check how the back side lines up with the front on your printer.', drop: '' },
  vinyl: { title: 'Vinyl cutting', lede: 'The shapes of your SVGs cut from vinyl or flex exactly as drawn: no print, no registration marks.', files: 'Shapes to cut', drop: 'Drop SVG files with the shapes to cut.' },
  pen: { title: 'Pen drawing', lede: 'The lines of your SVGs drawn with a pen in the plotter instead of the knife.', files: 'Drawings', drop: 'Drop SVG files with the lines to draw.' },
  squares: { title: 'Squares', lede: 'A blank sheet cut into squares or rectangles with straight lines, without print or registration marks.', drop: '' },
  svgplt: { title: 'SVG to PLT', lede: 'A finished print-and-cut SVG with its own registration marks, turned into PLTs for the Skycut.', drop: 'Drop the print-and-cut SVG here.' },
  stamps: { title: 'Pieczątki', lede: 'Rubber stamps from text or SVG, saved as an xTool Studio project (.xs) for the P2 laser.', drop: 'Add a stamp with text, or drop SVG files here.' }
};

// modes that print on the sheet with registration marks (state.template: its size, clearance, resolution)
const TEMPLATE = ['stickers', 'cards', 'vouchers', 'winietka'];
// modes that write PLTs: pltForce, cutSpeed, upSpeed (speedTokens)
const PLT = [...TEMPLATE, 'roll', 'svgplt', 'vinyl', 'pen', 'squares'];

// field id -> the modes that read it; its row (and the hint right after the row) is hidden in the others
export const FIELD_MODES = {
  // Cut lines: the sticker outlines
  kiss: ['stickers'], die: ['stickers'], gap: ['stickers'], borderFill: ['stickers'],
  // colours and layers of the cut files (roll: kiss or die by its own "force" choice; pen: the kiss cut layer)
  kissColor: ['stickers', 'roll', 'vinyl', 'pen'], kissLayer: ['stickers', 'roll', 'vinyl', 'pen'],
  dieColor: [...TEMPLATE, 'roll', 'squares'], dieLayer: [...TEMPLATE, 'roll', 'squares'],
  // knife, force and speed (pen sets overcut and blade offset to 0 and uses its own force; squares has no overcut)
  lineW: [...TEMPLATE, 'roll', 'vinyl', 'pen', 'squares'],
  overcut: [...TEMPLATE, 'roll', 'svgplt', 'vinyl'], bladeOffset: [...TEMPLATE, 'roll', 'svgplt', 'vinyl', 'squares'],
  pltForce: PLT, cutSpeed: PLT, upSpeed: PLT,
  kissForce: ['stickers', 'roll', 'svgplt', 'vinyl'], dieForce: [...TEMPLATE, 'roll', 'svgplt', 'squares'],
  // Layout
  clearance: TEMPLATE, joinGap: ['stickers'], rotate: ['stickers', 'vinyl', 'pen'], center: ['stickers'],
  ignoreWhite: ['stickers'], quality: ['stickers']
};
// the panels made of those rows: hidden when none of their rows is used
export const ROW_PANELS = ['secCut', 'secLayout'];
// whole panels: id -> the modes they are shown in
export const PANEL_MODES = { secSheet: TEMPLATE };
