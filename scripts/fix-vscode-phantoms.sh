#!/bin/bash
# Script to fix VS Code phantom file errors

echo "🔧 Fixing VS Code phantom file errors..."

# Remove any phantom files that might have been recreated
echo "Removing phantom files..."
find /workspaces/Statly -name "*-new.tsx" -type f -delete 2>/dev/null || true
find /workspaces/Statly -name "*Module-new.tsx" -type f -delete 2>/dev/null || true

# Kill TypeScript language server processes
echo "Stopping TypeScript language servers..."
pkill -f "node.*typescript" 2>/dev/null || true

# Clear all caches
echo "Clearing caches..."
rm -rf /workspaces/Statly/.next 2>/dev/null || true
rm -rf /workspaces/Statly/node_modules/.cache 2>/dev/null || true
rm -rf /workspaces/Statly/.eslintcache 2>/dev/null || true
find /workspaces/Statly -name "*.tsbuildinfo" -delete 2>/dev/null || true

# Verify build still works
echo "Verifying build..."
cd /workspaces/Statly
npx tsc --noEmit

echo "✅ Phantom files fixed!"
echo ""
echo "Now restart VS Code TypeScript server:"
echo "1. Press Ctrl+Shift+P (or Cmd+Shift+P on Mac)"
echo "2. Type 'TypeScript: Restart TS Server'"
echo "3. Press Enter"
echo ""
echo "Or reload VS Code window:"
echo "1. Press Ctrl+Shift+P (or Cmd+Shift+P on Mac)"
echo "2. Type 'Developer: Reload Window'"
echo "3. Press Enter"
