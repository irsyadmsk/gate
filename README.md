# Gate

Aplikasi pos gerbang untuk sekolah berasrama: QR GTK, izin keluar murid, kunjungan tamu, shift dan serah terima, buku jaga, serta laporan CSV/XLSX/DOCX.

Repositori mandiri hasil pemisahan dari Irsyads pada 29 Oktober 2026. Aplikasi dibangun dari folder ini, tanpa checkout atau node_modules monorepo Irsyads.

## Menjalankan

Node.js >= 22.12 dan npm diperlukan.

```sh
npm ci
npm run dev
```

Buka http://127.0.0.1:4341. `npm run build` menghasilkan dist/; `npm run preview` menyajikannya di port 4342. `npm test` menjalankan tes Gate secara lokal. Dependensi dikunci dalam package-lock.json.

## Batas layanan

- Frontend, inti aturan Gate, tes, dan sumber Edge Functions Gate berada di repositori ini.
- Login memakai akun Irsyads ID: formulir di Gate (web dan Android) atau, di web, tombol "Masuk dengan Irsyads ID". Sesi web memakai cookie `*.irsyads.com` yang sama dengan `id.irsyads.com`. Pendaftaran dan pemulihan sandi tetap di Irsyads ID. Sesi, profil akun, RBAC, dan database Supabase masih memakai layanan Irsyads yang sudah ada. Pemisahan repositori tidak membuat proyek database atau akun baru.
- Kandidat ruang admin dan satpam kini tersedia langsung di Gate: GTK/kartu, status petugas, laporan, dan serah terima. Panel Studio lama tetap menjadi integrasi kompatibilitas; kandidat ini belum dirilis ke produksi. Lihat docs/2026-10-29_WORKSPACES_LOCAL.md.
- Domain layanan yang sudah ada: https://gate.irsyads.com. Pemisahan ini tidak men-deploy ulang layanan atau mengubah database/DNS.

Salinan terbatas adapter login/sesi berada di packages/supabase/src/; packages/design-tokens/src/preferences.ts hanya mendefinisikan tipe preferensi. Inti aturan di packages/gate/ hanya memuat mesin Gate asrama; Studio memelihara salinannya sendiri di monorepo Irsyads. Perubahan kontrak bersama harus dikoordinasikan; lihat [catatan pemisahan](docs/EXTRACTION.md).

## Konfigurasi

Salin .env.example ke .env jika perlu mengganti konfigurasi. Nilai bawaan adapter memakai URL dan kunci **publishable** Irsyads yang memang tersedia di browser; kunci ini bukan kunci server. Jangan menaruh secret/service-role key dalam variabel PUBLIC_*, frontend, atau Git.

Frontend pengembangan biasa tetap mengarah ke layanan yang dikonfigurasi. Untuk uji dengan **data sintetis saja**, gunakan:

```sh
npm run preview:fixture
```

Server fixture hanya mendengarkan loopback di http://127.0.0.1:4571, tidak mengakses Supabase, dan menyimpan state contoh di scratch/ yang diabaikan Git. Akun serta sandinya hanya berlaku di server fixture. Route fixture /studio merupakan alias konsol Gate untuk pemeriksaan HTTP; antarmuka Studio asli tidak disalin.

## Android

Proyek Capacitor ada di `android/`. [Panduan Android](docs/ANDROID_DEVELOPMENT.md) menjelaskan build APK uji dan cara menghubungkan HP ke fixture melalui USB. [Rencana Play Store](docs/ANDROID_PLAY_STORE_PLAN.md) memuat cakupan dan syarat rilis, [materi pengajuan](docs/ANDROID_PLAY_SUBMISSION.md) memuat isian Play Console dan langkah membangun AAB, dan [matriks uji perangkat](docs/ANDROID_DEVICE_TEST.md) mencatat hasil uji. Layar masuk punya tombol "Coba mode demo" (data rekaan di memori, tanpa jaringan) untuk reviewer dan calon pengguna; kebijakan privasi ada di `/privasi`.

## Backend dan publikasi

supabase/functions/{gate-console,gate-public,gate-tamu} dan migrasi Gate disalin sebagai sumber yang sudah ada. Migrasi membutuhkan skema identitas/RBAC Irsyads; ini bukan bootstrap Supabase baru. ops/review/ hanya berisi SQL skema untuk tes. Tidak ada data sekolah, backup database, riwayat monorepo, .env, atau secret server yang disertakan.

`npm run build:engine` membentuk ulang engine fungsi dari inti aturan. Perubahan engine memerlukan tes ulang dan pemeriksaan kompatibilitas Studio. Penerapan backend, migrasi, dan deploy Cloudflare dilakukan secara sengaja dengan persetujuan pemilik. Tidak ada workflow Actions/deploy otomatis. Konfigurasi Worker gate berada di wrangler.jsonc.

Pendaftaran tamu mandiri (`gate-public`) memverifikasi token Cloudflare Turnstile di server dan membutuhkan secret `TURNSTILE_SECRET_KEY` di Edge Functions; tanpa secret pendaftaran ditolak. Pengembangan lokal formulir tamu memakai `http://localhost:4341` (bukan 127.0.0.1) karena widget hanya mengizinkan hostname `*.irsyads.com` dan `localhost`.

Kode dipublikasikan tanpa penambahan lisensi distribusi baru pada saat pemisahan.

## Keamanan repo terbuka

Cara melapor kerentanan ada di [SECURITY.md](SECURITY.md). Sebelum push jalankan `npm run check:public` (tambahkan `-- --history` untuk memeriksa riwayat Git). `npm run build` menulis Content-Security-Policy ke `dist/_headers` dengan hash skrip inline (`scripts/write-csp.mjs`), dan halaman tidak memuat font atau skrip pihak ketiga. Rencana perbaikan dan aturan lengkap: [docs/ATURAN_PERBAIKAN.md](docs/ATURAN_PERBAIKAN.md).

## Ruang kerja Gate (kandidat lokal)

Admin dan satpam bekerja langsung melalui Gate. Satpam dapat meninjau keberadaan orang, kartu, buku jaga/foto, laporan, dan kiriman pergantian jaga. Admin mengelola GTK, kartu/tautan akun, pengasuh, penerima, serta pemberian/pencabutan hak satpam. Lihat [catatan implementasi](docs/2026-10-29_WORKSPACES_LOCAL.md) dan [konfigurasi foto privat](docs/DRIVE_PHOTOS.md).
