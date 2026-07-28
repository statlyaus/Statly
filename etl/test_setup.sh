#!/bin/bash

echo "=== Statly ETL Pipeline Test ==="
echo ""

# Test 1: Check R installation
echo "1. Checking R installation..."
if command -v R &> /dev/null; then
    echo "   ✓ R is installed: $(R --version | head -1)"
else
    echo "   ✗ R is not installed"
    exit 1
fi

# Test 2: Check Node.js
echo ""
echo "2. Checking Node.js installation..."
if command -v node &> /dev/null; then
    echo "   ✓ Node.js is installed: $(node --version)"
else
    echo "   ✗ Node.js is not installed"
    exit 1
fi

# Test 3: Check if we can run R script
echo ""
echo "3. Testing R script execution..."
if Rscript --version &> /dev/null; then
    echo "   ✓ Rscript is available"
    
    # Test with a basic command (don't install packages yet)
    echo "   Testing basic R functionality..."
    if R -e 'cat("R is working\n")' 2>/dev/null; then
        echo "   ✓ R execution test passed"
    else
        echo "   ⚠ R execution test failed (this is expected without packages)"
    fi
else
    echo "   ✗ Rscript is not available"
fi

# Test 4: Check ETL directory structure
echo ""
echo "4. Checking ETL directory structure..."
FILES=(
    "fetch_fw_round.R"
    "fetchPipeline.ts"
    "processFootywireData.ts"
    "liveGuard.ts"
    "backfill.ts"
    "package.json"
    "tsconfig.json"
    ".env.template"
)

for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "   ✓ $file exists"
    else
        echo "   ✗ $file missing"
    fi
done

# Test 5: Check Node dependencies
echo ""
echo "5. Checking Node.js dependencies..."
if [ -d "node_modules" ]; then
    echo "   ✓ node_modules exists"
    
    if [ -f "node_modules/firebase-admin/package.json" ]; then
        echo "   ✓ firebase-admin installed"
    else
        echo "   ✗ firebase-admin not found"
    fi
else
    echo "   ✗ node_modules missing - run 'npm install'"
fi

# Test 6: TypeScript compilation
echo ""
echo "6. Testing TypeScript compilation..."
if npx tsc --noEmit 2>/dev/null; then
    echo "   ✓ TypeScript compilation successful"
else
    echo "   ⚠ TypeScript compilation issues (check with 'npx tsc')"
fi

echo ""
echo "=== Test Summary ==="
echo ""
echo "Next steps:"
echo "1. Install R packages: ./setup_r.sh"
echo "2. Configure environment: cp .env.template .env"
echo "3. Test R script: Rscript fetch_fw_round.R 2025 18 | head"
echo "4. Test full pipeline: npm run dev"
echo ""
echo "For production deployment:"
echo "- Docker: docker build -t statly-etl ."
echo "- Cloud Run: gcloud run deploy statly-etl --source ."
echo "- VM: npm run build && npm start"
