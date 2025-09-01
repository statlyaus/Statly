#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx|js|jsx)$' || true)
if [ -z "$FILES" ]; then
  echo "No staged files to review."
  exit 0
fi

echo "Reviewing staged files:"
printf '%s\n' $FILES

BUNDLE=""
for F in $FILES; do
  BUNDLE+=$'\n\n==== FILE: '"$F"$'\n'
  BUNDLE+="$(cat "$F")"
done

npx openai api chat.completions.create \
  -m gpt-4o-mini \
  -g '{"role":"system","content":"Strict senior code reviewer for Next.js/TypeScript/React. Enforce ESLint, a11y, performance, security, and scalability best practices."}' \
  -g "{\"role\":\"user\",\"content\":\"Review these changes and suggest precise diffs and explanations:\n$BUNDLE\"}" \
  --jq '.choices[0].message.content'
