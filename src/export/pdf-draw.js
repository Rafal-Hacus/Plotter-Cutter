export const cssRgb = c => {
  const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c).trim());
  if (h) { const x = h[1].length === 3 ? h[1].split('').map(ch => ch + ch).join('') : h[1]; return window.PDFLib.rgb(parseInt(x.slice(0, 2), 16) / 255, parseInt(x.slice(2, 4), 16) / 255, parseInt(x.slice(4, 6), 16) / 255); }
  const m = String(c).match(/[\d.]+/g) || [0, 0, 0];
  return window.PDFLib.rgb(+m[0] / 255, +m[1] / 255, +m[2] / 255);
};
