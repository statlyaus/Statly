#!/bin/bash
# Script to clear VS Code caches and restart language servers

echo "🧹 Clearing VS Code and project caches..."

# Clear TypeScript build info
find . -name "*.tsbuildinfo" -delete 2>/dev/null || true

# Clear ESLint cache
find . -name ".eslintcache" -delete 2>/dev/null || true

# Clear Next.js cache
rm -rf .next 2>/dev/null || true

# Clear node modules cache
rm -rf node_modules/.cache 2>/dev/null || true

# Clear npm cache (if needed)
# npm cache clean --force

echo "✅ Caches cleared!"
echo ""
echo "To restart VS Code language servers manually:"
echo "1. Press Ctrl+Shift+P (or Cmd+Shift+P on Mac)"
echo "2. Type 'TypeScript: Restart TS Server' and press Enter"
echo "3. Type 'ESLint: Restart ESLint Server' and press Enter"
echo ""
echo "Or simply reload VS Code window:"
echo "1. Press Ctrl+Shift+P (or Cmd+Shift+P on Mac)"
echo "2. Type 'Developer: Reload Window' and press Enter"
