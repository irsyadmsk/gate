# Foto kejadian privat

Foto dikaitkan dengan ID catatan jaga. Admin dan satpam aktif dapat mengunggah dan membaca melalui `gate-console`; akun lain dan endpoint publik ditolak. Server memeriksa akun/sesi serta hak Gate pada setiap permintaan. Tidak ada URL Drive publik atau token OAuth yang diberikan ke frontend.

Browser menerima JPEG/PNG/WebP maksimal 20 MB, mengubahnya menjadi JPEG dengan sisi panjang maksimal 1.600 piksel, dan membuang metadata EXIF melalui canvas. Hasil maksimal 1,5 MB; server memeriksa ukuran, tanda JPEG dan dimensi maksimal 2.000 piksel. Maksimal delapan foto per catatan. Ini penyimpanan foto, bukan video.

Sebelum mengunggah, server meminta ID file Drive dan menyimpan reservasinya melalui CAS. Percobaan ulang memakai ID yang sama. Konflik 409 diperiksa terhadap folder, ukuran dan SHA-256 yang tersimpan; konfirmasi yang hilang tidak membuat file baru. Snapshot tidak membocorkan ID file Drive atau digest. Reservasi milik pengunggah yang belum selesai dapat dilanjutkan dengan memilih foto yang sama. Foto tidak dihapus otomatis saat serah terima atau pencabutan hak petugas.

## Konfigurasi backend

Keempat variabel ini merupakan **secret server**, tidak boleh memakai awalan `PUBLIC_`, disalin ke browser, atau dimasukkan ke Git:

```text
GATE_DRIVE_CLIENT_ID
GATE_DRIVE_CLIENT_SECRET
GATE_DRIVE_REFRESH_TOKEN
GATE_DRIVE_FOLDER_ID
```

Folder pilihan pemilik dicatat hanya dalam `.env.backend.local` yang diabaikan Git. Jangan memublikasikan ID folder pribadi atau screenshot akun. File tersebut belum berisi kredensial OAuth dan tidak otomatis mengatur secret Supabase.

Gunakan OAuth milik aplikasi Gate dengan akses offline yang disetujui pemilik akun penyimpanan. Utamakan `drive.file` jika folder telah dipilih/diotorisasi untuk client yang sama melalui Google Picker. Tautan folder saja tidak memberi otorisasi OAuth. Scope lebih luas memerlukan peninjauan dan persetujuan tersendiri; jangan menggunakan ulang kredensial Irsyads ID atau mengambil token dari konektor chat.

Koneksi Google Drive di chat memudahkan pemeriksaan metadata dan folder, tetapi bukan otorisasi server Gate untuk mengunggah tanpa chat. Aktivasi tetap membutuhkan OAuth backend yang terpisah.

Backend memeriksa bahwa folder benar-benar folder, dapat ditambahi berkas oleh akun penyimpanan, dan tidak memiliki izin `anyone` atau `domain`. Bila folder dibagikan secara umum, konfigurasi hilang, kuota habis, token dicabut, atau Drive gagal, unggahan ditahan dengan pesan yang sesuai. Catatan teks tetap dapat disimpan. Aplikasi tidak membuat izin berbagi publik.

## Bukti saat ini

Pada 29 Oktober 2026 pemilik memberikan folder tujuan dan menyetujui pengubahan akses umum menjadi Dibatasi. Perubahan dilakukan melalui Google Drive, lalu metadata diperiksa ulang: hanya izin pemilik yang tersisa. Bukti privat di `scratch/workspaces-proof/drive-restricted.png`.

Unggah/baca foto sintetis telah diuji pada provider lokal loopback. Provider Drive diuji dengan HTTP palsu untuk folder publik, retry 409, parent yang salah, dan cache access token. **Belum ada unggahan nyata ke Google Drive, token OAuth server, atau uji kuota/delivery produksi.**

Referensi: [unggah berkas Drive](https://developers.google.com/workspace/drive/api/guides/manage-uploads), [izin berbagi](https://developers.google.com/workspace/drive/api/guides/manage-sharing), [OAuth akses offline](https://developers.google.com/identity/protocols/oauth2/web-server#offline).
