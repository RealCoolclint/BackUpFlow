# État des lieux — BackupFlow

**Document de référence**  
*Dernière mise à jour : février 2026*

---

## 1. Identification de la version

Ce dépôt correspond à la **version « Studio »** de l’application BackupFlow.

Il existe plusieurs variantes de l’application (dont d’autres contextes ou déploiements). **Cette version Studio est retenue comme base de développement** pour les évolutions à venir. Toute nouvelle fonctionnalité ou correction doit s’appuyer sur cette base.

- **Nom produit** : BackupFlow  
- **Version logicielle** : 1.0.0 (cf. `package.json`)  
- **Auteur** : Martin Pavloff  
- **Environnement cible** : macOS (Electron)

---

## 2. Objectif de l’application

BackupFlow automatise le **workflow de backup, stockage, compression et archivage de fichiers vidéo** en postproduction. Elle permet de :

- Copier des projets vidéo vers **deux destinations locales** (SSD Perso et SSD Studio)
- Optionnellement **compresser les vidéos** avec HandBrake
- Optionnellement **archiver en ZIP** et **envoyer vers un NAS** (SMB ou SFTP)

Le tout avec **nomenclature de projet normalisée**, **profils utilisateur** et **queue batch** pour enchaîner plusieurs workflows.

---

## 3. Stack technique

| Élément | Technologie |
|--------|-------------|
| Application desktop | **Electron** (v28.x) |
| Langage | JavaScript (Node.js côté main, pas de framework front) |
| Interface | HTML5, CSS3, JavaScript vanilla (pas React/Vue) |
| Fichiers / système | `fs-extra` |
| Compression ZIP | `archiver` |
| Upload NAS (SFTP) | `ssh2-sftp-client` |
| Notifications mail | `resend` |
| Notifications | `node-notifier` |
| Build / distribution | `electron-builder` (DMG, ZIP pour macOS x64/arm64) |

**HandBrakeCLI** est requis pour la compression vidéo (détecté au lancement, optionnel pour le reste).

---

## 4. Architecture

### 4.1 Processus Electron

- **Main** (`main.js`) : point d’entrée, fenêtre, IPC, orchestration des modules, exécution du workflow.
- **Preload** (`preload.js`) : pont sécurisé (contextBridge) entre main et renderer ; expose `window.electronAPI`.
- **Renderer** (`renderer.js` + `index.html`) : UI, état client, appels IPC, affichage de la progression.

Communication **uniquement par IPC** (invoke/handle pour les requêtes, `send`/`on` pour les événements tels que `workflow-progress`).

### 4.2 Modules (côté main)

Tous dans `modules/` :

