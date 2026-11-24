// Cut lines drawn in a spot colour of their own (CutContour, Cut, Kiss, Wykrój …: the usual way RIPs and cutters
// are told "this is the cut, don't print it") are taken out of a page's content stream: their strokes become
// "end path, paint nothing", so the page prints without them. The lines themselves are still read from the
// original page (they are the kiss cut).

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]); // ( ) < > [ ] { } / %
// the stroking paint operators, and what each becomes when the stroke is dropped (the fill stays)
const STROKE_TO = { S: 'n', s: 'n', B: 'f', 'B*': 'f*', b: 'f', 'b*': 'f*' };

// content: Uint8Array of a content stream. isCut(name): whether the colour space resource `name` is a cut colour.
// Returns { bytes, removed } (bytes is the input itself when nothing was removed).
// opts.fillStroke: drop the stroke of every fill-and-stroke operator (B B* b b*) whatever its colour (and nothing else)
export function stripCutStrokes(content, isCut, opts = {}) {
  const n = content.length, edits = [];
  let i = 0, lastName = null, cut = false;
  const stack = [];
  while (i < n) {
    const c = content[i];
    if (WS.has(c)) { i++; continue; }
    if (c === 37) { while (i < n && content[i] !== 10 && content[i] !== 13) i++; continue; } // comment
    if (c === 40) { // (string), nested parentheses and escapes
      let depth = 0;
      for (; i < n; i++) {
        const d = content[i];
        if (d === 92) { i++; continue; }
        if (d === 40) depth++;
        else if (d === 41 && --depth === 0) { i++; break; }
      }
      lastName = null; continue;
    }
    if (c === 60) {
      if (content[i + 1] === 60) { i += 2; continue; } // << dictionary
      while (i < n && content[i] !== 62) i++; // <hex string>
      i++; lastName = null; continue;
    }
    if (c === 62 || c === 91 || c === 93 || c === 123 || c === 125) { i++; continue; }
    if (c === 47) { // /Name
      let j = i + 1;
      while (j < n && !WS.has(content[j]) && !DELIM.has(content[j])) j++;
      lastName = String.fromCharCode(...content.subarray(i + 1, j)).replace(/#([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
      i = j; continue;
    }
    let j = i;
    while (j < n && !WS.has(content[j]) && !DELIM.has(content[j])) j++;
    if (j === i) { i++; continue; }
    const tok = String.fromCharCode(...content.subarray(i, j));
    if (tok === 'ID') { // inline image: its data runs to "EI" between white space
      let k = j + 1;
      while (k < n - 1 && !(content[k] === 69 && content[k + 1] === 73 && WS.has(content[k - 1]) && (k + 2 >= n || WS.has(content[k + 2])))) k++;
      i = k + 2; lastName = null; continue;
    }
    if (tok === 'q') stack.push(cut);
    else if (tok === 'Q') { if (stack.length) cut = stack.pop(); }
    else if (tok === 'CS') cut = !!(lastName && isCut(lastName));
    else if (tok === 'G' || tok === 'RG' || tok === 'K') cut = false;
    else if (opts.fillStroke ? /^[Bb]\*?$/.test(tok) : cut && STROKE_TO[tok]) edits.push([i, j, STROKE_TO[tok]]);
    if (!/^[-+.\d]+$/.test(tok)) lastName = null;
    i = j;
  }
  if (!edits.length) return { bytes: content, removed: 0 };
  const parts = [];
  let at = 0, len = 0;
  for (const [a, b, r] of edits) {
    parts.push(content.subarray(at, a), new TextEncoder().encode(r));
    at = b;
  }
  parts.push(content.subarray(at));
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return { bytes: out, removed: edits.length };
}

// With pdf-lib (PDFLib): the document with its cut-colour strokes removed from every page (and the forms the pages
// draw). cutName: RegExp for the spot colour's name. Returns { bytes, removed } (bytes unchanged when none).
export async function stripCutColour(PDFLib, bytes, cutName) {
  const { PDFDocument, PDFName, PDFArray, PDFDict, PDFRawStream, PDFRef, decodePDFRawStream } = PDFLib;
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const ctx = doc.context, look = o => (o instanceof PDFRef ? ctx.lookup(o) : o);
  let removed = 0;
  const done = new Set();
  const cutSpaces = res => {
    const cs = res && look(res.get(PDFName.of('ColorSpace'))), names = new Set();
    if (!(cs instanceof PDFDict)) return names;
    for (const [k, v] of cs.entries()) {
      const a = look(v);
      if (!(a instanceof PDFArray) || a.size() < 2) continue;
      const kind = look(a.get(0)), nm = look(a.get(1));
      if (!kind || !nm || !kind.asString) continue;
      const t = kind.asString();
      // Separation /Name, or DeviceN [/Name] with one colourant
      let spot = null;
      if (t === '/Separation' && nm.asString) spot = nm.asString();
      else if (t === '/DeviceN' && nm instanceof PDFArray && nm.size() === 1 && look(nm.get(0)).asString) spot = look(nm.get(0)).asString();
      if (spot && cutName.test(spot.replace(/^\//, '').replace(/#([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))))) names.add(k.asString().replace(/^\//, ''));
    }
    return names;
  };
  const clean = (streamObj, names) => {
    if (!(streamObj instanceof PDFRawStream) || !names.size) return null;
    const raw = decodePDFRawStream(streamObj).decode();
    const r = stripCutStrokes(raw, nm => names.has(nm));
    if (!r.removed) return null;
    removed += r.removed;
    return ctx.flateStream(r.bytes, {});
  };
  const forms = res => {
    const xo = res && look(res.get(PDFName.of('XObject')));
    if (!(xo instanceof PDFDict)) return;
    for (const [, v] of xo.entries()) {
      if (!(v instanceof PDFRef) || done.has(v.toString())) continue;
      done.add(v.toString());
      const s = ctx.lookup(v);
      if (!(s instanceof PDFRawStream) || look(s.dict.get(PDFName.of('Subtype')))?.asString?.() !== '/Form') continue;
      const fres = look(s.dict.get(PDFName.of('Resources'))) || res;
      const ns = clean(s, cutSpaces(fres));
      if (ns) {
        for (const [k, val] of s.dict.entries()) if (!['/Length', '/Filter', '/DecodeParms'].includes(k.asString())) ns.dict.set(k, val);
        ctx.assign(v, ns);
      }
      forms(fres);
    }
  };
  for (const page of doc.getPages()) {
    const res = page.node.Resources(), names = cutSpaces(res);
    const contents = look(page.node.get(PDFName.of('Contents')));
    if (names.size && contents) {
      // the page's content: one stream or several (joined: an operator may straddle two)
      const list = contents instanceof PDFArray ? contents.asArray().map(look) : [contents];
      if (list.every(s => s instanceof PDFRawStream)) {
        const parts = list.map(s => decodePDFRawStream(s).decode());
        let len = parts.reduce((a, p) => a + p.length + 1, 0), o = 0;
        const all = new Uint8Array(len);
        for (const p of parts) { all.set(p, o); o += p.length; all[o++] = 10; }
        const r = stripCutStrokes(all, nm => names.has(nm));
        if (r.removed) { removed += r.removed; page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(r.bytes, {}))); }
      }
    }
    forms(res);
  }
  if (!removed) return { bytes, removed: 0 };
  return { bytes: await doc.save({ useObjectStreams: false }), removed };
}

// The contour drawn as a stroked shape with an invisible fill (as Affinity writes it): its stroke taken out of page
// `pageIndex`'s own content, so it doesn't print under the kiss cut. Only when that page's content has exactly one
// fill-and-stroke operator (then it is the contour, which the caller found as the only one); else nothing changes.
export async function stripFillStroke(PDFLib, bytes, pageIndex) {
  const { PDFDocument, PDFName, PDFArray, PDFRawStream, PDFRef, decodePDFRawStream } = PDFLib;
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const ctx = doc.context, look = o => (o instanceof PDFRef ? ctx.lookup(o) : o), page = doc.getPages()[pageIndex];
  const contents = page && look(page.node.get(PDFName.of('Contents')));
  const list = !contents ? [] : contents instanceof PDFArray ? contents.asArray().map(look) : [contents];
  if (!list.length || !list.every(x => x instanceof PDFRawStream)) return { bytes, removed: 0 };
  const parts = list.map(x => decodePDFRawStream(x).decode());
  let o = 0;
  const all = new Uint8Array(parts.reduce((a, q) => a + q.length + 1, 0));
  for (const q of parts) { all.set(q, o); o += q.length; all[o++] = 10; }
  const r = stripCutStrokes(all, () => false, { fillStroke: true });
  if (r.removed !== 1) return { bytes, removed: 0 };
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(r.bytes, {})));
  return { bytes: await doc.save({ useObjectStreams: false }), removed: 1 };
}
