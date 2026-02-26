const statusText = document.getElementById("statusText");
const totalProducts = document.getElementById("totalProducts");
const totalRows = document.getElementById("totalRows");
const totalQty = document.getElementById("totalQty");
const generatedAt = document.getElementById("generatedAt");
const productList = document.getElementById("productList");
const searchInput = document.getElementById("searchInput");
const refreshBtn = document.getElementById("refreshBtn");

let products = [];
let sourceWebsite = "zzhomey.com";

function isReadyProductName(name) {
  return String(name || "").trimStart().toLowerCase().startsWith("[ready]");
}

function getInitialQuery() {
  const params = new URLSearchParams(window.location.search);
  return (params.get("q") || params.get("search") || params.get("keyword") || "").trim();
}

function syncUrlQuery(q) {
  const url = new URL(window.location.href);
  if (q) {
    url.searchParams.set("q", q);
  } else {
    url.searchParams.delete("q");
  }
  window.history.replaceState({}, "", url.toString());
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatNumber(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }
  return value.toLocaleString("id-ID");
}

function buildProductLink(baseWebsite, productId, productSlug) {
  let base = String(baseWebsite || "").trim();
  if (!base) {
    base = "zzhomey.com";
  }
  if (!base.startsWith("http://") && !base.startsWith("https://")) {
    base = `https://${base}`;
  }
  base = base.replace(/\/+$/, "");
  if (productSlug) {
    return `${base}/product/${productSlug}`;
  }
  return `${base}/product/${productId || ""}`;
}

function formatVariationInline(variations, variationText, sku) {
  if (Array.isArray(variations) && variations.length > 0) {
    return variations
      .map((item) => {
        if (item && typeof item === "object") {
          const raw = item.value || item.option || item.name || item.key || "";
          const text = String(raw || "").trim();
          return text ? `{${text}}` : "";
        }
        const text = String(item || "").trim();
        return text ? `{${text}}` : "";
      })
      .filter(Boolean)
      .join("");
  }

  const cleanVariationText = String(variationText || "").trim();
  if (cleanVariationText) {
    if (cleanVariationText.startsWith("{")) {
      return cleanVariationText;
    }
    return cleanVariationText
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => `{${part}}`)
      .join("");
  }

  if (String(sku || "").trim()) {
    return `{SKU:${String(sku).trim()}}`;
  }

  return "{Tanpa Variasi}";
}

function normalizeProducts(payload) {
  sourceWebsite = payload?.source?.website || "zzhomey.com";

  if (Array.isArray(payload.products)) {
    return payload.products
      .filter((product) => isReadyProductName(product.product_name || product.name))
      .map((product) => {
        const productId = product.product_id || product.id || "";
        const productName = product.product_name || product.name || "Tanpa Nama";
        const productSlug = product.product_slug || product.slug || "";
        const productLink =
          product.product_link || buildProductLink(sourceWebsite, productId, productSlug);
        const stocks = Array.isArray(product.stocks) ? product.stocks : [];
        const lines = stocks.map((stock) => {
          const variationInline = formatVariationInline(
            stock.variations,
            stock.variation_text,
            stock.sku,
          );
          return {
            variation_inline: variationInline,
            stock: stock.stock,
            sku: stock.sku,
            link: productLink,
          };
        });
        return {
          product_id: productId,
          product_name: productName,
          product_link: productLink,
          product_image: product.product_image || "",
          lines,
        };
      });
  }

  if (Array.isArray(payload.items)) {
    const grouped = new Map();
    payload.items
      .filter((row) => isReadyProductName(row.product_name))
      .forEach((row) => {
        const key = row.product_id || row.product_name || "";
        if (!grouped.has(key)) {
          const fallbackLink = buildProductLink(sourceWebsite, row.product_id, "");
          grouped.set(key, {
            product_id: row.product_id || "",
            product_name: row.product_name || "Tanpa Nama",
            product_link: row.product_link || fallbackLink,
            product_image: row.product_image || "",
            lines: [],
          });
        }
        const bucket = grouped.get(key);
        bucket.lines.push({
          variation_inline: formatVariationInline([], row.variation_text, row.sku),
          stock: row.stock,
          sku: row.sku,
          link: row.product_link || bucket.product_link,
        });
      });
    return Array.from(grouped.values());
  }

  return [];
}

function renderProducts(items) {
  if (!items.length) {
    productList.innerHTML = '<p class="empty">Data tidak ditemukan.</p>';
    return;
  }

  productList.innerHTML = items
    .map((product) => {
      const linesHtml = product.lines
        .map((line) => {
          const linkHtml = line.link
            ? `<a class="product-link" href="${escapeHtml(line.link)}" target="_blank" rel="noopener noreferrer">Link Produk</a>`
            : "<span class=\"product-link disabled\">Link Produk</span>";
          return `<p class="stock-line"><span class="variation">${escapeHtml(
            line.variation_inline,
          )}</span>=<span class="stock-value">${formatNumber(line.stock)}</span> | ${linkHtml}</p>`;
        })
        .join("");

      return `<article class="product-card">
        <div class="product-head">
          ${
            product.product_image
              ? `<img class="product-thumb" src="${escapeHtml(product.product_image)}" alt="${escapeHtml(
                  product.product_name,
                )}" loading="lazy" />`
              : '<div class="product-thumb placeholder">IMG</div>'
          }
          <h3>${escapeHtml(product.product_name)}</h3>
        </div>
        <div class="stock-lines">${linesHtml}</div>
      </article>`;
    })
    .join("");
}

function updateSummary(items) {
  const rowCount = items.reduce((sum, item) => sum + item.lines.length, 0);
  const qty = items.reduce(
    (sum, item) =>
      sum +
      item.lines.reduce((inner, line) => inner + (typeof line.stock === "number" ? line.stock : 0), 0),
    0,
  );
  totalProducts.textContent = formatNumber(items.length);
  totalRows.textContent = formatNumber(rowCount);
  totalQty.textContent = formatNumber(qty);
}

function applyFilter({ syncUrl = true } = {}) {
  const rawQuery = searchInput.value.trim();
  const q = rawQuery.toLowerCase();
  let filtered = products;

  if (q) {
    filtered = products.filter((product) => {
      if ((product.product_name || "").toLowerCase().includes(q)) {
        return true;
      }
      return product.lines.some((line) => {
        const haystack = `${line.variation_inline || ""} ${line.sku || ""} ${line.stock ?? ""}`.toLowerCase();
        return haystack.includes(q);
      });
    });
  }

  renderProducts(filtered);
  updateSummary(filtered);

  if (syncUrl) {
    syncUrlQuery(rawQuery);
  }
}

async function loadData() {
  statusText.textContent = "Memuat data...";
  try {
    const response = await fetch(`./data/stock.json?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();

    products = normalizeProducts(payload);

    if (payload.generated_at) {
      generatedAt.textContent = new Date(payload.generated_at).toLocaleString("id-ID");
    } else {
      generatedAt.textContent = "-";
    }

    statusText.textContent = `Sumber: ${payload?.source?.website || "zzhomey.com"}`;
    applyFilter({ syncUrl: false });
  } catch (error) {
    statusText.textContent = `Gagal memuat: ${error.message}`;
    productList.innerHTML = '<p class="empty">JSON belum tersedia.</p>';
    totalProducts.textContent = "0";
    totalRows.textContent = "0";
    totalQty.textContent = "0";
  }
}

searchInput.addEventListener("input", () => applyFilter({ syncUrl: true }));
refreshBtn.addEventListener("click", loadData);

const initialQuery = getInitialQuery();
if (initialQuery) {
  searchInput.value = initialQuery;
}

loadData();
