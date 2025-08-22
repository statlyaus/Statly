#!/bin/bash

echo "Starting Next.js development server..."
# Change to the directory containing this script, then to project root if needed
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
    install_status=$?
    if [ $install_status -ne 0 ]; then
        echo "Error: npm install failed with exit code $install_status" >&2
        echo "Please check your package.json and network connection, then try again." >&2
        exit $install_status
    fi
    echo "Dependencies installed successfully."
fi

# Start the development server
echo "Starting server on port 3000..."
npm run dev
