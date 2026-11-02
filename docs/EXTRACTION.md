# Pemisahan Gate — 29 Oktober 2026

Catatan lanjutan: kandidat ruang admin/satpam langsung di Gate tersedia pada `docs/2026-10-29_WORKSPACES_LOCAL.md`. Pembagian Studio di bawah mencatat keadaan saat ekstraksi; kandidat ruang baru belum dirilis.

Gate menjadi repositori tersendiri di `irsyadmsk/gate`, dengan aplikasi Astro di root (`src/`, `public/`, `astro.config.mjs`, `wrangler.jsonc`). Pemisahan mengambil snapshot sumber Gate dari working tree Irsyads, tanpa membawa sejarah Git atau aplikasi lain.

## Kepemilikan

| Bagian | Lokasi pemeliharaan |
| --- | --- |
| Frontend Gate dan build | Repositori Gate ini |
| Domain inti dan sumber Edge Functions Gate | Repositori Gate ini; sinkronkan perubahan kontrak ke Studio |
| Login, akun, sesi, RBAC | Layanan Irsyads ID/Supabase yang sudah ada |
| Panel administrasi Gate di Studio | Monorepo Irsyads |
| Riwayat migrasi Supabase bersama | Monorepo Irsyads tetap menjadi catatan penerapan; salinan migrasi di sini untuk referensi/tes |

`packages/gate` di monorepo dipertahankan agar Studio dan tes integrasinya tetap berfungsi. Sejak 2 November 2026 sumber Edge Functions Gate (`gate-console`, `gate-public`, `gate-tamu`) hanya ada di repositori ini dan dideploy dari sini; salinannya di monorepo sudah dihapus. Migrasi yang sudah diterapkan tetap ada di monorepo sebagai catatan penerapan backend bersama.

Studio menyimpan modul UI, adapter native, dan tipe HTTP yang dibutuhkannya sendiri. Build produksi Studio tidak mengimpor direktori aplikasi Gate. Tes HTTP aplikasi Gate dipindahkan ke repositori ini; skrip pratinjau integrasi manual di monorepo membutuhkan checkout Gate sebagai folder saudara.

Adapter `auth`, `klien`, `sesi`, `pantau-sesi`, `preferences-account`, `proyek`, dan `captcha` disalin dengan kontrak yang sama. Perubahan keamanan sesi/identitas di Irsyads harus ditinjau juga di sini. Tidak ada dependensi file atau symlink menuju checkout Irsyads.

## Pemulihan

Penghapusan direktori aplikasi lama dilakukan hanya setelah hash salinan cocok, build dan tes repositori baru berhasil. Cadangan direktori lama dan manifest hash disimpan privat di luar kedua repositori pada komputer pemilik. Riwayat Git Irsyads juga masih menyimpan versi sebelumnya. Pekerjaan lain yang belum di-commit tidak dipindahkan atau dipublikasikan.

Pemisahan folder dan publikasi kode tidak memindahkan data, mengubah domain, men-deploy frontend/fungsi, atau menerapkan SQL. Build dan fixture lokal tidak membuktikan login nyata, kamera HP, printer, maupun penerimaan operasional.
