# BackUpFlow Studio – Documentation application

Application Electron macOS qui automatise le workflow de backup, stockage, compression et archivage de fichiers vidéo en postproduction · Cellule Vidéo · l'Étudiant.

*Documentation alignée sur la version stable actuelle. Dernière mise à jour : février 2026.*

---

## 1. Vue d'ensemble

- **Splash** : écran d'ouverture avec logo BackUpFlow et **version** (V1.DD.MM.AA) sous le logo ; animation ~3,7 s ; jingle audio selon l'heure (matin/midi/après-midi/soir).
- **Sélection de profil** : écran « CHOISISSEZ VOTRE PROFIL » sur l'accueil (profils archivés masqués). Cartes avec photo ou initiales, modale pour créer/modifier un profil (nom, initiales, **email**, **destination disque perso**, **destination disque studio** optionnelle, **photo**, **couleurs de la bannière**, thème par défaut). Le profil pré-remplit les infos du workflow. Menu carte : Modifier / Archiver (remplace Supprimer). Badge ADMIN sur les profils `isAdmin: true`.
- **Bannière de profil** : une fois un profil choisi, une **bannière personnalisable** (dégradé selon les couleurs du profil) s'affiche en **pleine largeur** en tête du contenu. Elle affiche la **photo de profil** (cliquable → ouvre la modale de configuration), le nom et les initiales.
- **Workflow** : formulaire en 4 étapes (Infos projet, Sélection fichiers, Options, Vérification), boutons « Démarrer le workflow » et « Ajouter à la queue BATCH ».
- **Queue BATCH** : liste des workflows en attente, « Démarrer la queue », « Arreter le batch » (avec modale de confirmation, interrompt le workflow en cours et annule les restants), « Vider la queue ». Item actif enrichi (étape en cours + to-do list fichiers). Écran de fin « Batch terminé » avec GIF, récap détaillé (projets, destinations Perso/Studio/NAS, poids, statuts, durée) et bouton « Nouveau batch ».
- **Paramètres** : SSD Perso/Studio, connexion NAS (SMB ou SFTP), **Gofile** (envoi automatique intégré au workflow, option « Proposer l'envoi Gofile en fin de travail »), clé API Monday.com. Zone scrollable. **Section Admin** (visible pour profils `isAdmin: true`) : clé API Resend (test de connexion), gestion des profils archivés.
- **Notifications mail** : via Resend (si clé API configurée et email profil renseigné). Mail de succès workflow (avec lien Gofile), mail d'interruption, rapport d'erreur à l'admin, récap de fin de batch.
- **Historique** : liste des opérations avec filtre par profil, actualisation, effacement.
- **Stockage** : `data/` (à la racine du projet) — `settings.json`, `metadata.json`, `history.json`, `profiles.json`.
- **Navigation** : barre de navigation horizontale (Accueil, Workflow, Queue BATCH, Paramètres, Historique), logo BackUpFlow (header), bouton thème clair/sombre, Quitter.
- **Stack** : Electron 28, HTML/CSS/JS vanilla, electron-builder → **BackupFlow.app** et **DMG** (universal).

**Version** : format **V1.DD.MM.AA** (jour, mois, année). Calculée dans **index.html** (`window.APP_VERSION`) et **renderer.js** (`getAppVersion()`), affichée sur le **splash** (sous le logo) et dans la **top bar** (à droite du logo).

**Principe de sécurité** : BackUpFlow **ne modifie jamais les fichiers sources** ; lecture + copie uniquement vers les destinations choisies.

---

## 2. Architecture

- **main.js** : fenêtre (largeur **1400** px, hauteur 900, `titleBarStyle: 'hidden'`, `frame: false`), IPC : `get-settings`, `save-settings`, `check-handbrake`, `detect-sources`, `scan-directory`, `calculate-checksum`, `verify-integrity`, `generate-project-name`, `get-next-letter`, `parse-project-name`, `get-format-description`, `check-disk-space`, `get-file-size`, `select-folder`, `execute-backup-workflow`, `get-history`, `clear-history`, `get-project-metadata`, `list-projects`, `test-nas-connection`, `get-mounted-smb-path`, `check-and-connect-vpn`, `mount-smb-share`, `get-profiles`, `get-profile`, `create-profile`, `update-profile`, `delete-profile`, `select-profile-photo`, `list-celebration-gifs`, `open-external-url`, `gofile-upload`, `is-workflow-running`, **`monday-get-projects`**, **`monday-test-connection`**, **`monday-get-column-ids`**, **`monday-update-item`**, **`archive-profile`**, **`restore-profile`**, **`send-workflow-success-mail`**, **`send-workflow-stopped-mail`**, **`send-error-report-mail`**, **`send-batch-summary-mail`**, **`test-resend-connection`** ; événements : `workflow-progress`, `gofile-progress`, `confirm-quit-during-workflow` ; contrôles fenêtre : `window-minimize`, `window-maximize`, `window-close`, `app-quit`, `force-quit`.
- **preload.js** : contextBridge → `window.electronAPI` (toutes les méthodes listées ci-dessus).
- **modules/** : nomenclature.js (noms de projet, lettres), import.js (sources, scan avec filtrage configurable par extensions/taille/prefixe, checksums), storage.js (copie SSD avec noms pre-calcules, ZIP, normalisation macOS NFD/NFC), compression.js (HandBrakeCLI, ZIP NAS, nettoyage dossier temp), upload.js (SMB/SFTP), metadata.js (historique, profils avec archivage/email/isAdmin, metadonnees), nas-connector.js (polling VPN, auto-mount NAS, diagnostic acces/ecriture/espace), mailer.js (notifications mail via Resend), progress-tracker.js.
- **Renderer** : index.html (splash, bannière profil, vues Accueil/Workflow/Queue/Paramètres/Historique/WorkflowRunning/WorkflowCompleted, modales profil, espace disque, quit confirm), renderer.js (logique UI, état, événements), styles.css.

---

## 3. Structure des données

### settings.json (dans data/)

```json
{
  "ssdPersoPath": "/chemin/vers/SSD_Perso",
  "ssdStudioPath": "/chemin/vers/SSD_Studio",
  "nas": {
    "protocol": "smb" | "sftp",
    "smbURL": "smb://srvfiler01.etudiant.lan/Video",
    "remotePath": "/Volumes/Video",
    "host": "192.168.1.100",
    "port": 22,
    "username": "",
    "password": "",
    "remotePath": "/backups"
  },
  "gofileAutoUpload": false,
  "proposeGofileAtEnd": false,
  "mondayApiToken": "",
  "mondayBoardId": "",
  "allowedVideoExtensions": [".mp4", ".mov"],
  "resendApiKey": ""
}
```

### profiles.json

```json
{
  "profiles": [
    {
      "id": "1234567890abcdef",
      "name": "Martin",
      "initiales": "MP",
      "ssdPersoPath": "/chemin/vers/SSD_Perso",
      "ssdStudioPath": null,
      "photoPath": "/chemin/vers/photo.jpeg",
      "color1": "#2563eb",
      "color2": "#0f172a",
      "color3": "#ffffff",
      "theme": "dark" | "light",
      "mondayMode": "monday" | "manual",
      "email": "prenom.nom@letudiant.fr",
      "archived": false,
      "isAdmin": false,
      "isProtected": false,
      "passwordHash": null,
      "createdAt": "2025-02-20T...",
      "updatedAt": "2025-02-20T..."
    }
  ]
}
```

- **Profils** : chaque profil a `id`, `name`, `initiales`, **`email`**, `ssdPersoPath`, **`ssdStudioPath`** (optionnel), **`photoPath`**, **`color1`**, **`color2`**, **`color3`** (bannière et accent), `theme`, **`mondayMode`** (`monday` | `manual`), **`archived`** (masqué de l'accueil, restaurable), **`isAdmin`** (accès section admin), `isProtected`, `passwordHash`.
- **Bannière** : dégradé `linear-gradient(135deg, color1, color2)`.

---

## 4. Nomenclature des projets

Format : `AAAAMMJJL_FORMAT_SUJET_INITIALES`  
Exemple : `250218A_ITW_Orelsan_MP`

- **Date** : AAMMJJ (année, mois, jour sur 2 chiffres)
- **Lettre** : A, B, C… (incrémentation **globale** sur tous les chemins SSD Perso — settings + profils)
- **Format** : BP, ITW, CEXP, SELEC, etc. (définis dans `nomenclature.js`)
- **Sujet** : en majuscules, espaces remplacés par `_`
- **Initiales** : du profil ou saisie manuelle

**Formats disponibles** : BP (Reco), CEXP (Campus Explorer), ITW (L'interview), ITR (L'interro), SELEC, CQUOI, SCH, REC, ATE, MT, ADLE, DDLE, CDLE, AS, TD3M, EME, TEASER, PROMO, DOC, REP, TEST, CORR.

**Intégration Monday.com (Phase A)** : lorsqu'un projet est sélectionné depuis Monday, le format est extrait du **nom du projet** par recherche d'acronymes (TD3M, CQUOI, ITW, BP, etc.) entourés de séparateurs. Pour éviter la redondance dans le nom généré, l'acronyme du format est retiré du champ Sujet avant assemblage (`stripFormatFromSujet`) — ex. « Projet ITW - Orelsan » + format ITW → sujet « Projet - Orelsan » dans le nom final.

**Intégration Monday.com (Phase B)** : en fin de workflow réussi, si un projet Monday a été sélectionné en étape 1, BackUpFlow met à jour automatiquement l'item Monday : Statut Prod → « 3 - BACKUPÉ », Lien Swiss/GoFile → lien Gofile (si présent), Responsable Backup → nom du profil actif. L'opération est silencieuse en cas de succès. En cas d'échec : message discret sur l'écran « Workflow terminé » ou notification (queue BATCH). L'échec Monday ne bloque jamais la fin du workflow.

---

## 5. Mécanique du workflow de backup

### 5.1 Déroulement global

1. **Copie (~36–40 %)** — SSD Perso et SSD Studio  
   - Création du dossier projet  
   - Copie des fichiers vidéo (renommés `NomProjet_1.mp4`, etc.)

2. **Compression (~27–30 %)** — Si activée  
   - HandBrakeCLI (preset Fast 1080p30)  
   - Création du ZIP NAS (vidéos compressées)

3. **ZIP NAS (~13,5–15 %)** — Si compression et NAS activés  
   - Création de l'archive temporaire

4. **Upload NAS (~13,5–15 %)** — Si activé  
   - SMB : copie vers chemin monté  
   - SFTP : upload via `ssh2-sftp-client`

5. **Envoi Gofile (~10 %)** — Si « Envoi automatique vers Gofile » active dans les parametres  
   - Execute a la suite du transfert NAS (ou apres la derniere action si pas de NAS)  
   - Upload sequentiel des fichiers compressés (si compression activée, sinon fallback SSD Studio), regroupes dans un meme dossier Gofile (via `parentFolder` + `guestToken`). Dossier temporaire nettoyé avant chaque run  
   - Option « Proposer l'envoi Gofile en fin de travail » : affiche un bouton sur l'ecran final pour envoi manuel

### 5.2 Événements de progression

Le main envoie des événements `workflow-progress` avec :

- `step` : copying, compressing, creating_zip_nas, uploading, **gofile** (si envoi auto active), completed, error
- `status` : starting, active, completed
- `progress` : pourcentage de l'etape
- `globalProgress` : pourcentage global (0-100)
- `message`, `file`, `processed`, `total`, `speed`, `eta`, `elapsed`, `fps`, `avgFps`, etc.
- Pour l'etape `gofile` : `done` (fichiers envoyes), `total` (nombre total), `fileName` (fichier en cours)

---

## 6. Parcours utilisateur et vues

1. **Splash** (~3,7 s) : logo BackUpFlow + **version** sous le logo, jingle audio selon l'heure (4 jingles : matin/midi/après-midi/soir), animation fondu + zoom ; puis affichage de l'app.
2. **Accueil** : « CHOISISSEZ VOTRE PROFIL », grille de cartes (photo ou initiales, nom, initiales), « + Ajouter un profil ». Clic sur une carte → profil sélectionné, bannière affichée, pré-remplissage workflow. Clic sur **photo** (bannière) → modale configuration.
3. **Bannière de profil** : visible dès qu'un profil est choisi. Pleine largeur, dégradé (color1, color2), **photo** (clic → modale config), nom, initiales.
4. **Workflow** : 4 étapes. **Étape 1** — Toggle **MONDAY / MANUEL** (source du projet, mémorisé par profil) ; si Monday : liste de projets (filtrage par statut 1-En projet / 2-En tournage, exclusion OPTION, tri), sélection → pré-remplissage Sujet, Format (extrait du nom), Date de tournage ; si Manuel : saisie manuelle. Étapes 2-4 : Sélection fichiers, Options, Vérification. Boutons « Démarrer le workflow » et « Ajouter à la queue BATCH ».
5. **Workflow en cours** : barre de progression globale ancrée (%, ETA, débit), sections COPIE / COMPRESSION / TRANSFERT VERS LE NAS / ENVOI GOFILE, to-do list par fichier avec états individuels (En attente / En cours / Terminé / Erreur), bouton « Arrêter le workflow ».
6. **Workflow terminé** : GIF de célébration aléatoire (assets/GIF), boutons « RETOUR À L'ACCUEIL » et « QUITTER », option « Envoyer vers Gofile » si non fait automatiquement. Zone message d'erreur Monday (`#mondayUpdateErrorMsg`) en cas d'échec Phase B. Mail de succès envoyé automatiquement si email configuré.
6b. **Workflow interrompu** (`workflowAbortedView`) : écran dédié avec nom du projet, choix « Supprimer les fichiers copiés », « Conserver les fichiers copiés », « Quitter l'application ». Mail d'interruption envoyé automatiquement.
7. **Queue BATCH** : liste des workflows en attente, « Démarrer la queue », « Arreter le batch » (modale de confirmation → `abortWorkflow()` + items restants marqués « cancelled »), « Vider la queue ». Item actif enrichi : nom de l'étape + pourcentage + barre fine + to-do list fichiers (pastilles colorées + cercle SVG progressif). Statuts possibles : pending, running, completed, partial, failed, cancelled.
8. **Batch terminé** (`batchCompleteView`) : GIF de célébration aléatoire, titre « Batch terminé », tableau récapitulatif par projet (nom, destinations Perso/Studio/NAS avec chemins courts, poids total des fichiers, statut coloré), compteurs par statut, durée totale, bouton « Nouveau batch » (vide la queue, retour à la vue batch).
9. **Paramètres** : Destinations SSD (Perso + Studio), Connexion NAS (SMB/SFTP), Gofile (envoi automatique + proposer en fin de travail), **Monday.com** (clé API, Board ID, bouton « Tester la connexion »), Enregistrer. **Section Admin** (profils isAdmin uniquement) : clé API Resend, gestion des profils archivés.
10. **Historique** : filtre par profil, Actualiser, Effacer l'historique.

**Header global** : **logo BackUpFlow** (sans lien retour explicite), **version** à droite du logo, navigation (ACCUEIL, WORKFLOW, QUEUE BATCH, PARAMÈTRES, HISTORIQUE), **MODE SOMBRE/CLAIR**, **QUITTER**.

---

## 7. Structure des dossiers (source)

```
BackUpFlow Studio/
├── package.json
├── main.js
├── preload.js
├── index.html
├── renderer.js
├── styles.css
├── Lancer BackupFlow.command
├── INSTALLATION.md
├── ETAT_DES_LIEUX.md
├── RESOLUTION_PROBLEMES.md
├── BACKUPFLOW_STUDIO_DOCUMENTATION.md
├── BACKUPFLOW_STUDIO_DOCUMENTATION_APPLICATION.md
├── BACKUPFLOW_STUDIO_DOCUMENTATION_INTERFACE_UX.md
├── data/                        # Données persistantes (profiles, settings, history, metadata)
├── assets/
│   ├── LOGO.png              # Logo BackUpFlow (splash + header)
│   ├── icon.icns
│   ├── JINGLE BCUPFLX.wav    # Jingle matin
│   ├── JINGLE_MIDI.wav       # Jingle midi
│   ├── JINGLE_APREM.wav      # Jingle après-midi
│   ├── JINGLE_SOIR.wav       # Jingle soir
│   └── GIF/                     # GIFs de célébration (aléatoire à la fin)
└── modules/
    ├── nomenclature.js
    ├── import.js
    ├── storage.js
    ├── compression.js
    ├── upload.js
    ├── metadata.js
    ├── mailer.js             # Notifications mail via Resend
    ├── nas-connector.js
    └── progress-tracker.js
```

---

## 8. Version et journal des versions

- **Version affichée** : calculée dans **index.html** (script inline `window.APP_VERSION`, format **V1.DD.MM.AA**), utilisée par `getAppVersion()` dans **renderer.js**, appliquée via `applyVersionToUI()` (splash + header). Affichée sur le **splash** (sous le logo) et dans la **top bar** (à droite du logo, cliquable → modale changelog).
- **Changelog** : objet `CHANGELOG` dans `renderer.js` (liste des versions avec date et notes). Modale `#changelogModal` accessible par clic sur le numéro de version ou touche Escape pour fermer.

---

## 9. Lancement et build

- **Dev** : `npm install` puis `npm start` ou `npm run dev` (DevTools ouvert).
- **Lancement** : double-clic sur `Lancer BackupFlow.command` (vérification Node.js, `npm install` si besoin, puis `npm start`).
- **Build** : `npm run build` ou `npm run build:mac` ou `npm run dist` → **dist/** :
  - **dist/mac-universal/BackupFlow.app** : application macOS (universal).
  - **dist/*.dmg** : image disque pour distribution.
  - **dist/*.zip** : archive.
- **Distribution** : partager le **.dmg** ou **BackupFlow.app** avec l'équipe.

---

## 10. Gestion des chemins (macOS)

- **Normalisation Unicode** : le module storage tente une résolution NFD si le chemin en NFC échoue (caractères accentués type « Dépôt »).
- **Priorité des chemins** : pour chaque workflow, le chemin du profil est utilisé s'il est défini, sinon celui des Paramètres globaux.
- **Message d'erreur** : en cas de dossier inexistant, indication de vérifier Paramètres et configuration du profil.

---

## 11. Dépendances externes

- **HandBrakeCLI** : PATH ou `/usr/local/bin`, `/opt/homebrew/bin`. Indispensable pour la compression vidéo.
- **NAS SMB** : partage monté dans Finder ; l'app utilise le chemin local (ex. `/Volumes/Video`).
- **NAS SFTP** : connexion directe (host, port, user, password).
- **Volumes SSD** : chemins configurés dans Paramètres (valeurs par défaut) ou par profil (SSD Perso et SSD Studio optionnel par profil pour tests).
