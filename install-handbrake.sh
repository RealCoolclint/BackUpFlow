#!/bin/bash

# Script d'installation de HandBrakeCLI pour BackupFlow
# Ce script installe HandBrakeCLI via Homebrew ou télécharge directement les binaires

echo "🔧 Installation de HandBrakeCLI pour BackupFlow"
echo ""

# Vérifier si HandBrakeCLI est déjà installé
if command -v HandBrakeCLI &> /dev/null; then
    echo "✅ HandBrakeCLI est déjà installé !"
    HandBrakeCLI --version
    exit 0
fi

# Méthode 1: Via Homebrew (recommandé)
if command -v brew &> /dev/null; then
    echo "📦 Installation via Homebrew..."
    brew install handbrake
    if command -v HandBrakeCLI &> /dev/null; then
        echo "✅ HandBrakeCLI installé avec succès via Homebrew !"
        HandBrakeCLI --version
        exit 0
    fi
fi

# Si Homebrew n'est pas installé, proposer de l'installer
if ! command -v brew &> /dev/null; then
    echo "⚠️  Homebrew n'est pas installé."
    echo ""
    echo "Pour installer Homebrew (recommandé), exécutez cette commande dans le Terminal :"
    echo ""
    echo '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
    echo ""
    echo "Ensuite, réexécutez ce script ou tapez : brew install handbrake"
    echo ""
    read -p "Voulez-vous installer Homebrew maintenant ? (o/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[OoYy]$ ]]; then
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        if command -v brew &> /dev/null; then
            echo "📦 Installation de HandBrakeCLI via Homebrew..."
            brew install handbrake
            if command -v HandBrakeCLI &> /dev/null; then
                echo "✅ HandBrakeCLI installé avec succès !"
                HandBrakeCLI --version
                exit 0
            fi
        fi
    fi
fi

# Méthode 2: Téléchargement direct (si Homebrew n'est pas disponible)
echo ""
echo "📥 Tentative de téléchargement direct depuis handbrake.fr..."
echo "⚠️  Note: Vous devrez peut-être installer manuellement depuis https://handbrake.fr/downloads.php"
echo ""

# Vérifier l'architecture
ARCH=$(uname -m)
if [ "$ARCH" == "arm64" ]; then
    echo "Architecture détectée: Apple Silicon (arm64)"
    echo "Veuillez télécharger HandBrake depuis: https://handbrake.fr/downloads.php"
    echo "Puis placez HandBrakeCLI dans /usr/local/bin/ ou /opt/homebrew/bin/"
elif [ "$ARCH" == "x86_64" ]; then
    echo "Architecture détectée: Intel (x86_64)"
    echo "Veuillez télécharger HandBrake depuis: https://handbrake.fr/downloads.php"
    echo "Puis placez HandBrakeCLI dans /usr/local/bin/"
else
    echo "Architecture inconnue: $ARCH"
fi

echo ""
echo "💡 Alternative: L'application fonctionnera sans HandBrakeCLI,"
echo "   mais la fonctionnalité de compression vidéo sera désactivée."

