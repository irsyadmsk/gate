# Materi pengajuan Google Play

Draf untuk peninjauan sebelum pengisian Play Console. Cakupan awal mengikuti [rencana rilis Android](ANDROID_PLAY_STORE_PLAN.md) dengan fokus pada petugas pos dan admin sekolah.

## Listing Indonesia

**Nama aplikasi**

Irsyads Gate

**Deskripsi singkat**

Catat akses gerbang, kunjungan tamu, dan pergantian jaga sekolah

**Deskripsi lengkap**

Irsyads Gate membantu petugas pos sekolah berasrama mencatat pergerakan di gerbang dan meneruskan informasi antarshift. Akses diberikan oleh pengelola sesuai peran akun Irsyads ID.

- Pindai kartu QR atau masukkan kode kartu untuk mencatat pergerakan GTK.
- Periksa izin keluar murid yang sudah disetujui pengasuh atau petugas piket.
- Catat kedatangan dan kepulangan tamu setelah pendaftaran diperiksa.
- Isi buku jaga dan serahkan catatan serta tanggungan kepada petugas berikutnya.
- Tinjau riwayat sesuai hak akses. Admin dapat mengelola petugas dan kartu di ruang administrasi.

Fitur operasional menggunakan koneksi internet. Pendaftaran tamu dapat dibuka melalui situs Gate di browser.

**Aset grafis**

| Aset | File | Teks alternatif |
| --- | --- | --- |
| Ikon 512 × 512 | [play-icon.png](play-store/play-icon.png) | Ikon gerbang warna krem dan biru pada latar biru tua. |
| Feature graphic 1024 × 500 | [feature-graphic.png](play-store/feature-graphic.png) | Irsyads Gate, ruang kerja pos sekolah untuk akses, kunjungan, dan serah terima. |

Sumber grafis dapat dibuka di browser. Gunakan tampilan 1024 × 500 untuk feature graphic atau `#icon` pada tampilan 512 × 512 untuk ikon. Ambil tangkapan layar dari build kandidat dengan data sintetis. Prioritaskan GTK cepat, izin murid, tamu, dan serah terima. [Sumber grafis](play-store/graphics.html) · [Aturan aset Google Play](https://support.google.com/googleplay/android-developer/answer/9866151)

## App access untuk reviewer

Teks berikut dipakai setelah akun demo, tautan QR sintetis, dan label navigasi diperiksa dari instalasi Play. Simpan kredensial di bagian App access dalam Play Console.

> Irsyads Gate requires an assigned Irsyads ID account. Tap **Masuk melalui Irsyads ID**, sign in with the supplied demo credentials, then return to Gate. The demo environment contains synthetic school records. Use the guard account to open **GTK** for staff movement, **Pindai** for card checks, and **Jaga** for duty handover. Use the administrator account to inspect **GTK & akun** and **Status satpam**. Use the supplied sample QR link or type the provided sample card code. Sign out using **Lainnya → Keluar akun** before changing accounts.

Verifikasi akses demo Satpam, admin, GTK, pengasuh/piket, dan penerima tamu sesuai fitur pada AAB. Akun dan kode harus dapat dipakai berulang kali oleh reviewer dari lokasi mereka. Tautan contoh perlu memakai QR staging yang tidak memberi akses ke data sekolah. [Syarat akses reviewer](https://support.google.com/googleplay/android-developer/answer/15748846)

## Masukan untuk kebijakan privasi dan Data safety

| Alur | Data yang perlu diperiksa sebelum mengisi formulir |
| --- | --- |
| Irsyads ID dan sesi | Identitas akun, peran, sesi perangkat dan token autentikasi. Verifikasi jalur pembuatan serta penghapusan akun pada portal yang dapat dibuka dari aplikasi. |
| Operasional pos | Nama, nomor identitas atau kode kartu, tujuan atau alasan izin, waktu pergerakan, data petugas, dan riwayat jaga. Pastikan pihak yang bisa melihat, tujuan pemrosesan, serta aturan retensi untuk tiap jenis catatan. |
| Kunjungan | Nama, keperluan, penerima, waktu, dan nomor telepon jika diberikan. Verifikasi pemisahan alur browser publik dan data kunjungan yang diproses di aplikasi. |
| Kamera dan foto | Kamera membaca QR saat petugas membuka scanner. Foto kejadian perlu deklarasi tersendiri jika unggah diaktifkan dan diuji untuk build rilis. |
| Berbagi dan laporan | Periksa data yang bisa diekspor atau dicetak, lokasi file sementara pada Android, serta kapan file itu dibersihkan. |

Sebelum mengisi Play Console, tetapkan nama penerbit, alamat dukungan, URL kebijakan privasi publik, retensi catatan, dan kontak permintaan data. Isi deklarasi berdasarkan AAB final dan SDK yang benar-benar ikut. [Persiapan review](https://support.google.com/googleplay/android-developer/answer/9859455) · [Data safety](https://support.google.com/googleplay/android-developer/answer/10787469)

## Urutan masuk Play Console

1. Verifikasi akun demo dan satu tindakan Gate dari login sampai data tercatat. Gunakan staging yang terpisah dan uji App Link serta scan QR di perangkat pos.
2. Siapkan package ID dan kunci unggah milik penerbit. Bangun AAB rilis bertanda tangan dan unggah ke Internal testing.
3. Pasang dari Google Play. Verifikasi App Link memakai sidik jari Play App Signing, uji ulang alur demo, dan ambil tangkapan layar kandidat.
4. Lengkapi listing, kebijakan privasi, App access, Data safety, dan rating konten sebelum beralih ke jalur pengujian atau produksi sesuai ketentuan akun.
