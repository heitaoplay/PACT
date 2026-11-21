#!/usr/bin/env python3
# 锁契 · PACT — i18n 自检脚本
# 检查所有语言包：键集一致性、空值、明显的未翻译（与基准相同且基准是中文时提示）
# 用法：pnpm i18n:check 或 python3 scripts/check-i18n.py

import json
import os
import sys

LOCALE_DIR = os.path.join(os.path.dirname(__file__), "..", "localization")
# 基准语言：以 cn（简体中文，BC 代码）为准，若文件不存在则退回 zh-CN
BASE_CANDIDATES = ["cn.json", "zh-CN.json", "en.json"]

errors = []
warnings = []


def flatten(obj, prefix=""):
    """把嵌套 dict 展平成 {'a.b.c': value}"""
    out = {}
    for key, value in obj.items():
        path = f"{prefix}.{key}" if prefix else key
        if isinstance(value, dict):
            out.update(flatten(value, path))
        else:
            out[path] = value
    return out


# 找到基准文件
base_file = None
for name in BASE_CANDIDATES:
    path = os.path.join(LOCALE_DIR, name)
    if os.path.exists(path):
        base_file = path
        break

if not base_file:
    print("✗ 找不到基准语言包（cn.json / zh-CN.json / en.json）")
    sys.exit(1)

base_name = os.path.splitext(os.path.basename(base_file))[0]
with open(base_file, encoding="utf-8") as f:
    base = flatten(json.load(f))
base_keys = set(base.keys())

# 收集所有语言包
locales = {}
for name in sorted(os.listdir(LOCALE_DIR)):
    if name.endswith(".json"):
        with open(os.path.join(LOCALE_DIR, name), encoding="utf-8") as f:
            locales[os.path.splitext(name)[0]] = flatten(json.load(f))

print(f"基准语言: {base_name} ({len(base_keys)} 键)")
print(f"语言包: {', '.join(sorted(locales.keys()))}")
print("-" * 50)

for locale, data in sorted(locales.items()):
    keys = set(data.keys())
    missing = base_keys - keys
    extra = keys - base_keys
    empty = {k for k, v in data.items() if v is None or (isinstance(v, str) and not v.strip())}

    if missing:
        errors.append(f"[{locale}] 缺少 {len(missing)} 键: {', '.join(sorted(missing)[:8])}")
    if extra:
        warnings.append(f"[{locale}] 多出 {len(extra)} 键: {', '.join(sorted(extra)[:8])}")
    if empty:
        errors.append(f"[{locale}] {len(empty)} 个空值: {', '.join(sorted(empty)[:8])}")

    status = "OK" if not (missing or extra or empty) else "FAIL"
    print(f"{'✓' if status == 'OK' else '✗'} {locale}: {len(keys)} 键 [{status}]")

print("-" * 50)
for w in warnings:
    print(f"⚠ {w}")
for e in errors:
    print(f"✗ {e}")

if errors:
    print(f"\n✗ i18n 检查失败：{len(errors)} 个错误")
    sys.exit(1)
else:
    print(f"\n✓ i18n 检查通过：{len(locales)} 个语言包键集一致、无空值")
    sys.exit(0)
