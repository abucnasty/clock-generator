#!/bin/bash
# Build script for Clock Generator Recorder Factorio mod
# Creates a zip file ready for installation in Factorio's mods folder

set -e

# Get the directory where the script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Read mod info from info.json
MOD_NAME=$(grep -o '"name": *"[^"]*"' info.json | cut -d'"' -f4)
MOD_VERSION=$(grep -o '"version": *"[^"]*"' info.json | cut -d'"' -f4)

# Output filename follows Factorio convention: modname_version.zip
OUTPUT_NAME="${MOD_NAME}_${MOD_VERSION}"
OUTPUT_FILE="${OUTPUT_NAME}.zip"

echo "Building ${OUTPUT_FILE}..."

# Clean up any existing build
rm -f "$OUTPUT_FILE"

# Create a temporary directory with the correct structure
# Factorio expects mods to be in a folder named modname_version inside the zip
TEMP_DIR=$(mktemp -d)
MOD_DIR="${TEMP_DIR}/${OUTPUT_NAME}"
mkdir -p "$MOD_DIR"

# Copy mod files
cp info.json "$MOD_DIR/"
cp changelog.txt "$MOD_DIR/"
cp data.lua "$MOD_DIR/"
cp settings.lua "$MOD_DIR/"
cp control.lua "$MOD_DIR/"
cp -r locale "$MOD_DIR/"
cp -r graphics "$MOD_DIR/"
cp -r scripts "$MOD_DIR/"

# Create the zip file
cd "$TEMP_DIR"
zip -r "$SCRIPT_DIR/$OUTPUT_FILE" "$OUTPUT_NAME"

# Clean up
rm -rf "$TEMP_DIR"

echo ""
echo "✅ Built: $OUTPUT_FILE"
echo ""

if [[ "$1" != "--install" ]]; then
    echo "To install:"
    echo "  1. Copy $OUTPUT_FILE to your Factorio mods folder:"
    echo "     macOS:   ~/Library/Application Support/factorio/mods/"
    echo "     Linux:   ~/.factorio/mods/"
    echo "     Windows: %APPDATA%\\Factorio\\mods\\"
    echo ""
    echo "  2. Or run: ./build.sh --install"
fi

# Handle --install flag
if [[ "$1" == "--install" ]]; then
    # Detect Factorio mods folder
    if [[ "$OSTYPE" == "darwin"* ]]; then
        MODS_DIR="$HOME/Library/Application Support/factorio/mods"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        MODS_DIR="$HOME/.factorio/mods"
    else
        echo "❌ Auto-install not supported on this platform. Please copy manually."
        exit 1
    fi

    if [[ -d "$MODS_DIR" ]]; then
        # Remove old versions of this mod
        rm -f "$MODS_DIR/${MOD_NAME}_"*.zip
        cp "$SCRIPT_DIR/$OUTPUT_FILE" "$MODS_DIR/"
        echo ""
        echo "✅ Installed to: $MODS_DIR/$OUTPUT_FILE"
    else
        echo "❌ Mods folder not found: $MODS_DIR"
        echo "   Make sure Factorio has been run at least once."
        exit 1
    fi
fi
