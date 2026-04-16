#!/bin/bash

# Catalyst Magazine CMS Installation Script
# This script helps you set up the CMS quickly

echo "═══════════════════════════════════════════════════════"
echo "   Catalyst Magazine CMS - Installation Script"
echo "═══════════════════════════════════════════════════════"
echo ""

# Check if Node.js is installed
echo "Checking for Node.js..."
if ! command -v node &> /dev/null
then
    echo "❌ Node.js is not installed!"
    echo "Please install Node.js from https://nodejs.org/"
    echo "Then run this script again."
    exit 1
else
    NODE_VERSION=$(node --version)
    echo "✅ Node.js is installed: $NODE_VERSION"
fi

echo ""

# Check if npm is installed
echo "Checking for npm..."
if ! command -v npm &> /dev/null
then
    echo "❌ npm is not installed!"
    exit 1
else
    NPM_VERSION=$(npm --version)
    echo "✅ npm is installed: $NPM_VERSION"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Installing Node.js dependencies..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

npm install

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Dependencies installed successfully!"
else
    echo ""
    echo "❌ Failed to install dependencies"
    exit 1
fi

# Create posts/published directory if it doesn't exist
echo ""
echo "Creating directories..."
mkdir -p posts/published
echo "✅ Directories created"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "   ✅ Installation Complete!"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo ""
echo "1. Configure Firebase:"
echo "   Visit: https://console.firebase.google.com/project/catalystwriters-5ce43"
echo "   - Enable Authentication (Email/Password)"
echo "   - Enable Firestore Database"
echo "   - Enable Storage"
echo "   - Apply security rules from CMS-SETUP.md"
echo ""
echo "2. Start the server:"
echo "   npm start"
echo ""
echo "3. Create your admin account:"
echo "   Visit: http://localhost:3000/writer-login.html"
echo ""
echo "4. Read the documentation:"
echo "   - Quick Start: QUICK-START.md"
echo "   - Full Setup: CMS-SETUP.md"
echo "   - Checklist: SETUP-CHECKLIST.md"
echo ""
echo "═══════════════════════════════════════════════════════"
echo ""