| Module | Fichier | Rôle |
|--------|---------|------|
| **NomenclatureManager** | `nomenclature.js` | Génération des noms de projet (date + lettre A/B/C… + format + sujet + initiales), incrémentation globale des lettres sur tous les profils/chemins. |
| **ImportManager** | `import.js` | Détection des sources, scan de répertoires avec filtrage configurable (extensions vidéo, taille min 1 Mo, préfixe), checksums, vérification d’intégrité. |
| **StorageManager** | `storage.js` | Copie vers SSD Perso et SSD Studio (noms pré-calculés une seule fois, suffixe `_1`, `_2`… pour les vidéos), création de ZIP (pour NAS), vérification d’espace disque, `ProgressTracker`. |
| **CompressionManager** | `compression.js` | Appel HandBrakeCLI (compression vidéo), création de l’archive ZIP NAS (vidéos compressées). |
| **UploadManager** | `upload.js` | Connexion et upload vers NAS (SMB via chemin monté, ou SFTP), progression. |
| **MetadataManager** | `metadata.js` | Historique des opérations, métadonnées projet, **gestion des profils** (CRUD, archivage/restauration, `profiles.json`). Données dans `data/` à la racine du projet. |
| **NASConnector** | `nas-connector.js` | Polling VPN, auto-mount NAS via SMB, verification acces NAS, evenements IPC. |
| **MailerManager** | `mailer.js` | Notifications mail via Resend (succès workflow, arrêt, rapport d'erreur admin, récap batch). |
| **ProgressTracker** | `progress-tracker.js` | Calcul progression (%, débit, ETA) à partir des octets traités. |

### 4.3 Données persistantes

Stockage dans `data/` (à la racine du projet, via `app.getAppPath()`) :

- **settings.json** : chemins SSD Perso / SSD Studio, config NAS, clé API Resend (`resendApiKey`), options Gofile, Monday.
- **metadata.json** : métadonnées des projets (format, sujet, initiales, nb fichiers, compression, upload, etc.).
- **history.json** : dernières opérations (backup, upload), limité à 100 entrées.
- **profiles.json** : profils utilisateur (nom, initiales, email, chemin SSD Perso, photo, couleurs, thème, `archived`, `isAdmin`).

---

## 5. Mécanique du workflow de backup

### 5.1 Déroulement global

1. **Copie (≈ 40 % de la progression globale)**  
   - **SSD Perso** : création d’un dossier au nom du projet ; copie des fichiers vidéo (renommés avec suffixe _1, _2…).  
   - **SSD Studio** : même logique dans un **dossier au nom du projet** (pas de ZIP) ; mêmes fichiers vidéo.

2. **Compression (≈ 30 %)**  
   Si l’option est activée : compression des vidéos avec HandBrakeCLI (preset « Fast 1080p30 » par défaut), puis création d’un **ZIP NAS** contenant les vidéos compressées.

3. **ZIP NAS (≈ 15 %)**  
   Création de l’archive destinée au NAS (dans un répertoire temporaire).

4. **Upload NAS (≈ 15 %)**  
   Si l’option est activée : envoi du ZIP vers le NAS (SMB : copie vers chemin monté ; SFTP : `ssh2-sftp-client`).

5. **Envoi Gofile (~10 %)**  
   Si envoi automatique activé : upload séquentiel des fichiers compressés (si compression activée, sinon fallback SSD Studio), regroupés dans un même dossier Gofile (via `parentFolder` + `guestToken`). Le dossier temporaire de compression est nettoyé avant chaque run pour éviter les résidus.

Les pourcentages sont indicatifs ; la progression globale est calculée dans `main.js` via `updateGlobalProgress` et renvoyée au renderer via `workflow-progress`.

### 5.2 Nomenclature des projets

Format : `AAAAMMJJL_FORMAT_SUJET_INITIALES`  
Exemple : `250218A_ITW_Orelsan_MP`

- **Date** : AAMMJJ (2 chiffres année, mois, jour).  
- **Lettre** : A, B, C… (incrémentation **globale** sur tous les chemins SSD Perso des paramètres et des profils, pour éviter les doublons entre utilisateurs).  
- **Format** : code (BP, ITW, CEXP, etc.) avec libellés définis dans `nomenclature.js`.  
- **Sujet** : en majuscules, espaces remplacés par `_`.  
- **Initiales** : issues du profil sélectionné ou saisies manuellement.

Fichiers multiples : les vidéos sont nommées `NomProjet_1.mp4`, `NomProjet_2.mp4`, etc. (SSD Perso et SSD Studio).

### 5.3 Fichiers pris en compte

- **Vidéo** : extensions configurables via `allowedVideoExtensions` dans settings.json (par défaut : .mp4, .mov). Gérable dans les Paramètres.  
- **Filtrage au scan** : fichiers < 1 Mo exclus, fichiers commençant par « Rendered - » exclus. En mode MultiCam (Organizer), .wav et .mp3 sont ajoutés automatiquement.
- **Tri** : projets Monday triés par date de tournage croissante ; fichiers source triés par taille décroissante.

### 5.4 Options du workflow

- Compresser les vidéos avec HandBrake (désactivé si HandBrakeCLI absent).  
- Uploader vers NAS après compression.  
- Vérifier l’intégrité (checksums).  


---

## 6. Profils utilisateur

- **Accueil** : choix du profil (grille de cartes, profils archivés masqués). Un profil peut être créé, modifié, archivé (remplace la suppression).  
- Chaque profil peut définir : **nom**, **initiales**, **email**, **chemin SSD Perso**, **photo**, **palette de couleurs**, **thème** (clair/sombre).  
- Champs spéciaux : `archived` (masqué de l’accueil, restaurable depuis les Paramètres), `isAdmin` (accès à la section Administration).  
- Lorsqu’un profil est sélectionné, ses **initiales** et son **chemin SSD Perso** sont utilisés pour le workflow.  
- Si un profil a un **email**, des notifications mail automatiques sont envoyées (succès, arrêt, récap batch) via Resend.  
- **Section Admin** (visible pour `isAdmin: true`) : clé API Resend (avec bouton test), gestion des profils archivés (restauration).

---

## 7. Queue BATCH

- Depuis la vue Workflow, un workflow peut etre **ajoute a la queue BATCH** (memes criteres de validation que « Demarrer le workflow »). Le nom du profil est stocke directement sur l'item (`profileName`) pour garantir sa disponibilite pendant le batch.
- Par defaut, l'option **Upload vers NAS** est cochee pour les elements ajoutes en batch.
- La vue **Queue BATCH** liste les workflows en attente et permet de **demarrer la queue** (execution sequentielle), **arreter le batch** (modale de confirmation, `abortWorkflow()`, items restants marques `cancelled`) ou **vider la queue**.
- **Item actif enrichi** : pendant l'execution, l'item en cours affiche le nom de l'etape (Copie SSD, Compression, etc.) + pourcentage global + barre fine + to-do list fichiers avec pastilles colorees et cercle SVG progressif. Les donnees proviennent de `state.workflowState.fileTodo`, alimente via `updateFileTodoFromProgress(data)` dans le listener batch.
- **Statuts possibles** : `pending`, `running`, `completed`, `partial`, `failed`, `cancelled`.
- **Ecran Batch termine** (`batchCompleteView`) : GIF de celebration, recapitulatif (nombre de projets par statut, tableau detaille avec nom/destinations Perso-Studio-NAS/poids/statut, duree totale calculee depuis `state.batchQueue.startTime`), bouton « Nouveau batch » (vide la queue et retourne a la vue batch).

---

## 8. Interface utilisateur

### 8.1 Vues principales

- **Accueil** : sélection du profil, bouton « Ajouter un profil ».  
- **Workflow** : formulaire projet (format, sujet, initiales), prévisualisation du nom, sélection des fichiers, options (compression, NAS, intégrité, audio), vérification, boutons « Démarrer le workflow » et « Ajouter à la queue BATCH ».  
- **Queue BATCH** : liste de la queue, demarrage / arret (modale de confirmation) / vidage. Item actif enrichi (etape + to-do list fichiers).
- **Paramètres** : chemins SSD Perso / SSD Studio, configuration NAS (SMB ou SFTP), test de connexion, enregistrement.  
- **Historique** : liste des opérations avec filtre par profil, actualisation, effacement.

Vues dédiées au run :

- **Workflow en cours** : barre de progression globale (pourcentage, ETA, détail), sections COPIE / COMPRESSION / TRANSFERT NAS / ENVOI GOFILE, to-do list par fichier avec pastilles colorées et cercles SVG progressifs, bouton « Arrêter le workflow ».  
- **Workflow termine** : GIF de celebration (assets/GIF), boutons « Retour a l'accueil » et « Quitter », option Gofile (lien centre ou bouton manuel).
- **Batch termine** (`batchCompleteView`) : GIF de celebration, recap (projets par statut, tableau detaille nom/destinations/poids/statut, duree totale), bouton « Nouveau batch ».

### 8.2 Contrôles et comportements

- **Barre de titre** : personnalisée (titleBarStyle hidden, frame false).  
- **Thème** : clair / sombre (bouton dans la barre).  
- **Quitter** : si un workflow est en cours, une modale demande confirmation ; sinon fermeture normale. Le main peut forcer la sortie (y compris gestion Terminal sous macOS après « Quitter »).  
- **Jingle** : 4 jingles selon l’heure (matin 6h-12h, midi 12h-14h, après-midi 14h-19h, soir). Fichiers WAV dans `assets/`.
- **Arrêt du workflow** : mécanisme `AbortController` + `checkAborted()` injecté dans les boucles de copie et compression. Écran « Workflow interrompu » (`workflowAbortedView`) avec choix de supprimer ou conserver les fichiers copiés.
- **Modale d’erreur universelle** : modale COPY_ERROR en cas d’échec du workflow. Rapport d’erreur envoyé automatiquement par mail à l’admin.
- **Changelog** : clic sur le numéro de version dans la top bar pour afficher les notes de version.

### 8.3 Progression en temps réel

- Le main envoie des événements **workflow-progress** (étape, progression, progression globale, message, vitesse, ETA, octets traités, etc.).  
- Le renderer met à jour la barre globale, les barres par étape et les textes (pourcentages au-dessus des barres, détails par fichier pour copie/compression).

---

## 9. Dépendances externes et configuration

- **HandBrakeCLI** : recherché dans le PATH ou dans des chemins type `/usr/local/bin`, `/opt/homebrew/bin`. Indispensable pour la compression.  
- **NAS SMB** : le partage doit être **monté dans le Finder** ; l’app utilise le chemin local (ex. `/Volumes/Video`).  
- **NAS SFTP** : connexion directe (host, port, user, password / clé).  
- **Volumes SSD** : les chemins sont choisis dans Paramètres (ou par profil). La création de dossiers sur certains volumes montés utilise `mkdir -p` en shell pour éviter des erreurs de permissions (EACCES).

---

## 10. Fichiers clés du projet

| Fichier | Rôle |
|---------|------|
| `main.js` | Process principal, fenêtre, IPC, `execute-backup-workflow`, gestion `isWorkflowRunning`, initialisation des managers, HandBrake, profils, NAS, VPN (FortiClient). |
| `preload.js` | API exposée au renderer (settings, workflow, historique, profils, progression, contrôles fenêtre, quit, etc.). |
| `renderer.js` | Logique UI, état (`state`), vues, formulaire workflow, batch queue, progression, profils, paramètres, historique. |
| `index.html` | Structure des vues, formulaires, modales (profil, confirmation quitter), splash, audio jingle. |
| `styles.css` | Thèmes, mise en page, barres de progression, cartes profils, batch, modales. |
| `modules/storage.js` | `copyToSSDPerso`, `copyToSSDStudio` (dossier projet, pas de ZIP), `copyToBothDestinations`, `createProjectZip`, gestion volumes. |
| `modules/compression.js` | HandBrakeCLI, création ZIP NAS (vidéos compressées + audio optionnel), callbacks de progression. |
| `modules/nomenclature.js` | `generateProjectName`, `getNextLetter` (avec `additionalPaths` pour globalité), formats. |
| `modules/metadata.js` | Historique, métadonnées projets, CRUD profils (archivage/restauration, email, isAdmin), fichiers JSON dans `data/`. |
| `modules/mailer.js` | Notifications mail via Resend (succès, arrêt, erreur admin, récap batch). |
| `modules/upload.js` | Config SMB/SFTP, `uploadProjectArchive`, progression. |
| `modules/import.js` | Détection sources, scan, checksum, vérification intégrité. |
| `modules/progress-tracker.js` | Suivi octets / total, %, vitesse, ETA. |

---

## 11. Évolutions prévues (hors scope actuel)

- **Mode backup ATEM** : prise en charge des fichiers provenant de l’ATEM (stockés sur disque T7) avec une option de backup **sans ISO**, à préciser ultérieurement.

---

*Ce document décrit l’état actuel de la version Studio de BackupFlow et sert de référence pour les développements futurs.*
