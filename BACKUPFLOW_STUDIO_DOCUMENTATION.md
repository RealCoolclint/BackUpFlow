# BackUpFlow Studio – Documentation complète

Ce document décrit l'application **BackUpFlow Studio** — version dédiée au workflow de backup vidéo en postproduction — afin qu'un assistant (ex. Claude) puisse proposer des évolutions cohérentes avec l'existant.

**Documents complémentaires** (format aligné avec Launcher) :
- **BACKUPFLOW_DOCUMENTATION_APPLICATION.md** — Vue d'ensemble, architecture, config, parcours utilisateur, build, journal des versions.
- **BACKUPFLOW_STUDIO_DOCUMENTATION_INTERFACE_UX.md** — Design system, palette, composants, écrans, modales.

*Dernière mise à jour : février 2026*

---

## 1. Vue d'ensemble

**BackUpFlow Studio** est une application pour **macOS** qui automatise le **workflow de backup, stockage, compression et archivage de fichiers vidéo** en postproduction. Elle permet de :

- Copier des projets vidéo vers **deux destinations locales** (SSD Perso et SSD Studio)
- **Compresser les vidéos** avec HandBrake (preset Fast 1080p30 par défaut)
- **Archiver en ZIP** et **envoyer vers un NAS** (SMB ou SFTP)
- **Envoyer vers Gofile** (optionnel, manuel ou automatique après workflow ; tous les fichiers sont regroupés dans un même dossier Gofile)
- Gérer des **profils utilisateur** avec initiales, chemins personnalisés et thèmes
- Enchaîner plusieurs workflows via la **queue BATCH**
- **Montage automatique du NAS** dès détection du VPN (polling réseau → montage SMB → vérification)
- **Intégration Monday.com (Phase A et B)** : Phase A — sélection de projets depuis un board Monday, pré-remplissage Sujet / Format (extraction depuis le nom) / Date de tournage, toggle MONDAY / MANUEL / ORGANIZER mémorisé par profil. Phase B — en fin de workflow réussi, mise à jour automatique de l'item Monday (Statut Prod, Lien Swiss/GoFile, Responsable Backup).

**Principe de sécurité** : BackUpFlow **ne modifie jamais les fichiers sources** ; il ne fait que les **lire** et les **copier** vers les destinations choisies par l'utilisateur.

**Version** : format `V1.DD.MM.AA` calculé au chargement (ex. `V1.19.02.25`). Affichée dans le header et sur le splash.

**Lancement** : via le script `Lancer BackupFlow.command` (vérification Node.js, `npm install` si besoin, puis `npm start`).

---

## 2. Stack technique

| Élément | Technologie |
|--------|-------------|
| **Application desktop** | Electron (v28.x) |
| **Langage** | JavaScript (Node.js côté main, JavaScript vanilla côté renderer) |
| **Interface** | HTML5, CSS3, JavaScript vanilla (pas React/Vue) |
| **Fichiers / système** | `fs-extra` |
| **Compression ZIP** | `archiver` |
| **Upload NAS (SFTP)** | `ssh2-sftp-client` |
| **FormData (Gofile)** | `form-data` |
| **Notifications mail** | `resend` |
| **Notifications** | `node-notifier` |
| **Build / distribution** | `electron-builder` (DMG, ZIP pour macOS x64/arm64) |

**HandBrakeCLI** est requis pour la compression vidéo (détecté au lancement ; optionnel pour le reste).

**Stockage** : `data/` (à la racine du projet, via `app.getAppPath()`)
- `settings.json` — chemins SSD, config NAS, options Gofile, clé Monday.com, clé API Resend (`resendApiKey`), `allowedVideoExtensions`
- `metadata.json` — métadonnées des projets
- `history.json` — dernières opérations (limitée à 100 entrées)
- `profiles.json` — profils utilisateur (nom, initiales, email, photo, couleurs, thème, `archived`, `isAdmin`)

---

## 3. Architecture des processus

| Rôle | Fichier(s) | Rôle |
|------|------------|------|
| **Main** | `main.js` | Point d'entrée, fenêtre Electron, IPC handlers, orchestration du workflow, initialisation des managers. |
| **Preload** | `preload.js` | Pont sécurisé : API exposée au renderer via `contextBridge` (`window.electronAPI`). |
| **Renderer** | `renderer.js` + `index.html` | Interface utilisateur, état client, appels IPC, affichage de la progression. |
| **Modules** | `modules/*.js` | Nomenclature, import, stockage, compression, upload, métadonnées, progression. |

