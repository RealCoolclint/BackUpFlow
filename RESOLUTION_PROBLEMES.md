# 🔧 Résolution des problèmes courants

## ✅ Problème résolu : Electron ENOENT

**Erreur** :
```
Error: spawn /Users/.../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron ENOENT
```

**Cause** : Le binaire Electron n'était pas installé correctement lors de `npm install`.

**Solution appliquée** :
1. ✅ Suppression et réinstallation d'Electron : `npm install electron --save-dev`
2. ✅ Vérification que le binaire existe maintenant
3. ✅ Suppression des flags de quarantaine macOS
4. ✅ Mise à jour du script de lancement pour vérifier automatiquement Electron

**Prévention** : Le script `Lancer BackupFlow.command` vérifie maintenant automatiquement la présence d'Electron et le réinstalle si nécessaire.

## ✅ Problème résolu : Gatekeeper macOS

**Erreur** :
```
Apple n'a pas pu confirmer que « Lancer BackupFlow.command » ne contenait pas de logiciel malveillant
```

**Solution** :
1. Exécutez `./fixer-permissions.sh` une fois
2. Ou : Clic droit → "Ouvrir" → "Ouvrir" dans la boîte de dialogue

## 🚀 État actuel

- ✅ Electron : Installé et fonctionnel
- ✅ Node.js : Installé
- ✅ npm : Installé
- ✅ Permissions : Corrigées
- ⚠️  HandBrakeCLI : Non installé (optionnel, nécessaire uniquement pour compression vidéo)

## 📝 Commandes utiles

**Réinstaller Electron manuellement** :
```bash
cd "/Users/studiovideo/Desktop/Apps Customs/BackUp"
rm -rf node_modules/electron
npm install electron --save-dev
```

**Vérifier l'installation d'Electron** :
```bash
test -f "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" && echo "✅ Electron OK" || echo "❌ Electron manquant"
```

**Lancer l'application** :
```bash
cd "/Users/studiovideo/Desktop/Apps Customs/BackUp"
npm start
```

Ou double-cliquez sur `Lancer BackupFlow.command`













