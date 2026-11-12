export const OPT_IDS = ['kiss', 'die', 'gap', 'kissColor', 'dieColor', 'kissLayer', 'dieLayer', 'lineW', 'overcut', 'bladeOffset', 'pltForce', 'kissForce', 'dieForce', 'cutSpeed', 'upSpeed', 'cBleed', 'cGap', 'cCutStyle', 'mSize', 'cRadius', 'cFlip', 'cOffX', 'cOffY', 'cFoldOn', 'cFoldPos', 'gSpace', 'gAutoGap', 'deckSets', 'deckOrder', 'icPreset', 'icW', 'icH', 'icFit', 'icDpi', 'icExtend', 'icBleedHow', 'icSafe', 'cPerfDie', 'cTieCut', 'cTie', 'cTiePlace', 'cTieInset', 'cAlign', 'cShiftX', 'cShiftY', 'winSrc', 'winW', 'winH', 'winFont', 'winSize', 'winColor', 'winBoth', 'winOffX', 'winOffY', 'winCopies', 'cFoldDir', 'sheetSize', 'sheetW', 'sheetH', 'sheetFeed', 'sheetFeedMm', 'gPage', 'gPageW', 'gPageH', 'dxSize', 'dxW', 'dxH', 'gPages', 'gMarksBack', 'gEachSets', 'gMarkLen', 'gMarkOff', 'gEdge', 'gSize', 'gScale', 'cPerfCut', 'cPerfGap', 'vWidth', 'vLength', 'vMargin', 'vGap', 'vWeed', 'vWeedMargin', 'vMirror', 'penForce', 'penFill', 'penStyle', 'penSpacing', 'penAngle', 'batchMix', 'ggFormat', 'ggW', 'ggH', 'ggBleed', 'ggFit', 'ggAuto', 'ggGap', 'ggMarkLen', 'ggMarkOff', 'ggEdge', 'spDpi', 'sqW', 'sqH', 'sqSheetW', 'sqSheetH', 'sqMargin', 'sqGap', 'borderFill', 'borderColor', 'clearance', 'joinGap', 'rotate', 'center', 'ignoreWhite', 'quality', 'dpi'];
export function readOpts() {
  const v = id => document.getElementById(id);
  const n = (id, def, min) => { const x = parseFloat(v(id).value); return isFinite(x) ? Math.max(min, x) : def; };
  return {
    kiss: n('kiss', 2, 0), die: n('die', 2, 0), gap: n('gap', 2, 0), lineW: n('lineW', 0.1, 0.01), overcut: n('overcut', 0.5, 0), bladeOffset: n('bladeOffset', 0.35, 0),
    pltForce: document.getElementById('pltForce').checked, kissForce: n('kissForce', 60, 1), dieForce: n('dieForce', 60, 1), cutSpeed: n('cutSpeed', 13, 1), upSpeed: n('upSpeed', 13, 1),
    cBleed: n('cBleed', 2, 0), cGap: n('cGap', 4, 0), cCutStyle: v('cCutStyle').value, mSize: v('mSize').value, cRadius: n('cRadius', 0, 0), cFlip: v('cFlip').value,
    winSrc: v('winSrc').value, winW: n('winW', 100, 20), winH: n('winH', 100, 20), winFont: v('winFont').value, winSize: Math.min(200, n('winSize', 28, 6)), winColor: v('winColor').value, winBoth: v('winBoth').checked, winOffX: parseFloat(v('winOffX').value) || 0, winOffY: parseFloat(v('winOffY').value) || 0, cAlign: v('cAlign').value === 'dot' ? 'dot' : 'marks', cShiftX: parseFloat(v('cShiftX').value) || 0, cShiftY: parseFloat(v('cShiftY').value) || 0, cPerfDie: v('cPerfDie').checked, cTiePlace: v('cTiePlace').value === 'corners' ? 'corners' : 'edges', cTieInset: n('cTieInset', 2, 0), cTieCut: n('cTieCut', 6, 0.5), cTie: n('cTie', 0.8, 0.1), cOffX: parseFloat(v('cOffX').value) || 0, cOffY: parseFloat(v('cOffY').value) || 0,
    cFold: v('cFoldOn').checked ? 'perf' : 'none', cFoldDir: v('cFoldDir').value, gGap: n('gSpace', 4, 0), gAuto: v('gAutoGap').checked, deckSets: Math.max(1, Math.round(n('deckSets', 10, 1))), deckOrder: v('deckOrder').value, winCopies: Math.max(1, Math.round(n('winCopies', 1, 1))), sheetSize: v('sheetSize').value, sheetW: n('sheetW', 310, 60), sheetH: n('sheetH', 440, 60), sheetFeed: v('sheetFeed').checked, sheetFeedMm: n('sheetFeedMm', 60, 0), gPages: v('gPages').value, gMarksBack: v('gMarksBack').checked, gEachSets: Math.max(1, Math.round(n('gEachSets', 1, 1))), gMarkLen: n('gMarkLen', 5, 1), gMarkOff: n('gMarkOff', 3, 0), gMargin: n('gEdge', 0, 0), gSize: v('gSize').value, gScale: n('gScale', 100, 5), cFoldPos: n('cFoldPos', 0, 0), cPerfCut: n('cPerfCut', 1, 0.2), cPerfGap: n('cPerfGap', 1, 0.2),
    vWidth: n('vWidth', 300, 20), vLength: n('vLength', 1000, 20), vMargin: n('vMargin', 5, 0), vGap: n('vGap', 3, 0),
    vWeed: v('vWeed').value, vWeedMargin: n('vWeedMargin', 3, 0), vMirror: v('vMirror').checked, penForce: n('penForce', 40, 1), penFill: v('penFill').checked, penStyle: v('penStyle').value, penSpacing: n('penSpacing', 0.4, 0.1), penAngle: parseFloat(v('penAngle').value) || 0, batchMix: v('batchMix').checked, ggFormat: v('ggFormat').value, ggW: n('ggW', 100, 5), ggH: n('ggH', 150, 5), ggBleed: n('ggBleed', 2, 0), ggFit: v('ggFit').value, ggAuto: v('ggAuto').checked, ggGap: n('ggGap', 4, 0), ggMarkLen: n('ggMarkLen', 5, 1), ggMarkOff: n('ggMarkOff', 3, 0), ggEdge: n('ggEdge', 0, 0), spDpi: parseFloat(v('spDpi').value) || 72, sqW: n('sqW', 50, 5), sqH: n('sqH', 50, 5), sqSheetW: n('sqSheetW', 320, 20), sqSheetH: n('sqSheetH', 450, 20), sqMargin: n('sqMargin', 10, 0), sqGap: n('sqGap', 0, 0),
    kissColor: v('kissColor').value, dieColor: v('dieColor').value,
    kissLayer: v('kissLayer').value.trim() || 'Kiss cut', dieLayer: v('dieLayer').value.trim() || 'Die cut',
    borderFill: v('borderFill').checked, borderColor: v('borderColor').value,
    clearance: n('clearance', 5, 0), joinGap: n('joinGap', 3, 0),
    rotate: v('rotate').checked, center: v('center').checked, ignoreWhite: v('ignoreWhite').checked,
    quality: v('quality').value, dpi: n('dpi', 300, 1)
  };
}
// every option field as { id: value } (checkboxes as booleans, the rest as the field's text)
export function optionValues() {
  const o = {};
  for (const id of OPT_IDS) { const e = document.getElementById(id); o[id] = e.type === 'checkbox' ? e.checked : e.value; }
  return o;
}
export function saveOpts() {
  try { localStorage.setItem('stickerSheet.opts.v2', JSON.stringify(optionValues())); } catch (e) { /* storage unavailable */ }
}
export function loadOpts() {
  try {
    const o = JSON.parse(localStorage.getItem('stickerSheet.opts.v2') || 'null');
    if (!o) return;
    for (const id of OPT_IDS) {
      if (!(id in o)) continue;
      const e = document.getElementById(id);
      if (e.type === 'checkbox') e.checked = !!o[id]; else e.value = o[id];
    }
  } catch (e) { /* ignore */ }
}
