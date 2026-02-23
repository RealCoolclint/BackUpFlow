# 🚀 Guide d'installation rapide pour BackupFlow

## ✅ État actuel

- ✅ **Node.js** : Installé
- ✅ **npm** : Installé  
- ✅ **Electron** : Installé (via npm install)
- ⚠️  **HandBrakeCLI** : Non installé (requis pour la compression vidéo)

## 📦 Installation de HandBrakeCLI

HandBrakeCLI est nécessaire pour la fonctionnalité de compression vidéo. L'application fonctionnera sans lui, mais la compression sera désactivée.

### Option 1 : Installation automatique (recommandé)

1. Double-cliquez sur le fichier **`install-handbrake.sh`** dans le dossier du projet
2. Suivez les instructions à l'écran
3. Le script tentera d'installer Homebrew puis HandBrakeCLI

### Option 2 : Installation manuelle via Homebrew

1. **Installer Homebrew** (si pas déjà installé) :
   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```

2. **Installer HandBrakeCLI** :
   ```bash
   brew install handbrake
   ```

3. **Vérifier l'installation** :
   ```bash
   HandBrakeCLI --version
   ```

### Option 3 : Téléchargement manuel

1. Visitez https://handbrake.fr/downloads.php
2. Téléchargez la version macOS
3. Installez HandBrake
4. HandBrakeCLI devrait être disponible dans `/usr/local/bin/HandBrakeCLI`

## 🎬 Lancer l'application

### Méthode 1 : Script de lancement (recommandé)

1. **Corriger les permissions** (première fois uniquement) :
   - Ouvrez le Terminal
   - Exécutez : `cd "/Users/studiovideo/Desktop/Apps Customs/BackUpFlow Studio" && ./fixer-permissions.sh`

2. **Lancer l'application** :
   - Double-cliquez sur **`Lancer BackupFlow.command`**
   - Si vous voyez encore l'avertissement : Clic droit → "Ouvrir" → "Ouvrir"

Le script :
- Vérifie que Node.js est installé
- Installe les dépendances npm si nécessaire
- Propose d'installer HandBrakeCLI si manquant
- Lance l'application Electron

### Méthode 2 : Terminal (alternative)

```bash
cd "/Users/studiovideo/Desktop/Apps Customs/BackUpFlow Studio"
npm start
```

## 🔍 Vérification

Pour vérifier que tout est installé correctement :

```bash
# Vérifier Node.js
node --version

# Vérifier npm
npm --version

# Vérifier Electron
cd "/Users/studiovideo/Desktop/Apps Customs/BackUpFlow Studio"
npm list electron

# Vérifier HandBrakeCLI
HandBrakeCLI --version
```

## ❓ Dépannage

**Message "Apple n'a pas pu confirmer..." (Gatekeeper)** :
- **Solution rapide** : Ouvrez le Terminal et exécutez :
  ```bash
  cd "/Users/studiovideo/Desktop/Apps Customs/BackUp"
  ./fixer-permissions.sh
  ```
- **Alternative** : Clic droit sur `Lancer BackupFlow.command` → "Ouvrir" → "Ouvrir" dans la boîte de dialogue
- **Via Terminal** : Exécutez directement `npm start` depuis le dossier du projet

**L'application ne démarre pas** :
- Vérifiez que Node.js est installé : `node --version`
- Réinstallez les dépendances : `npm install`

**HandBrakeCLI non trouvé** :
- L'application fonctionnera sans lui, mais sans compression
- Installez-le via Homebrew : `brew install handbrake`
- Ou suivez l'Option 3 ci-dessus

**Erreurs de permissions** :
- Assurez-vous d'avoir les droits d'administration pour installer Homebrew
- Vous pouvez aussi installer HandBrake manuellement depuis le site officiel

## 📝 Notes

- L'application **fonctionne sans HandBrakeCLI** mais la compression vidéo sera désactivée
- Toutes les autres fonctionnalités (copie, stockage, upload NAS) fonctionnent normalement
- HandBrakeCLI peut être installé plus tard sans problème

