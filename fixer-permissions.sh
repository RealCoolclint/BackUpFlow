#!/bin/bash

# Script pour corriger les permissions macOS et supprimer les flags de quarantaine
# Exécutez ce script une seule fois après avoir téléchargé/copié le projet

echo "🔧 Correction des permissions pour BackupFlow"
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Supprimer les flags de quarantaine de tous les scripts
echo "📝 Suppression des flags de quarantaine..."

xattr -d com.apple.quarantine "$SCRIPT_DIR/Lancer BackupFlow.command" 2>/dev/null || true
xattr -d com.apple.quarantine "$SCRIPT_DIR/install-handbrake.sh" 2>/dev/null || true
xattr -d com.apple.quarantine "$SCRIPT_DIR/fixer-permissions.sh" 2>/dev/null || true

# Rendre les scripts exécutables
echo "🔐 Ajout des permissions d'exécution..."

chmod +x "$SCRIPT_DIR/Lancer BackupFlow.command"
chmod +x "$SCRIPT_DIR/install-handbrake.sh"
chmod +x "$SCRIPT_DIR/fixer-permissions.sh"

echo ""
echo "✅ Permissions corrigées !"
echo ""
echo "Vous pouvez maintenant double-cliquer sur 'Lancer BackupFlow.command'"
echo "Si vous voyez encore un avertissement, faites :"
echo "  1. Clic droit sur le fichier"
echo "  2. Sélectionnez 'Ouvrir'"
echo "  3. Cliquez sur 'Ouvrir' dans la boîte de dialogue"
echo ""













