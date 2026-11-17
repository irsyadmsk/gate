/**
 * Memeriksa AAB rilis hasil `npm run android:bundle:release` sebelum diunggah (D1):
 * tanda tangan (jarsigner), struktur (bundletool validate) dan manifest gabungan.
 *
 * Manifest dibaca dari AAB itu sendiri lewat `bundletool dump manifest` bila `GATE_BUNDLETOOL_JAR`
 * menunjuk ke bundletool-all.jar. Tanpa bundletool, dipakai manifest gabungan hasil Gradle dan
 * `validate` dilewati dengan peringatan; jalankan pemeriksaan penuh sebelum unggah.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PACKAGE = 'com.irsyads.gate';
export const MIN_SDK = 24;
export const MIN_TARGET_SDK = 36;
/** Izin yang boleh ada di manifest gabungan. Yang terakhir ditambahkan AndroidX untuk receiver dinamis. */
const ALLOWED_PERMISSIONS = new Set(['android.permission.INTERNET', 'android.permission.CAMERA', `${PACKAGE}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`]);
/** Komponen yang boleh `exported="true"`. */
const ALLOWED_EXPORTED = new Set([`${PACKAGE}.MainActivity`, '.MainActivity', 'androidx.profileinstaller.ProfileInstallReceiver']);

const attributes = (text) => Object.fromEntries([...text.matchAll(/(?:^|\s)(?:android:|tools:)?([\w.-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));

/** @returns {string[]} daftar masalah pada manifest gabungan; kosong berarti lolos. */
export function checkManifest(xml, { minSdk = MIN_SDK, minTargetSdk = MIN_TARGET_SDK } = {}) {
  const problems = [];
  const tags = [...xml.matchAll(/<([\w.-]+)\b([^>]*?)\/?>/gs)].map((m) => ({ name: m[1], attr: attributes(m[2]) }));
  const first = (name) => tags.find((tag) => tag.name === name)?.attr;

  const root = first('manifest');
  if (!root) return ['Manifest tidak dapat dibaca.'];
  if (root.package && root.package !== PACKAGE) problems.push(`applicationId ${root.package}, seharusnya ${PACKAGE}.`);
  if (!/^[1-9][0-9]*$/.test(root.versionCode ?? '')) problems.push('versionCode tidak ada.');
  if (!root.versionName) problems.push('versionName tidak ada.');

  const permissions = tags.filter((tag) => tag.name === 'uses-permission' || tag.name === 'uses-permission-sdk-23').map((tag) => tag.attr.name);
  for (const name of permissions) if (!ALLOWED_PERMISSIONS.has(name)) problems.push(`Izin tidak diharapkan: ${name}.`);
  for (const name of ['android.permission.INTERNET', 'android.permission.CAMERA']) if (!permissions.includes(name)) problems.push(`Izin ${name} hilang.`);

  const sdk = first('uses-sdk');
  if (!sdk) problems.push('uses-sdk tidak ada.');
  else {
    if (Number(sdk.minSdkVersion) !== minSdk) problems.push(`minSdk ${sdk.minSdkVersion}, seharusnya ${minSdk}.`);
    if (!(Number(sdk.targetSdkVersion) >= minTargetSdk)) problems.push(`targetSdk ${sdk.targetSdkVersion}, minimal ${minTargetSdk}.`);
  }

  const app = first('application');
  if (!app) problems.push('Elemen application tidak ada.');
  else {
    if (app.debuggable === 'true') problems.push('Build rilis tidak boleh debuggable.');
    if (app.allowBackup !== 'false') problems.push('allowBackup harus false (sesi dan berkas privat tidak boleh ikut cadangan).');
    if (app.usesCleartextTraffic !== 'false') problems.push('usesCleartextTraffic harus false.');
  }

  for (const tag of tags) {
    if (['activity', 'activity-alias', 'service', 'receiver', 'provider'].includes(tag.name) && tag.attr.exported === 'true' && !ALLOWED_EXPORTED.has(tag.attr.name)) {
      problems.push(`Komponen diekspor tanpa alasan: ${tag.attr.name}.`);
    }
    if (tag.name === 'category' && tag.attr.name === 'android.intent.category.BROWSABLE') problems.push('Ada intent-filter BROWSABLE (App Link/deep link belum termasuk rilis pertama).');
    if (tag.name === 'intent-filter' && tag.attr.autoVerify === 'true') problems.push('Ada intent-filter autoVerify.');
  }
  return problems;
}

function javaTool(name) {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  return process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', exe) : name;
}
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  return result;
}

function main() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const aab = join(root, 'android/app/build/outputs/bundle/release/app-release.aab');
  const fail = (message) => { console.error(`android:verify GAGAL: ${message}`); process.exit(1); };
  if (!existsSync(aab)) fail(`AAB rilis tidak ditemukan (${aab}). Jalankan npm run android:bundle:release.`);

  const signature = run(javaTool('jarsigner'), ['-verify', aab]);
  if (signature.status !== 0 || !/jar verified/.test(signature.stdout)) fail('Tanda tangan AAB tidak valid.');
  console.log('Tanda tangan AAB: jar verified.');

  let xml;
  const bundletool = process.env.GATE_BUNDLETOOL_JAR;
  if (bundletool) {
    const validate = run(javaTool('java'), ['-jar', bundletool, 'validate', `--bundle=${aab}`]);
    if (validate.status !== 0) fail(`bundletool validate menolak AAB:\n${validate.stdout}${validate.stderr}`);
    console.log('bundletool validate: lolos.');
    const dump = run(javaTool('java'), ['-jar', bundletool, 'dump', 'manifest', `--bundle=${aab}`]);
    if (dump.status !== 0) fail(`bundletool dump manifest gagal:\n${dump.stderr}`);
    xml = dump.stdout;
  } else {
    const merged = join(root, 'android/app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml');
    if (!existsSync(merged)) fail('Manifest gabungan tidak ditemukan; set GATE_BUNDLETOOL_JAR untuk membacanya dari AAB.');
    console.warn('PERINGATAN: GATE_BUNDLETOOL_JAR belum diisi, bundletool validate dilewati. Jalankan pemeriksaan penuh sebelum unggah.');
    xml = readFileSync(merged, 'utf8');
  }

  const problems = checkManifest(xml);
  if (problems.length) fail(`manifest gabungan bermasalah:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
  console.log('Manifest gabungan: lolos (izin hanya INTERNET dan CAMERA, tanpa App Link, tidak debuggable, allowBackup=false, targetSdk >= 36).');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
