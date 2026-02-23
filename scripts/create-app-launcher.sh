#!/bin/bash

# Script pour créer un lanceur d'application macOS
# Ce script crée une application .app qui lance BackupFlow

APP_NAME="BackupFlow"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DIR="$HOME/Applications/$APP_NAME.app"

# Créer la structure de l'application
mkdir -p "$APP_DIR/Contents/MacOS"
mkdir -p "$APP_DIR/Contents/Resources"

# Créer le script de lancement
cat > "$APP_DIR/Contents/MacOS/$APP_NAME" << 'EOF'
#!/bin/bash
cd "$(dirname "$(dirname "$(dirname "$0")")")"
if [ -d "BackUp" ]; then
    cd "BackUp"
elif [ -d "backupflow" ]; then
    cd "backupflow"
fi

# Vérifier Node.js
if ! command -v node &> /dev/null; then
    osascript -e 'display dialog "Node.js n est pas installé." buttons {"OK"} default button "OK" with title "BackupFlow"'
    exit 1
fi

# Installer les dépendances si nécessaire
if [ ! -d "node_modules" ]; then
    osascript -e 'display dialog "Installation des dépendances..." buttons {"OK"} default button "OK" with title "BackupFlow"'
    npm install
fi

# Lancer
npm start
EOF

chmod +x "$APP_DIR/Contents/MacOS/$APP_NAME"

# Créer Info.plist
cat > "$APP_DIR/Contents/Info.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>$APP_NAME</string>
    <key>CFBundleIdentifier</key>
    <string>com.etudiant.backupflow</string>
    <key>CFBundleName</key>
    <string>$APP_NAME</string>
    <key>CFBundleVersion</key>
    <string>1.0.0</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleIconFile</key>
    <string>icon.icns</string>
</dict>
</plist>
EOF

echo "Application créée dans: $APP_DIR"
echo "Vous pouvez maintenant lancer BackupFlow depuis le dossier Applications de votre Mac"

