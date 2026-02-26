#!/usr/bin/env python3
"""Fetch product stock from Berdu API and write normalized JSON output."""

from __future__ import annotations

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import hmac
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv


def required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def optional_env(name: str, default: str) -> str:
    value = os.getenv(name, "").strip()
    return value if value else default


def build_authorization(app_id: str, app_secret: str, timestamp: int | None = None) -> str:
    ts = int(timestamp or time.time())
    message = f"{app_id}:{ts}:{app_secret}".encode("utf-8")
    secret = app_secret.encode("utf-8")
    token = base64.b64encode(hmac.new(secret, message, hashlib.sha256).digest()).decode("ascii")
    return f"{app_id}.{ts}.{token}"


def parse_number(value: Any) -> float | int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, str):
        cleaned = value.strip()
        if not cleaned:
            return None
        try:
            if "." in cleaned:
                return float(cleaned)
            return int(cleaned)
        except ValueError:
            return None
    return None


def extract_list(payload: Any, keys: tuple[str, ...]) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]
    if isinstance(payload, dict):
        for key in keys:
            value = payload.get(key)
            if isinstance(value, list):
                return [x for x in value if isinstance(x, dict)]
    return []


@dataclass
class BerduClient:
    base_url: str
    app_id: str
    app_secret: str
    timeout_seconds: int

    def _headers(self) -> dict[str, str]:
        return {
            "Accept": "application/json",
            "Authorization": build_authorization(self.app_id, self.app_secret),
        }

    def _url(self, endpoint: str) -> str:
        endpoint = endpoint if endpoint.startswith("/") else f"/{endpoint}"
        return f"{self.base_url.rstrip('/')}{endpoint}"

    def request(self, endpoint: str, params: dict[str, Any] | None = None) -> Any:
        response = requests.get(
            self._url(endpoint),
            params=params or {},
            headers=self._headers(),
            timeout=self.timeout_seconds,
        )
        text = response.text
        try:
            payload = response.json()
        except ValueError as exc:
            raise RuntimeError(
                f"Invalid JSON from {endpoint} (status={response.status_code}): {text[:400]}"
            ) from exc

        if response.status_code >= 400:
            raise RuntimeError(
                f"API request failed {endpoint} (status={response.status_code}): {payload}"
            )

        if isinstance(payload, dict) and payload.get("error"):
            raise RuntimeError(f"API returned error for {endpoint}: {payload}")

        if isinstance(payload, dict) and isinstance(payload.get("errors"), list):
            raise RuntimeError(f"API returned errors for {endpoint}: {payload['errors']}")

        return payload

    def iter_product_list(self, user_id: str) -> list[dict[str, Any]]:
        cursor: str | None = None
        all_items: list[dict[str, Any]] = []

        while True:
            params: dict[str, Any] = {"user_id": user_id}
            if cursor:
                params["cursor"] = cursor

            payload = self.request("/product/list", params=params)
            items = extract_list(payload, ("list", "data", "items", "products"))
            all_items.extend(items)

            if isinstance(payload, dict):
                cursor = payload.get("cursor")
            else:
                cursor = None

            if not cursor:
                break

        return all_items

    def get_product_stocks(self, user_id: str, product_id: str) -> list[dict[str, Any]]:
        payload = self.request("/product/stocks", params={"user_id": user_id, "product_id": product_id})
        items = extract_list(payload, ("list", "stocks", "data", "items"))
        if items:
            return items
        if isinstance(payload, dict) and payload.get("stock") is not None:
            return [payload]
        return []

    def get_product_detail(self, user_id: str, product_id: str) -> dict[str, Any]:
        payload = self.request("/product/detail", params={"user_id": user_id, "product_id": product_id})
        if isinstance(payload, dict):
            return payload
        return {}

    def get_product_variations(self, user_id: str, product_id: str) -> list[dict[str, Any]]:
        payload = self.request("/product/variations", params={"user_id": user_id, "product_id": product_id})
        if isinstance(payload, list):
            return [item for item in payload if isinstance(item, dict)]
        if isinstance(payload, dict):
            return extract_list(payload, ("list", "variations", "data", "items"))
        return []


