const statusText = document.getElementById("statusText");
const totalProducts = document.getElementById("totalProducts");
const totalStock = document.getElementById("totalStock");
const generatedDate = document.getElementById("generatedDate");
const generatedTime = document.getElementById("generatedTime");
const nextUpdateText = document.getElementById("nextUpdate");
const totalAssetText = document.getElementById("totalAssetText");
const categoryTabs = document.getElementById("categoryTabs");
const productList = document.getElementById("productList");
const searchInput = document.getElementById("searchInput");
const sortSelect = document.getElementById("sortSelect");
const sizeSelect = document.getElementById("sizeSelect");
const refreshBtn = document.getElementById("refreshBtn");
const dashboardMode = String(document.body?.dataset?.dashboard || "public")
  .trim()
  .toLowerCase();
const isInternalDashboard = dashboardMode === "internal";
const showAssetValues = isInternalDashboard;
const dataUrl = String(document.body?.dataset?.dataUrl || "/data/stock.json").trim();

let products = [];
let selectedCategory = "__all__";
let selectedSort = "stock_desc";
let selectedSize = "__all__";
let sourceWebsite = "zzhomey.com";
const expandedProducts = new Set();
const READY_KEYWORD = "[ready]";
const STOCK_SORT_OPTIONS = new Set(["stock_desc", "stock_asc"]);
const INTERNAL_SORT_OPTIONS = new Set(["stock_desc", "stock_asc", "asset_desc", "asset_asc"]);
const SIZE_OPTIONS = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "XXXXL"];
const SIZE_SET = new Set(SIZE_OPTIONS);
const SIZE_DETECT_ORDER = ["XXXXL", "XXXL", "XXL", "XXS", "XL", "XS", "S", "M", "L"];

function normalizeSortValue(value) {
  const selected = String(value || "").trim();
  const allowed = showAssetValues ? INTERNAL_SORT_OPTIONS : STOCK_SORT_OPTIONS;
  if (allowed.has(selected)) {
    return selected;
  }
  return "stock_desc";
}

function getInitialQuery() {
  const params = new URLSearchParams(window.location.search);
  return (params.get("q") || params.get("search") || params.get("keyword") || "").trim();
}

function getInitialCategory() {
  const params = new URLSearchParams(window.location.search);
  return (params.get("cat") || "").trim();
}

function getInitialSort() {
  const params = new URLSearchParams(window.location.search);
  return normalizeSortValue(params.get("sort"));
}

function getInitialSize() {
  const params = new URLSearchParams(window.location.search);
  const size = (params.get("size") || "").trim().toUpperCase();
  if (!size || !SIZE_SET.has(size)) {
    return "__all__";
  }
  return size;
}

