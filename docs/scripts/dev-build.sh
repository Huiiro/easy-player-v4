#!/bin/bash
# Quick build & run script for easy-player development
# Usage: bash docs/scripts/dev-build.sh [--no-run]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
cd "$PROJECT_DIR"

echo "=== Building native addon with pinned audio dependencies ==="
npm run build:native

echo "=== Build complete ==="

if [ "$1" = "--no-run" ]; then
    echo "Skipping run (--no-run)"
    exit 0
fi

echo "=== Starting Electron ==="
unset ELECTRON_RUN_AS_NODE
npm run dev
