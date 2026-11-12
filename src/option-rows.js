// Rows of the side panel that are shown or hidden depending on other fields' values. Called whenever the fields
// are set from outside (stored settings, saved settings, a background from the library).
import { byId } from './dom.js';
import { syncImgRows } from './modes/cards/images.js';
import { syncPerf } from './modes/cards/index.js';
import { syncPerfDie } from './modes/cards/render.js';
import { syncWinRows } from './modes/cards/winietki.js';

export function syncOptionRows() {
  syncPerf();
  byId('rowDxCustom').hidden = byId('dxSize').value !== 'custom';
  byId('rowGPageCustom').hidden = byId('gPage').value !== 'custom';
  byId('rowGGCustom').hidden = byId('ggFormat').value !== 'custom';
  byId('rowGGGap').hidden = byId('ggAuto').checked;
  syncImgRows();
  syncPerfDie();
  syncWinRows();
}
