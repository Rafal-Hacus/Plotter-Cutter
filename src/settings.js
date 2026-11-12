// The option fields of the side panel: reading them (readOpts), and keeping them in the browser between visits.
import { byId } from './dom.js';

// every field that is saved with the settings (the browser's storage, and Saved settings on the server)
export const OPT_IDS = [
  'kiss', 'die', 'gap', 'kissColor', 'dieColor', 'kissLayer', 'dieLayer', 'lineW', 'overcut', 'bladeOffset',
  'pltForce', 'kissForce', 'dieForce', 'cutSpeed', 'upSpeed', 'cBleed', 'cGap', 'cCutStyle', 'mSize',
  'cRadius', 'cFlip', 'cOffX', 'cOffY', 'cFoldOn', 'cFoldPos', 'gSpace', 'gAutoGap', 'deckSets', 'deckOrder',
  'icPreset', 'icW', 'icH', 'icFit', 'icDpi', 'icExtend', 'icBleedHow', 'icSafe', 'cPerfDie', 'cTieCut',
  'cTie', 'cTiePlace', 'cTieInset', 'cAlign', 'cShiftX', 'cShiftY', 'winSrc', 'winW', 'winH', 'winFont',
  'winSize', 'winColor', 'winBoth', 'winOffX', 'winOffY', 'winCopies', 'cFoldDir', 'sheetSize', 'sheetW',
  'sheetH', 'sheetFeed', 'sheetFeedMm', 'gPage', 'gPageW', 'gPageH', 'dxSize', 'dxW', 'dxH', 'gPages',
  'gMarksBack', 'gEachSets', 'gMarkLen', 'gMarkOff', 'gEdge', 'gSize', 'gScale', 'cPerfCut', 'cPerfGap',
  'vWidth', 'vLength', 'vMargin', 'vGap', 'vWeed', 'vWeedMargin', 'vMirror', 'penForce', 'penFill', 'penStyle',
  'penSpacing', 'penAngle', 'batchMix', 'ggFormat', 'ggW', 'ggH', 'ggBleed', 'ggFit', 'ggAuto', 'ggGap',
  'ggMarkLen', 'ggMarkOff', 'ggEdge', 'spDpi', 'sqW', 'sqH', 'sqSheetW', 'sqSheetH', 'sqMargin', 'sqGap',
  'borderFill', 'borderColor', 'clearance', 'joinGap', 'rotate', 'center', 'ignoreWhite', 'quality', 'dpi'
];

