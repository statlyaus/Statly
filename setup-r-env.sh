#!/bin/bash
# R Environment Setup for VS Code Language Server
export R_LIBS_USER=/home/codespace/R/library
export R_LIBS=/home/codespace/R/library:/usr/local/lib/R/site-library:/usr/lib/R/site-library:/usr/lib/R/library

# Test that R can find required packages
echo "Testing R package availability..."
if R --silent --no-echo --no-save --no-restore -e "library(languageserver)" 2>/dev/null; then
    echo "✅ R languageserver package is available"
else
    echo "❌ R languageserver package not found"
    exit 1
fi

if R --silent --no-echo --no-save --no-restore -e "library(jsonlite)" 2>/dev/null; then
    echo "✅ R jsonlite package is available"
else
    echo "❌ R jsonlite package not found"
    exit 1
fi

echo "🎉 R environment setup complete!"
