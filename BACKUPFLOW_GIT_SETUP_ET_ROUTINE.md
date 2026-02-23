# BACKUPFLOW STUDIO — Git : Mise en place et routine
**Date :** 23 février 2026  
**Contexte :** Mise en place du versioning Git pour BackUpFlow Studio V1

---

## Pourquoi Git ?

Sans Git, le code n'existe que sur le SSD externe. Si le SSD tombe en panne, tout disparaît. Si une modification casse l'app, il n'y a aucun filet.

Git prend des **photos du projet** (commits) à chaque étape. On peut revenir à n'importe quelle photo en une commande. Le dépôt est aussi synchronisé sur GitHub (cloud privé), ce qui garantit une double sauvegarde.

---

## Vocabulaire essentiel

| Terme | Définition simple |
|---|---|
| **Dépôt (repository)** | Le dossier du projet + tout son historique de photos |
| **Commit** | Une photo de l'état du code à un instant T, avec un message descriptif |
| **Branche** | Une copie parallèle du projet pour tester sans toucher à la version stable |
| **Push** | Envoyer les commits locaux vers GitHub |
| **main** | La branche principale — la version stable que l'équipe utilise |

---

## Ce qui a été mis en place

### Dépôt local
- Git initialisé dans `/Volumes/BACKUP PRO/Outils/App Persos/BackUpFlow Studio`
- Branche principale nommée `main`
- Fichier `.gitignore` configuré pour exclure les dossiers inutiles

### Dossiers ignorés par Git (`.gitignore`)
```
node_modules/   ← dépendances npm, trop lourdes et régénérables
dist/           ← résultat du build, régénérable
tmp/            ← fichiers temporaires
logs/           ← journaux d'erreurs
data/           ← données utilisateur (profils, historique) — propres à chaque machine
*.log           ← tous les fichiers de log
.DS_Store       ← fichiers cachés macOS inutiles
```

### Premier commit
- **Message :** `V1 validée en production - build du 23/02/2026`
- **Contenu :** 73 fichiers, 22 241 lignes de code
- **Identifiant :** `a7d891b`

### Dépôt GitHub
- **URL :** https://github.com/RealCoolclint/backupflow-studio
- **Visibilité :** Privé
- **Synchronisation :** Code envoyé avec succès (50 Mo)

---

## Configuration Git (faite une seule fois)

```bash
git config --global user.name "Martin Pavloff"
git config --global user.email "pavloffmartin@gmail.com"
```

---

## Routine à observer après chaque session de travail sur Cursor

Après chaque session de développement, avant de fermer Cursor, exécuter ces 4 commandes dans le Terminal :

```bash
# 0. Se placer dans le bon dossier (toujours vérifier)
cd "/Volumes/BACKUP PRO/Outils/App Persos/BackUpFlow Studio"

# 1. Voir ce qui a changé
git status

# 2. Préparer tous les fichiers modifiés
git add .

# 3. Prendre une photo avec un message descriptif
git commit -m "Description claire de ce qui a été fait"

# 4. Envoyer sur GitHub
git push
```

### Exemples de bons messages de commit
```
"Correction bug récapitulatif batch - affichage 3 destinations"
"Ajout fonctionnalité Sessions V2"
"Activation Organizer MultiCam"
"Amélioration UX écran de progression"
"Fix crash au démarrage sans VPN"
```

**Règle d'or :** un commit = une tâche. Ne pas mélanger plusieurs modifications dans un seul commit.

---

## Commandes utiles à connaître

```bash
# Voir l'historique des commits
git log --oneline

# Voir le détail des modifications en cours
git diff

# Annuler les modifications d'un fichier (avant commit)
git checkout -- nom-du-fichier.js
```

---

## Structure des branches

```
main    →  V1 stable (build du 23/02/2026) ✅  ← ne jamais développer directement ici
v2-dev  →  développements futurs V2 ✅          ← toujours travailler ici
```

### Règle fondamentale
On ne touche **jamais** à `main` directement. Tout développement se fait sur `v2-dev`. Quand la V2 est stable et validée en production, on fusionne `v2-dev` dans `main`.

### Vérifier sur quelle branche on est
```bash
git branch
```
L'étoile `*` indique la branche active. Toujours vérifier avant de commencer à travailler.

### Basculer entre les branches
```bash
# Aller sur v2-dev (développement)
git checkout v2-dev

# Aller sur main (version stable)
git checkout main
```

### Chantiers prévus sur v2-dev
- Sessions : toggle "Afficher projets backupés", SESSION_02, nomenclature mode session
- Résilience : modale erreur universelle, reprise queue NAS, bouton "Relancer NAS"
- Récap batch : afficher les 3 destinations (SSD Perso, SSD Studio, NAS)
- MultiCam / Organizer : en pause, manque de sources pour tester
- SortPilot : organisation automatique des médias dans Premiere Pro

---

## En cas de problème d'authentification GitHub

GitHub n'accepte pas les mots de passe classiques. Il faut utiliser un **Personal Access Token** :

1. GitHub → Photo de profil → Settings
2. Developer settings → Personal access tokens → Tokens (classic)
3. Generate new token (classic) → cocher `repo` → Generate
4. Copier le token `ghp_...` et l'utiliser comme mot de passe dans le Terminal

---

## Schéma de sauvegarde actuel

```
Cursor (code)
     ↓ git add + git commit
SSD externe (dépôt local)
     ↓ git push
GitHub privé (cloud)
```

Double protection : si le SSD tombe, GitHub sauvegarde tout. Si le code est cassé, on revient à n'importe quel commit précédent.