// The options as the code uses them: numbers checked against a lowest value, with a fallback when a field is
// empty or not a number. A few are stored under a clearer name than their field's id.
export function readOpts() {
  const text = id => byId(id).value, on = id => byId(id).checked;
  // a number of at least `min`, or `fallback`
  const num = (id, fallback, min) => { const x = parseFloat(text(id)); return isFinite(x) ? Math.max(min, x) : fallback; };
  const count = (id, fallback) => Math.max(1, Math.round(num(id, fallback, 1)));
  // a number that may be negative (shifts, angles); 0 when empty
  const signed = id => parseFloat(text(id)) || 0;
  return {
    // stickers: outlines and nesting
    kiss: num('kiss', 2, 0), die: num('die', 2, 0), gap: num('gap', 2, 0), joinGap: num('joinGap', 3, 0),
    clearance: num('clearance', 5, 0), rotate: on('rotate'), center: on('center'), ignoreWhite: on('ignoreWhite'),
    quality: text('quality'), borderFill: on('borderFill'), borderColor: text('borderColor'), batchMix: on('batchMix'),
    // the sheet with registration marks
    sheetSize: text('sheetSize'), sheetW: num('sheetW', 310, 60), sheetH: num('sheetH', 440, 60),
    sheetFeed: on('sheetFeed'), sheetFeedMm: num('sheetFeedMm', 60, 0), dpi: num('dpi', 300, 1),
    // cut lines in the files, and the plotter
    kissColor: text('kissColor'), dieColor: text('dieColor'), lineW: num('lineW', 0.1, 0.01),
    kissLayer: text('kissLayer').trim() || 'Kiss cut', dieLayer: text('dieLayer').trim() || 'Die cut',
    overcut: num('overcut', 0.5, 0), bladeOffset: num('bladeOffset', 0.35, 0), pltForce: on('pltForce'),
    kissForce: num('kissForce', 60, 1), dieForce: num('dieForce', 60, 1), cutSpeed: num('cutSpeed', 13, 1), upSpeed: num('upSpeed', 13, 1),
    // cards: the PDF, the cut, the back side
    cBleed: num('cBleed', 2, 0), cGap: num('cGap', 4, 0), cCutStyle: text('cCutStyle'), cRadius: num('cRadius', 0, 0),
    mSize: text('mSize'), cFlip: text('cFlip'), cOffX: signed('cOffX'), cOffY: signed('cOffY'),
    // cards: fold perforation, perforated die cut, cutting without the sensor
    cFold: on('cFoldOn') ? 'perf' : 'none', cFoldDir: text('cFoldDir'), cFoldPos: num('cFoldPos', 0, 0),
    cPerfCut: num('cPerfCut', 1, 0.2), cPerfGap: num('cPerfGap', 1, 0.2),
    cPerfDie: on('cPerfDie'), cTiePlace: text('cTiePlace') === 'corners' ? 'corners' : 'edges',
    cTieInset: num('cTieInset', 2, 0), cTieCut: num('cTieCut', 6, 0.5), cTie: num('cTie', 0.8, 0.1),
    cAlign: text('cAlign') === 'dot' ? 'dot' : 'marks', cShiftX: signed('cShiftX'), cShiftY: signed('cShiftY'),
    // winietki
    winSrc: text('winSrc'), winW: num('winW', 100, 20), winH: num('winH', 100, 20), winCopies: count('winCopies', 1),
    winFont: text('winFont'), winSize: Math.min(200, num('winSize', 28, 6)), winColor: text('winColor'),
    winBoth: on('winBoth'), winOffX: signed('winOffX'), winOffY: signed('winOffY'),
    // guillotine and card deck
    gGap: num('gSpace', 4, 0), gAuto: on('gAutoGap'), gMargin: num('gEdge', 0, 0), gSize: text('gSize'), gScale: num('gScale', 100, 5),
    gPages: text('gPages'), gEachSets: count('gEachSets', 1), gMarksBack: on('gMarksBack'),
    gMarkLen: num('gMarkLen', 5, 1), gMarkOff: num('gMarkOff', 3, 0), deckSets: count('deckSets', 10), deckOrder: text('deckOrder'),
    // print sheets
    ggFormat: text('ggFormat'), ggW: num('ggW', 100, 5), ggH: num('ggH', 150, 5), ggBleed: num('ggBleed', 2, 0), ggFit: text('ggFit'),
    ggAuto: on('ggAuto'), ggGap: num('ggGap', 4, 0), ggMarkLen: num('ggMarkLen', 5, 1), ggMarkOff: num('ggMarkOff', 3, 0), ggEdge: num('ggEdge', 0, 0),
    // vinyl and pen
    vWidth: num('vWidth', 300, 20), vLength: num('vLength', 1000, 20), vMargin: num('vMargin', 5, 0), vGap: num('vGap', 3, 0),
    vWeed: text('vWeed'), vWeedMargin: num('vWeedMargin', 3, 0), vMirror: on('vMirror'),
    penForce: num('penForce', 40, 1), penFill: on('penFill'), penStyle: text('penStyle'), penSpacing: num('penSpacing', 0.4, 0.1), penAngle: signed('penAngle'),
    // squares, SVG to PLT
    sqW: num('sqW', 50, 5), sqH: num('sqH', 50, 5), sqSheetW: num('sqSheetW', 320, 20), sqSheetH: num('sqSheetH', 450, 20),
    sqMargin: num('sqMargin', 10, 0), sqGap: num('sqGap', 0, 0), spDpi: parseFloat(text('spDpi')) || 72
  };
}
// set the fields from { id: value }; ids that are missing keep their value
export function applyOptionValues(values, ids = OPT_IDS) {
  for (const id of ids) {
    if (!Object.hasOwn(values, id)) continue;
    const e = byId(id);
    if (e.type === 'checkbox') e.checked = !!values[id]; else e.value = String(values[id]);
  }
}
const STORE_KEY = 'stickerSheet.opts.v2';
// every option field as { id: value } (checkboxes as booleans, the rest as the field's text)
export function optionValues() {
  const o = {};
  for (const id of OPT_IDS) { const e = byId(id); o[id] = e.type === 'checkbox' ? e.checked : e.value; }
  return o;
}
export function saveOpts() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(optionValues())); } catch (e) { /* storage unavailable */ }
}
export function loadOpts() {
  try {
    const o = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (o && typeof o === 'object') applyOptionValues(o);
  } catch (e) { /* storage unavailable, or not what we saved */ }
}