function syncUrlState({ q, cat, sort, size }) {
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
  if (sort && sort !== "stock_desc") {
    url.searchParams.set("sort", sort);
  } else {
    url.searchParams.delete("sort");
  }
  if (size && size !== "__all__") {
    url.searchParams.set("size", size);
  } else {
    url.searchParams.delete("size");
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

function formatCurrency(value) {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) {
    return "-";
  }
  return value.toLocaleString("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  });
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildModalDetailText(line) {
  const stockValue = toFiniteNumber(line?.stock);
  const modalValue = toFiniteNumber(line?.modal ?? line?.price);

  if (stockValue === null || modalValue === null || modalValue <= 0) {
    return "Total aset: -";
  }

  const lineAsset = modalValue * stockValue;
  return `Total aset: ${formatCurrency(lineAsset)}`;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function setText(node, value) {
  if (node) {
    node.textContent = value;
  }
}

const WIB_TIMEZONE = "Asia/Jakarta";
const WIB_PARTS_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: WIB_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  hourCycle: "h23",
});

function getWibParts(date) {
  const parts = WIB_PARTS_FORMATTER.formatToParts(date);
  const values = {};
  parts.forEach((part) => {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  });
  return {
    day: values.day || "00",
    month: values.month || "00",
    year: values.year || "0000",
    hour: values.hour || "00",
    minute: values.minute || "00",
  };
}

function formatWibHHMM(date) {
  const parts = getWibParts(date);
  return `${parts.hour}:${parts.minute}`;
}

function formatWibDDMMYYYY(date) {
  const parts = getWibParts(date);
  return `${parts.day}-${parts.month}-${parts.year}`;
}

function getNextScheduleWibHHMM(nowDate = new Date()) {
  const wibNow = getWibParts(nowDate);
  const hour = Number(wibNow.hour);
  const minute = Number(wibNow.minute);

  let nextHour = hour;
  let nextMinute = Math.floor(minute / 15) * 15 + 15;
  if (nextMinute >= 60) {
    nextMinute = 0;
    nextHour = (nextHour + 1) % 24;
  }

  return `${pad2(nextHour)}:${pad2(nextMinute)}`;
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

function buildStockLink(productLink, variationId, stockId, sku) {
  const base = String(productLink || "").trim();
  if (!base) {
    return "";
  }
  try {
    const url = new URL(base);
    const v = String(variationId || "").trim();
    const sId = String(stockId || "").trim();
    const sSku = String(sku || "").trim();
    if (v) {
      url.searchParams.set("variationID", v);
    }
    if (sId) {
      url.searchParams.set("stock_id", sId);
    }
    if (sSku) {
      url.searchParams.set("sku", sSku);
    }
    return url.toString();
  } catch {
    return base;
  }
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

function extractSizeFromVariation(variationText, sku) {
  const source = `${String(variationText || "")} ${String(sku || "")}`.toUpperCase();
  if (!source.trim()) {
    return "";
  }

  const tokens = source
    .replaceAll("{", " ")
    .replaceAll("}", " ")
    .replaceAll("(", " ")
    .replaceAll(")", " ")
    .split(/[^A-Z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  for (const token of tokens) {
    if (SIZE_SET.has(token)) {
      return token;
    }
  }

  for (const size of SIZE_DETECT_ORDER) {
    const pattern = new RegExp(`(?:^|[^A-Z0-9])${size}(?:[^A-Z0-9]|$)`);
    if (pattern.test(source)) {
      return size;
    }
  }

  return "";
}

function extractColorFromVariation(variationText, sizeKey) {
  const text = String(variationText || "").trim();
  if (!text) {
    return "";
  }

  const sizeUpper = String(sizeKey || "").trim().toUpperCase();
  const parts = text
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  for (const part of parts) {
    const upper = part.toUpperCase();
    if (!upper || upper === sizeUpper) {
      continue;
    }
    if (upper.startsWith("SKU:")) {
      continue;
    }
    if (SIZE_SET.has(upper)) {
      continue;
    }
    return part;
  }

  return parts[0] || "";
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

function isReadyProductName(productName) {
  return String(productName || "").toLowerCase().includes(READY_KEYWORD);
}

function getProductTotalStock(product) {
  return (Array.isArray(product.lines) ? product.lines : []).reduce(
    (sum, line) => sum + (typeof line.stock === "number" ? line.stock : 0),
    0,
  );
}

function getProductTotalAsset(product) {
  if (
    typeof product.total_asset === "number" &&
    !Number.isNaN(product.total_asset) &&
    product.total_asset > 0
  ) {
    return product.total_asset;
  }
  let hasAsset = false;
  const sum = (Array.isArray(product.lines) ? product.lines : []).reduce((total, line) => {
    if (typeof line.asset === "number" && !Number.isNaN(line.asset)) {
      hasAsset = true;
      return total + line.asset;
    }
    return total;
  }, 0);
  return hasAsset && sum > 0 ? sum : null;
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
    const lines = stocks.map((stock) => {
      const variationInline = normalizeVariationText(stock.variation_text, stock.sku);
      const sizeKey = extractSizeFromVariation(variationInline, stock.sku);
      return {
        variation_inline: variationInline,
        variation_raw: String(stock.variation_text || ""),
        variation_id: stock.variation_id,
        stock_id: stock.stock_id,
        size_key: sizeKey,
        color_key: extractColorFromVariation(variationInline, sizeKey),
        stock: stock.stock,
        sku: stock.sku,
        link: buildStockLink(productLink, stock.variation_id, stock.stock_id, stock.sku),
        price: stock.price,
        modal: stock.modal ?? stock.price,
        quantity: stock.quantity,
        asset: stock.asset,
      };
    });
    const totalStock = lines.reduce(
      (sum, line) => sum + (typeof line.stock === "number" ? line.stock : 0),
      0,
    );
    const totalAsset =
      typeof product.total_asset === "number"
        ? product.total_asset
        : lines.reduce((sum, line) => sum + (typeof line.asset === "number" ? line.asset : 0), 0);

    return {
      product_id: productId,
      product_name: productName,
      product_link: productLink,
      product_image: product.product_image || "",
      category_id: product.category_id || "",
      category_name: product.category_name || "",
      total_stock: totalStock,
      total_asset: totalAsset,
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
      const productKey = `${String(product.product_id || "").trim()}::${String(
        product.product_name || "",
      ).trim()}`;
      const isExpanded = expandedProducts.has(productKey);
      const productTotalStock =
        typeof product.total_stock === "number" ? product.total_stock : getProductTotalStock(product);
      const productTotalAsset = getProductTotalAsset(product);
      const assetHtml = showAssetValues
        ? `<p class="product-meta">Total aset: ${formatCurrency(productTotalAsset)}</p>`
        : "";
      const linesHtml = product.lines
        .map((line) => {
          const linkHtml = line.link
            ? `<a class="product-link" href="${escapeHtml(line.link)}" target="_blank" rel="noopener noreferrer">Link Produk</a>`
            : "<span class=\"product-link disabled\">Link Produk</span>";
          const stockPcsText = `${formatNumber(line.stock)} pcs`;
          const modalText = showAssetValues ? ` | ${escapeHtml(buildModalDetailText(line))}` : "";
          return `<p class="stock-line"><span class="variation">${escapeHtml(
            line.variation_inline,
          )}</span> = <span class="stock-value">${stockPcsText}</span>${modalText} | ${linkHtml}</p>`;
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
            ${assetHtml}
            <button
              class="stock-toggle-btn"
              type="button"
              data-product-key="${escapeHtml(productKey)}"
              aria-expanded="${isExpanded ? "true" : "false"}"
            >${isExpanded ? "Sembunyikan Stok" : "Lihat Stok"}</button>
          </div>
        </div>
        <div class="stock-lines${isExpanded ? "" : " is-collapsed"}"${isExpanded ? "" : " hidden"}>${linesHtml}</div>
      </article>`;
    })
    .join("");
}

function updateSummary(items) {
  const qty = items.reduce(
    (sum, item) =>
      sum +
      item.lines.reduce((inner, line) => inner + (typeof line.stock === "number" ? line.stock : 0), 0),
    0,
  );

  if (totalProducts) {
    totalProducts.textContent = formatNumber(items.length);
  }
  if (totalStock) {
    totalStock.textContent = formatNumber(qty);
  }

  if (!totalAssetText) {
    return;
  }
  if (!showAssetValues) {
    setText(totalAssetText, "-");
    return;
  }

  let hasAsset = false;
  const assetTotal = items.reduce((sum, item) => {
    const value = getProductTotalAsset(item);
    if (typeof value === "number" && !Number.isNaN(value)) {
      hasAsset = true;
      return sum + value;
    }
    return sum;
  }, 0);
  setText(totalAssetText, hasAsset && assetTotal > 0 ? formatCurrency(assetTotal) : "-");
}

function sortProducts(items) {
  const sorted = [...items];
  const getAssetSortValue = (product) => {
    const asset = getProductTotalAsset(product);
    if (typeof asset === "number" && !Number.isNaN(asset) && asset > 0) {
      return asset;
    }
    return 0;
  };

  if (showAssetValues && selectedSort === "asset_asc") {
    sorted.sort((a, b) => {
      const assetA = getAssetSortValue(a);
      const assetB = getAssetSortValue(b);
      if (assetA !== assetB) {
        return assetA - assetB;
      }
      return String(a.product_name || "").localeCompare(String(b.product_name || ""));
    });
    return sorted;
  }

  if (showAssetValues && selectedSort === "asset_desc") {
    sorted.sort((a, b) => {
      const assetA = getAssetSortValue(a);
      const assetB = getAssetSortValue(b);
      if (assetA !== assetB) {
        return assetB - assetA;
      }
      return String(a.product_name || "").localeCompare(String(b.product_name || ""));
    });
    return sorted;
  }

  if (selectedSort === "stock_asc") {
    sorted.sort((a, b) => {
      const stockA = typeof a.total_stock === "number" ? a.total_stock : getProductTotalStock(a);
      const stockB = typeof b.total_stock === "number" ? b.total_stock : getProductTotalStock(b);
      if (stockA !== stockB) {
        return stockA - stockB;
      }
      return String(a.product_name || "").localeCompare(String(b.product_name || ""));
    });
    return sorted;
  }

  sorted.sort((a, b) => {
    const stockA = typeof a.total_stock === "number" ? a.total_stock : getProductTotalStock(a);
    const stockB = typeof b.total_stock === "number" ? b.total_stock : getProductTotalStock(b);
    if (stockA !== stockB) {
      return stockB - stockA;
    }
    return String(a.product_name || "").localeCompare(String(b.product_name || ""));
  });
  return sorted;
}

function applyFilter({ syncUrl = true } = {}) {
  const rawQuery = searchInput.value.trim();
  const q = rawQuery.toLowerCase();

  let filtered = products;
  if (q) {
    filtered = products
      .map((product) => {
        const nameMatch = (product.product_name || "").toLowerCase().includes(q);
        const categoryMatch = getCategoryLabel(product).toLowerCase().includes(q);
        const lineMatches = product.lines.filter((line) => {
          const haystack =
            `${line.variation_inline || ""} ${line.variation_raw || ""} ${line.color_key || ""} ` +
            `${line.sku || ""} ${line.variation_id || ""} ${line.stock ?? ""}`.toLowerCase();
          return haystack.includes(q);
        });

        // Jika query cocok pada variasi/SKU/warna, tampilkan hanya SKU yang match.
        if (lineMatches.length > 0) {
          const totalStock = lineMatches.reduce(
            (sum, line) => sum + (typeof line.stock === "number" ? line.stock : 0),
            0,
          );
          const assetValues = lineMatches
            .map((line) => line.asset)
            .filter((value) => typeof value === "number" && !Number.isNaN(value));
          const totalAsset = assetValues.length > 0 ? assetValues.reduce((sum, value) => sum + value, 0) : null;
          return {
            ...product,
            lines: lineMatches,
            total_stock: totalStock,
            total_asset: totalAsset,
          };
        }

        if (nameMatch || categoryMatch) {
          return product;
        }
        return null;
      })
      .filter(Boolean);
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

  let visible =
    selectedCategory === "__all__"
      ? filtered
      : filtered.filter((product) => getCategoryLabel(product) === selectedCategory);

  if (selectedSize !== "__all__") {
    visible = visible
      .map((product) => {
        const lines = product.lines.filter((line) => line.size_key === selectedSize);
        if (!lines.length) {
          return null;
        }
        const totalStock = lines.reduce(
          (sum, line) => sum + (typeof line.stock === "number" ? line.stock : 0),
          0,
        );
        const assetValues = lines
          .map((line) => line.asset)
          .filter((value) => typeof value === "number" && !Number.isNaN(value));
        const totalAsset = assetValues.length > 0 ? assetValues.reduce((sum, value) => sum + value, 0) : null;
        return {
          ...product,
          lines,
          total_stock: totalStock,
          total_asset: totalAsset,
        };
      })
      .filter(Boolean);
  }

  const sortedVisible = sortProducts(visible);

  renderProducts(sortedVisible);
  updateSummary(sortedVisible);

  if (syncUrl) {
    syncUrlState({ q: rawQuery, cat: selectedCategory, sort: selectedSort, size: selectedSize });
  }
}

async function loadData() {
  setText(statusText, "Memuat data...");
  try {
    const separator = dataUrl.includes("?") ? "&" : "?";
    const response = await fetch(`${dataUrl}${separator}v=${Date.now()}`, { cache: "no-store" });
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
      setText(generatedDate, lastDate);
      setText(generatedTime, `${lastUpdate} WIB`);
      setText(nextUpdateText, `update selanjutnya ${nextUpdate} WIB`);
    } else {
      setText(generatedDate, "-");
      setText(generatedTime, "-");
      setText(nextUpdateText, "update selanjutnya -");
    }

    setText(statusText, `Sumber: ${payload?.source?.website || "zzhomey.com"}`);
    applyFilter({ syncUrl: false });
  } catch (error) {
    setText(statusText, `Gagal memuat: ${error.message}`);
    productList.innerHTML = '<p class="empty">JSON belum tersedia.</p>';
    setText(totalProducts, "0");
    setText(totalStock, "0");
    setText(generatedDate, "-");
    setText(generatedTime, "-");
    setText(nextUpdateText, "update selanjutnya -");
    setText(totalAssetText, "-");
  }
}

searchInput.addEventListener("input", () => applyFilter({ syncUrl: true }));
sortSelect?.addEventListener("change", () => {
  selectedSort = normalizeSortValue(sortSelect.value);
  applyFilter({ syncUrl: true });
});
sizeSelect?.addEventListener("change", () => {
  const value = String(sizeSelect.value || "__all__").toUpperCase();
  selectedSize = value === "__ALL__" || !SIZE_SET.has(value) ? "__all__" : value;
  applyFilter({ syncUrl: true });
});
refreshBtn.addEventListener("click", loadData);
categoryTabs.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-category]");
  if (!button) {
    return;
  }
  selectedCategory = button.dataset.category || "__all__";
  applyFilter({ syncUrl: true });
});
productList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-product-key]");
  if (!button) {
    return;
  }

  const key = button.dataset.productKey || "";
  const card = button.closest(".product-card");
  const linesNode = card?.querySelector(".stock-lines");
  if (!linesNode) {
    return;
  }

  const isExpanded = button.getAttribute("aria-expanded") === "true";
  const nextExpanded = !isExpanded;
  button.setAttribute("aria-expanded", nextExpanded ? "true" : "false");
  button.textContent = nextExpanded ? "Sembunyikan Stok" : "Lihat Stok";
  linesNode.classList.toggle("is-collapsed", !nextExpanded);
  if (nextExpanded) {
    linesNode.removeAttribute("hidden");
  } else {
    linesNode.setAttribute("hidden", "hidden");
  }

  if (key) {
    if (nextExpanded) {
      expandedProducts.add(key);
    } else {
      expandedProducts.delete(key);
    }
  }
});

const initialQuery = getInitialQuery();
if (initialQuery) {
  searchInput.value = initialQuery;
}

const initialCategory = getInitialCategory();
if (initialCategory) {
  selectedCategory = initialCategory;
}
selectedSort = getInitialSort();
if (sortSelect) {
  sortSelect.value = normalizeSortValue(selectedSort);
  selectedSort = normalizeSortValue(sortSelect.value);
}
selectedSize = getInitialSize();
if (sizeSelect) {
  sizeSelect.value = selectedSize;
}

loadData();

