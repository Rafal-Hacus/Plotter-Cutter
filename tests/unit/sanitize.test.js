// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { sanitize, cleanCss } from '../../src/core/sanitize.js';
import { parseSvg, parseLen, readViewBox, aiId } from '../../src/core/svg.js';

const EVIL = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 50 50" onload="x()">
<style>@import url(http://evil.example/x.css); rect{fill:url(http://evil.example/p.svg#g)}</style>
<script>x()</script>
<foreignObject><iframe xmlns="http://www.w3.org/1999/xhtml" srcdoc="&lt;script&gt;x()&lt;/script&gt;"></iframe></foreignObject>
<a xlink:href="java&#x09;script:x()"><circle r="20" fill="#c00"/></a>
<set attributeName="onmouseover" to="x()"/><animate attributeName="href" to="javascript:x()"/>
<image href="http://evil.example/t.png"/><image href="data:image/png;base64,AAAA"/>
<use href="#c"/><rect style="fill:url(#grad);background:url(http://evil.example/b)"/>
</svg>`;

describe('sanitize', () => {
  const doc = parseSvg(EVIL); sanitize(doc);
  const out = new XMLSerializer().serializeToString(doc);
  it('removes scripts, embedded HTML, handlers and animations', () => {
    expect(out).not.toMatch(/script|iframe|foreignObject|onload|onmouseover|<set|<animate/i);
  });
  it('removes external references but keeps internal ones and embedded images', () => {
    expect(out).not.toContain('evil.example');
    expect(out).toContain('href="#c"');
    expect(out).toContain('data:image/png;base64,AAAA');
    expect(out).toContain('url(#grad)');
  });
  it('keeps the drawing', () => {
    expect(doc.querySelectorAll('circle, rect, image, use').length).toBe(5);
  });
  it('cleanCss drops imports and external urls only', () => {
    expect(cleanCss('@import "x.css"; a{fill:url(#g);b:url(https://x/y)}')).toBe(' a{fill:url(#g);b:none}');
  });
});

describe('svg helpers', () => {
  it('parseLen understands units', () => {
    expect(parseLen('210mm')).toEqual({ n: 210, unit: 'mm' });
    expect(parseLen(' 12.5 ')).toEqual({ n: 12.5, unit: '' });
    expect(parseLen('abc')).toBeNull();
  });
  it('readViewBox prefers the viewBox, else width/height in px', () => {
    expect(readViewBox(parseSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="1 2 30 40"/>').documentElement)).toEqual({ x: 1, y: 2, w: 30, h: 40 });
    expect(readViewBox(parseSvg('<svg xmlns="http://www.w3.org/2000/svg" width="1in" height="96"/>').documentElement)).toEqual({ x: 0, y: 0, w: 96, h: 96 });
  });
  it('aiId encodes layer names the way Illustrator does', () => {
    expect(aiId('Die cut')).toBe('Die_cut');
    expect(aiId('scpro2_printonly')).toBe('scpro2_x5F_printonly');
    expect(aiId('2 Tool')).toBe('_2_Tool');
  });
  it('parseSvg rejects non-SVG input', () => {
    expect(() => parseSvg('<html/>')).toThrow();
  });
});
