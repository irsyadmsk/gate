/**
 * Mengisi CSP di dist/_headers setelah `astro build` (aturan S7 di docs/ATURAN_PERBAIKAN.md).
 *
 * public/_headers memuat kebijakan lengkap dengan tiga penampung: {{script-hashes}}, {{style-hashes}},
 * dan {{supabase-origin}}. Skrip ini menghitung SHA-256 setiap <script>/<style> inline di dist/**\/*.html
 * dan menulisnya ke kebijakan, sehingga `script-src` tidak perlu 'unsafe-inline'. Build gagal bila ada
 * penangan peristiwa inline (onclick=...) atau atribut style="..." di HTML statis, karena keduanya
 * tidak bisa dicakup tanpa melemahkan kebijakan.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sha256 = (text) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;

export function inlineHashes(html) {
  const scripts = new Set(), styles = new Set();
  for (const [, tag, attributes, body] of html.matchAll(/<(script|style)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    if (tag.toLowerCase() === 'script') {
      if (/\bsrc\s*=/i.test(attributes)) continue;
      scripts.add(sha256(body));
    } else {
      styles.add(sha256(body));
    }
  }
  return { scripts, styles };
}

/** Hal yang tidak dapat dicakup CSP ketat. Kosong berarti HTML aman. */
export function inlineViolations(html) {
  const stripped = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  const found = [];
  if (/\son[a-z]+\s*=\s*["']/i.test(stripped)) found.push('penangan peristiwa inline (onclick=…)');
  if (/\sstyle\s*=\s*["']/i.test(stripped)) found.push('atribut style="…"');
  if (/\bjavascript:/i.test(stripped)) found.push('URL javascript:');
  return found;
}

export function supabaseOrigin(env = process.env, read = (path) => readFileSync(path, 'utf8')) {
  let value = env.PUBLIC_SUPABASE_URL?.trim();
  if (!value) {
    const source = read(fileURLToPath(new URL('../packages/supabase/src/proyek.ts', import.meta.url)));
    value = source.match(/SUPABASE_URL_BAWAAN\s*=\s*["']([^"']+)["']/)?.[1];
  }
  const url = new URL(value ?? '');
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Alamat Supabase untuk CSP harus origin HTTPS.');
  return url.origin;
}

export function buildHeaders(template, { scripts, styles, supabase }) {
  if (!/^\s*Content-Security-Policy:/m.test(template)) throw new Error('public/_headers tidak memuat Content-Security-Policy.');
  const tidy = (line) => (/^\s*Content-Security-Policy:/.test(line) ? line.replace(/(\S) {2,}/g, '$1 ').replace(/ ;/g, ';') : line);
  const output = template
    .replaceAll('{{script-hashes}}', [...scripts].sort().join(' '))
    .replaceAll('{{style-hashes}}', [...styles].sort().join(' '))
    .replaceAll('{{supabase-origin}}', supabase)
    .split('\n').map(tidy).join('\n');
  if (output.includes('{{')) throw new Error('Masih ada penampung {{…}} di _headers.');
  const policyLines = output.split('\n').filter((line) => /^\s*Content-Security-Policy:/.test(line));
  if (policyLines.some((line) => /unsafe-(?:inline|eval)/.test(line))) throw new Error("CSP tidak boleh memuat 'unsafe-inline' atau 'unsafe-eval'.");
  return output;
}

function htmlFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? htmlFiles(path) : entry.name.endsWith('.html') ? [path] : [];
  });
}

export function writeCsp(dist) {
  const scripts = new Set(), styles = new Set(), problems = [];
  for (const file of htmlFiles(dist)) {
    const html = readFileSync(file, 'utf8');
    const hashes = inlineHashes(html);
    hashes.scripts.forEach((hash) => scripts.add(hash));
    hashes.styles.forEach((hash) => styles.add(hash));
    for (const violation of inlineViolations(html)) problems.push(`${file}: ${violation}`);
  }
  if (problems.length) throw new Error(`HTML memuat kode inline yang tidak dapat dicakup CSP:\n  ${problems.join('\n  ')}`);
  const headersFile = join(dist, '_headers');
  writeFileSync(headersFile, buildHeaders(readFileSync(headersFile, 'utf8'), { scripts, styles, supabase: supabaseOrigin() }));
  return { scripts: scripts.size, styles: styles.size };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = writeCsp(fileURLToPath(new URL('../dist/', import.meta.url)));
  console.log(`CSP ditulis ke dist/_headers (${result.scripts} hash skrip, ${result.styles} hash gaya).`);
}
