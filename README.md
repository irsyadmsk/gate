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
- Login tetap melalui Irsyads ID. Sesi, profil akun, RBAC, dan database Supabase masih memakai layanan Irsyads yang sudah ada. Pemisahan repositori tidak membuat proyek database atau akun baru.
- Administrasi GTK/kartu, pengasuh, penerima tamu, dan akun tetap tersedia melalui integrasi Studio. Panel Studio dipelihara di repositori Irsyads.
- Domain layanan yang sudah ada: https://gate.irsyads.com. Pemisahan ini tidak men-deploy ulang layanan atau mengubah database/DNS.

Salinan terbatas adapter login/sesi berada di packages/supabase/src/; packages/design-tokens/src/preferences.ts hanya mendefinisikan tipe preferensi. Inti aturan di packages/gate/ juga memiliki salinan kompatibilitas di monorepo untuk Studio. Perubahan kontrak keduanya harus dikoordinasikan; lihat [catatan pemisahan](docs/EXTRACTION.md).

## Konfigurasi

Salin .env.example ke .env jika perlu mengganti konfigurasi. Nilai bawaan adapter memakai URL dan kunci **publishable** Irsyads yang memang tersedia di browser; kunci ini bukan kunci server. Mode native aktif secara bawaan. Jangan menaruh secret/service-role key dalam variabel PUBLIC_*, frontend, atau Git.

Frontend pengembangan biasa tetap mengarah ke layanan yang dikonfigurasi. Untuk uji dengan **data sintetis saja**, gunakan:

```sh
npm run preview:fixture
```

Server fixture hanya mendengarkan loopback di http://127.0.0.1:4571, tidak mengakses Supabase, dan menyimpan state contoh di scratch/ yang diabaikan Git. Akun serta sandinya hanya berlaku di server fixture. Route fixture /studio merupakan alias konsol Gate untuk pemeriksaan HTTP; antarmuka Studio asli tidak disalin.

## Backend dan publikasi

supabase/functions/{gate-console,gate-public,gate-tamu} dan migrasi Gate disalin sebagai sumber yang sudah ada. Migrasi membutuhkan skema identitas/RBAC Irsyads; ini bukan bootstrap Supabase baru. ops/review/ hanya berisi SQL skema untuk tes. Tidak ada data sekolah, backup database, riwayat monorepo, .env, atau secret server yang disertakan.

`npm run build:engine` membentuk ulang engine fungsi dari inti aturan. Perubahan engine memerlukan tes ulang dan pemeriksaan kompatibilitas Studio. Penerapan backend, migrasi, dan deploy Cloudflare dilakukan secara sengaja dengan persetujuan pemilik. Tidak ada workflow Actions/deploy otomatis. Konfigurasi Worker gate berada di wrangler.jsonc.

Kode dipublikasikan tanpa penambahan lisensi distribusi baru pada saat pemisahan.
