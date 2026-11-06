# Menguji Gate pada Android

Varian `fixture` memakai paket `com.irsyads.gate.fixture` dan menampilkan nama **Irsyads Gate Uji**. Server fixture lokal menyediakan akun dan data sintetis. HTTP dibatasi ke loopback Android pada varian ini. Varian `release` ditahan di Gradle sampai pertukaran sesi Irsyads ID untuk aplikasi Android tersedia.

## Build dan pasang

Perlu Node.js 22.12+, JDK 21, Android SDK Platform 36, Android Build Tools, dan Platform Tools. Atur `JAVA_HOME` ke JDK 21 dan `ANDROID_HOME` ke Android SDK. Jalankan dari root Gate pada Windows.

```powershell
npm ci
npm run android:sync
Push-Location android
.\gradlew.bat :app:assembleFixture
Pop-Location
```

Hasil build ada di `android/app/build/outputs/apk/fixture/app-fixture.apk`. Jalankan server dalam terminal terpisah dari root Gate, dengan berkas state tersendiri untuk pengujian Android.

```powershell
$env:GATE_PREVIEW_STATE = 'android-fixture.json'
npm run preview:fixture
```

Hubungkan HP lewat USB, aktifkan USB debugging, dan setujui sidik jari komputer pada HP. Jalankan perintah berikut dari root repo pada terminal lain.

```powershell
$adb = Join-Path $env:ANDROID_HOME 'platform-tools/adb.exe'
& $adb devices -l
& $adb reverse tcp:4571 tcp:4571
& $adb install -r android/app/build/outputs/apk/fixture/app-fixture.apk
& $adb shell am start -n 'com.irsyads.gate.fixture/com.irsyads.gate.MainActivity'
```

Masuk dengan akun `satpam` atau `admin` dan sandi fixture yang tertera di layar masuk. Gunakan kode contoh dari [`gate-boarding-seed.mjs`](../tests/fixtures/gate-boarding-seed.mjs), atau siapkan kartu uji dari sesi Admin di browser komputer pada `http://127.0.0.1:4571/`. Biarkan server fixture berjalan selama sesi pengujian.

## Catatan uji perangkat

- Buka kamera, pindai QR GTK sintetis, lalu periksa transaksi pada Gate. Ulangi dengan kartu masih di depan kamera dan saat kartu dijauhkan. Catat model HP, versi Android dan WebView.
- Uji kode manual saat izin kamera ditolak. Pindah ke aplikasi lain ketika kamera aktif, lalu kembali dan periksa bahwa kamera perlu dibuka kembali.
- Uji izin murid yang telah disetujui, tamu masuk/keluar, serta serah terima antara `satpam` dan `satpam2`.
- Putuskan USB sesaat setelah tindakan dikirim. Setelah tersambung, periksa catatan sebelum mengulang tindakan.
- Uji ulang login dan logout fixture, orientasi layar, navigasi sistem, ekspor dan pencetakan. Catat perbedaan perilaku terhadap web.

## Pekerjaan sebelum release

APK `debug` memakai paket `com.irsyads.gate.debug` dan aset lokal. Gate membuka browser sistem, menerima kode pada Android App Link, menukarkannya dengan PKCE S256, lalu memakai token untuk `gate-console`. Sesi disimpan dalam penyimpanan privat yang dienkripsi dengan kunci Android Keystore. Browser web Gate tetap memakai sesi cookie Irsyads ID. Test `tests/gate-android-oauth.test.mjs` menjalankan protokol dengan layanan identitas simulasi.

