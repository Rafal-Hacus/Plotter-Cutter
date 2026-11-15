// Fonts for the stamp text: families with their regular, bold, italic and bold italic faces. Built-in families
// come with the app; font files you add are kept in the server's font library (or, without the server, for this
// session), grouped into families by the name inside the file.
import montserrat400 from '@expo-google-fonts/montserrat/400Regular/Montserrat_400Regular.ttf?url';
import montserrat400i from '@expo-google-fonts/montserrat/400Regular_Italic/Montserrat_400Regular_Italic.ttf?url';
import montserrat700 from '@expo-google-fonts/montserrat/700Bold/Montserrat_700Bold.ttf?url';
import montserrat700i from '@expo-google-fonts/montserrat/700Bold_Italic/Montserrat_700Bold_Italic.ttf?url';
import playfair400 from '@expo-google-fonts/playfair-display/400Regular/PlayfairDisplay_400Regular.ttf?url';
import playfair400i from '@expo-google-fonts/playfair-display/400Regular_Italic/PlayfairDisplay_400Regular_Italic.ttf?url';
import playfair700 from '@expo-google-fonts/playfair-display/700Bold/PlayfairDisplay_700Bold.ttf?url';
import playfair700i from '@expo-google-fonts/playfair-display/700Bold_Italic/PlayfairDisplay_700Bold_Italic.ttf?url';
import tinos400 from '@expo-google-fonts/tinos/400Regular/Tinos_400Regular.ttf?url';
import tinos400i from '@expo-google-fonts/tinos/400Regular_Italic/Tinos_400Regular_Italic.ttf?url';
import tinos700 from '@expo-google-fonts/tinos/700Bold/Tinos_700Bold.ttf?url';
import tinos700i from '@expo-google-fonts/tinos/700Bold_Italic/Tinos_700Bold_Italic.ttf?url';
import cousine400 from '@expo-google-fonts/cousine/400Regular/Cousine_400Regular.ttf?url';
import cousine400i from '@expo-google-fonts/cousine/400Regular_Italic/Cousine_400Regular_Italic.ttf?url';
import cousine700 from '@expo-google-fonts/cousine/700Bold/Cousine_700Bold.ttf?url';
import cousine700i from '@expo-google-fonts/cousine/700Bold_Italic/Cousine_700Bold_Italic.ttf?url';
import roboto400 from '@expo-google-fonts/roboto/400Regular/Roboto_400Regular.ttf?url';
import roboto400i from '@expo-google-fonts/roboto/400Regular_Italic/Roboto_400Regular_Italic.ttf?url';
import roboto700 from '@expo-google-fonts/roboto/700Bold/Roboto_700Bold.ttf?url';
import roboto700i from '@expo-google-fonts/roboto/700Bold_Italic/Roboto_700Bold_Italic.ttf?url';
import openSans400 from '@expo-google-fonts/open-sans/400Regular/OpenSans_400Regular.ttf?url';
import openSans400i from '@expo-google-fonts/open-sans/400Regular_Italic/OpenSans_400Regular_Italic.ttf?url';
import openSans700 from '@expo-google-fonts/open-sans/700Bold/OpenSans_700Bold.ttf?url';
import openSans700i from '@expo-google-fonts/open-sans/700Bold_Italic/OpenSans_700Bold_Italic.ttf?url';
import greatVibes from '@expo-google-fonts/great-vibes/400Regular/GreatVibes_400Regular.ttf?url';

export const STYLES = ['regular', 'bold', 'italic', 'bolditalic'];
const std = name => new URL(`pdfjs/standard_fonts/${name}`, document.baseURI).href;
const four = (r, b, i, bi) => ({ regular: { url: r }, bold: { url: b }, italic: { url: i }, bolditalic: { url: bi } });
// key -> { name, faces: { style: { url } | { id } | { bytes } }, own (from your files) }
const BUILTIN = {
  liberation: { name: 'Arial-like (Liberation Sans)', faces: four(std('LiberationSans-Regular.ttf'), std('LiberationSans-Bold.ttf'), std('LiberationSans-Italic.ttf'), std('LiberationSans-BoldItalic.ttf')) },
  tinos: { name: 'Times-like (Tinos)', faces: four(tinos400, tinos700, tinos400i, tinos700i) },
  cousine: { name: 'Courier-like (Cousine)', faces: four(cousine400, cousine700, cousine400i, cousine700i) },
  roboto: { name: 'Roboto', faces: four(roboto400, roboto700, roboto400i, roboto700i) },
  openSans: { name: 'Open Sans', faces: four(openSans400, openSans700, openSans400i, openSans700i) },
  montserrat: { name: 'Montserrat', faces: four(montserrat400, montserrat700, montserrat400i, montserrat700i) },
  playfair: { name: 'Playfair Display (serif)', faces: four(playfair400, playfair700, playfair400i, playfair700i) },
  greatVibes: { name: 'Great Vibes (script)', faces: { regular: { url: greatVibes } } }
};
export const DEFAULT_FAMILY = 'liberation';

let own = {}; // key -> family from your files
const listeners = new Set();
export const onFontsChanged = fn => listeners.add(fn);
const changed = () => listeners.forEach(fn => fn());
export const families = () => ({ ...BUILTIN, ...own });
export const familyName = key => (families()[key] || BUILTIN[DEFAULT_FAMILY]).name;
const ownKey = family => `own:${family.toLowerCase()}`;
function addOwn(family, style, face) {
  const key = ownKey(family);
  if (!own[key]) own[key] = { name: family, faces: {}, own: true };
  own[key].faces[style] = face;
}

