# Materi pengajuan Google Play

Status 17 November 2026. Isian di bawah dipakai saat mengisi Play Console dan harus dicek ulang terhadap AAB final. Cakupan awal mengikuti [rencana rilis Android](ANDROID_PLAY_STORE_PLAN.md); uji perangkat dicatat di [ANDROID_DEVICE_TEST.md](ANDROID_DEVICE_TEST.md).

## Identitas dan pengaturan aplikasi

| Isian Play Console | Nilai |
| --- | --- |
| Nama aplikasi | Irsyads Gate |
| Paket | `com.irsyads.gate` (keputusan pemilik K6) |
| Jenis dan harga | Aplikasi, gratis, tanpa pembelian dalam aplikasi |
| Kategori | Produktivitas |
| Iklan | Tidak ada |
| Target audiens | 18 tahun ke atas. Bukan untuk anak-anak dan tidak menarik bagi anak-anak |
| Rating konten (IARC) | Semua jawaban "tidak": tanpa kekerasan, konten seksual, bahasa kasar, zat terkontrol, perjudian, konten buatan pengguna yang dibagikan publik, berbagi lokasi, atau pembelian digital. Kategori kuesioner: utilitas/produktivitas. Hasil yang diharapkan: usia terendah |
| URL kebijakan privasi | `https://gate.irsyads.com/privasi` (halaman statis dari repo ini) |
| Kontak dukungan | Surel pengembang (keputusan pemilik K9; harus sama dengan `PUBLIC_GATE_CONTACT_EMAIL` saat build web). Situs: `https://gate.irsyads.com` |
| Negara distribusi | Indonesia saja pada rilis pertama. Bila akun Play berstatus non-pedagang, nilai ulang sebelum memperluas ke wilayah dengan aturan pedagang atau sebelum monetisasi |
| Akun di dalam aplikasi | Aplikasi tidak membuka pendaftaran akun. Akun dibuat admin lembaga lewat Irsyads ID; karena itu URL penghapusan akun khusus tidak diwajibkan. Permintaan penghapusan data dijelaskan di `/privasi#hak` |
| Izin manifest | Hanya `INTERNET` dan `CAMERA` (kamera opsional: `required=false`). Tidak ada izin lokasi, kontak, penyimpanan, atau notifikasi |

## Listing Indonesia

**Nama aplikasi:** Irsyads Gate

**Deskripsi singkat** (64 karakter, batas 80)

Catat akses gerbang, kunjungan tamu, dan pergantian jaga sekolah

**Deskripsi lengkap**

Irsyads Gate membantu petugas pos sekolah berasrama mencatat pergerakan di gerbang dan meneruskan informasi antarshift. Akses diberikan oleh admin lembaga sesuai peran akun Irsyads ID.

- Pindai kartu QR atau cari nama untuk mencatat pergerakan GTK.
- Periksa izin keluar murid yang sudah disetujui pengasuh atau petugas piket.
- Catat kedatangan dan kepulangan tamu, termasuk mendaftarkan tamu jalan-masuk langsung dari aplikasi.
- Isi buku jaga dan serahkan catatan serta tanggungan kepada petugas berikutnya.
- Admin dapat mengimpor data GTK dan murid dari berkas CSV, mencetak kartu, dan mengelola petugas.
- Bagikan atau simpan laporan dan kartu sebagai CSV, XLSX, DOCX, atau PDF melalui lembar berbagi Android.
- Belum punya akun? Pilih "Coba mode demo" di layar masuk untuk mencoba semua peran dengan data contoh, tanpa jaringan.

Fitur operasional memerlukan koneksi internet dan akun dari lembaga Anda. Pendaftaran tamu mandiri tetap dapat dibuka melalui situs Gate di browser.

## Aset grafis

| Aset | Berkas | Teks alternatif |
| --- | --- | --- |
| Ikon 512 × 512 | [play-icon.png](play-store/play-icon.png) | Ikon gerbang warna krem dan biru pada latar biru tua. |
| Feature graphic 1024 × 500 | [feature-graphic.png](play-store/feature-graphic.png) | Irsyads Gate, ruang kerja pos sekolah untuk akses, kunjungan, dan serah terima. |

