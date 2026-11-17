import test from 'node:test';
import assert from 'node:assert/strict';
import { checkManifest } from '../scripts/android-verify-release.mjs';

// Manifest gabungan AAB rilis (hasil `bundletool dump manifest`), disederhanakan. Bila build berubah, perbarui dari AAB sungguhan.
const good = `<manifest xmlns:android="http://schemas.android.com/apk/res/android" android:compileSdkVersion="36" android:versionCode="7" android:versionName="1.0.0" package="com.irsyads.gate">
  <uses-sdk android:minSdkVersion="24" android:targetSdkVersion="36"/>
  <uses-permission android:name="android.permission.INTERNET"/>
  <uses-permission android:name="android.permission.CAMERA"/>
  <uses-feature android:name="android.hardware.camera" android:required="false"/>
  <permission android:name="com.irsyads.gate.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION" android:protectionLevel="0x00000002"/>
  <uses-permission android:name="com.irsyads.gate.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION"/>
  <application android:allowBackup="false" android:label="@string/app_name" android:usesCleartextTraffic="false">
    <activity android:exported="true" android:launchMode="2" android:name="com.irsyads.gate.MainActivity">
      <intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter>
    </activity>
    <provider android:authorities="com.irsyads.gate.fileprovider" android:exported="false" android:grantUriPermissions="true" android:name="androidx.core.content.FileProvider"/>
    <receiver android:enabled="true" android:exported="true" android:name="androidx.profileinstaller.ProfileInstallReceiver" android:permission="android.permission.DUMP">
      <intent-filter><action android:name="androidx.profileinstaller.action.INSTALL_PROFILE"/></intent-filter>
    </receiver>
  </application>
</manifest>`;
const mutate = (from, to) => { assert.ok(good.includes(from), `fixture tidak memuat ${from}`); return good.replace(from, to); };

test('manifest rilis yang benar lolos', () => assert.deepEqual(checkManifest(good), []));

test('izin tambahan, izin hilang, dan paket salah ditolak', () => {
  assert.match(checkManifest(mutate('<uses-feature', '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/><uses-feature')).join(), /ACCESS_FINE_LOCATION/);
  assert.match(checkManifest(mutate('<uses-permission android:name="android.permission.CAMERA"/>', '')).join(), /CAMERA hilang/);
  assert.match(checkManifest(mutate('package="com.irsyads.gate"', 'package="com.contoh.lain"')).join(), /applicationId/);
});

test('versi dan SDK diperiksa', () => {
  assert.match(checkManifest(mutate('android:versionCode="7"', '')).join(), /versionCode/);
  assert.match(checkManifest(mutate('android:versionName="1.0.0"', '')).join(), /versionName/);
  assert.match(checkManifest(mutate('android:targetSdkVersion="36"', 'android:targetSdkVersion="35"')).join(), /targetSdk 35/);
  assert.match(checkManifest(mutate('android:minSdkVersion="24"', 'android:minSdkVersion="23"')).join(), /minSdk 23/);
});

test('pengaturan aplikasi yang membahayakan ditolak', () => {
  assert.match(checkManifest(mutate('<application ', '<application android:debuggable="true" ')).join(), /debuggable/);
  assert.match(checkManifest(mutate('android:allowBackup="false"', 'android:allowBackup="true"')).join(), /allowBackup/);
  assert.match(checkManifest(mutate('android:allowBackup="false"', '')).join(), /allowBackup/);
  assert.match(checkManifest(mutate('android:usesCleartextTraffic="false"', 'android:usesCleartextTraffic="true"')).join(), /usesCleartextTraffic/);
});

test('komponen diekspor tanpa alasan dan deep link ditolak', () => {
  assert.match(checkManifest(mutate('<provider android:authorities="com.irsyads.gate.fileprovider" android:exported="false"', '<provider android:authorities="com.irsyads.gate.fileprovider" android:exported="true"')).join(), /FileProvider/);
  assert.match(checkManifest(mutate('</application>', '<service android:exported="true" android:name="com.contoh.Layanan"/></application>')).join(), /Layanan/);
  assert.match(checkManifest(mutate('<category android:name="android.intent.category.LAUNCHER"/>', '<category android:name="android.intent.category.BROWSABLE"/>')).join(), /BROWSABLE/);
  assert.match(checkManifest(mutate('<intent-filter><action android:name="android.intent.action.MAIN"/>', '<intent-filter android:autoVerify="true"><action android:name="android.intent.action.MAIN"/>')).join(), /autoVerify/);
});

test('teks yang bukan manifest ditolak', () => assert.deepEqual(checkManifest('<html></html>'), ['Manifest tidak dapat dibaca.']));
