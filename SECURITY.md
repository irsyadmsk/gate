# Kebijakan keamanan

Gate adalah aplikasi pos gerbang sekolah. Kode ini terbuka, tetapi layanan yang berjalan memproses data murid, GTK, dan tamu. Terima kasih sudah membantu menjaganya aman.

## Melapor kerentanan

Laporkan **secara privat**, jangan lewat Issue atau Pull Request publik:

1. Buka tab **Security** di repositori ini, lalu pilih **Report a vulnerability** (GitHub private vulnerability reporting).
2. Jika pilihan itu belum tersedia, buka Issue dengan judul "Permintaan kontak keamanan" **tanpa detail teknis**. Pemilik akan menghubungi Anda untuk saluran privat.

Sertakan: ringkasan dampak, langkah mereproduksi, commit atau versi yang diuji, dan halaman atau fungsi yang terkait. Jangan melampirkan data pribadi nyata.

Ini proyek perorangan tanpa program hadiah (bug bounty). Pemilik berusaha membalas dalam 7 hari dan memperbaiki temuan yang valid sesuai tingkat risikonya.

## Lingkup

Dalam lingkup: kode di repositori ini (frontend, `supabase/functions`, migrasi SQL, skrip, proyek Android) dan layanan `gate.irsyads.com` yang dibangun darinya.

Layanan Irsyads lain, termasuk Irsyads ID, berada di luar repositori ini. Tetap laporkan lewat saluran yang sama; pemilik meneruskannya.

## Aturan pengujian

- Gunakan akun dan data milik sendiri atau data sintetis. Berhenti dan laporkan bila Anda menemukan data pribadi orang lain; jangan menyalin atau menyebarkannya.
- Jangan melakukan serangan penolakan layanan, pendaftaran massal ke `/tamu`, atau pengiriman otomatis dalam jumlah besar.
- Jangan melakukan rekayasa sosial terhadap pemilik atau pengguna, dan jangan mengubah atau menghapus data yang bukan milik Anda.

## Rahasia yang terlanjur terpublikasi

Bila Anda menemukan kunci, token, atau kredensial di repositori atau riwayatnya, laporkan secara privat dan jangan menggunakannya. Hanya kunci publishable Supabase, kunci situs Turnstile, dan client ID OAuth yang memang publik yang seharusnya ada di sini.

## Untuk kontributor

Jalankan `npm run check:public` sebelum push. Perintah itu memeriksa berkas terlarang (rahasia, keystore, build, log), pola rahasia, email di luar domain contoh, dan jalur pengguna lokal. Aturan lengkapnya ada di [docs/ATURAN_PERBAIKAN.md](docs/ATURAN_PERBAIKAN.md).

---

**English summary.** Please report vulnerabilities privately through GitHub's "Report a vulnerability" (Security tab), not through public issues. Include impact, reproduction steps, and the tested commit. Test only with your own or synthetic data, and do not run denial-of-service or mass-registration tests. This is a personal project with no bug bounty; best-effort first response within 7 days.
