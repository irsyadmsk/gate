# Matriks uji perangkat Android (D6)

Hasil uji build rilis Irsyads Gate. Dua jenis bukti dipisahkan: **emulator** (sudah dijalankan) dan **HP fisik / jaringan nyata** (belum). Emulator tidak menggantikan uji di HP pos; kolom "Sisa" menunjukkan yang masih harus dikerjakan sebelum unggah ke Internal testing dan di HP pos setelah terpasang dari Play.

## Lingkungan uji emulator (17 November 2026)

| Item | Nilai |
| --- | --- |
| Perangkat | Emulator Android 16 (API 36, `google_apis` x86_64), profil Pixel 6, layar 1080 × 1920 @ 420 dpi |
| WebView | Android System WebView 133.0.6943.137 |
| Build | AAB rilis (`npm run android:bundle:release`), `versionName` 0.0.1, `versionCode` 1, `targetSdk` 36, `minSdk` 24, ditandatangani **kunci sementara hanya untuk uji** (bukan upload key) |
| Pemasangan | APK universal dari `bundletool build-apks --mode=universal`, `adb install` |
| Jaringan | Emulator tanpa DNS (tidak bisa membuka situs luar). Uji yang butuh internet tidak dapat dijalankan |
| Data | Mode demo (data rekaan di memori) |

Pemeriksaan build otomatis (`scripts/android-verify-release.mjs`): tanda tangan AAB `jar verified`, `bundletool validate` lolos, manifest gabungan hanya `INTERNET` dan `CAMERA`, tanpa App Link, tidak debuggable, `allowBackup=false`, tanpa cleartext, `minSdk` 24 dan `targetSdk` 36. Tidak ada pustaka native (tidak ada pekerjaan ukuran halaman 16 KB).

## Hasil

Tanda: ✅ lulus di emulator · ⏳ belum, butuh HP fisik atau jaringan nyata · ➖ tidak berlaku.

| # | Uji | Emulator | Catatan | Sisa |
| --- | --- | --- | --- | --- |
| 1 | Pasang dan buka dari AAB rilis | ✅ | Terbuka ke layar masuk tanpa crash | Pasang dari Play (Internal testing) di HP pos |
| 2 | Edge-to-edge Android 16 | ✅ | Konten berada di bawah status bar dan di atas bilah navigasi, tidak ada yang terpotong; navigasi bawah aplikasi tidak menimpa bilah gestur | Cek di HP pos dengan bilah navigasi 3 tombol |
| 3 | Mode demo, empat peran | ✅ | Satpam (lima tab), Admin (Kartu, Riwayat, Lainnya), Pengasuh (Izin, Tamu, Murid), GTK (Lainnya) terbuka dan memuat data rekaan | ➖ |
| 4 | Keluar dari demo | ✅ | Kembali ke layar masuk; berkas ekspor sementara dihapus (`cache/exports/` kosong setelah keluar) | ➖ |
| 5 | Tombol kembali | ✅ | Dialog ditutup lebih dulu tanpa meninggalkan halaman; antarhalaman mundur lewat riwayat; dari halaman pertama aplikasi keluar. Tidak berjalan saat tindakan sedang dikirim | Cek gestur kembali prediktif di HP pos |
| 6 | Izin kamera ditolak | ✅ | Pesan "Kamera belum dapat dibuka… gunakan kode tertulis"; kolom kode kartu tetap bisa dipakai | ➖ |
| 7 | Kamera dengan izin diberikan | ✅ | WebView memulai kamera ("Kamera aktif"), dimatikan dengan "Matikan kamera". Memakai kamera virtual emulator | Baca QR kartu nyata |
| 8 | Ekspor CSV, Excel, Word | ✅ | Lembar berbagi sistem muncul dengan berkas `.csv`, `.xlsx`, `.docx` bernama sesuai laporan | Buka berkas di aplikasi tujuan (Drive, Gmail, Excel/Word) dari HP pos |
| 9 | Cetak | ✅ | Pencetakan sistem (`printspooler`) terbuka dari "Cetak" | Simpan sebagai PDF dan cetak kartu nyata di HP pos |
| 10 | Tautan kebijakan privasi | ✅ | Dari layar masuk membuka Chrome (peramban luar); tombol kembali mengembalikan ke aplikasi | Pastikan halaman `/privasi` termuat setelah situs dideploy |
| 11 | Widget Turnstile di WebView `https://localhost` | ⏳ | Emulator tanpa DNS; aplikasi menampilkan pesan galat yang dirancang ("Pemeriksaan keamanan tidak dapat dimuat…") dan tombol Masuk tidak mengirim apa pun | Wajib: uji di HP dengan internet; hostname `localhost` harus terdaftar di widget Cloudflare |
| 12 | Login formulir nyata, simpan sesi di Keystore, tutup dan buka aplikasi, refresh token, keluar mencabut sesi | ⏳ | Butuh jaringan dan akun uji | Wajib sebelum rilis |
| 13 | Akun tanpa peran dan sesi dicabut ditolak server | ⏳ | Butuh jaringan dan akun uji | Wajib sebelum rilis |
| 14 | Keyboard dan pengelola sandi pada formulir masuk | ⏳ | Atribut `autocomplete` dan `inputmode` sudah ada; perilaku IME butuh HP fisik | Uji dengan pengelola sandi yang dipakai petugas |
| 15 | QR pada cahaya rendah | ⏳ | Emulator tidak mensimulasikan cahaya | HP pos, malam hari |
| 16 | Dua petugas memindai kartu yang sama | ⏳ | Aturan sudah diuji di engine (tes unit), tetapi bukan di dua perangkat | Dua HP, satu kartu |
| 17 | Jaringan putus saat transaksi | ⏳ | Butuh backend | Matikan data tepat setelah menekan simpan; periksa catatan sebelum mengulang |
| 18 | Foto kejadian dari kamera | ⏳ | Penyimpanan foto belum aktif di backend | Setelah penyimpanan foto diaktifkan |
| 19 | Pre-launch report Play | ⏳ | Hanya tersedia setelah unggah | Periksa setelah unggah ke Internal testing |

## Cara mengulang

1. Bangun dan verifikasi AAB seperti di [ANDROID_PLAY_SUBMISSION.md](ANDROID_PLAY_SUBMISSION.md) (isi `GATE_BUNDLETOOL_JAR`).
2. Ubah ke APK universal dan pasang, lihat [ANDROID_DEVELOPMENT.md](ANDROID_DEVELOPMENT.md).
3. Untuk tangkapan layar atau uji berulang, `adb shell wm size 1080x1920` dan `adb shell wm density 420`; aktifkan demo mode System UI untuk status bar bersih. Emulator tanpa GPU host sering menampilkan "System UI isn't responding": jalankan dengan `-gpu host`, atau pilih "Wait".
4. Setiap kali baris di tabel diuji di HP fisik, tulis modelnya, versi Android, versi WebView, dan tanggalnya di kolom Catatan.
