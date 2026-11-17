/**
 * Pemeriksaan konfigurasi build rilis Android (D1). Murni dan tanpa efek samping supaya bisa diuji:
 * `scripts/android-release.mjs` memanggilnya sebelum Gradle berjalan.
 */
import { isAbsolute, relative, resolve } from 'node:path';

export const UPLOAD_SETTINGS = [
  'GATE_ANDROID_UPLOAD_STORE_FILE',
  'GATE_ANDROID_UPLOAD_STORE_PASSWORD',
  'GATE_ANDROID_UPLOAD_KEY_ALIAS',
  'GATE_ANDROID_UPLOAD_KEY_PASSWORD',
];
export const MAX_VERSION_CODE = 2_100_000_000; // batas Google Play

const httpsOrigin = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
  } catch { return false; }
};

/** @returns {string[]} daftar masalah; kosong berarti konfigurasi layak untuk `bundleRelease`. */
export function validateReleaseEnv(env, { root, isFile }) {
  const problems = [];
  const value = (name) => env[name]?.trim() || '';
  for (const name of ['PUBLIC_SUPABASE_URL', 'PUBLIC_GATE_ORIGIN']) {
    if (!value(name)) problems.push(`${name} belum diisi.`);
    else if (!httpsOrigin(value(name))) problems.push(`${name} harus berupa origin HTTPS.`);
  }
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(value('PUBLIC_SUPABASE_ANON_KEY'))) {
    problems.push('PUBLIC_SUPABASE_ANON_KEY harus berupa publishable key Supabase (sb_publishable_…).');
  }
  const code = value('GATE_ANDROID_VERSION_CODE');
  if (!/^[1-9][0-9]{0,9}$/.test(code) || Number(code) > MAX_VERSION_CODE) {
    problems.push(`GATE_ANDROID_VERSION_CODE harus bilangan bulat 1..${MAX_VERSION_CODE} dan lebih besar dari versionCode yang pernah diunggah.`);
  }
  for (const name of UPLOAD_SETTINGS) if (!value(name)) problems.push(`${name} belum diisi.`);
  const store = value('GATE_ANDROID_UPLOAD_STORE_FILE');
  if (store) {
    if (!isAbsolute(store)) problems.push('GATE_ANDROID_UPLOAD_STORE_FILE harus path absolut.');
    else {
      const inside = relative(resolve(root), resolve(store));
      if (!inside.startsWith('..') && !isAbsolute(inside) && inside !== '') problems.push('Upload keystore tidak boleh berada di dalam folder repo (repo terbuka). Simpan di luar.');
      if (!isFile(store)) problems.push('Berkas upload keystore tidak ditemukan.');
    }
  }
  return problems;
}
