#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

BASE_REF=${1:-origin/main}

FILES=$(git diff --name-only "$BASE_REF"...HEAD | grep -E '\.(ts|tsx|js|jsx)$' || true)
if [ -z "$FILES" ]; then
  echo "No TS/JS changes vs $BASE_REF."
  exit 0
fi

BUNDLE=""
for F in $FILES; do
  BUNDLE+=$'\n\n==== FILE: '"$F"$'\n'
  BUNDLE+="$(cat "$F")"
done

npx openai api chat.completions.create \
  -m gpt-4o-mini \
  -g '{"role":"system","content":"Strict senior code reviewer for Next.js/TypeScript/React. Focus on correctness, a11y, performance, and scalability. Respond with actionable items and example diffs."}' \
  -g "{\"role\":\"user\",\"content\":\"Review these changes vs $BASE_REF and propose improvements:\n$BUNDLE\"}" \
  --jq '.choices[0].message.content'
