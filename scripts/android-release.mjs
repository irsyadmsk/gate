import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const android = fileURLToPath(new URL('../android/', import.meta.url));
const uploadSettings = [
  'GATE_ANDROID_UPLOAD_STORE_FILE',
  'GATE_ANDROID_UPLOAD_STORE_PASSWORD',
  'GATE_ANDROID_UPLOAD_KEY_ALIAS',
  'GATE_ANDROID_UPLOAD_KEY_PASSWORD',
];

function requireValue(name) {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`Konfigurasi rilis Android belum diisi: ${name}`);
  return value;
}

function requireHttpsOrigin(name) {
  const url = new URL(requireValue(name));
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${name} harus berupa origin HTTPS.`);
  }
}

function run(command, args, options) {
  const result = spawnSync(command, args, { ...options, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

requireHttpsOrigin('PUBLIC_SUPABASE_URL');
requireHttpsOrigin('PUBLIC_GATE_ORIGIN');
if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(requireValue('PUBLIC_SUPABASE_ANON_KEY'))) {
  throw new Error('Rilis Android memerlukan publishable key Supabase.');
}
for (const name of uploadSettings) requireValue(name);
const keystore = process.env.GATE_ANDROID_UPLOAD_STORE_FILE;
if (!isAbsolute(keystore) || !statSync(keystore, { throwIfNoEntry: false })?.isFile()) {
  throw new Error('Gunakan path absolut ke file upload keystore.');
}

const assetEnv = { ...process.env };
for (const name of uploadSettings) delete assetEnv[name];
delete assetEnv.GATE_ANDROID_RELEASE;
run(process.execPath, [requireValue('npm_execpath'), 'run', 'android:sync'], { cwd: root, env: assetEnv });

const releaseOptions = { cwd: android, env: { ...process.env, GATE_ANDROID_RELEASE: '1' } };
if (process.platform === 'win32') {
  run('cmd.exe', ['/d', '/c', 'gradlew.bat', ':app:bundleRelease'], releaseOptions);
} else {
  run('./gradlew', [':app:bundleRelease'], releaseOptions);
}
