# BackUpFlow Studio – Documentation interface & UX

Design system aligné avec les autres applications maison (Transporter, Launcher). Gestion des profils : bannière personnalisable, photo cliquable, destinations SSD par profil.

*Documentation alignée sur la version stable actuelle.*

---

## 1. Palette

- **Palette limitée** : 3 couleurs — Bleu (accent), Noir/Gris foncé (fond sombre), Blanc/Gris clair (fond clair).
- **Fonds** : --bg-primary, --bg-secondary, --bg-tertiary, --bg-elevated.
- **Texte** : --text-primary, --text-secondary, --text-tertiary.
- **Accent** : --color-primary (#2563eb), --accent, --accent-hover, --accent-light.
- **États** : --success, --warning, --danger (+ variantes -light).
- **Bordures / Ombres** : --border, --shadow, --shadow-md, --shadow-lg.
- **Radius** : --radius-sm, --radius, --radius-md, --radius-lg, --radius-xl, --radius-full.
- **Sidebar / top bar** : --sidebar-bg (--color-dark), --sidebar-bg-hover, --sidebar-text, --sidebar-border.
- **Bannière profil** : --profile-primary, --profile-secondary, --profile-accent (définis par profil : color1, color2, color3).

---

## 2. Typographie

- **Lato** : titres, header, labels uppercase, boutons, noms.
- **Open Sans** : descriptions, champs, métadonnées, feedback.
- Titres écran : `.view h2` (uppercase, letter-spacing 2px, 2.25em).
- Sous-titres : `.home-subtitle`, `.batch-subtitle` (text-secondary).

---

## 3. Version (affichage)

- **Format** : **V1.DD.MM.AA** (jour, mois, année à 2 chiffres).
- **Calcul** : dans **index.html** (script inline `window.APP_VERSION`), utilisé par **renderer.js** (`getAppVersion()`), appliqué au chargement (`applyVersionToUI()`).
- **Affichage** :
  - **Splash** : sous le logo (`#splashScreen .splash-version`, `#splashVersion`), blanc 100 %, text-shadow pour visibilité sur fond noir, margin-top 12px.
  - **Header** : à droite du logo (`.app-version`, `#appVersion`), margin-left 12px, couleur `--sidebar-text` (toujours blanc, top bar sombre). **Cliquable** → ouvre la modale changelog (`#changelogModal`).

---

## 4. Composants

- **Barre de titre macOS** : `.title-bar` (40px, drag, `-webkit-app-region: drag`).
- **Header** : `.top-bar` — `.top-bar-brand` (**logo BackUpFlow** `assets/LOGO.png` + **version** cliquable), `.top-bar-nav` (boutons ACCUEIL, WORKFLOW, QUEUE BATCH, PARAMÈTRES, HISTORIQUE), `.top-bar-actions` (pastille NAS `.nas-indicator` avec `color: var(--text-primary)`, **MODE SOMBRE/CLAIR**, QUITTER).
- **Bannière de profil** : `.profile-header` (pleine largeur, entre header et main), `.profile-header-content`, `.profile-header-info` — **photo** (`.profile-header-photo`, 60×60, cliquable → modale config), `.profile-header-name`, `.profile-header-initiales`. Dégradé selon --profile-primary / --profile-secondary.
- **Boutons** : .btn, .btn-primary, .btn-secondary, .btn-ghost, .btn-danger, .btn-success, .btn-sm.
- **Formulaires** : .input, .select, .form-group, .form-grid, .field-group, .path-input-group.
- **Checkbox** : .checkbox-label.
- **Modales** : .modal, .modal-content, .modal-header, .modal-body, .modal-footer, .modal-close.
- **Barres de progression** : .progress-bar, .progress-bar-container, .global-progress-*, .workflow-task-bar.

---

## 5. Splash

- **Structure** : `#splashScreen.splash-screen` > `.splash-logo-container` (flex column) > logo (`.splash-logo`, `assets/LOGO.png`) + **`.splash-version`** (#splashVersion).
- **Animation** (~3,7 s) : fond noir, logo fondu + zoom 0,9→1,1 ; phase finale : logo disparaît, affichage de `.app-container`.
- **Jingle** : 4 jingles selon l'heure — `#jingleMatin` (6h-12h, JINGLE BCUPFLX.wav), `#jingleMidi` (12h-14h), `#jingleAprem` (14h-19h), `#jingleSoir` (19h-6h). Volume 0.7.
- **Version** : affichee sous le logo (blanc 100 % `rgba(255,255,255,1)`, bien visible sur fond noir quel que soit le theme).

---

## 6. Écran de sélection des profils (Accueil)

- **Conteneur** : `.home-container`, titre « Choisissez votre profil », sous-titre « Sélectionnez un profil pour pré-remplir vos informations de projet ».
- **Grille** : `.profiles-grid` — cartes profils actifs uniquement (archivés masqués). Photo ou placeholder avec initiales, nom, initiales, email si présent (`.profile-email`).
- **Cartes** : `.profile-card` ; hover : translateY(-4px), bordure accent, barre supérieure scaleX. Badge `.profile-admin-badge` (ADMIN) en haut à gauche si `isAdmin: true`.
- **Actions** : « + Ajouter un profil ». Menu contextuel (⋯) sur hover : Modifier, Archiver (remplace Supprimer — modale de confirmation).
- **Photo** : `.profile-photo` (100×100, cercle) ou `.profile-photo-placeholder`.

---

## 7. Bannière de profil

- **Emplacement** : entre le header et le contenu principal (`.main-content`), **pleine largeur** de la fenêtre.
- **Contenu** : `.profile-header-content` (max-width 1400px, centré) — **photo** 60×60 (cercle, cliquable, titre « Modifier le profil »), **nom** (uppercase), **initiales** entre guillemets.
- **Style** : dégradé linear-gradient(135deg, color1, color2), bordure basse, texte blanc. Photo : bordure 3px accent, hover scale 1.05.
- **Affichage** : visible uniquement quand un profil est choisi (cachée via `display: none` sur l'accueil sans profil). Variable CSS --profile-primary, --profile-secondary, --profile-accent appliquées dynamiquement.

---

## 8. Vue Workflow

- **Conteneur** : `.workflow-container`, titre « Workflow de Backup ».
- **Étapes** : `.workflow-step` (data-step 1-4) — `.step-header` (numéro dans cercle, titre, statut), `.step-content`.
- **Étape 1** :
  - **Toggle source** : `.monday-mode-toggle-wrapper` — toggle pill MONDAY / MANUEL (`.toggle-pill`, `#mondayModeToggle`) ; préférence mémorisée par profil.
  - **Mode Monday** : `#mondayProjectSection` — select `#mondayProjectSelect` (liste projets), `#mondayProjectStatus` (chargement, erreurs, lien vers Paramètres), bouton « Réessayer » `#mondayRetryBtn`. Sélection → pré-remplissage Sujet, Format, Date de tournage.
  - **Champs projet** : format (select), sujet, initiales ; aperçu nom généré (`.project-name-display`). L'acronyme du format est retiré du sujet pour éviter la redondance.
- **Étape 2** : bouton « Sélectionner fichiers », liste `.files-list`.
- **Étape 3** : checkboxes (compression HandBrake, upload NAS, vérification intégrité, audio backup).
- **Étape 4** : `.verification-info` (résumé).
- **Actions** : « Démarrer le workflow », « Ajouter à la queue BATCH ».
- **Progression** : `.global-progress-container`, `.progress-bar-container.global-bar`, `.progress-steps`, `.workflow-summary`.

---

## 9. Vue Workflow en cours

- **Barre ancrée** : `.global-progress-sticky` (position fixed, top 0) — pourcentage, ETA, barre de progression, détails et données (MB traités).
- **Sections** : `.workflow-sections` — COPIE, COMPRESSION, TRANSFERT VERS LE NAS, ENVOI GOFILE (`.workflow-section-gofile` visible si pertinent).
- **Taches** : `.workflow-task` — label, pourcentage, barre, details (debit, ETA).
- **To-do list par fichier** (`.file-todo-list`) : pastilles colorees (gris #888 = pending, bleu #3b82f6 = active, vert #22c55e = completed, rouge #ef4444 = error), cercle SVG progressif (`.file-todo-circle`) remplacant la mini barre lineaire, statut « OK » / « Erreur ».

---

## 10. Vue Workflow terminé

- **GIF** : `.celebration-gif-container` > `.celebration-gif` (aléatoire depuis assets/GIF).
- **Actions** : « RETOUR À L'ACCUEIL », « QUITTER ».
- **Message erreur Monday** : `#mondayUpdateErrorMsg` (`.monday-update-error-msg`) — affiché si la mise à jour automatique de l'item Monday (Phase B) échoue ; message discret avec rappel du statut cible (3 - BACKUPÉ).
- **Gofile** : section affichee si « Proposer l'envoi Gofile en fin de travail » ou envoi auto active. En mode auto : lien (texte blanc) si succes, message d'erreur si echec, « Gofile non disponible » sinon — jamais de bouton manuel. En mode propose : bouton d'envoi manuel. Zone resultat centree (`#gofile-result-zone`), boutons uniformes (fond bleu fonce, texte blanc).

---

## 10b. Vue Workflow interrompu

- **Vue** : `#workflowAbortedView` (`.workflow-aborted-container`).
- **Contenu** : icone d'avertissement (`.workflow-aborted-icon`), titre « Workflow interrompu » (`.workflow-aborted-title`), nom du projet (`.workflow-aborted-project`).
- **Actions** (`.workflow-aborted-actions`) : « Supprimer les fichiers copiés » (`#workflowAbortedDeleteBtn`, btn-danger), « Conserver les fichiers copiés » (`#workflowAbortedKeepBtn`, btn-secondary), « Quitter l'application » (`#workflowAbortedQuitBtn`, btn-ghost).
- **Comportement** : les chemins SSD Perso/Studio sont stockés dans `state._abortedPaths`. Supprimer efface les dossiers via IPC `removeFolder`. Mail d'interruption envoyé dans les trois cas si email configuré.

---

## 11. Paramètres

- **Titre** : « Paramètres ».
- **Structure** : `.settings-container` — sections `.settings-section` (Destinations SSD Perso/Studio, Connexion NAS, Gofile, Monday.com). **Section Admin** (`#adminSection`, visible si `isAdmin: true`) : clé API Resend (`#resendApiKey`) + bouton « Tester » (`#testResendBtn`), liste des profils archivés (`#archivedProfilesList`) avec bouton « Restaurer » par profil.
- **Monday.com** : clé API (`#mondayApiToken`), Board ID (`#mondayBoardId`) avec lien aide, bouton « Tester la connexion » ; résultat dans `#mondayTestResult` (succès avec nom du board, ou erreurs explicites : auth, board introuvable, réseau).
- **Gofile** : deux options — « Envoyer automatiquement vers Gofile (intégré au workflow) » et « Proposer l'envoi Gofile en fin de travail ».
- **Formulaires** : champs chemin avec bouton Parcourir (`.path-input-group`), select protocole NAS (SMB/SFTP), champs SFTP (host, port, user, password, chemin).
- **Footer** : « Enregistrer les paramètres ».
- **Scroll** : zone dans `.main-content` (overflow-y: auto).

---

## 12. Modale profil

- **Champs** : Nom du profil *, Initiales *, **Adresse e-mail** (`#profileEmail`, type email, placeholder), **Destination disque perso** (chemin + Parcourir), **Destination disque studio** (chemin + Parcourir + Réinitialiser ; si vide, utilise le dossier des Paramètres), **Photo de profil** (aperçu `.profile-photo-preview`, Choisir / Supprimer), **Palette de couleurs** (color1, color2, color3 via `.color-picker`), Mode par défaut (Sombre/Clair).
- **Actions** : Annuler, Enregistrer. Menu dropdown sur carte : Modifier, Archiver.
- Photo et couleurs enregistrées dans le profil ; la bannière se met à jour immédiatement après sauvegarde.

---

## 13. Queue BATCH (affichage)

- **Vue** : `#batchView` — liste des items (`.batch-queue-item`), controles (Demarrer / Arreter / Vider).
- **Item actif** (`.batch-queue-item.running`) : bloc enrichi (`.batch-running-detail`) contenant :
  - Ligne etape : nom de l'etape en cours (Copie SSD, Compression, ZIP NAS, Upload NAS, Envoi Gofile) + pourcentage global (`.batch-running-step`).
  - Barre de progression fine (4 px).
  - To-do list fichiers (`.batch-running-todo`) : reutilise les classes `.file-todo-item`, `.file-todo-dot`, `.file-todo-circle` (pastilles colorees + cercle SVG progressif). Noms tronques a 40 caracteres. Cas Gofile : resume texte (`.batch-todo-summary`).
- **Statuts items** : pending, running, completed, partial, failed, cancelled. Le statut `cancelled` (opacity 0.6, bordure grise) est applique aux items non executes apres arret du batch.
- **Bouton « Arreter le batch »** (`#stopBatchBtn`) : visible uniquement pendant l'execution. Ouvre `#stopBatchConfirmModal` (modale de confirmation). Si confirme : `stopRequested = true` + `abortWorkflow()`, items restants marques « cancelled ».
- **Donnees** : `state.batchQueue` contient `items`, `currentIndex`, `isRunning`, `stopRequested`, `startTime`. Chaque item stocke `profileName` (fallback pour mise a jour Monday).

## 13b. Ecran Batch termine

- **Vue** : `#batchCompleteView` — meme structure que l'ecran final workflow classique.
- **GIF** : `#batchCelebrationGifContainer` > `#batchCelebrationGif` (aleatoire depuis assets/GIF).
- **Recap** (`#batchCompleteRecap`, `.batch-complete-recap`) :
  - En-tete : nombre de projets traites + duree totale (`state.batchQueue.startTime` → `Date.now()`).
  - Compteurs par statut : complet (vert), partiel (orange), echoue (rouge), annule (gris).
  - Tableau `.batch-recap-table` par projet : Nom, Destinations (Perso / Studio / NAS sur lignes separees avec chemins courts — 2 derniers segments), Poids, Statut colore.
- **Action** : bouton « Nouveau batch » (`#newBatchBtn`) — vide la queue, remet `startTime` a null, retourne a la vue batch.

## 14. Modales système

- **Alerte espace disque** : `#diskSpaceAlertModal` — message, détails par disque, « J'ai compris ».
- **Confirmation quit** : `#quitConfirmModal` — message workflow en cours, « Annuler », « Quitter quand même ».
- **Confirmation arrêt batch** : `#stopBatchConfirmModal` — « Le workflow en cours sera interrompu immédiatement », « Annuler », « Confirmer l'arrêt ».
- **Changelog** : `#changelogModal` (`.changelog-modal-content`, max-width 480px, max-height 70vh, scrollable). Entrées versionnées (`.changelog-entry`) avec version (`.changelog-version`, couleur primary), date (`.changelog-date`), liste de notes (`.changelog-notes`). Fermeture par bouton ou Escape.
- **Erreur workflow** : modale d'erreur universelle avec titre, explication vulgarisée, détails techniques (COPY_ERROR, GOFILE_TIMEOUT, etc.). Rapport d'erreur envoyé automatiquement par mail à l'admin.

---

## 15. Navigation et raccourcis

- **Top bar** : boutons `.nav-btn` avec `data-view` (home, workflow, batch, settings, history). Classe `.active` sur le bouton correspondant à la vue affichée.
- **Thème** : bouton `.theme-toggle` — bascule light/dark (classe `.dark-theme` sur body).
- **Scroll** : dans `.main-content` pour toutes les vues. Pas de scroll global sauf dans le contenu principal.

---

## 16. Responsive

- **Media 768px** : top-bar en wrap, nav en pleine largeur, form-grid en 1 colonne, profiles-grid en colonnes plus étroites (min 180px).
