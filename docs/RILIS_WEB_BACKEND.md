# Runbook rilis web dan backend

Status 17 November 2026: **siap dijalankan, belum dijalankan.** Tanda 🔒 berarti langkah itu mengubah produksi dan butuh konfirmasi pemilik untuk rilis ini (aturan B1 di [ATURAN_PERBAIKAN.md](ATURAN_PERBAIKAN.md)). Izin untuk rilis lama tidak berlaku. Dokumen ini tidak memuat ID versi, alamat internal, atau rahasia; catatan semacam itu disimpan pemilik di luar repo (aturan S4).

## Yang dirilis

Dibandingkan dengan keadaan tayang sejak 2 November 2026:

| Bagian | Perubahan |
| --- | --- |
| `gate-console` | Engine baru: `person.import` (impor CSV, maksimal 500 baris) dan `visit.create` (tamu jalan-masuk oleh satpam/admin). Perintah lama tidak berubah, jadi frontend lama tetap bekerja |
| `gate-public` | Pendaftaran tamu mandiri **wajib token Cloudflare Turnstile** dan memverifikasinya di server (gagal tertutup bila secret kosong) |
| Worker `gate` (web) | Formulir login di Gate, impor CSV, tamu jalan-masuk, ekspor dan cetak, kebijakan privasi `/privasi`, mode demo, CSP penuh |
| Migrasi SQL | **Tidak ada.** Perintah baru hidup di dokumen state |
| Android | Tidak ikut runbook ini. AAB diunggah lewat Play Console, tetapi `/privasi` harus sudah hidup sebelum Play meninjau |

## Prasyarat yang sudah dicek secara lokal

| Cek | Hasil 17 Nov 2026 |
| --- | --- |
| `npm test` (PowerShell dan Git Bash) | 177/177 lulus |
| `npm run check:public -- --history` | lulus |
| `npm run build:engine` lalu `git status` | tanpa perubahan: `gate-console-engine.js` sama dengan sumber |
| `npm run build` | berhasil; `dist/_headers` memuat CSP dengan origin Supabase dan Turnstile; `/privasi` terbangun |
| `npx wrangler deploy --dry-run` | membaca 31 berkas dari `dist`, tidak mengunggah apa pun |

Ulangi semuanya tepat sebelum rilis bila ada commit baru. Deno dan Supabase CLI tidak terpasang di mesin pengembangan ini, jadi fungsi tepi belum dikompilasi secara lokal; deploy fungsi memakai metode yang sama dengan rilis 2 November.

## Yang harus disediakan pemilik

1. **`TURNSTILE_SECRET_KEY`**: secret widget Turnstile yang site key-nya ada di `packages/supabase/src/captcha.ts`. Ketik sendiri nilainya di dashboard Supabase (Edge Functions → Secrets); jangan lewat chat, berkas, atau riwayat shell.
2. **Hostname widget**: di dashboard Cloudflare Turnstile pastikan widget itu mengizinkan `gate.irsyads.com` dan `localhost` (WebView Android memakai origin `https://localhost`). Server juga hanya menerima token berhostname itu (`GATE_CAPTCHA_HOSTNAMES` di `gate-captcha.ts`).
3. **`PUBLIC_GATE_CONTACT_EMAIL`**: surel pengembang yang tampil di `/privasi` (keputusan K9). Alamat yang sama dipakai di Play Console.
4. Dua catatan pribadi di luar repo, ditulis sebelum langkah 1: daftar fungsi tepi beserta versi dan pengaturan verifikasi JWT-nya, dan ID versi Worker `gate` yang sedang tayang (`npx wrangler deployments list`). Keduanya dibutuhkan untuk rollback.

## Urutan rilis

Urutannya dipilih supaya tidak ada jendela di mana pendaftaran tamu rusak: frontend baru dideploy **sebelum** `gate-public` mewajibkan token, dan `gate-public` lama mengabaikan kolom `captchaToken` yang dikirim frontend baru (diperiksa pada handler sebelum perubahan).

