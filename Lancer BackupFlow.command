#!/bin/bash

# Script de lancement pour BackupFlow
# Double-cliquez sur ce fichier pour lancer l'application

# Fonction pour fermer les anciennes fenêtres Terminal (sauf celle qui lance l'app)
close_old_terminal_windows() {
  if [ "$TERM_PROGRAM" = "Apple_Terminal" ] || [ "$TERM_PROGRAM" = "iTerm.app" ]; then
    CURRENT_WINDOW_ID=$(osascript -e 'tell application "Terminal" to get id of front window' 2>/dev/null)
    
    if [ -n "$CURRENT_WINDOW_ID" ]; then
      osascript <<EOF 2>/dev/null
tell application "Terminal"
  set currentWindowId to $CURRENT_WINDOW_ID
  repeat with w in windows
    try
      set windowId to id of w
      if windowId is not currentWindowId then
        close w saving no
      end if
    end try
  end repeat
end tell
EOF
    fi
  fi
}

# Fonction pour fermer Terminal proprement à la sortie
close_terminal() {
  TEMP_FILE="/tmp/backupflow-close-terminal"
  if [ -f "$TEMP_FILE" ] && ([ "$TERM_PROGRAM" = "Apple_Terminal" ] || [ "$TERM_PROGRAM" = "iTerm.app" ]); then
    rm -f "$TEMP_FILE"
    sleep 0.3
    # Fermer Terminal directement sans simuler de raccourci clavier
    osascript -e 'tell application "Terminal" to quit saving no' 2>/dev/null
  fi
}

# Installer un trap pour exécuter close_terminal quand le script se termine
trap close_terminal EXIT

# Fermer les anciennes fenêtres Terminal avant de lancer l'app
close_old_terminal_windows

cd "$(dirname "$0")"

# Vérifier si Node.js est installé
if ! command -v node &> /dev/null; then
    osascript -e 'display dialog "Node.js n est pas installé. Veuillez l installer depuis nodejs.org" buttons {"OK"} default button "OK" with title "BackupFlow"'
    exit 1
fi

# Vérifier si les dépendances sont installées
if [ ! -d "node_modules" ]; then
    osascript -e 'display dialog "Installation des dépendances en cours..." buttons {"OK"} default button "OK" with title "BackupFlow"'
    npm install
fi

# Vérifier que le binaire Electron est présent (peut être manquant après installation)
if [ ! -f "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" ]; then
    echo "Binaire Electron manquant, réinstallation..."
    osascript -e 'display dialog "Réinstallation d Electron en cours..." buttons {"OK"} default button "OK" with title "BackupFlow"'
    npm install electron --save-dev
    xattr -r -d com.apple.quarantine "node_modules/electron/dist/Electron.app" 2>/dev/null || true
fi

# Vérifier HandBrakeCLI (optionnel mais recommandé)
if ! command -v HandBrakeCLI &> /dev/null; then
    HANDBRAKE_FOUND=false
    if [ -f "/usr/local/bin/HandBrakeCLI" ] || [ -f "/opt/homebrew/bin/HandBrakeCLI" ]; then
        HANDBRAKE_FOUND=true
    fi
    
    if [ "$HANDBRAKE_FOUND" = false ]; then
        RESPONSE=$(osascript -e 'display dialog "HandBrakeCLI n est pas installé. La compression vidéo ne sera pas disponible.\n\nVoulez-vous installer HandBrakeCLI maintenant ?" buttons {"Plus tard", "Installer"} default button "Installer" with title "BackupFlow"')
        
        if [[ "$RESPONSE" == *"Installer"* ]]; then
            if [ -f "./install-handbrake.sh" ]; then
                open -a Terminal "./install-handbrake.sh"
            else
                osascript -e 'display dialog "Pour installer HandBrakeCLI, exécutez dans le Terminal:\n\nbrew install handbrake" buttons {"OK"} default button "OK" with title "BackupFlow"'
            fi
        fi
    fi
fi

# Créer un fichier temporaire pour indiquer qu'on doit fermer Terminal à la sortie
echo "1" > /tmp/backupflow-close-terminal

# Lancer l'application
npm start

# Le trap EXIT sera automatiquement exécuté quand le script se termine