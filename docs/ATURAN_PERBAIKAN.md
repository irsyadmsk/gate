# Aturan perbaikan Gate

Status: **usulan, revisi 16 November 2026** setelah pemilik memutuskan K1 (login berupa formulir di Gate, ditambah SSO Irsyads ID). Dokumen ini hanya rencana dan aturan. Belum ada kode, branch, deploy, migrasi, atau data yang diubah. Setiap temuan dicocokkan dengan kode pada tanggal itu, bukan dengan catatan lama.

## 1. Tujuan dan definisi selesai

1. **Gate mandiri.** Pembuatan kartu, pendaftaran tamu, dan ekspor laporan berjalan penuh dari Gate (web dan Android) tanpa membuka Studio.
2. **Login lewat Gate, SSO dengan Irsyads ID.** Pengguna dapat masuk langsung dengan formulir di Gate (email atau nama pengguna, sandi, CAPTCHA), atau dengan tombol "Masuk dengan Irsyads ID". Di web, sesi dipakai bersama `id.irsyads.com` dan layanan `*.irsyads.com` lain. Di Android versi pertama, login memakai formulir di dalam aplikasi.
3. **Siap Google Play dan aman dibuka publik.** AAB bertanda tangan dapat diunggah ke Internal testing, dan repo terbuka tidak membocorkan rahasia atau data.

Selesai berarti semua kriteria "Lulus bila" di bagian 4 terpenuhi, gerbang rilis bagian 5 terisi, dan pemilik mengonfirmasi tiap rilis.

## 2. Temuan

