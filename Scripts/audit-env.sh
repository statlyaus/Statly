#!/usr/bin/env bash
set -euo pipefail

# Collect keys referenced in code
grep -RhoE "process\.env\.[A-Z0-9_]+" src functions prisma 2>/dev/null \
  | sed -E 's/.*process\.env\.([A-Z0-9_]+).*/\1/' \
  | sort -u > /tmp/code_keys.txt

# Collect keys from .env.local
grep -E '^[A-Z0-9_]+=' .env.local \
  | sed -E 's/^([A-Z0-9_]+)=.*/\1/' \
  | sort -u > /tmp/env_keys.txt

echo "🔎 Comparing code vs .env.local..."
echo

comm -23 /tmp/code_keys.txt /tmp/env_keys.txt || true | sed 's/^/❌ Missing: /'
comm -13 /tmp/code_keys.txt /tmp/env_keys.txt || true | sed 's/^/ℹ️ Extra:   /'
