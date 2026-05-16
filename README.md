# ZZHomey Stock Bot (GitHub + Cloudflare Pages)

Bot ini:

1. Ambil data stok dari API Berdu.
2. Generate file `public/data/stock.json`.
3. Tampilkan stok di website statis Cloudflare Pages (`public/index.html`).
4. Update otomatis via GitHub Actions setiap 15 menit (24 jam).

Halaman yang tersedia:

1. Publik: `/`
2. Internal: `/internal/`

Perhitungan aset menggunakan **harga modal** (bukan harga jual).

---

## 1) Setup Environment

Salin `.env.example` menjadi `.env`, lalu isi:

1. `BERDU_APP_ID`
2. `BERDU_APP_SECRET`
3. `BERDU_USER_ID`
4. `BERDU_API_BASE_URL` (default: `https://api.berdu.id/v0.0`)
5. `WEBSITE_NAME` (default: `zzhomey.com`)
6. `READY_KEYWORD` (default: `[ready]`)

---

## 2) Jalankan Bot Lokal

```bash
python -m pip install -r requirements.txt
python scripts/fetch_stock.py
```

Output ditulis ke `public/data/stock.json`.

---

## 3) Deploy ke GitHub + Cloudflare Pages

### GitHub Secrets

Tambahkan secret berikut di repo:

1. `BERDU_API_BASE_URL`
2. `BERDU_APP_ID`
3. `BERDU_APP_SECRET`
4. `BERDU_USER_ID`

Workflow: `.github/workflows/update-stock.yml`

1. Jadwal: setiap 15 menit (`*/15 * * * *`)
2. Generate `public/data/stock.json`
3. Commit otomatis bila ada perubahan data

### Cloudflare Pages

Connect repo ini ke Cloudflare Pages dengan setting:

1. Framework preset: `None`
2. Build command: kosongkan
3. Output directory: `public`
4. Production branch: `main`

---

## 4) Endpoint API yang Dipakai

1. `GET /product/list` (pagination cursor)
2. `GET /product/stocks`
3. `GET /product/detail`
4. `GET /product/variations`
5. `GET /product/prices` (best effort, untuk modal/aset)

---

## 5) Jika Berdu Hanya Support Form HTML

Gunakan snippet:

1. `public/berdu-form-snippet.html`

Cara pakai:

1. Ganti `https://YOUR-PAGES-DOMAIN.pages.dev/` dengan URL Pages kamu.
2. Paste ke area custom HTML Berdu.
3. Form buka dashboard stok di tab baru.