def product_id_from(product: dict[str, Any]) -> str:
    for key in ("id", "product_id", "productId"):
        value = product.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def product_name_from(product: dict[str, Any]) -> str:
    for key in ("name", "title", "product_name"):
        value = product.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return "Tanpa Nama"


def is_ready_product_name(name: str) -> bool:
    return name.lstrip().lower().startswith("[ready]")


def normalize_tag_texts(raw_tags: Any) -> list[str]:
    tags: list[str] = []
    if isinstance(raw_tags, list):
        for item in raw_tags:
            if isinstance(item, str):
                text = item.strip().lower()
                if text:
                    tags.append(text)
            elif isinstance(item, dict):
                for key in ("name", "tag", "value", "id"):
                    value = item.get(key)
                    if isinstance(value, str) and value.strip():
                        tags.append(value.strip().lower())
    elif isinstance(raw_tags, str):
        text = raw_tags.strip().lower()
        if text:
            tags.append(text)
    return tags


def is_hidden_from_list_item(product: dict[str, Any]) -> bool:
    for key in ("hidden", "is_hidden", "isHidden", "hide", "isHide"):
        if product.get(key) is True:
            return True

    hidden_terms = {
        "hide",
        "hidden",
        "draft",
        "private",
        "archive",
        "archived",
        "inactive",
        "nonaktif",
    }
    tag_texts = normalize_tag_texts(product.get("tags"))
    if any(tag in hidden_terms for tag in tag_texts):
        return True

    status_candidates = [
        product.get("status"),
        product.get("publish_status"),
        product.get("visibility"),
        product.get("state"),
    ]
    for raw in status_candidates:
        if isinstance(raw, str) and raw.strip().lower() in hidden_terms:
            return True

    return False


def is_hidden_from_detail(detail: dict[str, Any]) -> bool:
    for key in ("hidden", "is_hidden", "isHidden", "hide", "isHide"):
        if detail.get(key) is True:
            return True

    if detail.get("published") is False or detail.get("isPublished") is False:
        return True

    hidden_terms = {
        "hide",
        "hidden",
        "draft",
        "private",
        "archive",
        "archived",
        "inactive",
        "nonaktif",
        "deleted",
        "unpublished",
    }
    status_candidates = [
        detail.get("status"),
        detail.get("publish_status"),
        detail.get("visibility"),
        detail.get("state"),
        detail.get("type"),
    ]
    for raw in status_candidates:
        if isinstance(raw, str) and raw.strip().lower() in hidden_terms:
            return True

    tag_texts = normalize_tag_texts(detail.get("tags"))
    if any(tag in hidden_terms for tag in tag_texts):
        return True

    return False


def website_base_url(website_name: str) -> str:
    text = website_name.strip().rstrip("/")
    if text.startswith("http://") or text.startswith("https://"):
        return text
    return f"https://{text}"


def build_product_link(website_name: str, product_id: str, detail: dict[str, Any]) -> str:
    base = website_base_url(website_name)

    for key in ("url", "link", "permalink", "product_url", "web_url"):
        value = detail.get(key)
        if isinstance(value, str) and value.strip():
            candidate = value.strip()
            if candidate.startswith("http://") or candidate.startswith("https://"):
                return candidate
            if candidate.startswith("/"):
                return f"{base}{candidate}"
            return f"{base}/{candidate.lstrip('/')}"

    slug = detail.get("slug")
    if isinstance(slug, str) and slug.strip():
        return f"{base}/product/{slug.strip()}"

    return f"{base}/product/{product_id}"


