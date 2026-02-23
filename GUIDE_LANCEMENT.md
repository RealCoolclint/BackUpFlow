# 🚀 Guide de Lancement - BackupFlow

## ✅ Méthode la plus simple : Double-clic

### Pendant le développement

1. **Double-cliquez sur** `Lancer BackupFlow.command`
2. C'est tout ! L'application s'ouvre dans une fenêtre graphique

**Note** : La première fois, macOS peut demander une autorisation. Cliquez sur "Ouvrir" dans les Préférences Système > Sécurité.

---

## 📦 Après avoir créé l'application (.dmg)

Une fois que vous avez exécuté `npm run build:mac` :

1. **Double-cliquez** sur `BackupFlow-1.0.0.dmg` dans le dossier `dist/`
2. **Glissez-déposez** l'icône BackupFlow vers le dossier Applications
3. **Lancez** BackupFlow depuis Applications (comme n'importe quelle app Mac)
4. **Plus besoin de Terminal !** L'application est autonome

---

## 🛠️ Si vous préférez créer une application .app personnalisée

1. Ouvrez Terminal une seule fois
2. Allez dans le dossier du projet
3. Exécutez :
   ```bash
   ./scripts/create-app-launcher.sh
   ```
4. Une application `BackupFlow.app` sera créée dans `~/Applications`
5. Double-cliquez dessus pour lancer (comme une app normale)

---

## ❓ Problèmes courants

### "Impossible d'ouvrir car non identifié"
- Allez dans **Préférences Système > Sécurité et confidentialité**
- Cliquez sur **"Ouvrir quand même"** à côté du message d'avertissement

### "Node.js n'est pas installé"
- Téléchargez Node.js depuis [nodejs.org](https://nodejs.org/)
- Installez-le normalement
- Relancez `Lancer BackupFlow.command`

### Le fichier .command ne s'ouvre pas
- Faites un clic droit > **Ouvrir avec** > **Terminal**

---

## 💡 Astuce

Après le premier build (`npm run build:mac`), l'application dans le `.dmg` est **autonome** et ne nécessite plus Node.js ni Terminal. C'est la version finale pour distribution.

