# 🎬 BackupFlow

Application macOS pour automatiser le workflow de backup, stockage, compression et archivage de fichiers vidéo selon un pipeline de postproduction spécifique.

## ✨ Fonctionnalités

### 🔄 Workflow complet
- **Importation** : Détection automatique des sources (cartes SD, SSD, appareils montés)
- **Nomenclature** : Génération automatique de noms de projets au format `AnnéeMoisJourLettre_FORMAT_Sujet_Initiales`
- **Stockage** : Copie simultanée vers SSD PERSO (dossiers projets) et SSD STUDIO (fichiers à la racine)
- **Compression** : Compression vidéo via HandBrake CLI avec présets configurables
- **Archivage** : Création d'archives ZIP pour chaque projet
- **Upload NAS** : Transfert automatique vers serveur NAS via SFTP/SCP
- **Vérification** : Checksums MD5 pour vérification d'intégrité

### 🎨 Interface
- Interface HTML moderne avec workflow visuel
- Mode sombre/clair
- Historique des opérations
- Progression en temps réel
- Notifications système

### 📊 Gestion
- Métadonnées et journalisation
- Historique persistant
- Système de préréglages par type de projet
- Gestion d'erreurs robuste

## 📋 Prérequis

1. **Node.js** (version 16 ou supérieure)
   - Téléchargez depuis [nodejs.org](https://nodejs.org/)

2. **HandBrake CLI**
   - Téléchargez depuis [handbrake.fr](https://handbrake.fr/downloads.php)
   - Ou installez via Homebrew : `brew install handbrake`

## 🚀 Installation et lancement

### Option 1 : Lancement simple (SANS Terminal)

**Pour le développement** :
1. Double-cliquez sur le fichier **`Lancer BackupFlow.command`** dans le dossier du projet
2. L'application s'ouvrira automatiquement dans une fenêtre graphique

**Après le build** :
1. Exécutez `npm run build:mac`
2. Montez le fichier `BackupFlow-1.0.0.dmg` généré dans `dist/`
3. Glissez-déposez l'application BackupFlow dans votre dossier Applications
4. Double-cliquez sur BackupFlow dans Applications pour lancer l'app (plus besoin de Terminal!)

### Option 2 : Créer une application .app personnalisée

Exécutez le script (une seule fois) :
```bash
./scripts/create-app-launcher.sh
```

Une application `BackupFlow.app` sera créée dans votre dossier Applications personnelles, que vous pourrez lancer comme n'importe quelle app Mac.

### Option 3 : Terminal (pour les développeurs)

1. **Installer les dépendances** :
```bash
npm install
```

2. **Lancer l'application** :
```bash
npm start
```

3. **Créer l'application distribuable** :
```bash
npm run build:mac
```

L'application sera générée dans le dossier `dist/` :
- `BackupFlow-1.0.0.dmg` - Pour l'installation (double-cliquez pour monter, puis glissez-déposez dans Applications)
- `BackupFlow-1.0.0-mac.zip` - Archive ZIP

## 📖 Guide d'utilisation

### Configuration initiale

1. **Ouvrir les Paramètres** dans l'application
2. **Configurer les destinations** :
   - **SSD PERSO** : Chemin où seront créés les dossiers de projets complets
   - **SSD STUDIO** : Chemin où seront copiés les fichiers individuels à la racine
3. **Configurer le NAS** (optionnel) :
   - Hôte, port, identifiants, chemin distant

### Workflow de backup

1. **Étape 1 - Informations du projet** :
   - Sélectionner le format (BP, ITW, CEXP, SELEC, etc.)
   - Entrer le sujet (ex: Orelsan)
   - Entrer les initiales (ex: AP)
   - Le nom de projet est généré automatiquement : `251013A_ITW_Orelsan_AP`

2. **Étape 2 - Sélection des fichiers** :
   - Détecter automatiquement les sources (cartes SD, SSD)
   - Scanner un dossier
   - Sélectionner des fichiers manuellement

3. **Étape 3 - Options** :
   - Activer la compression HandBrake
   - Activer l'upload NAS
   - Activer la vérification d'intégrité

4. **Étape 4 - Vérification** :
   - Vérification de l'espace disque
   - Aperçu des fichiers à traiter

5. **Démarrer le workflow** :
   - La progression est affichée en temps réel
   - Les opérations sont journalisées

### Format de nomenclature

Le format généré est : `AnnéeMoisJourLettre_FORMAT_Sujet_Initiales`

- **AnnéeMoisJour** : Date au format YYMMDD (ex: 251013 pour 13/10/2025)
- **Lettre** : Incrémentée automatiquement (A, B, C...) pour chaque nouveau projet du jour
- **FORMAT** : Acronyme du format (BP, ITW, CEXP, SELEC, etc.)
- **Sujet** : Nom du projet (espaces remplacés par underscores)
- **Initiales** : Initiales du créateur (ex: AP)

Exemples :
- `251013A_ITW_Orelsan_AP` (L'interview)
- `251013B_BP_Reco_CF` (Reco)
- `251014A_REP_Reportage_MP` (Reportage)

## 🛠️ Structure du projet

```
.
├── main.js                  # Processus principal Electron
├── preload.js               # Bridge sécurisé IPC
├── index.html               # Interface utilisateur
├── styles.css               # Styles avec thème sombre/clair
├── renderer.js              # Logique de l'interface
├── package.json             # Configuration npm et electron-builder
├── modules/
│   ├── nomenclature.js      # Gestion de la nomenclature
│   ├── import.js            # Importation et détection
│   ├── storage.js           # Copie et stockage
│   ├── compression.js        # Compression HandBrake et ZIP
│   ├── upload.js             # Upload vers NAS
│   └── metadata.js          # Métadonnées et historique
└── README.md
```

## 📝 Configuration des présets HandBrake

Les présets HandBrake sont configurables dans `modules/compression.js`. Par défaut :
- Préset : `Fast 1080p30`
- Codec : H.264
- Frame rate : 30fps
- Résolution max : 1920px

## 🔧 Dépannage

**HandBrake non détecté** :
- Vérifiez que HandBrake CLI est dans votre PATH
- Ou installez-le via Homebrew : `brew install handbrake`
- L'application continuera de fonctionner sans compression

**Connexion NAS échoue** :
- Vérifiez les identifiants et l'adresse IP
- Testez la connexion dans les paramètres
- Vérifiez que le port SFTP/SSH est ouvert

**Espace disque insuffisant** :
- L'application vérifie l'espace avant de commencer
- Libérez de l'espace ou changez les destinations

## 📄 Licence

MIT

## 🆘 Support

Pour toute question ou problème, consultez les logs dans `~/.backupflow/logs/`
