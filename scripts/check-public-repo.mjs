/**
 * Pemeriksaan sebelum push untuk repo terbuka (aturan S1, S3, S5 di docs/ATURAN_PERBAIKAN.md).
 *
 *   npm run check:public              berkas terlacak Git
 *   npm run check:public -- --history seluruh riwayat Git (baris yang ditambahkan)
 *
 * Memeriksa: berkas terlarang (rahasia, keystore, build, log, scratch), pola rahasia berkeyakinan
 * tinggi, email di luar domain contoh, dan jalur pengguna Windows. Nilai yang ditemukan tidak
 * dicetak utuh. Tanpa dependensi dan tanpa jaringan. Tambahkan `check:public-allow` pada baris
 * yang sengaja memuat pola serupa (mis. nilai palsu untuk tes).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ALLOW_MARKER = 'check:public-allow';

/** Berkas yang tidak boleh terlacak Git. Pola dicocokkan pada jalur bergaya POSIX. */
const FORBIDDEN_PATHS = [
  [/(^|\/)\.env(\.|$)(?!example$)/, 'berkas .env'],
  [/\.(jks|keystore|p12|pfx|pem|key)$/i, 'keystore atau kunci privat'],
  [/(^|\/)(client_secret|gate-oauth-client)[^/]*\.json$/i, 'berkas client OAuth'],
  [/(^|\/)(serviceAccountKey|service-account)[^/]*\.json$/i, 'kunci service account'],
  [/(^|\/)local\.properties$/, 'local.properties'],
  [/\.(apk|aab|apks)$/i, 'hasil build Android'],
  [/\.log$/i, 'berkas log'],
  [/(^|\/)(scratch|dist|node_modules|\.wrangler|\.astro)\//, 'folder sementara atau hasil build'],
  [/(^|\/)[^/]*(backup|dump)[^/]*\.(sql|json|csv|zip|gz)$/i, 'cadangan atau dump data'],
];

/** Pola rahasia berkeyakinan tinggi; aman diterapkan pada semua berkas teks. */
const SECRET_PATTERNS = [
  ['kunci privat', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['kunci rahasia Supabase', /\bsb_secret_[A-Za-z0-9_-]{10,}/],
  ['client secret Google', /\bGOCSPX-[A-Za-z0-9_-]{10,}/],
  ['kunci API Google', /\bAIza[0-9A-Za-z_-]{30,}/],
  ['refresh token Google', /\b1\/\/0[A-Za-z0-9_-]{30,}/],
  ['token GitHub', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/],
  ['token Slack', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['kunci akses AWS', /\bAKIA[0-9A-Z]{16}\b/],
];

/** Penugasan rahasia bernilai literal. Tidak dipakai pada tes, yang memang memuat nilai palsu. */
const ASSIGNMENT = /\b(?:secret|password|passwd|token|api[_-]?key|private[_-]?key)\w*\s*[:=]\s*["'][^"'\s]{12,}["']/i;
// TLD wajib huruf supaya spesifikasi paket seperti `npm:pkg@2.114.0` tidak dianggap email.
const EMAIL = /[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})\b/g;
const SAFE_EMAIL_DOMAIN = /(?:\.test|\.example|\.invalid|\.localhost)$|^(?:example\.(?:com|org|net)|irsyads\.com|users\.noreply\.github\.com)$/i;
const WINDOWS_USER_PATH = /[A-Za-z]:[\\/]{1,2}Users[\\/]{1,2}(?![<{$%.]|nama|user[\\/]|username|name[\\/]|\*)[^\\/\s"'`]+/i;

/** Jalur yang harus selalu diabaikan Git; diperiksa dengan `git check-ignore`. */
export const REQUIRED_IGNORED = [
  '.env', '.env.local', '.env.backend.local', 'scratch/catatan.txt', 'dist/index.html', 'node_modules/x/index.js',
  'client_secret_contoh.json', 'gate-oauth-client.json', 'android/upload.jks', 'android/release.keystore',
  'android/local.properties', 'android/app/build/outputs/apk/debug/app-debug.apk',
];

const redact = (value) => (value.length <= 8 ? '***' : `${value.slice(0, 4)}…(${value.length} karakter)`);

export function forbiddenPath(path) {
  const normalized = path.replaceAll('\\', '/');
  for (const [pattern, label] of FORBIDDEN_PATHS) if (pattern.test(normalized)) return label;
  return null;
}

/** @returns {{ rule: string, line: number, sample: string }[]} */
export function scanText(path, text, { secretsOnly = false } = {}) {
  const findings = [];
  const inTests = /(^|\/)tests\//.test(path.replaceAll('\\', '/'));
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.includes(ALLOW_MARKER)) return;
    const add = (rule, sample) => findings.push({ rule, line: index + 1, sample: redact(sample) });
    for (const [rule, pattern] of SECRET_PATTERNS) {
      const match = line.match(pattern);
      if (match) add(rule, match[0]);
    }
    if (secretsOnly) return;
    if (!inTests) {
      const match = line.match(ASSIGNMENT);
      if (match) add('penugasan rahasia literal', match[0]);
    }
    for (const match of line.matchAll(EMAIL)) if (!SAFE_EMAIL_DOMAIN.test(match[1])) add('email di luar domain contoh', match[0]);
    const windowsPath = line.match(WINDOWS_USER_PATH);
    if (windowsPath) add('jalur pengguna Windows', windowsPath[0]);
  });
  return findings;
}

export function missingIgnoreGuards(isIgnored, paths = REQUIRED_IGNORED) {
  return paths.filter((path) => !isIgnored(path));
}

const git = (args, options = {}) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options });
const gitIgnores = (path) => {
  try { execFileSync('git', ['check-ignore', '-q', '--no-index', path], { stdio: 'ignore' }); return true; } catch { return false; }
};
const isText = (buffer) => !buffer.subarray(0, 8000).includes(0);
const SKIP_CONTENT = /(^|\/)package-lock\.json$/;

