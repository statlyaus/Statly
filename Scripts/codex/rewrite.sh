#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx|js|jsx)$' || true)
if [ -z "$FILES" ]; then
  echo "No staged files to rewrite."
  exit 0
fi

for FILE in $FILES; do
  echo "Rewriting $FILE"
  CONTENT=$(cat "$FILE")

  FIXED=$(npx openai api chat.completions.create \
    -m gpt-4o-mini \
    -g '{"role":"system","content":"Rewrite this file to meet Next.js/TypeScript/React/ESLint/a11y/scalability best practices. Return ONLY the new code, no commentary."}' \
    -g "{\"role\":\"user\",\"content\":\"$CONTENT\"}" \
    --jq '.choices[0].message.content')

  if [ -n "$FIXED" ]; then
    printf '%s' "$FIXED" > "$FILE"
  else
    echo "Skipped $FILE (empty AI output)"
  fi
done
