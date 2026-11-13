// What the modes share. Everything else lives in the module that owns it.
export const state = {
  mode: 'stickers',     // the open mode (a key of the mode table, see modes/registry.js)
  template: null,       // the sheet with its registration marks (see template.js)
  sheetCache: null,     // the template as a nesting grid: where stickers and cards may go
  layout: null,         // stickers placed on the sheet
  vinylLayout: null,    // shapes placed on the vinyl (vinyl and pen modes)
  job: null,            // the PDF job of the open card mode (see modes/cards/job.js)
  gen: 0,               // counts layout runs, so an older run can tell it was superseded
  view: null,           // visible part of the preview when zoomed in; null = the whole sheet
  previewFrame: null,   // the preview's own frame when it isn't the template's (plain sheets, vinyl)
  loadError: ''         // why the last file couldn't be added; shown until the next file or mode change
};
// the sticker designs (also the shapes of the vinyl and pen modes)
export const designs = [];
