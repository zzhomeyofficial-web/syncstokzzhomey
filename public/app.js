const statusText = document.getElementById("statusText");
const totalProducts = document.getElementById("totalProducts");
const totalRows = document.getElementById("totalRows");
const totalQty = document.getElementById("totalQty");
const generatedAt = document.getElementById("generatedAt");
const tableBody = document.getElementById("tableBody");
const searchInput = document.getElementById("searchInput");
const refreshBtn = document.getElementById("refreshBtn");

let rows = [];

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

function renderTable(filteredRows) {
  if (!filteredRows.length) {
    tableBody.innerHTML = '<tr><td class="empty" colspan="5">Data tidak ditemukan.</td></tr>';
    return;
  }

  tableBody.innerHTML = filteredRows
    .map(
      (row) => `
      <tr>
        <td>${escapeHtml(row.product_name || "-")}</td>
        <td>${escapeHtml(row.sku || "-")}</td>
        <td>${escapeHtml(row.variation_text || "-")}</td>
        <td>${escapeHtml(row.warehouse_id || "-")}</td>
        <td class="num">${formatNumber(row.stock)}</td>
      </tr>
    `,
    )
    .join("");
}

function applyFilter({ syncUrl = true } = {}) {
  const rawQuery = searchInput.value.trim();
  const q = rawQuery.toLowerCase();
  if (!q) {
    renderTable(rows);
    if (syncUrl) {
      syncUrlQuery("");
    }
    return;
  }

  const filtered = rows.filter((row) => {
    const haystack = `${row.product_name || ""} ${row.sku || ""} ${row.variation_text || ""}`.toLowerCase();
    return haystack.includes(q);
  });
  renderTable(filtered);
  if (syncUrl) {
    syncUrlQuery(rawQuery);
  }
}

function normalizeRows(payload) {
  if (Array.isArray(payload.items)) {
    return payload.items.filter((row) => isReadyProductName(row.product_name));
  }

  if (!Array.isArray(payload.products)) {
    return [];
  }

  const normalized = [];
  payload.products.forEach((product) => {
    const productId = product.product_id || product.id || "";
    const productName = product.product_name || product.name || "Tanpa Nama";
    if (!isReadyProductName(productName)) {
      return;
    }
    const stocks = Array.isArray(product.stocks) ? product.stocks : [];
    stocks.forEach((stock) => {
      normalized.push({
        product_id: productId,
        product_name: productName,
        sku: stock.sku,
        stock: stock.stock,
        warehouse_id: stock.warehouse_id,
        variation_text: Array.isArray(stock.variations) ? JSON.stringify(stock.variations) : "",
      });
    });
  });
  return normalized;
}

async function loadData() {
  statusText.textContent = "Memuat data...";
  try {
    const response = await fetch(`./data/stock.json?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();

    rows = normalizeRows(payload);
    const uniqueProducts = new Set(rows.map((row) => row.product_id || row.product_name || ""));
    const stockAmount = rows.reduce((sum, row) => sum + (typeof row.stock === "number" ? row.stock : 0), 0);

    totalProducts.textContent = formatNumber(uniqueProducts.size);
    totalRows.textContent = formatNumber(rows.length);
    totalQty.textContent = formatNumber(stockAmount);

    if (payload.generated_at) {
      generatedAt.textContent = new Date(payload.generated_at).toLocaleString("id-ID");
    } else {
      generatedAt.textContent = "-";
    }

    statusText.textContent = `Sumber: ${payload?.source?.website || "zzhomey.com"}`;
    applyFilter({ syncUrl: false });
  } catch (error) {
    statusText.textContent = `Gagal memuat: ${error.message}`;
    tableBody.innerHTML = '<tr><td class="empty" colspan="5">JSON belum tersedia.</td></tr>';
  }
}

searchInput.addEventListener("input", () => applyFilter({ syncUrl: true }));
refreshBtn.addEventListener("click", loadData);

const initialQuery = getInitialQuery();
if (initialQuery) {
  searchInput.value = initialQuery;
}

loadData();
