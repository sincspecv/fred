#!/bin/bash
# Helper script to activate Flox development environment for Fred

# Ensure the script is sourced, not executed
if [ "$0" = "$BASH_SOURCE" ]; then
    echo "❌ This script must be sourced, not executed."
    echo "Usage: source scripts/flox-activate.sh"
    exit 1
fi

# Check if flox is installed
if ! command -v flox &> /dev/null; then
    echo "❌ Flox is not installed."
    echo ""
    echo "Install Flox:"
    echo "  macOS: brew install flox"
    echo "  Linux: Download from https://flox.dev/docs/install-flox/install/"
    echo "         (Review the installer before executing for security)"
    echo ""
    echo "For detailed installation instructions, visit:"
    echo "  https://flox.dev/docs/install-flox/install/"
    return 1
fi

# Determine repo root (prefer git if available)
REPO_ROOT=""
if command -v git &> /dev/null; then
    REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
fi
if [ -z "$REPO_ROOT" ]; then
    REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi

cd "$REPO_ROOT" || return 1

# Check if flox.nix exists
if [ ! -f "flox.nix" ]; then
    echo "❌ flox.nix not found in repo root: $REPO_ROOT"
    return 1
fi

# Activate Flox environment
echo "🐰 Activating Fred development environment with Flox..."
flox activate