Le renderer n'appelle que l'API exposée par le preload ; pas d'accès direct au système de fichiers.

---

## 4. Structure des dossiers (source)

```
BackUpFlow Studio/
├── package.json              # scripts: start, dev, build, build:mac
├── main.js                   # Processus principal Electron
├── preload.js                # API exposée au renderer
├── index.html                # Structure des vues, formulaires, modales
├── renderer.js               # Logique UI, état, événements
├── styles.css                # Thèmes, mise en page, composants
├── Lancer BackupFlow.command # Script de lancement (double-clic)
├── INSTALLATION.md           # Guide d'installation
├── ETAT_DES_LIEUX.md         # État actuel de la version Studio
├── BACKUPFLOW_STUDIO_DOCUMENTATION.md  # Ce document
├── data/                     # Données persistantes (profiles, settings, history, metadata)
├── assets/
│   ├── logo.png
│   ├── JINGLE BCUPFLX.wav    # Jingle matin
│   ├── JINGLE_MIDI.wav       # Jingle midi
│   ├── JINGLE_APREM.wav      # Jingle après-midi
│   ├── JINGLE_SOIR.wav       # Jingle soir
│   └── GIF/                  # GIFs de célébration (aléatoire à la fin)
└── modules/
    ├── nomenclature.js       # Noms de projet (date, lettre, format, sujet, initiales)
    ├── import.js             # Détection sources, scan (filtrage configurable), checksums, intégrité
    ├── storage.js            # Copie SSD Perso/Studio, ZIP, espace disque
    ├── compression.js        # HandBrakeCLI, création ZIP NAS
    ├── nas-connector.js      # Polling VPN, auto-mount NAS, vérification accès
    ├── upload.js             # Connexion et upload NAS (SMB/SFTP)
    ├── metadata.js           # Historique, métadonnées, profils (CRUD, archivage)
    ├── mailer.js             # Notifications mail via Resend
    └── progress-tracker.js   # Progression %, débit, ETA
```

---

## 5. Parcours utilisateur et vues

Les vues sont des `<div class="view">` ; une seule affichée à la fois via la classe `active`. Navigation via `.nav-btn[data-view]` et la fonction `showView()` dans `renderer.js`.

### 5.1 Splash screen

- Plein écran, fond noir
- Logo centré, version en dessous
- Animation : fondu + zoom (~3,7 s)
- Transition vers le contenu principal

### 5.2 Vues principales

