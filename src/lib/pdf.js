// PDF libraries, loaded on first use so the app starts fast.
// pdf.js (reading/rendering PDFs) runs its parser in a Web Worker; pdf-lib writes PDFs.
// The legacy pdf.js build is used because it carries polyfills for browsers that are a few versions old.
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

let libs = null;
export function ensureLibs() {
  if (!libs) libs = Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdf-lib')])
    .then(([pdfjs, pdflib]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      // the app reads them from window (as it did when they came from a CDN)
      window.pdfjsLib = pdfjs;
      window.PDFLib = pdflib;
    })
    .catch(e => { libs = null; throw new Error('Could not load the PDF library.', { cause: e }); });
  return libs;
}

// Options for every pdf.js getDocument call: never evaluate code from a PDF, and use the bundled data files.
export const pdfSource = data => {
  const base = new URL('pdfjs/', document.baseURI).href;
  return { data, isEvalSupported: false, cMapUrl: base + 'cmaps/', cMapPacked: true, standardFontDataUrl: base + 'standard_fonts/', wasmUrl: base + 'wasm/', iccUrl: base + 'iccs/' };
};