Sumber grafis dapat dibuka di browser: tampilan 1024 × 500 untuk feature graphic atau `#icon` pada tampilan 512 × 512 untuk ikon. [Sumber grafis](play-store/graphics.html) · [Aturan aset Google Play](https://support.google.com/googleplay/android-developer/answer/9866151)

### Tangkapan layar ponsel

Diambil dari build rilis di emulator dalam mode demo (data rekaan, tidak ada data sekolah). Ukuran 1080 × 1920 (16:9): Play menolak rasio lebih dari 2:1, jadi emulator memakai `wm size 1080x1920` saat mengambilnya. Lihat [play-store/screenshots](play-store/screenshots).

| Berkas | Isi |
| --- | --- |
| `01-masuk.png` | Layar masuk dengan tombol "Coba mode demo" dan tautan kebijakan privasi |
| `02-pos.png` | Ruang satpam: ringkasan gerbang dan orang di luar |
| `03-laporan.png` | Riwayat dan laporan dengan ekspor CSV, Excel, Word, dan cetak (peran admin) |
| `04-izin.png` | Izin keluar murid dengan status persetujuan (peran pengasuh) |
| `05-tamu.png` | Kunjungan tamu dan konfirmasi penerima (peran pengasuh) |
| `06-jaga.png` | Jaga dan serah terima antarpetugas |

Status bar disetel lewat demo mode System UI Android (jam 9:41, baterai penuh) supaya bersih. Spanduk "Mode demo" tampil di setiap layar aplikasi; biarkan, karena menjelaskan asal data rekaan.

## App access untuk reviewer

Pilih "All or some functionality is restricted" lalu tempelkan teks berikut (bahasa Inggris, sesuai kebutuhan reviewer). Mode demo tidak memerlukan kredensial, OTP, lokasi, atau jaringan.

> Irsyads Gate normally requires an account assigned by a school administrator, so there are no public credentials. To review every feature without an account, tap **Coba mode demo** (Try demo mode) at the bottom of the sign-in screen and choose a role. Demo mode uses synthetic records that live only in memory on the device. It needs no network, OTP, or location, and it resets when you leave. Roles: **Satpam** (guard) opens the gate desk, **Pindai** (scan), **Orang** (who is on site), **Jaga** (duty handover) and guest registration; **Admin** opens **GTK & akun**, **Status satpam**, card printing, CSV import and settings; **Pengasuh** (dormitory caretaker) approves student exit permits under **Izin**; **GTK** (staff) shows the personal card. To switch roles, open **Lainnya → Keluar dari demo**. The camera is used only on **Pindai** after you tap the open-camera button; you can also type a card code. The privacy policy is linked from the sign-in screen and from **Lainnya**. The real e-mail/password sign-in is for school staff and cannot be exercised without a school account.

Alasan memilih mode demo (K4 opsi a): data Gate satu-tenant, jadi akun reviewer pada data produksi berisiko, dan proyek Supabase uji terpisah belum ada. Bila Google meminta kredensial nyata, jalur cadangan adalah proyek uji terpisah dengan data sintetis (perlu kuota proyek) dan akun demo per peran.

## Data safety: jawaban yang dianjurkan

Isi ulang sesuai AAB final. Gate tidak memakai SDK analitik, iklan, atau pelaporan crash; pustaka yang ikut hanya Capacitor, Supabase (lewat HTTP), dan pustaka QR. Penyedia infrastruktur (Supabase, Cloudflare, Google Drive) memproses data atas nama pengembang, sehingga tidak dihitung sebagai "dibagikan" menurut definisi Google.

| Jenis data | Dikumpulkan | Dibagikan | Wajib | Tujuan |
| --- | --- | --- | --- | --- |
| Informasi pribadi: Nama (murid, GTK, tamu, akun) | Ya | Tidak | Ya | Fungsi aplikasi |
| Informasi pribadi: Alamat email (akun masuk) | Ya | Tidak | Ya | Fungsi aplikasi, manajemen akun |
| Informasi pribadi: ID pengguna | Ya | Tidak | Ya | Fungsi aplikasi, manajemen akun |
| Informasi pribadi: Nomor telepon (tamu) | Ya | Tidak | Tidak (boleh kosong) | Fungsi aplikasi |
| Informasi pribadi lainnya: nomor induk, kelas/unit, asrama, plat kendaraan, keperluan kunjungan | Ya | Tidak | Ya | Fungsi aplikasi |
| Foto dan video: foto kejadian | Ya, hanya bila lembaga mengaktifkan penyimpanan foto | Tidak | Tidak | Fungsi aplikasi |
| Aktivitas aplikasi: catatan pergerakan, buku jaga, jejak audit | Ya | Tidak | Ya | Fungsi aplikasi, keamanan dan kepatuhan |
| ID perangkat atau lainnya (Turnstile memproses alamat IP dan sinyal peramban untuk pemeriksaan keamanan) | Ya, sebagai kehati-hatian | Tidak | Ya | Pencegahan penipuan, keamanan, dan kepatuhan |

Tidak dikumpulkan: lokasi, kontak, kalender, pesan, audio, berkas dan dokumen, informasi keuangan, kesehatan dan kebugaran, riwayat penelusuran web, log crash, dan diagnostik.

Praktik keamanan: data dienkripsi saat transit (HTTPS); pengguna dapat meminta penghapusan data (jalur di `/privasi#hak`); tidak mengikuti kebijakan Play Families; tanpa tinjauan keamanan independen.

Setelah mengisi, bandingkan dengan [kebijakan privasi](../src/pages/privasi.astro) agar keduanya sama. Pernyataan retensi di sana mengikuti engine: tamu belum diproses 24 jam, kunjungan selesai 30–365 hari (bawaan 90), catatan lain belum dihapus otomatis (keputusan pemilik K10). [Data safety](https://support.google.com/googleplay/android-developer/answer/10787469) · [Kebijakan privasi](https://support.google.com/googleplay/android-developer/answer/18265346) · [Persiapan review](https://support.google.com/googleplay/android-developer/answer/9859455)

## Membangun kandidat rilis

Upload keystore dibuat sekali, disimpan di luar repo dan dicadangkan terpisah (kehilangan upload key memerlukan reset lewat dukungan Google). Dari root Gate, di PowerShell:

```powershell
$env:PUBLIC_SUPABASE_URL = 'https://<proyek>.supabase.co'
$env:PUBLIC_SUPABASE_ANON_KEY = 'sb_publishable_…'            # kunci publishable, bukan secret
$env:PUBLIC_GATE_ORIGIN = 'https://gate.irsyads.com'
$env:GATE_ANDROID_VERSION_CODE = '1'                          # naik setiap unggahan
$env:GATE_ANDROID_UPLOAD_STORE_FILE = 'D:\kunci\gate-upload.jks'   # path absolut, di luar repo
$env:GATE_ANDROID_UPLOAD_STORE_PASSWORD = '…'
$env:GATE_ANDROID_UPLOAD_KEY_ALIAS = '…'
$env:GATE_ANDROID_UPLOAD_KEY_PASSWORD = '…'
$env:GATE_BUNDLETOOL_JAR = 'D:\alat\bundletool-all.jar'       # agar validate dan manifest dibaca dari AAB
npm run android:bundle:release
```

Skrip menolak konfigurasi yang tidak lengkap, keystore di dalam folder repo, dan `versionCode` di luar 1..2100000000. Setelah Gradle selesai, `scripts/android-verify-release.mjs` memeriksa tanda tangan (jarsigner), `bundletool validate`, dan manifest gabungan: izin hanya `INTERNET`/`CAMERA`, tidak debuggable, `allowBackup=false`, tanpa cleartext, tanpa App Link, `minSdk` 24, dan `targetSdk` minimal 36. `versionName` mengikuti `version` di `package.json`; naikkan sebelum rilis publik (saat ini `0.0.1`). Hasil: `android/app/build/outputs/bundle/release/app-release.aab`.

## Urutan masuk Play Console

1. Bangun dan verifikasi AAB seperti di atas, lalu aktifkan Play App Signing dan unggah ke **Internal testing** (hingga 100 penguji, tanpa tinjauan lama).
2. Pasang dari Google Play pada HP pos. Jalankan [matriks uji perangkat](ANDROID_DEVICE_TEST.md) dan perbaiki penghambat; naikkan `versionCode` untuk tiap unggahan ulang.
3. Lengkapi isian: App access, Data safety, rating konten, target audiens, listing, URL kebijakan privasi, dan tangkapan layar. Periksa Pre-launch report.
4. **Closed testing**: akun developer personal yang dibuat setelah 13 November 2023 butuh minimal 12 penguji yang tetap ikut 14 hari berturut-turut sebelum boleh mengajukan akses produksi. Konfirmasi tipe akun di Play Console. [Aturan uji akun personal](https://support.google.com/googleplay/android-developer/answer/14151465)
5. Ajukan produksi setelah syarat terpenuhi; mulai dengan rollout bertahap.

Unggahan ke Play Console selalu butuh konfirmasi pemilik (B1 di [ATURAN_PERBAIKAN.md](ATURAN_PERBAIKAN.md)).
