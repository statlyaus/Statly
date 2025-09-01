#!/usr/bin/env bash
set -euo pipefail

# Always run from repo root
cd "$(git rev-parse --show-toplevel)"

# Get files changed in the last commit (TS/JS only)
FILES=$(git diff --name-only HEAD~1 HEAD | grep -E '\.(ts|tsx|js|jsx)$' || true)

if [ -z "$FILES" ]; then
  echo "No committed files to review."
  exit 0
fi

for FILE in $FILES; do
  echo "Reviewing committed file: $FILE"
  CONTENT=$(cat "$FILE")

  npx openai api chat.completions.create \
    -m gpt-4o-mini \
    -g '{"role":"system","content":"You are a senior code reviewer. Highlight risks, anti-patterns, and suggest best-practice improvements for Next.js/TypeScript/React scalability, a11y, and performance."}' \
    -g "{\"role\":\"user\",\"content\":\"$CONTENT\"}" \
    --jq '.choices[0].message.content'
done
