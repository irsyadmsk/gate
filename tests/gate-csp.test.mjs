import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { inlineHashes, inlineViolations, buildHeaders, supabaseOrigin } from '../scripts/write-csp.mjs';

const hash = (text) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
const template = await readFile(new URL('../public/_headers', import.meta.url), 'utf8');
const policy = (output) => output.split('\n').find((line) => line.includes('Content-Security-Policy:'));

test('hash dihitung untuk skrip dan gaya inline, bukan skrip berkas', () => {
  const html = '<style>.a{display:contents}</style><script>go()</script><script type="module" src="/_astro/a.js"></script>';
  const { scripts, styles } = inlineHashes(html);
  assert.deepEqual([...scripts], [hash('go()')]);
  assert.deepEqual([...styles], [hash('.a{display:contents}')]);
});

test('penangan inline, atribut style, dan javascript: ditandai; isi skrip tidak', () => {
  assert.equal(inlineViolations('<button onclick="x()">a</button>').length, 1);
  assert.equal(inlineViolations('<div style="color:red">a</div>').length, 1);
  assert.equal(inlineViolations('<a href="javascript:x()">a</a>').length, 1);
  assert.deepEqual(inlineViolations('<script>el.setAttribute("onclick","x"); const s = "style=\\"a\\"";</script><p class="a">ok</p>'), []);
});

test('kebijakan terisi lengkap, ketat, dan tanpa penampung tersisa', () => {
  const output = buildHeaders(template, { scripts: new Set([hash('a'), hash('b')]), styles: new Set([hash('c')]), supabase: 'https://abc.supabase.co' });
  const line = policy(output);
  assert.match(line, /script-src 'self' 'sha256-[^']+' 'sha256-[^']+';/);
  assert.match(line, /style-src 'self' 'sha256-[^']+';/);
  assert.match(line, /connect-src 'self' https:\/\/abc\.supabase\.co;/);
  assert.match(line, /frame-ancestors 'none'/);
  assert.match(line, /object-src 'none'/);
  assert.match(line, /default-src 'self'/);
  assert.doesNotMatch(output, /\{\{/);
  assert.doesNotMatch(line, /unsafe-/);
  assert.match(output, /^ {2}Content-Security-Policy:/m);
});

test('tanpa hash gaya, style-src tetap rapi', () => {
  const line = policy(buildHeaders(template, { scripts: new Set(), styles: new Set(), supabase: 'https://abc.supabase.co' }));
  assert.match(line, /script-src 'self'; style-src 'self'; img-src/);
});

test('template tanpa CSP atau dengan unsafe-inline ditolak', () => {
  const data = { scripts: new Set(), styles: new Set(), supabase: 'https://abc.supabase.co' };
  assert.throws(() => buildHeaders('/*\n  X-Test: 1\n', data), /Content-Security-Policy/);
  assert.throws(() => buildHeaders("/*\n  Content-Security-Policy: script-src 'unsafe-inline'\n", data), /unsafe-inline/);
});

test('origin Supabase dari env atau default sumber, hanya HTTPS', () => {
  assert.equal(supabaseOrigin({ PUBLIC_SUPABASE_URL: 'https://xyz.supabase.co/' }), 'https://xyz.supabase.co');
  assert.equal(supabaseOrigin({}, () => 'export const SUPABASE_URL_BAWAAN = "https://def.supabase.co";'), 'https://def.supabase.co');
  assert.throws(() => supabaseOrigin({ PUBLIC_SUPABASE_URL: 'http://xyz.supabase.co' }), /HTTPS/);
  assert.throws(() => supabaseOrigin({}, () => ''), /Invalid URL/);
});

test('layout tidak lagi memuat font atau skrip pihak ketiga', async () => {
  const layout = await readFile(new URL('../src/layouts/Dasar.astro', import.meta.url), 'utf8');
  assert.doesNotMatch(layout, /fonts\.(googleapis|gstatic)\.com/);
  assert.doesNotMatch(layout, /<script[^>]+src=["']https?:/);
});