| # | Langkah | Efek langsung |
| --- | --- | --- |
| 0 | Catat keadaan sekarang (lihat butir 4 di atas). Hanya baca | Tidak ada |
| 1 | 🔒 Pasang secret `TURNSTILE_SECRET_KEY` | Tidak ada; fungsi lama tidak memakainya |
| 2 | 🔒 Deploy `gate-console` dari root repo (`supabase/functions/gate-console` dan `_shared/` ikut terbundel; handler mengimpor tipe dari `packages/gate`). **Pertahankan pengaturan verifikasi JWT sama dengan yang terpasang**: tanpa `supabase/config.toml`, Supabase CLI memakai bawaan "verifikasi JWT aktif" dan bisa mengubah fungsi yang sebelumnya tanpa verifikasi | Perintah baru tersedia; frontend lama tidak terpengaruh |
| 3 | Uji cepat: masuk sebagai admin lewat web lama, snapshot terbuka | Memastikan engine baru tidak merusak jalur lama |
| 4 | 🔒 Bangun dan deploy web: `PUBLIC_GATE_CONTACT_EMAIL=<surel> npm run build`, lalu `npm run check:public`, lalu `npx wrangler deploy` | Frontend baru tayang. Formulir tamu mengirim token; `gate-public` lama masih menerima pendaftaran |
| 5 | 🔒 Deploy `gate-public` (pengaturan verifikasi JWT sama dengan yang terpasang) | Pendaftaran tamu kini wajib token. Halaman `/tamu` lama yang masih terbuka di browser tamu akan gagal sampai dimuat ulang |
| 6 | Uji asap (tabel di bawah) | Rilis dianggap selesai |

Bila hanya ingin menutup pendaftaran tamu sementara, hapus `TURNSTILE_SECRET_KEY`: `gate-public` baru menolak semua pendaftaran, dan petugas memakai fitur tamu jalan-masuk.

## Uji asap setelah rilis

| Uji | Yang diperiksa |
| --- | --- |
| `https://gate.irsyads.com/` | Layar masuk muncul tanpa galat CSP di konsol; widget Turnstile termuat |
| `/privasi` | Halaman terbuka dan memuat alamat surel pengembang |
| Login dengan formulir | Akun uji masuk; email atau sandi salah memberi pesan seragam; sesi juga berlaku di `id.irsyads.com` |
| "Masuk dengan Irsyads ID" | Kembali ke Gate dalam keadaan masuk |
| `/tamu` | Satu pendaftaran bernama "Uji rilis", dengan token Turnstile, masuk sebagai "Menunggu konfirmasi penerima"; batalkan setelahnya. Permintaan tanpa token ditolak |
| Satpam | Satu tamu jalan-masuk lewat "Daftarkan tamu"; satu GTK dicatat dari tab Pindai |
| Admin | Impor CSV dua baris uji (lalu nonaktifkan barisnya); ekspor CSV, Excel, Word |
| Log fungsi tepi | Tidak ada 5xx beruntun pada `gate-console` dan `gate-public` selama 15 menit pertama |

Data uji di produksi dibuat seminimal mungkin dan memakai nama yang jelas rekaan.

## Rollback

| Bagian | Cara | Catatan |
| --- | --- | --- |
| Web | `npx wrangler rollback` ke versi yang dicatat pada langkah 0 | Aman kapan saja. Versi lama tidak punya formulir login, impor, dan `/privasi` |
| `gate-public` | Deploy ulang sumber lama: `git show f540bed:supabase/functions/gate-public/index.ts` dan `_shared` pada commit yang sama, dari worktree sementara, bukan dari `main` | Menghapus kewajiban token. Aman karena endpoint publik tidak memutuskan hak |
| `gate-console` | **Jangan dikembalikan ke engine lama** bila pencabutan `guardAccess` sudah dipakai (lihat [2026-10-29_WORKSPACES_LOCAL.md](2026-10-29_WORKSPACES_LOCAL.md)). Perbaiki ke depan | Perintah baru bersifat tambahan, jadi frontend lama tidak butuh rollback ini |
| Secret | Menghapus `TURNSTILE_SECRET_KEY` membuat `gate-public` baru menolak pendaftaran (gagal tertutup) | Cara tercepat menutup pendaftaran tamu mandiri |

## Setelah rilis

- Perbarui bagian "Gerbang rilis" di [ATURAN_PERBAIKAN.md](ATURAN_PERBAIKAN.md) dan tanggal tayang di catatan pribadi, bukan di repo.
- Isi `https://gate.irsyads.com/privasi` sebagai URL kebijakan privasi di Play Console dan jalankan uji HP fisik di [ANDROID_DEVICE_TEST.md](ANDROID_DEVICE_TEST.md) (Turnstile di WebView, login, Keystore).
- Fungsi lama `gate-tamu`, migrasinya, dan tes SQL-nya sengaja tidak disentuh runbook ini. Menghapusnya adalah keputusan terpisah setelah dicek apakah masih terpasang di produksi.
