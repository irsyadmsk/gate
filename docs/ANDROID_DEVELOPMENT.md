# Menguji Gate pada Android

Varian `fixture` memakai paket `com.irsyads.gate.fixture` dan menampilkan nama **Irsyads Gate Uji**. Server fixture lokal menyediakan akun dan data sintetis. HTTP dibatasi ke loopback Android pada varian ini. Varian `release` hanya aktif lewat `npm run android:bundle:release` (butuh upload keystore di luar repo).

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

## Login dan pekerjaan sebelum release

Login Android memakai formulir di aplikasi (email, sandi, Turnstile). `src/lib/android-session.ts` memanggil Supabase Auth langsung lewat CapacitorHttp (`grant_type=password`, lalu `refresh_token`) dan menyimpan sesi terenkripsi lewat plugin `GateSession` (Android Keystore). Kata sandi tidak disimpan, supabase-js tidak dipakai, dan token tidak pernah ada di `localStorage`. Keluar akun selalu menghapus sesi perangkat dan berkas ekspor sementara, lalu mencoba mencabut sesi di server. Widget Turnstile berjalan di WebView dengan origin `https://localhost`, yang diizinkan widget produksi. Tombol Irsyads ID tidak ditampilkan di Android.

Build rilis: set `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY` (kunci publishable), dan `PUBLIC_GATE_ORIGIN` (origin HTTPS), lalu jalankan `npm run android:bundle:release` dengan variabel upload keystore (`GATE_ANDROID_UPLOAD_*`). Build debug dan fixture: `npm run android:sync`, lalu `:app:assembleDebug` atau `:app:assembleFixture` dari `android/`.

Uji di perangkat sebelum rilis: widget Turnstile termuat di WebView; login dengan akun uji Satpam; satu tindakan Gate; tutup dan buka aplikasi (sesi tetap); token kedaluwarsa diperbarui; keluar menghapus sesi; akun tanpa peran ditolak server; sesi yang dicabut ditolak.

### Fase 2: login lewat browser (OAuth), ditunda

`src/lib/android-oauth.ts` (PKCE S256 dengan callback Android App Link) dan tesnya dipertahankan tanpa terhubung ke UI. Hanya dikerjakan bila ada kebutuhan nyata, mis. akun yang hanya punya login Google. Syaratnya: halaman persetujuan OAuth dipindah ke host Site URL proyek bersama (UI otorisasi Supabase adalah Site URL + Authorization Path, satu per proyek), audit RLS dan RPC semua aplikasi terhadap klaim `client_id` sebelum OAuth server diaktifkan, klien publik `token_endpoint_auth_method=none` dengan redirect URI persis, `public/.well-known/assetlinks.json` berisi sidik jari Play App Signing, dan intent-filter App Link (`android/app/src/appLinks/`, kini hanya untuk build debug) dipasang kembali pada rilis. Bagian di bawah mencatat uji sebelumnya.

## Ekspor dan cetak

WebView tidak menangani unduhan blob maupun `window.print()`, jadi aplikasi memakai plugin `GateFiles` (`GateFilesPlugin.java`, antarmuka di `src/lib/device-files.ts`). Ekspor CSV/XLSX/DOCX ditulis ke `cache/exports/` lalu dibagikan lewat lembar berbagi sistem (FileProvider, entri `cache-path` di `file_paths.xml`); cetak kartu dan laporan memakai PrintManager, yang menawarkan "Simpan sebagai PDF". Berkas sementara dibuang saat keluar akun dan bila lebih dari satu jam. Plugin ini terdaftar di semua varian, termasuk fixture.

Uji di perangkat: ekspor tiap format dan buka di aplikasi tujuan; cetak kartu dan simpan sebagai PDF; keluar akun lalu pastikan `cache/exports/` kosong. Sampai saat ini plugin baru teruji sampai kompilasi dan paket APK fixture.

## Bukti uji Supabase lokal (OAuth, fase 2)

Stack Docker terpisah menguji OAuth PKCE dengan penyedia Supabase Auth dan Postgres lokal. Akun sintetis memberi persetujuan atau menolak melalui API Supabase. Token Satpam membuka snapshot dan mencatat pergerakan GTK melalui handler Gate serta RPC yang ada. Pengulangan perintah terdeteksi, akun tanpa peran ditolak, dan sesi Android yang dicabut ditolak Gate. Sesi web tetap berlaku setelah logout Android. Harness lokal menjalankan handler dalam Node dengan adapter konfigurasi Deno. Uji ini mencakup protokol dan backend dengan akun sintetis. Uji portal Irsyads ID staging, verifikasi domain App Link dan penggunaan di perangkat masih terpisah.

## Domain uji Android (App Link, fase 2)

Pada 6 November 2026, Worker statis `gate-uat` dipasang pada [gate-uat.irsyads.com](https://gate-uat.irsyads.com). Worker itu memuat halaman informasi, halaman kembali ke aplikasi, dan [assetlinks.json](https://gate-uat.irsyads.com/.well-known/assetlinks.json). File JSON dilayani lewat HTTPS tanpa redirect dan cocok dengan paket serta sertifikat APK debug. Pemeriksaan Google Digital Asset Links mengembalikan `linked: true`.

APK debug uji (tidak disertakan di repo) memakai host `gate-uat.irsyads.com` dan paket `com.irsyads.gate.debug`. Build ini dipakai untuk memeriksa App Link. Halaman persetujuan dan login baru dapat diuji secara daring setelah proyek Supabase dan portal ID staging terhubung. APK rilis kelak memerlukan relasi tersendiri untuk paket rilis dengan sertifikat Play App Signing.

APK berhasil dipasang di emulator Android 16. Android melaporkan `gate-uat.irsyads.com: verified` dan menemukan aktivitas Gate serta Chrome untuk URL callback. Pemeriksaan aktivitas default mengembalikan pemilih aplikasi Android. Uji membuka tautan dari browser dan menyelesaikan login tetap diperlukan pada perangkat.

Belum ada proyek Supabase uji terpisah. Domain UAT saat ini melayani aset statis untuk uji App Link. Alur OAuth dan API Gate telah diuji dengan stack Supabase lokal yang memakai akun sintetis.

## Uji pengemasan AAB lokal

Gunakan `bundleDebug` untuk memeriksa pengemasan tanpa akses Play Console atau upload key penerbit. Jalankan dari root repo dengan JDK dan SDK yang sama dengan build APK.

```powershell
npm run android:sync
Push-Location android
.\gradlew.bat :app:bundleDebug
Pop-Location
```

Hasilnya `android/app/build/outputs/bundle/debug/app-debug.aab` dengan paket `com.irsyads.gate.debug`. Jalankan `bundletool validate --bundle=<file>` untuk memeriksa struktur, lalu `bundletool build-apks --mode=universal --bundle=<file> --output=<file.apks>` untuk menguji pembentukan APK. Gunakan `apksigner verify` pada APK hasil ekstraksi. AAB ini untuk pemeriksaan lokal dan memakai kunci debug. Pengajuan Play memakai paket rilis `com.irsyads.gate` dan upload key milik penerbit. [Dokumentasi bundletool](https://developer.android.com/tools/bundletool)
