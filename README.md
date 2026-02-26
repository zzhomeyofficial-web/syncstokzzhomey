# ZZHomey Stock Bot + Cloudflare Pages

Bot ini mengambil stok dari API Berdu (referensi: `https://dev.berdu.id/docs/reference`), menyimpan hasilnya ke `public/data/stock.json`, lalu HTML statis menampilkannya.

## 1. Setup Environment

Salin `.env.example` menjadi `.env`, lalu isi:

- `BERDU_APP_ID`
- `BERDU_APP_SECRET`
- `BERDU_USER_ID`
- `BERDU_API_BASE_URL` (default docs: `https://api.berdu.id/v0.0`)

## 2. Jalankan Bot Lokal

```bash
python -m pip install -r requirements.txt
python scripts/fetch_stock.py
```

Output akan ditulis ke `public/data/stock.json`.

## 3. Deploy ke GitHub + Cloudflare Pages

### GitHub Secrets

Tambahkan secret berikut di repo:

- `BERDU_API_BASE_URL`
- `BERDU_APP_ID`
- `BERDU_APP_SECRET`
- `BERDU_USER_ID`

Workflow yang sudah disiapkan: `.github/workflows/update-stock.yml`

- berjalan tiap 30 menit
- generate `public/data/stock.json`
- commit perubahan otomatis ke repo

### Cloudflare Pages

Connect repo ini ke Cloudflare Pages:

- Framework preset: `None`
- Build command: kosongkan
- Output directory: `public`

Cloudflare Pages akan serve:

- `index.html`
- `styles.css`
- `app.js`
- `data/stock.json`
- `berdu-form-snippet.html`

## 4. Endpoint yang dipakai bot

- `GET /product/list` (pakai pagination cursor)
- `GET /product/stocks`

Keduanya membutuhkan parameter `user_id`, sesuai docs reference Berdu.

## 5. Jika Berdu hanya support Form HTML

Jika di Berdu kamu hanya bisa pasang HTML form (tanpa JS custom), gunakan snippet:

- `public/berdu-form-snippet.html`

Cara pakai:

1. Ganti `https://YOUR-PAGES-DOMAIN.pages.dev/` dengan domain Cloudflare Pages kamu.
2. Paste HTML form tersebut ke area custom HTML di Berdu.
3. Form akan membuka halaman stock monitor di tab baru.
4. Query input form dikirim sebagai `?q=...` dan otomatis dipakai untuk filter di dashboard stok.