1. Di proyek Supabase uji terisolasi, daftarkan public OAuth client khusus Gate dengan `token_endpoint_auth_method=none`. Untuk build web staging, gunakan origin Gate staging sebagai Auth Site URL, `/android/auth/consent` sebagai Authorization Path, dan isi `PUBLIC_GATE_ANDROID_CONSENT_LOGIN_URL` dengan portal ID staging yang memakai proyek Supabase yang sama. Portal ID staging harus menerima URL kembali ke Gate staging dan membagikan sesi browser dengannya. Tanpa variabel login, halaman persetujuan tidak aktif. Gunakan akun, peran, dan data Gate sintetis. Token OAuth Supabase membawa izin yang sepadan dengan sesi biasa. Sebelum mengaktifkan pada proyek bersama, audit akses data dan kebijakan lintas aplikasi berdasarkan `client_id`. [Konfigurasi OAuth server](https://supabase.com/docs/guides/auth/oauth-server/getting-started) · [Keamanan token](https://supabase.com/docs/guides/auth/oauth-server/token-security)
2. Tetapkan host HTTPS staging milik Irsyads dan daftarkan callback `https://<host-staging>/android/auth/callback` secara persis pada OAuth client. Publikasikan `/.well-known/assetlinks.json` dengan paket `com.irsyads.gate.debug` dan sidik jari SHA-256 sertifikat debug komputer penguji. Untuk kandidat Play nanti gunakan paket rilis dan sertifikat Play App Signing. [Android App Links](https://developer.android.com/training/app-links/configure-assetlinks)
3. Set `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY` (kunci publishable), `PUBLIC_GATE_ANDROID_OAUTH_CLIENT_ID`, dan `PUBLIC_GATE_ANDROID_APP_LINK_HOST` di **satu sesi terminal**. Isi host dengan nama domain huruf kecil, tanpa skema, port, atau path. Variabel host perlu terbaca oleh Astro dan Gradle agar callback cocok. Jalankan `npm run android:sync`, lalu `:app:assembleDebug` dari `android/`. APK berada di `android/app/build/outputs/apk/debug/app-debug.apk`.
4. Uji domain App Link, login dari browser, callback saat aplikasi ditutup dan sedang terbuka, pencabutan sesi atau peran, dan penolakan akun tanpa peran. Uji login serta satu tindakan Gate dengan akun Satpam uji. Logout menghapus sesi lokal dan mencoba mencabut sesi Android di server, sehingga cabut sesi server juga perlu diperiksa saat jaringan putus atau token sudah kedaluwarsa.

Build `release` ditahan sampai sambungan Irsyads ID dan Gate lulus uji. Berikutnya verifikasi perangkat pos, penandatanganan oleh penerbit, dan track pengujian Play Console.

## Bukti uji Supabase lokal

Stack Docker terpisah menguji OAuth PKCE dengan penyedia Supabase Auth dan Postgres lokal. Akun sintetis memberi persetujuan atau menolak melalui API Supabase. Token Satpam membuka snapshot dan mencatat pergerakan GTK melalui handler Gate serta RPC yang ada. Pengulangan perintah terdeteksi, akun tanpa peran ditolak, dan sesi Android yang dicabut ditolak Gate. Sesi web tetap berlaku setelah logout Android. Harness lokal menjalankan handler dalam Node dengan adapter konfigurasi Deno. Uji ini mencakup protokol dan backend dengan akun sintetis. Uji portal Irsyads ID staging, verifikasi domain App Link dan penggunaan di perangkat masih terpisah.

## Domain uji Android

Pada 6 November 2026, Worker statis `gate-uat` dipasang pada [gate-uat.irsyads.com](https://gate-uat.irsyads.com). Versi `b891cebb-2074-4b96-b6d5-ceba14187b80` memuat halaman informasi, halaman kembali ke aplikasi, dan [assetlinks.json](https://gate-uat.irsyads.com/.well-known/assetlinks.json). File JSON dilayani lewat HTTPS tanpa redirect dan cocok dengan paket serta sertifikat APK debug. Pemeriksaan Google Digital Asset Links mengembalikan `linked: true`. Aset dan konfigurasi manual ada di `scratch/gate-uat/`.

APK `scratch/gate-uat/irsyads-gate-uat-debug.apk` memakai host `gate-uat.irsyads.com` dan paket `com.irsyads.gate.debug`. Build ini dipakai untuk memeriksa App Link. Halaman persetujuan dan login baru dapat diuji secara daring setelah proyek Supabase dan portal ID staging terhubung. APK rilis kelak memerlukan relasi tersendiri untuk paket rilis dengan sertifikat Play App Signing.

APK berhasil dipasang di emulator Android 16. Android melaporkan `gate-uat.irsyads.com: verified` dan menemukan aktivitas Gate serta Chrome untuk URL callback. Pemeriksaan aktivitas default mengembalikan pemilih aplikasi Android. Uji membuka tautan dari browser dan menyelesaikan login tetap diperlukan pada perangkat.

Pembuatan proyek Supabase `gate-uat` di organisasi `irsyads.com` ditolak karena akun pemilik telah memakai dua slot proyek gratis aktif. Domain UAT saat ini melayani aset statis untuk uji App Link. Alur OAuth dan API Gate telah diuji dengan stack Supabase lokal yang memakai akun sintetis.
