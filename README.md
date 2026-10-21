# TernakKu

Panduan ternak dalam bahasa Indonesia untuk peternak kecil, berjalan di
Homeroom. Satu layar dengan tiga tab:

- **FAQ**: 15 pertanyaan umum soal sapi, kambing dan domba, ayam, serta
  urusan kandang. Ada kolom cari dan saringan per hewan; tiap pertanyaan
  dibuka dan ditutup dengan sekali ketuk.
- **Forum**: peternak menulis pertanyaan (judul, isi, nama panggilan) dan
  membalas pertanyaan orang lain. Postingan terbaru di atas dan tersimpan di
  database, jadi semua pengguna melihatnya. Tiap postingan punya tombol
  Tanya AI, Laporkan, dan Hapus untuk postingan sendiri.
- **Tanya AI**: percakapan singkat soal ternak lewat layanan AI Homeroom.
  Jawabannya umum, singkat, dan selalu menyarankan dokter hewan atau dinas
  peternakan untuk kasus berat, darurat, atau penyakit menular.

Footer di semua tab: "Informasi umum, bukan pengganti dokter hewan."

## Menjalankan

```sh
npm ci --include=dev
npm run build      # menyusun public/tailwind.css
npm start          # butuh DATABASE_URL
```

Di Homeroom, pratinjau staging dengan `?demo=1` menampilkan forum contoh
dengan nama panggilan yang jelas palsu, plus pertanyaan milik penampil.
Demo itu hanya muncul di staging dan tidak pernah di produksi.

Lihat `CLAUDE.md` untuk aturan platform dan catatan desain aplikasi ini.
