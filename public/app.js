const statusText = document.getElementById("statusText");
const totalProducts = document.getElementById("totalProducts");
const totalRows = document.getElementById("totalRows");
const totalQty = document.getElementById("totalQty");
const generatedDate = document.getElementById("generatedDate");
const generatedTime = document.getElementById("generatedTime");
const nextUpdateText = document.getElementById("nextUpdate");
const categoryTabs = document.getElementById("categoryTabs");
const productList = document.getElementById("productList");
const searchInput = document.getElementById("searchInput");
const refreshBtn = document.getElementById("refreshBtn");

let products = [];
let selectedCategory = "__all__";
let sourceWebsite = "zzhomey.com";

function getInitialQuery() {
  const params = new URLSearchParams(window.location.search);
  return (params.get("q") || params.get("search") || params.get("keyword") || "").trim();
}

function getInitialCategory() {
  const params = new URLSearchParams(window.location.search);
  return (params.get("cat") || "").trim();
}

function syncUrlState({ q, cat }) {
  const url = new URL(window.location.href);
  if (q) {
    url.searchParams.set("q", q);
  } else {
    url.searchParams.delete("q");
  }
  if (cat && cat !== "__all__") {
    url.searchParams.set("cat", cat);
  } else {
    url.searchParams.delete("cat");
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

function pad2(value) {
  return String(value).padStart(2, "0");
}

function toWibPseudoDate(date) {
  const utcMs = date.getTime() + date.getTimezoneOffset() * 60_000;
  return new Date(utcMs + 7 * 60 * 60 * 1000);
}

function formatWibHHMM(date) {
  const wibDate = toWibPseudoDate(date);
  return `${pad2(wibDate.getUTCHours())}:${pad2(wibDate.getUTCMinutes())}`;
}

function formatWibDDMMYYYY(date) {
  const wibDate = toWibPseudoDate(date);
  const day = pad2(wibDate.getUTCDate());
  const month = pad2(wibDate.getUTCMonth() + 1);
  const year = wibDate.getUTCFullYear();
  return `${day}-${month}-${year}`;
}

function getNextScheduleWibHHMM(nowDate = new Date()) {
  const wibNow = toWibPseudoDate(nowDate);
  const hour = wibNow.getUTCHours();
  const minute = wibNow.getUTCMinutes();
  let nextHour = 8;

  if (hour < 8) {
    nextHour = 8;
  } else if (hour > 21 || (hour === 21 && minute > 0)) {
    nextHour = 8;
  } else {
    nextHour = hour + 1;
    if (nextHour > 21) {
      nextHour = 8;
    }
  }

  return `${pad2(nextHour)}:00`;
}

function isReadyProductName(name) {
  return String(name || "").trimStart().toLowerCase().startsWith("[ready]");
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

function normalizeVariationText(variationText, sku) {
  const raw = String(variationText || "").trim();
  if (raw) {
    if (raw.includes("{") && raw.includes("}")) {
      const values = [...raw.matchAll(/\{([^}]*)\}/g)]
        .map((m) => String(m[1] || "").trim())
        .filter(Boolean);
      if (values.length > 0) {
        return values.join(" / ");
      }
    }
    return raw
      .replaceAll("{", "")
      .replaceAll("}", "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .join(" / ");
  }
  if (String(sku || "").trim()) {
    return `SKU: ${String(sku).trim()}`;
  }
  return "Tanpa Variasi";
}

function getCategoryLabel(product) {
  const name = String(product.category_name || "").trim();
  if (name) {
    return name;
  }
  const id = String(product.category_id || "").trim();
  if (id) {
    return `Kategori ${id}`;
  }
  return "Tanpa Kategori";
}

function normalizeProducts(payload) {
  sourceWebsite = payload?.source?.website || "zzhomey.com";
  if (!Array.isArray(payload.products)) {
    return [];
  }

  return payload.products
    .filter((product) => isReadyProductName(product.product_name || product.name))
    .map((product) => {
      const productId = product.product_id || product.id || "";
      const productName = product.product_name || product.name || "Tanpa Nama";
      const productSlug = product.product_slug || product.slug || "";
      const productLink =
        product.product_link || buildProductLink(sourceWebsite, productId, productSlug);
      const stocks = Array.isArray(product.stocks) ? product.stocks : [];
      const lines = stocks.map((stock) => ({
        variation_inline: normalizeVariationText(stock.variation_text, stock.sku),
        stock: stock.stock,
        sku: stock.sku,
        link: productLink,
      }));

      return {
        product_id: productId,
        product_name: productName,
        product_link: productLink,
        product_image: product.product_image || "",
        category_id: product.category_id || "",
        category_name: product.category_name || "",
        lines,
      };
    });
}

function renderCategoryTabs(categories) {
  const tabs = [{ key: "__all__", label: "Semua" }, ...categories];
  if (!tabs.some((tab) => tab.key === selectedCategory)) {
    selectedCategory = "__all__";
  }

  categoryTabs.innerHTML = tabs
    .map((tab) => {
      const active = tab.key === selectedCategory ? " active" : "";
      return `<button class="category-tab${active}" type="button" data-category="${escapeHtml(
        tab.key,
      )}">${escapeHtml(tab.label)}</button>`;
    })
    .join("");
}

function renderProducts(items) {
  if (!items.length) {
    productList.innerHTML = '<p class="empty">Data tidak ditemukan.</p>';
    return;
  }

  productList.innerHTML = items
    .map((product) => {
      const productTotalStock = product.lines.reduce(
        (sum, line) => sum + (typeof line.stock === "number" ? line.stock : 0),
        0,
      );
      const linesHtml = product.lines
        .map((line) => {
          const linkHtml = line.link
            ? `<a class="product-link" href="${escapeHtml(line.link)}" target="_blank" rel="noopener noreferrer">Link Produk</a>`
            : "<span class=\"product-link disabled\">Link Produk</span>";
          return `<p class="stock-line"><span class="variation">${escapeHtml(
            line.variation_inline,
          )}</span> = <span class="stock-value">${formatNumber(line.stock)}</span> | ${linkHtml}</p>`;
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
          <div class="product-head-text">
            <h3>${escapeHtml(product.product_name)}</h3>
            <p class="product-meta">Total stok: ${formatNumber(productTotalStock)}</p>
          </div>
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
      if (getCategoryLabel(product).toLowerCase().includes(q)) {
        return true;
      }
      return product.lines.some((line) => {
        const haystack = `${line.variation_inline || ""} ${line.sku || ""} ${line.stock ?? ""}`.toLowerCase();
        return haystack.includes(q);
      });
    });
  }

  const categoryMap = new Map();
  filtered.forEach((product) => {
    const key = getCategoryLabel(product);
    if (!categoryMap.has(key)) {
      categoryMap.set(key, key);
    }
  });
  const categories = Array.from(categoryMap.keys())
    .sort((a, b) => a.localeCompare(b))
    .map((label) => ({ key: label, label }));

  renderCategoryTabs(categories);

  const visible =
    selectedCategory === "__all__"
      ? filtered
      : filtered.filter((product) => getCategoryLabel(product) === selectedCategory);

  renderProducts(visible);
  updateSummary(visible);

  if (syncUrl) {
    syncUrlState({ q: rawQuery, cat: selectedCategory });
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
      const generatedDateObj = new Date(payload.generated_at);
      const lastDate = formatWibDDMMYYYY(generatedDateObj);
      const lastUpdate = formatWibHHMM(generatedDateObj);
      const nextUpdate = getNextScheduleWibHHMM(new Date());
      generatedDate.textContent = lastDate;
      generatedTime.textContent = `${lastUpdate} WIB`;
      nextUpdateText.textContent = `update selanjutnya ${nextUpdate} WIB`;
    } else {
      generatedDate.textContent = "-";
      generatedTime.textContent = "-";
      nextUpdateText.textContent = "update selanjutnya -";
    }

    statusText.textContent = `Sumber: ${payload?.source?.website || "zzhomey.com"}`;
    applyFilter({ syncUrl: false });
  } catch (error) {
    statusText.textContent = `Gagal memuat: ${error.message}`;
    productList.innerHTML = '<p class="empty">JSON belum tersedia.</p>';
    totalProducts.textContent = "0";
    totalRows.textContent = "0";
    totalQty.textContent = "0";
    generatedDate.textContent = "-";
    generatedTime.textContent = "-";
    nextUpdateText.textContent = "update selanjutnya -";
  }
}

searchInput.addEventListener("input", () => applyFilter({ syncUrl: true }));
refreshBtn.addEventListener("click", loadData);
categoryTabs.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-category]");
  if (!button) {
    return;
  }
  selectedCategory = button.dataset.category || "__all__";
  applyFilter({ syncUrl: true });
});

const initialQuery = getInitialQuery();
if (initialQuery) {
  searchInput.value = initialQuery;
}

const initialCategory = getInitialCategory();
if (initialCategory) {
  selectedCategory = initialCategory;
}

loadData();