| # | Area | Temuan | Bukti |
|---|---|---|---|
| T1 | Web SSO | Sudah berjalan. `urlMasukId` mengirim ke `id.irsyads.com/?intent=login&redirect=<gate>`. ID hanya menerima `redirect` ke `https://*.irsyads.com`, dan sesi memakai cookie `.irsyads.com`. | `packages/supabase/src/auth.ts`, `sesi.ts` |
| T2 | Login Android (OAuth) | Klien PKCE dan penyimpanan sesi Android Keystore sudah ada, tetapi **belum bisa dipakai di produksi**. Halaman persetujuan berada di Gate (`/android/auth/consent`), sedangkan UI otorisasi OAuth Supabase adalah *Site URL + Authorization Path*, satu pengaturan per proyek. Pada proyek bersama, halaman itu harus berada di host Site URL, bukan di Gate. Alur baru terbukti di stack lokal. Dengan keputusan K1, jalur ini tidak lagi menghambat rilis pertama dan pindah ke fase 2 (C3). | `src/lib/android-oauth.ts`, `src/pages/android/auth/consent.astro`, [docs OAuth server Supabase](https://supabase.com/docs/guides/auth/oauth-server/getting-started) |
| T3 | App Links | `public/` tidak memuat `.well-known/assetlinks.json` untuk host produksi. Hanya diperlukan bila login Android memakai callback App Link (fase 2). | `public/` |
| T4 | Kartu | GTK, kartu, tautan akun, rotasi token, dan cetak (maks. 10 kartu per halaman) sudah ada di Gate untuk admin dan satpam. Tidak ada impor massal murid/GTK. Peran dasar `admin` dan `staff` berasal dari RBAC Irsyads ID. | `AdminDirectory.tsx`, `GateCards.tsx`, `gtk-accounts.ts` |
| T5 | Sisa Studio | `NativeGateRoot` menautkan pengelolaan identitas ke `studio.irsyads.com`. Mode lama (`PUBLIC_GATE_CONSOLE=0`) masih hidup berdampingan: `GateApp.tsx` (555 baris), `GtkPanel`, `GuestForm`, `gate-tamu`, tombol "muat pengaturan dari Studio". Daftar origin CORS memuat `studio.irsyads.com`. | `NativeGateRoot.tsx`, `GateApp.tsx`, `gate-console-handler.ts:12` |
| T6 | Tamu | Form publik `/tamu` memanggil `gate-public`: ada batas laju (20/jam per asal, 500/jam global, antrean 2.000), **tanpa CAPTCHA**. Turnstile hanya ada di jalur lama `gate-tamu`. Tidak ada perintah `visit.create` untuk satpam, jadi tamu jalan-masuk dicatat dengan membuka form publik di browser (di Android: browser luar). | `gate-console-handler.ts:33-44`, `boarding.ts` (daftar perintah) |
| T7 | Ekspor Android | CSV/XLSX/DOCX memakai `Blob` + `a.download`, cetak memakai `window.print()`. Proyek Android hanya memuat plugin `core`, `app`, dan `GateSession`; tidak ada Share, Filesystem, atau Print. Alur ini **belum terbukti** berjalan di APK. `file_paths.xml` bukan sisa template: Capacitor memakainya untuk foto kejadian (`<input capture>`), jadi harus dipertahankan, dan ekspor perlu entri `cache-path` tambahan. | `GateReports.tsx`, `package.json`, `android/app/src/main/res/xml/file_paths.xml` |
| T8 | Alur kerja | Seluruh pekerjaan Android ada di branch kerja `codex/gate-android-uat` (tiga commit, ditambah perubahan yang belum di-commit). `main` belum memuat Android. Ini melanggar aturan satu branch. | `git log main..` |
| T9 | Tes | 137 tes, 136 lulus di Git Bash. Satu gagal karena `whoami /user` memanggil `whoami` GNU. Nama pendek juga rawan PATH. | `scripts/drive-oauth.mjs:22` |
| T10 | Rilis Android | Skrip rilis ada (`scripts/android-release.mjs`, penandatanganan lewat env, `release` nonaktif tanpa `GATE_ANDROID_RELEASE=1`). `versionCode` tetap 1, `minifyEnabled false`. | `android/app/build.gradle` |
| T11 | Play | Belum ada halaman kebijakan privasi publik, tautan privasi di aplikasi, atau jalur akses reviewer. Data Gate satu-tenant, jadi akun demo di produksi akan melihat data sekolah. | `src/pages/`, `docs/ANDROID_PLAY_SUBMISSION.md` |
| T12 | Repo terbuka | Pemindaian pola di berkas terlacak dan riwayat git: **tidak ada** kunci server, JWT, keystore, atau `.env`. Yang tampak hanya kunci publishable Supabase dan client ID OAuth Google, yang memang publik. `.gitignore` menutup `.env*`, `client_secret*.json`, keystore. Celah: CSP hanya `frame-ancestors/base-uri/object-src/form-action` (tanpa `script-src`/`connect-src`), tidak ada `SECURITY.md`, tidak ada lisensi, tidak ada pemindaian rahasia, dan docs memuat catatan operasional pemilik. | `public/_headers`, `docs/` |
| T13 | Dasar formulir login | CAPTCHA Supabase Auth **aktif**: setiap `signInWithPassword` wajib membawa `captchaToken`. Menurut catatan di kode, widget Turnstile mengizinkan `*.irsyads.com`, `id.irsyads.com`, dan `localhost`, sehingga Gate web dan WebView Android (`https://localhost`) dapat memakainya; verifikasi di dasbor Cloudflare sebelum rilis. Klien bersama menyimpan sesi di cookie `.irsyads.com` (SSO otomatis); di host lain sesi jatuh ke `localStorage`, bukan Keystore. Salinan Gate belum memuat `keluar.ts` (`keluarSesiAman`) milik Irsyads, yang mencabut sesi di server dan memblokir pemulihan sesi lama. Formulir login ID memakai `signInWithPassword` + `captchaToken` dan pesan galat seragam (`terjemahkanGalatAuth`). | `packages/supabase/src/captcha.ts`, `klien.ts`, `sesi.ts`, `apps/id` (monorepo Irsyads) |

## 3. Aturan

### 3.1 Repo terbuka dan keamanan

- **S1. Tanpa rahasia.** Tidak ada `.env*`, keystore (`*.jks`, `*.keystore`), `client_secret*.json`, token Drive, `SERVICE_ROLE`, atau refresh token di Git. Hanya kunci `sb_publishable_…`, kunci situs Turnstile, dan client ID OAuth publik yang boleh ada.
- **S2. Server yang memutuskan.** Kode terbuka dianggap sudah dibaca penyerang. Hak akses diputuskan di RLS, `gate-console`, dan `gate-public`, tidak pernah hanya di klien.
- **S3. Tanpa data nyata.** Nama murid/GTK/tamu, nomor kartu, email, dan sandi asli tidak boleh ada di repo, fixture, tes, tangkapan layar, log, atau dokumen. Fixture memakai domain `.test`.
- **S4. Dokumen untuk pengembang.** Tanpa ID versi deploy, status kuota atau akun, jalur lokal, kontak pribadi, atau kredensial demo. Catatan itu disimpan pemilik di luar repo.
- **S5. Pemeriksaan sebelum push.** Tambahkan `npm run check:public`: memindai berkas terlacak untuk pola rahasia dan berkas terlarang; wajib lulus. Aktifkan GitHub secret scanning dan push protection (gratis untuk repo publik; tindakan pemilik). Tidak menambah workflow Actions (aturan `AGENTS.md`).
- **S6. CORS tertulis dan sempit.** Daftar origin kecil, tanpa `*`, dibaca dari konfigurasi. Hapus `studio.irsyads.com` setelah Studio tidak lagi memanggil Gate.
- **S7. Header penuh.** CSP dengan `default-src 'self'`, `script-src`, `connect-src` (hanya Supabase), `frame-src` dan `script-src` untuk `challenges.cloudflare.com` (Turnstile), `img-src 'self' data: blob:`, `frame-ancestors 'none'`. Uji bahwa semua halaman, termasuk formulir login dan widget Turnstile, tetap berjalan sebelum diterapkan.
- **S8. Endpoint publik.** `gate-public` wajib CAPTCHA terverifikasi server, batas laju per asal, dan batas antrean per asal supaya satu pihak tidak menghabiskan kuota global. Pesan galat tidak membuka data.
- **S9. Token.** Tidak masuk URL, log, atau laporan crash. Sesi Android hanya di Keystore, `allowBackup=false` (sudah), logout mencabut sesi di server.
- **S10. Dependensi.** Versi persis dan `package-lock.json` dikunci (sudah). Jalankan `npm audit` sebelum tiap rilis; temuan tinggi/kritis diperbaiki atau dicatat alasannya.
- **S11. Kontak dan lisensi.** `SECURITY.md` berisi cara melapor kerentanan secara privat. Lisensi ditetapkan pemilik (K5); tanpa lisensi berarti orang lain tidak boleh memakai ulang kode.
- **S12. Formulir login.** Hanya identitas dan sandi. Turnstile wajib dan token baru untuk tiap percobaan (`reset()` setelah setiap percobaan, berhasil atau gagal). Pesan galat seragam ("Email atau kata sandi salah"), tanpa pembeda akun ada atau tidak. Jeda bertahap di klien setelah gagal berulang, di atas batas laju Supabase Auth. Sandi tidak pernah disimpan di `localStorage`, dicatat di log, atau dikirim lewat URL. Kolom memakai `autocomplete="username"` dan `current-password` agar pengelola sandi bekerja. Tidak ada kolom "ingat saya" buatan sendiri.
- **S13. Gate tidak mengelola akun.** Pendaftaran, lupa sandi, dan ganti sandi tetap di Irsyads ID (tautan keluar dari Gate). Alamat redirect pemulihan terdaftar hanya untuk ID. Dengan begitu Gate tidak menambah permukaan serangan pada alur pemulihan, dan tidak menawarkan pembuatan akun dari dalam aplikasi (cek implikasinya pada D2).
- **S14. Satu perilaku sesi.** Web memakai klien bersama (cookie `.irsyads.com`) dan `keluarSesiAman`. Android memakai klien terpisah dengan penyimpanan Keystore. Tidak ada token di `localStorage` Android.

### 3.2 Alur kerja

- **W1.** Satu branch `main`. Pekerjaan Android digabung ke `main`, lalu branch kerja dihapus (lokal dan remote) setelah pemilik mengonfirmasi.
- **W2.** Fitur baru atau yang masih ragu dikerjakan di `Folder UJI\gate-<fitur>`. Berhasil: ganti kode di folder utama, tes, commit ke `main`, hapus folder uji. Gagal: hapus folder uji.
- **W3.** Folder utama kecil. Tangkapan layar, log, build, toolchain, dan bukti uji tidak disimpan di `scratch/` repo; pindahkan ke Folder UJI atau luar repo, hapus setelah selesai.
- **W4.** Commit yang belum boleh rilis memakai awalan `[skip ci] [CF-Pages-Skip]`.
- **W5.** Setiap perubahan perilaku disertai tes. `npm test` lulus 100% di PowerShell dan Git Bash sebelum commit.

### 3.3 Backend dan rilis

- **B1.** Tidak ada deploy Worker, deploy Edge Function, migrasi, perubahan konfigurasi Auth Supabase atau Cloudflare, atau unggahan Play Console tanpa konfirmasi pemilik untuk rilis itu. Izin lama tidak berlaku untuk rilis baru.
- **B2.** Hanya kuota gratis. Kuota tidak jelas berarti tidak menjalankan operasi jarak jauh.
- **B3.** Perubahan kontrak bersama (`gate-console`, skema, login, `keluar.ts`) dikoordinasikan dengan Irsyads sesuai `docs/EXTRACTION.md`. Salinan di Gate harus identik dengan sumbernya.
- **B4.** Rencana rollback ditulis sebelum rilis. Jangan mengembalikan engine lama setelah `guardAccess` dipakai (lihat `docs/2026-10-29_WORKSPACES_LOCAL.md`).

## 4. Paket perbaikan

Urutan kerja: **A → (B dan C) → D**. B dan C boleh paralel di Folder UJI yang berbeda, dengan satu penulis per berkas.

### A. Dasar repo dan keamanan (tidak menyentuh produksi)

| Langkah | Perbaikan |
|---|---|
| A1 | Gabungkan pekerjaan Android ke `main` (commit perubahan yang tertunda), lalu hapus branch kerja setelah konfirmasi. |
| A2 | Perbaiki `scripts/drive-oauth.mjs`: panggil `whoami.exe` lewat path absolut `System32`, bukan nama pendek. |
| A3 | Tambah `scripts/check-public-repo.mjs` dan `npm run check:public` (S5). |
| A4 | CSP penuh di `public/_headers` (S7). Hash skrip dan gaya inline diisi `scripts/write-csp.mjs` saat `npm run build`, tanpa `unsafe-inline`. Layout tidak lagi memuat Google Fonts (font lokal `Gate Sans`). Turnstile ditambahkan ke CSP bersama B3 dan C1. |
| A5 | Tambah `SECURITY.md`. Pindahkan catatan operasional pemilik keluar dari `docs/` (S4). Tetapkan lisensi (K5). |
| A6 | `file_paths.xml` dipertahankan (dipakai Capacitor untuk foto kejadian) dan diberi komentar. R8 (`minifyEnabled`) tetap nonaktif untuk versi pertama: kode Java aplikasi sangat kecil dan plugin Capacitor dipanggil lewat refleksi, jadi R8 baru layak diaktifkan bersama aturan keep dan uji di perangkat. |

**Lulus bila:** `check:public` hijau, 137/137 tes lulus di PowerShell dan Git Bash, CSP aktif tanpa galat konsol di `/` dan `/tamu`, dan `git ls-files` tidak memuat berkas terlarang.

**Status 16 Nov 2026:** A1–A6 selesai di `main` lokal (belum di-push). `npm test` 151/151 lulus di PowerShell dan Git Bash; `check:public` hijau termasuk riwayat Git; CSP diuji di browser pada `/`, `/tamu`, callback, dan 404 tanpa pelanggaran, dan terbukti memblokir fetch ke host asing serta skrip inline sisipan. Belum teruji: layar setelah login (pemindai kamera, foto, ekspor) di bawah CSP, dan build rilis Android. Branch kerja `codex/gate-android-uat` masih ada sampai pemilik mengonfirmasi penghapusannya. Lisensi (K5) belum ditetapkan.

### B. Gate mandiri tanpa Studio

| Langkah | Perbaikan |
|---|---|
| B1 | **Satu jalur kode.** Hapus mode lama (`GateApp`, `GtkPanel`, `GuestForm`, `gate-tamu`, `src/lib/{store,guest-api,auth,auth-supabase}.ts`, impor pengaturan dari Studio). Pertahankan fixture loopback. Sesuaikan tes. |
| B2 | **Kartu.** Hapus tautan ke Studio. Tambah impor massal murid/GTK dari CSV untuk admin (`person.import`): pratinjau, deteksi nomor ganda, batas 500 baris, berkas tidak disimpan. Rotasi dan penonaktifan kartu tetap lewat `person.rotate` dan `person.save`. |
| B3 | **Tamu.** Tambah `visit.create` untuk satpam/admin (tamu jalan-masuk) dengan validasi yang sama seperti `registerBoardingGuest`, mencatat siapa yang mendaftarkan. Formulirnya di dalam aplikasi, tidak lagi membuka browser luar. Form publik `/tamu` tetap ada, tetapi `gate-public` wajib Turnstile dan batas antrean per asal (S8). |
| B4 | **Ekspor dan cetak di Android.** Bagikan CSV/XLSX/DOCX lewat share sheet (FileProvider + `ACTION_SEND`, atau `@capacitor/share` + `@capacitor/filesystem` dengan versi dikunci). Cetak kartu dan laporan menjadi PDF yang dibagikan; jangan bergantung pada `window.print()`. Hapus berkas sementara setelah dibagikan dan saat logout. Pertahankan penetralan formula di CSV dan tambah tes untuk XLSX/DOCX. |
| B5 | **Peran.** Gate tidak membuat peran global. `admin` dan `staff` tetap dari RBAC Irsyads ID; Gate mengelola hak Gate (satpam, tautan GTK↔akun, pengasuh, penerima tamu). Gate menautkan ke halaman akun di Irsyads ID, bukan Studio (K2). |

**Lulus bila:** akun admin yang sudah memiliki peran dapat membuat GTK dan kartu, mengimpor CSV, mencetak, mendaftarkan tamu jalan-masuk, dan mengekspor CSV/XLSX/DOCX **di web dan di APK tanpa membuka Studio**. Spam pada `/tamu` tanpa token Turnstile ditolak.

### C. Login lewat Gate dan SSO Irsyads ID

| Langkah | Perbaikan |
|---|---|
| C1 | **Web: formulir di Gate.** Komponen `LoginForm` baru di layar masuk `NativeGateRoot`: identitas, sandi, Turnstile (`pasangTurnstile`, kunci situs yang sudah ada), lalu `signInWithPassword` dengan `captchaToken` memakai klien bersama. Karena sesi disimpan di cookie `.irsyads.com`, login di Gate otomatis berlaku di `id.irsyads.com` dan layanan lain, dan sebaliknya. Tombol kedua "Masuk dengan Irsyads ID" memakai `urlMasukId` (untuk akun Google atau saat formulir bermasalah). "Daftar" dan "Lupa sandi" menautkan ke ID (S13). Tampilkan galat seragam (S12). |
| C2 | **Android v1: formulir di dalam aplikasi.** `AndroidGateRoot` memakai `LoginForm` yang sama dan klien Supabase khusus Android: tanpa pemantau sesi dan preferensi akun, `detectSessionInUrl: false`, refresh otomatis, adaptor penyimpanan async ke plugin `GateSession` (Keystore; plugin diperluas dari satu nilai menjadi berkunci). Panggilan `gate-console` tetap lewat `CapacitorHttp` dengan token dari klien itu. Logout: cabut sesi di server, hapus vault, lalu bersihkan berkas ekspor sementara. Turnstile berjalan di WebView dengan origin `https://localhost`; uji di perangkat bahwa widget termuat dan token diterima. Tombol "Masuk dengan Irsyads ID" tidak ditampilkan di Android v1. |
| C3 | **Android fase 2 (opsional, setelah rilis pertama): SSO lewat browser.** Hanya bila ada kebutuhan nyata (mis. akun yang hanya punya login Google). Syaratnya: halaman persetujuan dipindah ke host Site URL proyek bersama (mis. `id.irsyads.com/oauth/consent`), audit RLS dan RPC semua aplikasi terhadap klaim `client_id` sebelum OAuth server diaktifkan (token OAuth setara sesi biasa), klien publik `token_endpoint_auth_method=none` dengan redirect URI persis, dan `public/.well-known/assetlinks.json` berisi sidik jari Play App Signing. Sampai fase ini dimulai, UI persetujuan (`consent.astro`, `AndroidConsent.tsx`, `android-consent.ts`) tidak ikut bundel rilis (K7). |
| C4 | **Inventaris akun.** Periksa akun Gate (admin, satpam, GTK) apakah punya sandi. Akun tanpa sandi tidak dapat memakai formulir: di web mereka memakai tombol ID; di Android v1 admin perlu menyiapkan sandi lewat ID (verifikasi apakah ID mendukung) atau menunggu fase 2. |
| C5 | **Salinan kontrak bersama.** Salin `keluar.ts` (`keluarSesiAman`) dari Irsyads ke `packages/supabase/src/` dengan isi identik dan catat di `docs/EXTRACTION.md`. Web memakainya untuk "Keluar akun" (S14). |
| C6 | **Tes.** Unit untuk validasi formulir, galat seragam, jeda bertahap, dan reset token per percobaan; adaptor Keystore dengan plugin tiruan; pengambilan token oleh klien Android; fixture `localLogin` tetap selaras. Uji perangkat untuk widget Turnstile di WebView. |

**Lulus bila:**
- **Web:** login dengan formulir di Gate langsung membuka ruang kerja; `id.irsyads.com` di tab lain sudah dalam keadaan masuk, dan sebaliknya; tombol ID bekerja; permintaan tanpa token Turnstile ditolak; galat salah sandi seragam untuk akun ada maupun tidak ada.
- **Android:** login formulir → satu tindakan Gate tercatat → aplikasi ditutup dan dibuka, sesi tetap → logout mencabut sesi. Akun tanpa peran dan sesi yang dicabut ditolak server. Tidak ada token di penyimpanan selain Keystore.

### D. Siap Google Play

| Langkah | Perbaikan |
|---|---|
| D1 | **Build rilis.** `npm run android:bundle:release` dengan upload keystore di luar repo. `versionCode` naik monoton dari env, `versionName` dari `package.json`. Jalankan `bundletool validate`; periksa manifest gabungan (izin hanya `INTERNET` dan `CAMERA`); `targetSdk` 36 dan `minSdk` 24 sudah sesuai. Intent-filter App Link boleh dilepas dari build rilis versi pertama bila C3 belum dikerjakan. |
| D2 | **Privasi.** Halaman statis `gate.irsyads.com/privasi` (data yang diproses, tujuan, retensi `guestRetentionDays`, jalur permintaan data tamu). Tautkan dari layar masuk, menu "Lainnya", dan Play Console. Isi Data safety dari inventaris di `docs/ANDROID_PLAY_SUBMISSION.md` sesuai AAB final, termasuk kredensial login yang dikirim ke Irsyads ID. Pastikan alur "Daftar" di ID tidak dapat dibuka sebagai pembuatan akun dari dalam aplikasi; bila bisa, siapkan jalur penghapusan akun (kewajiban Play). |
| D3 | **Akses reviewer** sesuai K4. Harus berjalan tanpa OTP, tanpa lokasi, dan tanpa data sekolah. |
| D4 | **Listing.** Ikon dan feature graphic sudah ada. Tambah tangkapan layar dari data sintetis, rating konten, target audiens (bukan anak), dan kontak dukungan. |
| D5 | **Jalur.** Internal testing → closed testing → produksi. Akun personal yang dibuat setelah 13 November 2023 butuh minimal 12 penguji selama 14 hari sebelum produksi; konfirmasi tipe akun di Play Console. |
| D6 | **Uji perangkat** mengikuti matriks di `docs/ANDROID_PLAY_STORE_PLAN.md`: kamera dan izin ditolak, QR cahaya rendah, jaringan putus, dua petugas memindai kartu yang sama, tombol kembali, edge-to-edge Android 16, keyboard dan pengelola sandi pada formulir login, logout bersih, ekspor dibuka di aplikasi tujuan. |

**Lulus bila:** AAB bertanda tangan terpasang dari Internal testing, login formulir, scan, dan ekspor berhasil dari instalasi Play pada HP pos, dan formulir Play Console cocok dengan build.

## 5. Gerbang rilis

Tiap baris butuh konfirmasi pemilik sebelum dilakukan.

- [ ] **Repo:** A1–A6 selesai dan di `main`; `check:public` hijau; secret scanning aktif.
- [ ] **Backend:** `gate-public` dengan Turnstile, serta `visit.create` dan `person.import` (bila perlu migrasi, tulis rollback). Urutan: rekonsiliasi migrasi → fungsi → frontend, seperti catatan rilis sebelumnya.
- [ ] **Login:** hostname widget Turnstile diverifikasi di Cloudflare untuk `gate.irsyads.com` dan `localhost`; formulir login lulus uji web dan perangkat; CSP mengizinkan Turnstile. Fase 2 (OAuth server) tidak termasuk rilis pertama.
- [ ] **Play:** D1–D6, lalu unggah ke Internal testing.

## 6. Keputusan pemilik

| # | Keputusan | Status / rekomendasi |
|---|---|---|
| K1 | Arti "login via Gate". | **Diputuskan 16 Nov 2026: formulir di Gate, ditambah tombol SSO Irsyads ID.** Risiko yang diterima: login kedua di repo terbuka. Dikendalikan lewat S12–S14 dan CAPTCHA wajib. |
| K2 | Peran dasar `admin`/`staff`: tetap di Irsyads ID, atau kelola dari Gate? | Tetap di Irsyads ID. Gate hanya mengelola hak Gate. |
| K3 | Lingkungan uji OAuth (hanya untuk fase 2): proyek Supabase uji sementara, klien uji di proyek produksi, atau stack lokal. | Stack lokal sampai fase 2 dimulai. Hindari proyek produksi sebelum audit C3. |
| K4 | Akses reviewer Play: (a) mode demo di aplikasi dengan data sintetis lokal, (b) proyek uji terpisah, (c) tenant demo di produksi. | (a), berupa tombol "Coba mode demo" di layar masuk. Data Gate satu-tenant, jadi (c) berisiko. |
| K5 | Lisensi repo: MIT, Apache-2.0, AGPL-3.0, atau tanpa lisensi. | Putuskan sebelum repo diumumkan. |
| K6 | Konfirmasi paket `com.irsyads.gate`, pemilik akun Play, dan pemegang upload key. | — |
| K7 | Nasib kode OAuth Android (`android-oauth.ts` dan tesnya) selama fase 2 belum dimulai. | Simpan tanpa terhubung ke UI selama satu siklus rilis; hapus bila fase 2 tidak dimulai. |
| K8 | Google di formulir Gate: tombol memakai redirect ke ID (Google "langsung" hanya terdaftar untuk `id.irsyads.com`), atau `signInWithOAuth` dari Gate (butuh redirect URL Gate di Supabase dan Google). | Lewat ID. Tidak ada perubahan konfigurasi Google atau Supabase. |

## 7. Yang tidak dilakukan tanpa konfirmasi

Deploy Worker atau Edge Function, migrasi atau penulisan data Supabase produksi, mengubah pengaturan Auth Supabase atau widget Turnstile, mengaktifkan OAuth server atau mendaftarkan klien, membuat akun atau proyek, unggah Play Console, menghapus branch remote, membuat workflow Actions, dan semua yang berbayar.
