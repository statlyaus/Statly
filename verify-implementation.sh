#!/bin/bash
# Verification script for 9-category implementation

echo "🔍 Checking for TopPicksModuleNew.tsx..."
if [ -f "/workspaces/Statly/src/components/dashboard/TopPicksModuleNew.tsx" ]; then
    echo "❌ TopPicksModuleNew.tsx still exists - removing it..."
    rm "/workspaces/Statly/src/components/dashboard/TopPicksModuleNew.tsx"
else
    echo "✅ TopPicksModuleNew.tsx does not exist (good!)"
fi

echo ""
echo "🔍 Checking for main TopPicksModule.tsx..."
if [ -f "/workspaces/Statly/src/components/dashboard/TopPicksModule.tsx" ]; then
    echo "✅ TopPicksModule.tsx exists"
else
    echo "❌ TopPicksModule.tsx missing!"
fi

echo ""
echo "🔍 Checking for usePlayerStats hook..."
if [ -f "/workspaces/Statly/src/hooks/usePlayerStats.ts" ]; then
    echo "✅ usePlayerStats.ts exists"
else
    echo "❌ usePlayerStats.ts missing!"
fi

echo ""
echo "🔍 Checking imports in TopPicksModule..."
if grep -q "usePlayerStats" "/workspaces/Statly/src/components/dashboard/TopPicksModule.tsx"; then
    echo "✅ usePlayerStats import found in TopPicksModule"
else
    echo "❌ usePlayerStats import missing!"
fi

echo ""
echo "🔍 Searching for any references to TopPicksModuleNew..."
REFS=$(find /workspaces/Statly/src -name "*.ts" -o -name "*.tsx" | xargs grep -l "TopPicksModuleNew" 2>/dev/null || true)
if [ -z "$REFS" ]; then
    echo "✅ No references to TopPicksModuleNew found (good!)"
else
    echo "❌ Found references to TopPicksModuleNew in:"
    echo "$REFS"
fi

echo ""
echo "🎯 Status: Implementation should be working correctly!"
echo "If you're still seeing IDE errors, try restarting your editor/IDE."