/* ---------- reading fonts ---------- */
const fontkitP = () => import('@pdf-lib/fontkit').then(m => m.default);
const cache = new Map(); // face object -> Promise<fontkit font>
function loadFace(face) {
  if (!cache.has(face)) cache.set(face, (async () => {
    const fontkit = await fontkitP();
    let bytes = face.bytes;
    if (!bytes) {
      const r = await fetch(face.url || `api/fonts/${face.id}/file`, { credentials: 'same-origin' });
      if (!r.ok) throw new Error('Could not load the font.');
      bytes = new Uint8Array(await r.arrayBuffer());
    }
    const f = fontkit.create(bytes);
    if (!f || !f.layout) throw new Error('That font file holds several fonts (a collection): use a single .ttf or .otf.');
    return f;
  })().catch(e => { cache.delete(face); throw e; }));
  return cache.get(face);
}
// fontFor(bold, italic) for the family (sync, once its faces are loaded): the closest face, and what is made up
export async function fontResolver(key) {
  const fam = families()[key] || BUILTIN[DEFAULT_FAMILY], loaded = {};
  for (const s of STYLES) if (fam.faces[s]) loaded[s] = await loadFace(fam.faces[s]);
  const any = loaded.regular || loaded.bold || loaded.italic || loaded.bolditalic;
  return (bold, italic) => {
    const want = bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'regular';
    if (loaded[want]) return { font: loaded[want] };
    // fall back: keep what exists, make up the rest
    if (bold && italic && loaded.bold) return { font: loaded.bold, fauxItalic: true };
    if (bold && italic && loaded.italic) return { font: loaded.italic, fauxBold: true };
    const f = loaded.regular || any;
    return { font: f, fauxBold: bold, fauxItalic: italic };
  };
}
// the style of a font file, from the file itself
function styleOf(font) {
  const sub = String(font.subfamilyName || ''), os2 = font['OS/2'] || {};
  const bold = (os2.usWeightClass || 400) >= 600 || /bold|black|heavy/i.test(sub);
  const italic = Math.abs(font.italicAngle || 0) > 0.5 || /italic|oblique/i.test(sub);
  return bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'regular';
}
const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };

/* ---------- your fonts ---------- */
let serverOk = null;
export async function loadLibrary() {
  try {
    const r = await fetch('api/fonts', { credentials: 'same-origin' });
    if (!r.ok) { serverOk = false; return; }
    const { fonts } = await r.json();
    const keep = Object.fromEntries(Object.entries(own).filter(([, f]) => Object.values(f.faces).some(x => x.bytes)));
    own = keep;
    for (const f of fonts) addOwn(f.family, f.style, { id: f.id, file: f.name });
    serverOk = true;
  } catch { serverOk = false; }
  changed();
}
// add font files: read their family and style, keep them (server, else this session). Returns { added, failed, saved }.
export async function addFontFiles(files) {
  const fontkit = await fontkitP(), added = [], failed = [];
  for (const file of Array.from(files)) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const font = fontkit.create(bytes);
      if (!font || !font.layout) throw new Error('a font collection: use a single .ttf or .otf');
      const family = String(font.familyName || file.name.replace(/\.[^.]+$/, '')).trim(), style = styleOf(font);
      let face = { bytes, file: file.name };
      if (serverOk !== false) {
        const r = await fetch('api/fonts', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: file.name, family, style, data: b64(bytes) }) }).catch(() => null);
        if (r && r.ok) face = { id: (await r.json()).id, file: file.name };
        else if (r && r.status === 400) throw new Error((await r.json().catch(() => ({}))).error || 'refused');
        else serverOk = false;
      }
      cache.delete(face);
      addOwn(family, style, face);
      added.push({ key: ownKey(family), family, style });
    } catch (e) { failed.push(`${file.name}: ${e.message || e}`); }
  }
  changed();
  return { added, failed, saved: serverOk !== false };
}
export async function removeFamily(key) {
  const fam = own[key];
  if (!fam) return;
  for (const face of Object.values(fam.faces)) if (face.id) await fetch(`api/fonts/${face.id}`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => {});
  delete own[key];
  changed();
}
export const ownFamilies = () => Object.entries(own).map(([key, f]) => ({ key, name: f.name, styles: STYLES.filter(s => f.faces[s]), saved: Object.values(f.faces).every(x => x.id) }));

/* ---------- the editor shows the font ---------- */
const cssDone = new Map();
// register the family's faces with the browser (FontFace), so the text editor shows the chosen font; returns the
// CSS font-family. Only a guide: the stamp itself is drawn from the font file.
export async function cssFamily(key) {
  const fams = families(), fam = fams[key] || BUILTIN[DEFAULT_FAMILY], name = `pc-${(fams[key] ? key : DEFAULT_FAMILY).replace(/[^a-z0-9]/gi, '_')}`;
  if (!cssDone.has(name)) cssDone.set(name, (async () => {
    for (const s of STYLES) {
      const face = fam.faces[s];
      if (!face) continue;
      const src = face.bytes ? face.bytes.slice().buffer : `url(${face.url || new URL(`api/fonts/${face.id}/file`, document.baseURI).href})`;
      try { const ff = new FontFace(name, src, { weight: /bold/.test(s) ? '700' : '400', style: /italic/.test(s) ? 'italic' : 'normal' }); await ff.load(); document.fonts.add(ff); }
      catch { /* the editor falls back to a system font */ }
    }
  })());
  await cssDone.get(name);
  return `"${name}", sans-serif`;
}