export function scanTrackedFiles(read = (path) => readFileSync(path)) {
  const problems = [];
  const files = git(['ls-files', '-z']).split('\0').filter(Boolean);
  for (const path of files) {
    const label = forbiddenPath(path);
    if (label) problems.push(`${path}: ${label} tidak boleh terlacak`);
    if (SKIP_CONTENT.test(path)) continue;
    let buffer;
    try { buffer = read(path); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (buffer.length > 2_000_000 || !isText(buffer)) continue;
    for (const finding of scanText(path, buffer.toString('utf8'))) problems.push(`${path}:${finding.line}: ${finding.rule} (${finding.sample})`);
  }
  return problems;
}

export function scanHistory() {
  const problems = [];
  const names = new Set(git(['log', '--all', '--name-only', '--format=']).split(/\r?\n/).filter(Boolean));
  for (const path of names) {
    const label = forbiddenPath(path);
    if (label) problems.push(`riwayat ${path}: ${label}`);
  }
  let commit = '', file = '';
  for (const line of git(['log', '--all', '-p', '--no-color', '--format=commit %H']).split(/\r?\n/)) {
    if (line.startsWith('commit ')) { commit = line.slice(7, 19); continue; }
    if (line.startsWith('+++ ')) { file = line.slice(6); continue; }
    if (!line.startsWith('+') || SKIP_CONTENT.test(file)) continue;
    for (const finding of scanText(file, line.slice(1), { secretsOnly: true })) problems.push(`riwayat ${commit} ${file}: ${finding.rule} (${finding.sample})`);
  }
  return problems;
}

export function runCheck({ history = false } = {}) {
  const problems = [
    ...missingIgnoreGuards(gitIgnores).map((path) => `.gitignore tidak menutup ${path}`),
    ...scanTrackedFiles(),
    ...(history ? scanHistory() : []),
  ];
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const history = process.argv.includes('--history');
  const problems = runCheck({ history });
  if (problems.length) {
    console.error(`check:public GAGAL (${problems.length} temuan)\n` + problems.map((p) => `  - ${p}`).join('\n'));
    process.exit(1);
  }
  console.log(`check:public lulus${history ? ' (termasuk riwayat Git)' : ''}.`);
}