| Vue | ID | Contenu |
|-----|-----|---------|
| **Accueil** | `homeView` | Grille de profils utilisateur, bouton « Ajouter un profil ». Sélection d'un profil pour pré-remplir les infos de workflow. |
| **Workflow** | `workflowView` | Toggle MONDAY / MANUEL (source projet, mémorisé par profil). Étape 1 : si Monday — liste projets (filtrage, tri), sélection → pré-remplissage Sujet, Format (extrait du nom), Date ; si Manuel — saisie. Étapes 2-4 : Sélection fichiers, Options, Vérification. En fin de workflow réussi (mode Monday), mise à jour automatique de l'item Monday (Phase B). Boutons « Démarrer le workflow », « Ajouter à la queue BATCH ». |
| **Queue BATCH** | `batchView` | Liste des workflows en attente, « Démarrer la queue », « Arreter le batch » (pendant l'exécution, avec modale de confirmation), « Vider la queue ». Item actif enrichi : étape en cours + to-do list fichiers avec pastilles et cercle SVG. |
| **Batch terminé** | `batchCompleteView` | GIF de célébration, récap (projets traités, statuts, destinations Perso/Studio/NAS, poids, durée totale), bouton « Nouveau batch ». |
| **Paramètres** | `settingsView` | Destinations SSD Perso/Studio, configuration NAS (SMB ou SFTP), Gofile auto-upload, Monday.com (clé API, Board ID, test de connexion). |
| **Historique** | `historyView` | Liste des opérations avec filtre par profil, actualisation, effacement. |

### 5.3 Vues dédiées au run

| Vue | ID | Contenu |
|-----|-----|---------|
| **Workflow en cours** | `workflowRunningView` | Barre de progression globale (pourcentage, ETA, detail), etapes COPIE / COMPRESSION / TRANSFERT NAS / ENVOI GOFILE, to-do list par fichier avec etats individuels (En attente / En cours / Termine / Erreur), bouton « Arreter le workflow ». |
| **Workflow interrompu** | `workflowAbortedView` | Ecran d'interruption : nom du projet, choix « Supprimer les fichiers copiés » / « Conserver les fichiers copiés » / « Quitter l'application ». Mail d'interruption envoyé si email configuré. |
| **Workflow termine** | `workflowCompletedView` | GIF de celebration aleatoire, boutons « Retour a l'accueil » et « Quitter », option « Envoyer vers Gofile » si non fait automatiquement. |
| **Batch termine** | `batchCompleteView` | GIF de celebration aleatoire, titre « Batch termine », recap (nombre projets par statut, tableau par projet avec nom/destinations/poids/statut, duree totale), bouton « Nouveau batch » (vide la queue et retourne a la vue batch). |

### 5.4 Header global

- Logo + version
- Navigation : Accueil, Workflow, Queue BATCH, Paramètres, Historique
- Bouton thème clair/sombre
- Bouton Quitter

---

## 6. Données et état (renderer)

| Variable / clé | Rôle |
|----------------|------|
| `state.currentView` | Vue active (home, workflow, batch, settings, history, workflowRunning, workflowCompleted, workflowAborted). |
| `state.selectedProfile` | Profil sélectionné (id, nom, initiales, ssdPersoPath, photo, couleurs, thème). |
| `state.profiles` | Liste des profils chargés. |
| `state.workflow` | Données du formulaire workflow (format, sujet, initiales, mondayItemId, dateTournage, files, options). |
| `state.batchQueue` | Queue BATCH : `items` (workflows), `currentIndex`, `isRunning`, `stopRequested` (arrêt demandé), `startTime` (horodatage début). Chaque item stocke `profileName` pour le fallback Monday. |
| `state.settings` | Paramètres chargés (ssdPersoPath, ssdStudioPath, nas, gofileAutoUpload, mondayApiToken, resendApiKey). |
| `state.history` | Historique des opérations. |
| `state.theme` | Thème actif (light / dark). |

---

## 7. API exposée au renderer (`window.electronAPI`)

| Méthode | Rôle |
|---------|------|
| `getSettings()` | Charge les paramètres. |
| `saveSettings(settings)` | Enregistre les paramètres. |
| `checkHandBrake()` | Vérifie la présence de HandBrakeCLI. |
| `detectSources()` | Détecte les volumes montés. |
| `scanDirectory(dirPath, recursive, opts)` | Scanne un repertoire (opts.multiCam elargit aux extensions audio). |
| `calculateChecksum(filePath)` | Calcule le checksum d'un fichier. |
| `verifyIntegrity(source, dest)` | Vérifie l'intégrité source/destination. |
| `generateProjectName(params)` | Génère le nom du projet (date, lettre, format, sujet, initiales). |
| `getNextLetter(format)` | Retourne la prochaine lettre disponible (A, B, C…). |
| `parseProjectName(name)` | Parse un nom de projet. |
| `getFormatDescription(format)` | Description du format. |
| `checkDiskSpace(directory, bytes)` | Vérifie l'espace disque. |
| `getFileSize(filePath)` | Taille d'un fichier. |
| `selectFolder()` | Dialogue « Choisir un dossier ». |
| `executeBackupWorkflow(workflowData)` | Lance le workflow de backup. |
| `getHistory(limit)` | Charge l'historique. |
| `clearHistory()` | Efface l'historique. |
| `getProjectMetadata(projectName)` | Métadonnées d'un projet. |
| `listProjects()` | Liste les projets. |
| `testNASConnection(config)` | Teste la connexion NAS. |
| `getMountedSMBShare(smbURL)` | Chemin monté SMB. |
| `checkAndConnectVPN()` | Vérifie/connexion VPN FortiClient. |
| `mountSMBShare(smbURL)` | Monte un partage SMB. |
| `getProfiles()` | Charge les profils. |
| `getProfile(id)` | Charge un profil. |
| `createProfile(data)` | Crée un profil. |
| `updateProfile(id, data)` | Met à jour un profil. |
| `deleteProfile(id)` | Supprime un profil. |
| `selectProfilePhoto()` | Sélectionne une photo de profil. |
| `listCelebrationGifs()` | Liste les GIFs de célébration. |
| `openExternalURL(url)` | Ouvre une URL dans le navigateur. |
| `gofileUpload(folderPath)` | Envoie un dossier vers Gofile. |
| `mondayGetProjects(boardId, token)` | Charge la liste des projets Monday (filtrage statut, tri, exclusion OPTION). |
| `mondayTestConnection(token, boardId)` | Teste la connexion Monday (auth, board, API). |
| `mondayGetColumnIds(boardId, token)` | Recupere les IDs des colonnes Monday. |
| `mondayUpdateItem({ itemId, boardId, apiToken, updates })` | Met a jour un item Monday (Phase B). |
| `findProjectByMondayItemId(mondayItemId)` | Recherche un projet par ID Monday. |
| `nasCheckVPN()` | Verifie l'etat du VPN. |
| `nasCheckAccess(remotePath)` | Verifie l'accessibilite du NAS. |
| `nasCheckSMBMount(smbURL)` | Verifie si le partage SMB est monte. |
| `nasFullProtocol()` | Execute le protocole complet de connexion NAS. |
| `nasFullDiagnostic(requiredBytes)` | Diagnostic NAS complet (acces, ecriture, espace). |
| `nasVerifyWriteAccess(remotePath)` | Verifie l'acces en ecriture sur le NAS. |
| `getNASStatus()` | Statut courant du NAS. |
| `retryNASUpload(data)` | Relance un upload NAS echoue. |
| `getNextSessionNumber(parentFolderPath)` | Numero de session suivant. |
| `pathExists(folderPath)` | Verifie l'existence d'un chemin. |
| `readOrganizerManifest(folderPath)` | Lit un manifeste Organizer (MultiCam). |
| `getMulticamFolderSummary(data)` | Resume d'un dossier MultiCam. |
| `executeMultiCamWorkflow(workflowData)` | Execute un workflow MultiCam. |
| `onWorkflowProgress(callback)` | Listener progression du workflow. |
| `onGofileProgress(callback)` | Listener progression Gofile. |
| `onMultiCamProgress(callback)` | Listener progression MultiCam. |
| `onVpnStatusUpdate(callback)` | Listener changement d'etat VPN. |
| `onNasAutoMounted(callback)` | Listener montage NAS automatique reussi. |
| `onNasAutoMountFailed(callback)` | Listener echec montage NAS automatique. |
| `onConfirmQuit(callback)` | Listener confirmation de fermeture pendant workflow. |
| `removeAllListeners(channel)` | Supprime les listeners d'un canal. |
| `minimizeWindow()` | Reduit la fenetre. |
| `maximizeWindow()` | Agrandit ou restaure. |
| `closeWindow()` | Ferme la fenetre. |
| `quitApp()` | Quitte l'application. |
| `forceQuit()` | Force la fermeture (apres confirmation). |
| `abortWorkflow()` | Interrompt le workflow en cours (AbortController). |
| `isWorkflowRunning()` | Indique si un workflow est en cours. |
| `archiveProfile(id)` | Archive un profil (masqué de l'accueil). |
| `restoreProfile(id)` | Restaure un profil archivé. |
| `sendWorkflowSuccessMail(params)` | Envoie un mail de succès workflow. |
| `sendWorkflowStoppedMail(params)` | Envoie un mail d'interruption workflow. |
| `sendErrorReportMail(params)` | Envoie un rapport d'erreur à l'admin. |
| `sendBatchSummaryMail(data)` | Envoie un récap de fin de batch. |
| `testResendConnection(apiKey)` | Teste la connexion Resend avec un mail de test. |

---

## 8. Mécanique du workflow de backup

### 8.1 Déroulement global

1. **Copie (~40 %)** — SSD Perso et SSD Studio  
   - Création du dossier projet  
   - Copie des fichiers video (renommes `NomProjet_1.mp4`, etc.)

2. **Compression (~27-30 %)** — Si activee  
   - HandBrakeCLI (preset Fast 1080p30)  
   - Creation du ZIP NAS (videos compressees)

3. **ZIP NAS (~15 %)** — Si compression et NAS activés  
   - Création de l’archive temporaire

4. **Upload NAS (~13-15 %)** — Si active  
   - SMB : copie vers chemin monte  
   - SFTP : upload via `ssh2-sftp-client`

5. **Envoi Gofile (~10 %)** — Si envoi automatique active  
   - Upload séquentiel des fichiers compressés (si compression activée, sinon fallback SSD Studio), regroupés dans un même dossier Gofile (via `parentFolder` + `guestToken`). Dossier temp nettoyé avant chaque run.

### 8.2 Nomenclature des projets

Format : `AAAAMMJJL_FORMAT_SUJET_INITIALES`  
Exemple : `250218A_ITW_Orelsan_MP`

- **Date** : AAMMJJ (année, mois, jour sur 2 chiffres)
- **Lettre** : A, B, C… (incrémentation **globale** sur tous les chemins SSD Perso)
- **Format** : BP, ITW, CEXP, etc. (définis dans `nomenclature.js`)
- **Sujet** : en majuscules, espaces remplacés par `_`. Si source Monday : l'acronyme du format est retiré du sujet pour éviter la redondance (ex. « Projet ITW - Orelsan » → sujet « Projet - Orelsan »).
- **Initiales** : du profil ou saisie manuelle

### 8.3 Mise à jour Monday (Phase B)

En fin de workflow réussi, si un projet Monday a été sélectionné en étape 1 (`mondayItemId` défini), le renderer appelle `mondayUpdateItem` de manière asynchrone et non bloquante. L'item Monday est mis à jour avec : **Statut Prod** → « 3 - BACKUPÉ », **Lien Swiss/GoFile** → lien Gofile (si présent), **Responsable Backup** → nom du profil actif. Les colonnes sont résolues dynamiquement (Statut Prod, Lien Swiss/GoFile, Responsable Backup). En cas d'échec : message discret sur l'écran « Workflow terminé » ou notification pour la queue BATCH. L'échec n'interrompt jamais le déroulement du workflow.

### 8.4 Filtrage des fichiers sources

Le scan de repertoire (`ImportManager.scanDirectory`) applique trois filtres en chaine :

1. **Inclusion par extension** : seuls les fichiers dont l'extension figure dans `allowedVideoExtensions` sont retenus. Liste par defaut : `.mp4`, `.mov`. Configurable dans les Parametres (section « Extensions video autorisees »), persiste dans `settings.json` sous la cle `allowedVideoExtensions`.
2. **Exclusion par taille** : fichiers de moins de 1 Mo ignores.
3. **Exclusion par prefixe** : fichiers dont le nom commence par `Rendered - ` ignores.

**Mode MultiCam (Organizer)** : le scan elargit automatiquement la liste des extensions avec `.wav` et `.mp3` sans modifier la configuration persistee.

### 8.5 Montage automatique du NAS

Le module `NASConnector` effectue un polling reseau toutes les 30 secondes (`nc -z -w5 77.158.242.12 445`). Lorsque le VPN passe de « deconnecte » a « connecte » et que le NAS n'est pas encore monte :

1. Lancement de `open smb://srvfiler01.etudiant.lan/Video`
2. Attente 3 secondes
3. Verification du montage via `fs.pathExists` sur le chemin NAS configure
4. Mise a jour des indicateurs (VPN et NAS) dans l'interface via IPC

Les identifiants sont geres par le trousseau macOS (Keychain). Aucune gestion de credentials dans l'application.

### 8.6 Evenements de progression

Le main envoie des événements `workflow-progress` avec :

- `step` : copying, compressing, creating_zip_nas, uploading, gofile, completed, error
- `status` : starting, active, completed
- `progress` : pourcentage de l’étape
- `globalProgress` : pourcentage global (0–100)
- `message`, `file`, `processed`, `total`, `speed`, `eta`, `elapsed`, etc.

Le renderer affiche une **to-do list par fichier** dans chaque section de workflow :
- **Copie / Compression** : liste pre-remplie avec les noms de fichiers sources, chaque fichier passe de « En attente » (pastille grise) a « En cours » (pastille bleue + cercle SVG progressif) puis « Termine » (pastille verte) ou « Erreur » (pastille rouge).
- **NAS** : alimentation dynamique (ZIP + upload).
- **Gofile** : pas de liste individuelle, libelle « Envoi du dossier vers Gofile (X fichiers) ».

L'evenement `workflow-progress` pour l'etape `gofile` inclut les champs `done`, `total` et `fileName`.

---

## 9. Philosophie du design

### 9.1 Principes directeurs

- **Minimalisme** : palette limitée, pas de fioritures
- **Clarté** : hiérarchie visuelle nette, états explicites
- **Cohérence** : mêmes motifs pour boutons, formulaires, modales
- **Accessibilité** : contraste suffisant, libellés explicites
- **Sans icônes superflues** : libellés textuels privilégiés

### 9.2 Palette de couleurs

| Variable | Usage | Valeur (hex) |
|----------|-------|--------------|
| `--color-primary` | Accent, actions | `#2563eb` |
| `--color-dark` | Fond sombre, texte | `#0f172a` |
| `--color-light` | Fond clair | `#ffffff` |

Variables sémantiques : `--bg-primary`, `--bg-secondary`, `--bg-elevated`, `--text-primary`, `--text-secondary`, `--accent`, `--accent-hover`, `--success`, `--danger`, `--warning`, `--border`, `--shadow-*`.

### 9.3 Typographie

- **Polices** : Open Sans (corps), Lato (titres)
- **Hiérarchie** : titres 1.5–2rem / 700, labels 0.75em / 600 uppercase

### 9.4 Composants réutilisables

- **Boutons** : `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-danger`, `.btn-success`, `.btn-sm`
- **Formulaires** : `.input`, `.select`, `.form-group`, `.field-group`, `.path-input-group`
- **Checkbox** : `.checkbox-label`
- **Modales** : `.modal`, `.modal-content`, `.modal-header`, `.modal-body`, `.modal-footer`
- **Barre de progression** : `.progress-bar`, `.progress-bar-container`, `.global-progress-*`
- **Cartes** : `.profiles-grid`, cartes de profils avec photo, nom, initiales

---

## 10. Modules main (résumé)

| Module | Rôle |
|--------|------|
| **NomenclatureManager** | Génération des noms de projet, incrémentation globale des lettres (tous profils/chemins). |
| **ImportManager** | Detection des sources, scan avec filtrage configurable (extensions, taille min 1 Mo, prefixe), checksums, verification d'integrite. |
| **StorageManager** | Copie vers SSD Perso et SSD Studio (noms pré-calculés une seule fois dans `copyToBothDestinations`, suffixe `_1`, `_2`… pour les vidéos), ZIP, vérification d’espace disque, ProgressTracker. |
| **CompressionManager** | Appel HandBrakeCLI, creation du ZIP NAS (videos compressees). |
| **UploadManager** | Connexion et upload NAS (SMB via chemin monte, SFTP via ssh2-sftp-client). |
| **NASConnector** | Polling VPN, auto-mount NAS via SMB, verification d'acces, evenements IPC. |
| **MetadataManager** | Historique, metadonnees projet, CRUD profils (archivage/restauration, email, isAdmin). Données dans `data/`. |
| **MailerManager** | Notifications mail via Resend : succès workflow, arrêt, rapport erreur admin, récap batch. |
| **ProgressTracker** | Calcul progression (%, debit, ETA) a partir des octets traites. |

---

## 11. Règles de sécurité

- **Ne jamais modifier ni supprimer les fichiers sources** : lecture + copie uniquement.
- **Écriture uniquement** dans les dossiers de destination choisis par l’utilisateur.
- Pas d’exécution de code arbitraire ; chemins validés.
- Communication main/renderer **uniquement via IPC** ; pas d’accès direct au système de fichiers côté renderer.

---

## 12. Lancement et build

| Commande | Usage |
|----------|-------|
| `npm start` | Lancement en mode normal |
| `npm run dev` | Lancement en mode développement (DevTools ouvert) |
| `npm run build` | Build Electron (electron-builder) |
| `npm run build:mac` | Build macOS uniquement |
| `npm run dist` | Build sans publication |

**Script de lancement** : double-clic sur `Lancer BackupFlow.command`.

---

## 13. Dépendances externes

- **HandBrakeCLI** : PATH ou `/usr/local/bin`, `/opt/homebrew/bin`. Indispensable pour la compression.
- **NAS SMB** : partage monté dans le Finder ; l’app utilise le chemin local (ex. `/Volumes/Video`).
- **NAS SFTP** : connexion directe (host, port, user, password/clé).
- **Volumes SSD** : chemins configurés dans Paramètres ou par profil.

---

## 14. Évolutions prévues (hors scope actuel)

- **Mode backup ATEM** : prise en charge des fichiers provenant de l’ATEM (T7) avec option de backup sans ISO.
- Autres évolutions Monday.com (corrections, colonnes supplémentaires, etc.).

---

*Document de référence pour BackUpFlow Studio. À mettre à jour lorsque l’architecture ou les fonctionnalités évoluent.*
