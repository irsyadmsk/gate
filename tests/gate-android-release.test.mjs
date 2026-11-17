import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateReleaseEnv, MAX_VERSION_CODE } from '../scripts/android-release-config.mjs';

const root = process.platform === 'win32' ? 'C:\\Users\\Contoh\\Github\\gate' : '/home/contoh/gate'; // check:public-allow
const outside = process.platform === 'win32' ? 'C:\\Users\\Contoh\\kunci\\upload.jks' : '/home/contoh/kunci/upload.jks'; // check:public-allow
const inside = process.platform === 'win32' ? `${root}\\android\\upload.jks` : `${root}/android/upload.jks`;
const good = {
  PUBLIC_SUPABASE_URL: 'https://contoh.supabase.co',
  PUBLIC_GATE_ORIGIN: 'https://gate.irsyads.com',
  PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_' + 'a'.repeat(24),
  GATE_ANDROID_VERSION_CODE: '12',
  GATE_ANDROID_UPLOAD_STORE_FILE: outside,
  GATE_ANDROID_UPLOAD_STORE_PASSWORD: 'x',
  GATE_ANDROID_UPLOAD_KEY_ALIAS: 'upload',
  GATE_ANDROID_UPLOAD_KEY_PASSWORD: 'x',
};
const check = (env, files = [outside, inside]) => validateReleaseEnv(env, { root, isFile: (path) => files.includes(path) });

test('konfigurasi rilis lengkap lolos', () => assert.deepEqual(check(good), []));

test('versionCode wajib, bulat positif, dan di bawah batas Play', () => {
  assert.match(check({ ...good, GATE_ANDROID_VERSION_CODE: '' }).join(), /GATE_ANDROID_VERSION_CODE/);
  for (const bad of ['0', '-1', '1.5', '01', 'abc', String(MAX_VERSION_CODE + 1), '99999999999']) {
    assert.match(check({ ...good, GATE_ANDROID_VERSION_CODE: bad }).join(), /GATE_ANDROID_VERSION_CODE/, bad);
  }
  assert.deepEqual(check({ ...good, GATE_ANDROID_VERSION_CODE: String(MAX_VERSION_CODE) }), []);
});

test('origin harus HTTPS polos dan kunci harus publishable', () => {
  for (const bad of ['http://gate.irsyads.com', 'https://gate.irsyads.com/path', 'https://u:p@contoh.test', 'bukan url']) {
    assert.match(check({ ...good, PUBLIC_GATE_ORIGIN: bad }).join(), /PUBLIC_GATE_ORIGIN/, bad);
  }
  assert.match(check({ ...good, PUBLIC_SUPABASE_ANON_KEY: 'eyJ' + 'a'.repeat(30) }).join(), /publishable/);
  assert.match(check({ ...good, PUBLIC_SUPABASE_URL: '' }).join(), /PUBLIC_SUPABASE_URL/);
});

test('upload keystore harus absolut, ada, dan di luar repo terbuka', () => {
  assert.match(check({ ...good, GATE_ANDROID_UPLOAD_STORE_FILE: 'kunci/upload.jks' }).join(), /absolut/);
  assert.match(check(good, []).join(), /tidak ditemukan/);
  assert.match(check({ ...good, GATE_ANDROID_UPLOAD_STORE_FILE: inside }).join(), /di dalam folder repo/);
  for (const name of ['GATE_ANDROID_UPLOAD_STORE_PASSWORD', 'GATE_ANDROID_UPLOAD_KEY_ALIAS', 'GATE_ANDROID_UPLOAD_KEY_PASSWORD']) {
    assert.match(check({ ...good, [name]: ' ' }).join(), new RegExp(name), name);
  }
});

test('build.gradle membaca versi dari env dan package.json, tanpa angka tertanam', () => {
  const gradle = readFileSync(new URL('../android/app/build.gradle', import.meta.url), 'utf8');
  assert.match(gradle, /GATE_ANDROID_VERSION_CODE/);
  assert.match(gradle, /versionCode gateVersionCode/);
  assert.match(gradle, /versionName gateVersionName/);
  assert.doesNotMatch(gradle, /versionCode \d/);
  assert.match(gradle, /App Link hanya dibutuhkan login OAuth/);
  assert.match(gradle, /debug\.manifest\.srcFile 'src\/appLinks\/AndroidManifest\.xml'/);
});
