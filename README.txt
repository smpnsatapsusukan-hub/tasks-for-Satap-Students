KELAS ONLINE - SMPN 4 SATAP SUSUKAN
===================================
Isi folder:
  public/index.html              -> tampilan aplikasi (guru, siswa, orang tua)
  netlify/functions/api.mjs      -> server (cek password, simpan tugas/nilai/komentar)
  netlify/functions/students.mjs -> daftar siswa + password (sudah ter-hash)
  package.json, netlify.toml     -> pengaturan Netlify

CARA PASANG (cara termudah, lewat GitHub):
 1. Buat repository PRIVATE di github.com, upload semua isi folder ini.
 2. Di netlify.com: Add new site > Import an existing project > pilih repository tadi.
 3. Biarkan pengaturan default > Deploy. Selesai, Netlify memberi alamat https://namasitus.netlify.app
 4. Bagikan alamat itu + password dari file DAFTAR_AKUN_RAHASIA.xlsx.

CARA LAIN (Netlify CLI):  npm i -g netlify-cli ; npm install ; netlify deploy --prod

CATATAN:
 - Drag & drop folder di Netlify TIDAK cocok, karena aplikasi butuh server (Functions + Blobs).
 - Jangan upload DAFTAR_AKUN_RAHASIA.xlsx ke GitHub.