def extract_product_image(detail: dict[str, Any], variation_defs: list[dict[str, Any]]) -> str | None:
    images = detail.get("images")
    if isinstance(images, list):
        for image in images:
            if isinstance(image, str) and image.strip():
                return image.strip()
    if isinstance(images, str) and images.strip():
        return images.strip()

    # Fallback to first variation option image when product image is missing.
    for var in variation_defs:
        if not isinstance(var, dict):
            continue
        options = var.get("options")
        if not isinstance(options, list):
            continue
        for opt in options:
            if not isinstance(opt, dict):
                continue
            image = opt.get("image")
            if isinstance(image, str) and image.strip():
                return image.strip()
    return None


def build_variation_lookup(
    variation_defs: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    lookup: dict[str, dict[str, Any]] = {}
    for var in variation_defs:
        if not isinstance(var, dict):
            continue
        var_id = str(var.get("id", "")).strip()
        if not var_id:
            continue
        var_name = str(var.get("name", "")).strip() or f"var_{var_id}"
        options_map: dict[str, str] = {}
        options = var.get("options")
        if isinstance(options, list):
            for option in options:
                if not isinstance(option, dict):
                    continue
                option_id = str(option.get("id", "")).strip()
                if not option_id:
                    continue
                option_name = str(option.get("name", "")).strip() or option_id
                options_map[option_id] = option_name
        lookup[var_id] = {"name": var_name, "options": options_map}
    return lookup


def resolve_variations(
    raw_variations: Any,
    lookup: dict[str, dict[str, Any]],
) -> list[dict[str, str]]:
    pairs: list[tuple[str, str]] = []

    if isinstance(raw_variations, dict):
        for key, value in raw_variations.items():
            key_text = str(key).strip()
            value_text = str(value).strip()
            if key_text and value_text:
                pairs.append((key_text, value_text))
    elif isinstance(raw_variations, list):
        for item in raw_variations:
            if not isinstance(item, dict):
                continue
            var_id = str(item.get("id") or item.get("variation_id") or "").strip()
            option_id = str(item.get("option_id") or item.get("value") or item.get("id_value") or "").strip()
            if var_id and option_id:
                pairs.append((var_id, option_id))

    pairs.sort(key=lambda pair: pair[0])

    resolved: list[dict[str, str]] = []
    for var_id, option_id in pairs:
        var_info = lookup.get(var_id, {})
        var_name = str(var_info.get("name", "")).strip() or f"var_{var_id}"
        option_name = str(var_info.get("options", {}).get(option_id, "")).strip() or option_id
        resolved.append(
            {
                "variation_id": var_id,
                "name": var_name,
                "option_id": option_id,
                "value": option_name,
            }
        )

    return resolved


def variation_text_from_resolved(variations: list[dict[str, str]]) -> str:
    if not variations:
        return ""
    parts = []
    for item in variations:
        value = str(item.get("value", "")).strip()
        if value:
            parts.append(value)
    return " / ".join(parts)


def variation_label(value: Any) -> str:
    if isinstance(value, list):
        parts: list[str] = []
        for item in value:
            if isinstance(item, dict):
                key = item.get("name") or item.get("key") or ""
                val = item.get("value") or item.get("option") or ""
                text = f"{key}:{val}".strip(":")
                if text:
                    parts.append(text)
            elif isinstance(item, str):
                if item.strip():
                    parts.append(item.strip())
        return " / ".join(parts)
    return ""


def resolve_category(detail: dict[str, Any]) -> tuple[str | None, str | None]:
    category_id: str | None = None
    category_name: str | None = None

    raw_id = detail.get("category_id") or detail.get("categoryId")
    if raw_id is not None:
        text = str(raw_id).strip()
        if text:
            category_id = text

    raw_name = detail.get("category_name") or detail.get("categoryName")
    if isinstance(raw_name, str) and raw_name.strip():
        category_name = raw_name.strip()

    raw_category = detail.get("category")
    if isinstance(raw_category, dict):
        if category_id is None:
            nested_id = raw_category.get("id") or raw_category.get("category_id")
            if nested_id is not None and str(nested_id).strip():
                category_id = str(nested_id).strip()
        if category_name is None:
            nested_name = raw_category.get("name") or raw_category.get("title")
            if isinstance(nested_name, str) and nested_name.strip():
                category_name = nested_name.strip()
    elif category_name is None and isinstance(raw_category, str) and raw_category.strip():
        category_name = raw_category.strip()

    return category_id, category_name


def fetch_category_name_from_product_page(
    product_link: str,
    category_id: str,
    timeout_seconds: int,
) -> str | None:
    if not product_link or not category_id:
        return None

    try:
        response = requests.get(product_link, timeout=timeout_seconds)
    except requests.RequestException:
        return None

    if response.status_code >= 400:
        return None

    html = response.text
    escaped_id = re.escape(category_id)
    patterns = [
        rf'\\"category\\":\{{\\"name\\":\\"(?P<name>[^"\\]+)\\"\s*,\s*\\"id\\":\\"{escaped_id}\\"',
        rf'\\"category\\":\{{\\"id\\":\\"{escaped_id}\\"\s*,\s*\\"name\\":\\"(?P<name>[^"\\]+)\\"',
        rf'"category":\{{"name":"(?P<name>[^"]+)"\s*,\s*"id":"{escaped_id}"',
        rf'"category":\{{"id":"{escaped_id}"\s*,\s*"name":"(?P<name>[^"]+)"',
    ]
    for pattern in patterns:
        match = re.search(pattern, html)
        if match:
            name = str(match.group("name")).strip()
            if name:
                return name
    return None


def build_product_snapshot(
    client: BerduClient,
    user_id: str,
    website_name: str,
    product: dict[str, Any],
) -> dict[str, Any] | None:
    p_id = product_id_from(product)
    if not p_id:
        return None

    p_name = product_name_from(product)
    if not is_ready_product_name(p_name):
        return None
    if is_hidden_from_list_item(product):
        return None

    detail = client.get_product_detail(user_id=user_id, product_id=p_id)
    if is_hidden_from_detail(detail):
        return None

    variation_defs = client.get_product_variations(user_id=user_id, product_id=p_id)
    variation_lookup = build_variation_lookup(variation_defs)
    product_slug = detail.get("slug") if isinstance(detail.get("slug"), str) else None
    product_link = build_product_link(website_name, p_id, detail)
    product_image = extract_product_image(detail, variation_defs)
    category_id, category_name = resolve_category(detail)

    stocks = client.get_product_stocks(user_id=user_id, product_id=p_id)
    normalized_stocks: list[dict[str, Any]] = []
    total_per_product = 0.0

    for row in stocks:
        resolved_variations = resolve_variations(row.get("variations"), variation_lookup)
        variation_text = variation_text_from_resolved(resolved_variations) or variation_label(
            resolved_variations
        )
        stock_number = parse_number(row.get("stock"))
        if stock_number is not None:
            total_per_product += float(stock_number)

        stock_record = {
            "stock_id": row.get("id") or row.get("stock_id"),
            "sku": row.get("sku"),
            "stock": stock_number,
            "warehouse_id": row.get("warehouse_id"),
            "variation_text": variation_text,
        }
        normalized_stocks.append(stock_record)

    return {
        "product_id": p_id,
        "product_name": p_name,
        "product_slug": product_slug,
        "product_link": product_link,
        "product_image": product_image,
        "category_id": category_id,
        "category_name": category_name,
        "stock_count": len(normalized_stocks),
        "total_stock": total_per_product,
        "stocks": normalized_stocks,
    }


def build_snapshot(client: BerduClient, user_id: str, website_name: str) -> dict[str, Any]:
    products = client.iter_product_list(user_id)
    candidate_products = [
        product
        for product in products
        if is_ready_product_name(product_name_from(product)) and not is_hidden_from_list_item(product)
    ]

    max_workers_raw = optional_env("BERDU_MAX_WORKERS", "6")
    try:
        max_workers = max(1, int(max_workers_raw))
    except ValueError:
        max_workers = 6

    snapshots: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(build_product_snapshot, client, user_id, website_name, product): product
            for product in candidate_products
        }
        for future in as_completed(futures):
            product = futures[future]
            p_id = product_id_from(product)
            try:
                result = future.result()
            except Exception as exc:  # noqa: BLE001
                print(f"[warn] skip product {p_id}: {exc}", file=sys.stderr)
                continue
            if result:
                snapshots.append(result)

    # Fetch category names once per category_id (lighter than per-product page fetch).
    category_link_map: dict[str, str] = {}
    for product in snapshots:
        category_id = product.get("category_id")
        category_name = product.get("category_name")
        product_link = product.get("product_link")
        if (
            isinstance(category_id, str)
            and category_id
            and not category_name
            and isinstance(product_link, str)
            and product_link
            and category_id not in category_link_map
        ):
            category_link_map[category_id] = product_link

    category_name_cache: dict[str, str] = {}
    for category_id, product_link in category_link_map.items():
        name = fetch_category_name_from_product_page(
            product_link=product_link,
            category_id=category_id,
            timeout_seconds=client.timeout_seconds,
        )
        if name:
            category_name_cache[category_id] = name

    for product in snapshots:
        category_id = product.get("category_id")
        if (
            isinstance(category_id, str)
            and category_id
            and not product.get("category_name")
            and category_id in category_name_cache
        ):
            product["category_name"] = category_name_cache[category_id]

    snapshots.sort(
        key=lambda p: (
            str(p.get("category_name") or ""),
            str(p.get("category_id") or ""),
            str(p.get("product_name") or ""),
        )
    )

    stock_rows = sum(int(p.get("stock_count") or 0) for p in snapshots)
    stock_total = float(sum(float(p.get("total_stock") or 0) for p in snapshots))

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": {
            "website": website_name,
            "api_base_url": client.base_url,
            "reference": "https://dev.berdu.id/docs/reference",
        },
        "totals": {
            "products": len(snapshots),
            "stock_rows": stock_rows,
            "stock_amount": stock_total,
        },
        "products": snapshots,
    }


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch stock data from Berdu API.")
    parser.add_argument(
        "--output",
        default=optional_env("OUTPUT_JSON_PATH", "public/data/stock.json"),
        help="Output JSON file path.",
    )
    return parser.parse_args()


