# Ruang admin dan satpam Gate — kandidat lokal, 29 Oktober 2026

Instruksi pemilik: pertahankan `gate.irsyads.com`, pindahkan kebutuhan admin/satpam dari Studio ke Gate, sediakan cetak/ekspor seluruh aktivitas, keberadaan orang, serah terima ke akun berikutnya, foto kejadian dan pengaturan status satpam oleh admin.

## Hasil

- Ruang masuk mengikuti identitas server: **Ruang admin** atau **Ruang satpam**, dengan navigasi ponsel lima tujuan utama.
- Admin memperoleh direktori GTK, penerbitan/tautan kartu dan konfirmasi pengajuan, pengasuh/penerima, serta status satpam. Semua perubahan status membutuhkan alasan, versi terbaru dan jejak audit. Administrator tidak dapat diturunkan lewat pengaturan satpam.
- Hak satpam disimpan pada `guardAccess` di dokumen Gate yang sudah ada. Tidak mengubah `user_roles`, level Academy atau hak aplikasi lain. Pencabutan diperiksa pada snapshot, lookup, pencatatan, persiapan cetak dan akses foto berikutnya. Jaga/tanggungan serta jejak lama dipertahankan.
- Kedua ruang mendapat daftar orang di dalam/di luar/lewat waktu/belum terverifikasi, murid/GTK, dan kunjungan tamu. GTK penghuni asrama mempertahankan catatan keberadaan lintas malam; GTK pulang-pergi perlu verifikasi kedatangan hari baru.
- Kedua ruang dapat menyiapkan kartu terbitan untuk cetak. Token tetap disembunyikan dari snapshot operasional satpam dan hanya dikeluarkan melalui permintaan cetak yang berizin serta diaudit. Ada pratinjau QR sebelum cetak dan lembar A4 maksimal 10 kartu per halaman. Persiapan harus diperbarui setelah 30 detik sebelum memanggil cetak.
- Laporan CSV, XLSX, DOCX dan cetak meliputi tamu, pergerakan, izin, jadwal/pelaksanaan jaga, pergantian jaga, kejadian, seluruh buku jaga, audit, dan aktivitas Gate. Perubahan tanggal membatalkan hasil lama; ekspor membaca ulang rentang dan akun sebelum membuat berkas.
- Serah terima menyimpan rangkuman saat penyerahan: orang di luar, tamu, kebutuhan terbuka, dan aktivitas selama jaga. Akun penerima melihat kiriman, meninjau, lalu menerima dan memulai jaga berikutnya. Tindak lanjut kemudian tidak menimpa rangkuman awal. Tidak mengirim email/WhatsApp atau pesan di luar Gate.
- Foto kejadian memiliki penyimpanan provider privat, kompresi, batas ukuran, pemeriksaan akses, reservasi ID, retry aman dan pengecekan integritas. Lihat `DRIVE_PHOTOS.md`.

## Verifikasi lokal

- `npm test`: **125 tes lulus, 0 gagal**, termasuk PGlite dan 13 tes tambahan/baru (ruang, Drive, dan riwayat kembali).
- Sesudah penyempurnaan terakhir: 20 tes domain/API/provider yang terkena perubahan diulang dan lulus; TypeScript frontend serta handler/provider server lulus.
- Build statis Gate menghasilkan 3 halaman. Tidak membangun atau mengubah Studio pada tahap ini.
- Browser loopback port **4581**, state `scratch/gate-asrama-20261027/workspaces-review.json`: satpam masuk langsung, filter keberadaan, unggah/baca JPEG sintetis, kirim jaga petugas pertama, penerimaan petugas kedua, dan unduh CSV pergantian jaga berhasil. Admin memberi lalu mencabut hak akun GTK sintetis dengan alasan; direktori GTK/tautan akun terbuka langsung di Gate. Delapan kartu disiapkan menjadi delapan QR terdekode pada satu halaman cetak, dengan pratinjau yang dapat diperiksa sebelum dialog cetak.
- Pada lebar 390 px: lima tombol navigasi, lebar dokumen tidak melampaui viewport. Screenshot desktop dan ponsel tersimpan privat dalam `scratch/workspaces-proof/`.
- Uji cetak melalui browser bawaan membuka alur cetak yang menghambat kontrol tab; tab uji dibuka ulang tanpa kehilangan state. Alur kartu diperbaiki menjadi persiapan + pratinjau + tombol cetak terpisah. Printer fisik/hasil PDF final belum diterima.
- Situs produksi dibuka baca saja di browser: judul **Irsyads Gate — Pos satpam**, halaman masuk **Selamat datang di Gate.**. Percobaan HTTP shell sempat gagal DNS; browser berhasil. `wrangler.jsonc` tetap memakai Worker `gate` dan custom domain `gate.irsyads.com`.

## Kandidat database dan pemulihan

`20261029042446_gate_report_return_history.sql` dibuat melalui `supabase migration new`. Kandidat ini menambah indeks `last_at` dan memperbaiki pembacaan riwayat agar perjalanan yang kembali pada rentang laporan tetap terbaca walau keberangkatan dan pergerakan terbaru berada di luar rentang. RLS/grant tetap service-only. Tes PGlite mencakup kasus tersebut. Belum diterapkan pada database produksi; jangan menjalankan bulk `db push` dari repo hasil ekstraksi.

Pemulihan fungsi baca lama ada di `ops/review/workspaces/rollback-return-history.sql`, tanpa penghapusan data. Saat merilis, rekonsiliasi riwayat migrasi bersama Irsyads dan tinjau advisors/schema aktual dahulu.

**Jangan mengembalikan backend ke engine lama setelah memakai pencabutan `guardAccess`: engine lama tidak mengetahui override ini.** Bila perlu rollback, pertahankan enforcement baru dan rollback frontend saja, atau tahan endpoint terlebih dahulu lalu rekonsiliasi izin sebelum menjalankan engine lama. Reservasi/foto serta audit tidak boleh dihapus untuk rollback.

## Yang belum diaktifkan

Perubahan berada pada branch lokal `codex/gate-admin-guard-workspaces`, belum commit/push, deploy, penerapan migrasi, atau data sekolah ditulis. Pengecualian remote yang disetujui pemilik hanyalah pengubahan folder Drive menjadi Dibatasi.

OAuth server Drive masih kosong. Aktivasi perlu kredensial server yang disetujui pemilik, uji unggah/baca pada folder privat yang sama, pemeriksaan kuota, dan rilis terarah: rekonsiliasi migrasi → fungsi `gate-console`/`gate-public` yang kompatibel → frontend Worker `gate` di domain yang sama → cek akun asli/izin/hash. Pertahankan layanan lama sampai paket lengkap siap. Koneksi Drive chat bukan kredensial server; jangan mengambil atau menyalinnya.
