# TernakKu

Panduan ternak dalam bahasa Indonesia untuk peternak kecil, berjalan di
Homeroom. Satu layar dengan empat tab:

- **FAQ**: 15 pertanyaan umum soal sapi, kambing dan domba, ayam, serta
  urusan kandang. Ada kolom cari dan saringan per hewan; tiap pertanyaan
  dibuka dan ditutup dengan sekali ketuk. Logo bulat di header berisi sapi,
  kambing dan ayam dan berganti mengikuti hewan yang dipilih, dan catatan
  ⓘ dibuka dengan semboyan "Semua ternak, satu aplikasi".
- **Ternakku**: catatan ternak milik sendiri. Tiap ternak punya nama atau
  nomor telinga, jenis, umur, foto, catatan berat, pengingat vaksin, obat
  cacing, perkiraan lahir dan jadwal timbang, grafik pertumbuhan, serta
  catatan sakit dan pengobatan yang bisa dibagikan ke dokter hewan lewat
  WhatsApp. Catatan ini hanya terlihat oleh akun Homeroom pemiliknya.
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