def main() -> int:
    load_dotenv()
    args = parse_args()

    try:
        app_id = required_env("BERDU_APP_ID")
        app_secret = required_env("BERDU_APP_SECRET")
        user_id = required_env("BERDU_USER_ID")
    except RuntimeError as exc:
        print(f"[config] {exc}", file=sys.stderr)
        return 2

    base_url = optional_env("BERDU_API_BASE_URL", "https://api.berdu.id/v0.0")
    website_name = optional_env("WEBSITE_NAME", "zzhomey.com")
    timeout_raw = optional_env("BERDU_TIMEOUT_SECONDS", "30")
    timeout_seconds = int(timeout_raw) if timeout_raw.isdigit() else 30

    client = BerduClient(
        base_url=base_url,
        app_id=app_id,
        app_secret=app_secret,
        timeout_seconds=timeout_seconds,
    )

    try:
        snapshot = build_snapshot(client, user_id=user_id, website_name=website_name)
    except Exception as exc:  # noqa: BLE001
        print(f"[error] failed to fetch stock: {exc}", file=sys.stderr)
        return 1

    output = Path(args.output)
    write_json(output, snapshot)
    print(
        f"[ok] wrote {output} | products={snapshot['totals']['products']} "
        f"rows={snapshot['totals']['stock_rows']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
