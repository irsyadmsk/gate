import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { UPLOAD_SETTINGS, validateReleaseEnv } from './android-release-config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const android = fileURLToPath(new URL('../android/', import.meta.url));

function run(command, args, options) {
  const result = spawnSync(command, args, { ...options, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const problems = validateReleaseEnv(process.env, { root, isFile: (path) => statSync(path, { throwIfNoEntry: false })?.isFile() === true });
if (problems.length) {
  console.error(`Konfigurasi rilis Android belum lengkap:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
  process.exit(1);
}
if (!process.env.npm_execpath) throw new Error('Jalankan lewat `npm run android:bundle:release`.');

// Aset web dibangun tanpa rahasia unggah; hanya Gradle yang menerimanya.
const assetEnv = { ...process.env };
for (const name of UPLOAD_SETTINGS) delete assetEnv[name];
delete assetEnv.GATE_ANDROID_RELEASE;
run(process.execPath, [process.env.npm_execpath, 'run', 'android:sync'], { cwd: root, env: assetEnv });

const releaseOptions = { cwd: android, env: { ...process.env, GATE_ANDROID_RELEASE: '1' } };
if (process.platform === 'win32') {
  // `.\` eksplisit: cmd tidak selalu mencari di folder kerja (mis. NoDefaultCurrentDirectoryInExePath di Git Bash).
  run('cmd.exe', ['/d', '/c', '.\\gradlew.bat', ':app:bundleRelease'], releaseOptions);
} else {
  run('./gradlew', [':app:bundleRelease'], releaseOptions);
}

// Pemeriksaan AAB hasil build (manifest, tanda tangan, bundletool bila tersedia).
run(process.execPath, [fileURLToPath(new URL('./android-verify-release.mjs', import.meta.url))], { cwd: root, env: assetEnv });
