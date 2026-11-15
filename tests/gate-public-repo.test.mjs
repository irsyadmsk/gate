import test from 'node:test';
import assert from 'node:assert/strict';
import { forbiddenPath, scanText, missingIgnoreGuards, runCheck, REQUIRED_IGNORED } from '../scripts/check-public-repo.mjs';

// Nilai palsu disusun saat dijalankan supaya berkas tes ini sendiri tidak memicu pemeriksaan.
const dash = '-'.repeat(5);
const fake = {
  privateKey: `${dash}BEGIN ${'PRIVATE'} KEY${dash}`,
  jwt: ['eyJ' + 'a'.repeat(12), 'eyJ' + 'b'.repeat(12), 'c'.repeat(14)].join('.'),
  googleSecret: 'GOCSPX' + '-' + 'x'.repeat(20),
  githubToken: 'ghp' + '_' + 'y'.repeat(36),
  supabaseSecret: 'sb' + '_secret_' + 'z'.repeat(20),
};

test('berkas terlarang ditolak, berkas contoh dan kode biasa lolos', () => {
  for (const path of ['.env', '.env.local', '.env.backend.local', 'android/upload.jks', 'x/client_secret_123.json',
    'scratch/log.txt', 'android/app/build/app.apk', 'dist/index.html', 'db-backup.sql', 'local.properties']) {
    assert.ok(forbiddenPath(path), path);
  }
  for (const path of ['.env.example', 'src/a.ts', 'docs/ANDROID_DEVELOPMENT.md', 'src/lib/environment.ts', 'public/_headers']) {
    assert.equal(forbiddenPath(path), null, path);
  }
});

test('pola rahasia berkeyakinan tinggi terdeteksi dan nilainya tidak dicetak utuh', () => {
  for (const [name, value] of Object.entries(fake)) {
    const found = scanText('src/a.ts', `const x = "${value}";`);
    assert.ok(found.length, name);
    assert.ok(!found.some((f) => f.sample.includes(value)), `${name} tidak boleh tercetak utuh`);
  }
});

test('kunci publishable, email contoh, dan spesifikasi paket lolos', () => {
  const lines = [
    "const key = 'sb_publishable_" + 'a'.repeat(24) + "';",
    "const owner = 'owner@contoh.test'; const d = 'kontak@irsyads.com'; const e = 'a@example.com';",
    "import { createClient } from 'npm:@supabase/supabase-js@2.114.0';",
    'const token = req.headers.get("authorization");',
  ];
  assert.deepEqual(scanText('src/a.ts', lines.join('\n')), []);
});

test('email nyata, jalur pengguna, dan penugasan rahasia literal ditandai', () => {
  assert.equal(scanText('docs/a.md', 'hubungi nama.asli@gmail.com').length, 1); // check:public-allow
  assert.equal(scanText('docs/a.md', 'lokasi C:\\Users\\PemilikAsli\\Github\\gate').length, 1); // check:public-allow
  assert.equal(scanText('docs/a.md', 'lokasi C:\\Users\\<nama>\\Github').length, 0);
  assert.equal(scanText('src/a.ts', `const password = "${'p'.repeat(14)}";`).length, 1);
  assert.equal(scanText('tests/a.test.mjs', `const password = "${'p'.repeat(14)}";`).length, 0);
});

test('penanda check:public-allow melewati satu baris saja', () => {
  const text = `const a = "${fake.githubToken}"; // check:public-allow\nconst b = "${fake.githubToken}";`;
  const found = scanText('src/a.ts', text);
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 2);
});

test('pagar .gitignore dilaporkan bila ada jalur yang tidak ditutup', () => {
  assert.deepEqual(missingIgnoreGuards(() => true), []);
  assert.deepEqual(missingIgnoreGuards((path) => path !== '.env', REQUIRED_IGNORED), ['.env']);
});

test('berkas terlacak repo ini bersih', () => {
  assert.deepEqual(runCheck(), []);
});
