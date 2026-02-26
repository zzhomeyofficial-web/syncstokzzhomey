#!/usr/bin/env python3
"""Fetch product stock from Berdu API and write normalized JSON output."""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
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
        return ", ".join(parts)
    return ""


def build_snapshot(client: BerduClient, user_id: str, website_name: str) -> dict[str, Any]:
    products = client.iter_product_list(user_id)
    normalized_products: list[dict[str, Any]] = []
    item_rows: list[dict[str, Any]] = []
    stock_total = 0.0

    for product in products:
        p_id = product_id_from(product)
        if not p_id:
            continue

        p_name = product_name_from(product)
        if not is_ready_product_name(p_name):
            continue

        stocks = client.get_product_stocks(user_id=user_id, product_id=p_id)
        normalized_stocks: list[dict[str, Any]] = []
        total_per_product = 0.0

        for row in stocks:
            stock_number = parse_number(row.get("stock"))
            if stock_number is not None:
                total_per_product += float(stock_number)

            stock_record = {
                "stock_id": row.get("id") or row.get("stock_id"),
                "sku": row.get("sku"),
                "stock": stock_number,
                "warehouse_id": row.get("warehouse_id"),
                "variations": row.get("variations"),
            }
            normalized_stocks.append(stock_record)

            item_rows.append(
                {
                    "product_id": p_id,
                    "product_name": p_name,
                    "stock_id": stock_record["stock_id"],
                    "sku": stock_record["sku"],
                    "stock": stock_record["stock"],
                    "warehouse_id": stock_record["warehouse_id"],
                    "variation_text": variation_label(stock_record["variations"]),
                }
            )

        stock_total += total_per_product

        normalized_products.append(
            {
                "product_id": p_id,
                "product_name": p_name,
                "stock_count": len(normalized_stocks),
                "total_stock": total_per_product,
                "stocks": normalized_stocks,
            }
        )

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": {
            "website": website_name,
            "api_base_url": client.base_url,
            "reference": "https://dev.berdu.id/docs/reference",
        },
        "totals": {
            "products": len(normalized_products),
            "stock_rows": len(item_rows),
            "stock_amount": stock_total,
        },
        "products": normalized_products,
        "items": item_rows,
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
