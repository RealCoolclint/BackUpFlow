const { app, BrowserWindow, ipcMain, dialog, Notification, shell } = require('electron');
const path = require('path');
const { exec, spawn, execSync } = require('child_process');
const fs = require('fs-extra');
const https = require('https');
const FormData = require('form-data');
const { promisify } = require('util');
const os = require('os');

// Modules
const NomenclatureManager = require('./modules/nomenclature');
const ImportManager = require('./modules/import');
const StorageManager = require('./modules/storage');
const CompressionManager = require('./modules/compression');
const UploadManager = require('./modules/upload');
const MetadataManager = require('./modules/metadata');
const NASConnector = require('./modules/nas-connector');
const MailerManager = require('./modules/mailer');

const execAsync = promisify(exec);
const { version: appVersion } = require('./package.json');
const { readLauncherSession } = require('./modules/session-reader');

let mainWindow;
let nomenclatureManager;
let importManager;
let storageManager;
let compressionManager;
let uploadManager;
let metadataManager;
let nasConnector;
let mailerManager;
let handbrakePath = null;
let isWorkflowRunning = false;
let workflowAbortController = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true // Garder la sécurité web activée
    },
    // Sur macOS, utiliser 'hidden' avec frame false pour avoir une fenêtre complètement personnalisée
    // Cela évite l'affichage des traffic lights natifs macOS
    titleBarStyle: 'hidden',
    frame: false,
    backgroundColor: '#1e1e1e'
  });

  mainWindow.loadFile('index.html');

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
  
  // Gérer les contrôles de fenêtre personnalisés
  mainWindow.webContents.on('dom-ready', () => {
    // Les contrôles seront gérés via IPC depuis le renderer
  });
  
  // Jouer le jingle d'ouverture une fois la page complètement chargée
  mainWindow.webContents.on('did-finish-load', () => {
    // Exécuter le script pour jouer le jingle dans le renderer
    mainWindow.webContents.executeJavaScript(`
      (function() {
        try {
          const startupJingle = document.getElementById('startupJingle');
          if (startupJingle) {
            startupJingle.volume = 0.7;
            startupJingle.play().catch(err => console.log('Jingle play error:', err));
          }
        } catch (error) {
          console.log('Jingle error:', error);
        }
      })();
    `).catch(err => console.log('Erreur exécution jingle:', err));
  });
}


// Handlers pour les contrôles de fenêtre
ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

// Vérifier si un workflow est en cours
ipcMain.handle('is-workflow-running', () => {
  return isWorkflowRunning;
});

// Arrêter le workflow en cours
ipcMain.handle('abort-workflow', async () => {
  if (workflowAbortController) {
    workflowAbortController.abort();
  }
  isWorkflowRunning = false;
  // Kill any HandBrakeCLI processes
  try {
    execSync('pkill -f HandBrakeCLI', { stdio: 'ignore', timeout: 2000 });
  } catch { /* no HandBrakeCLI running */ }
  return { success: true };
});

// Supprimer un dossier (pour nettoyage après arrêt workflow)
ipcMain.handle('remove-folder', async (event, folderPath) => {
  if (!folderPath) return { success: false, error: 'Chemin vide' };
  try {
    await fs.remove(folderPath);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Forcer la fermeture (après confirmation utilisateur)
ipcMain.on('force-quit', () => {
  isWorkflowRunning = false; // Réinitialiser l'état
  // Continuer avec la fermeture normale
  const windows = BrowserWindow.getAllWindows();
  windows.forEach(win => {
    if (win && !win.isDestroyed()) {
      win.close();
    }
  });
  app.quit();
  
  // Fermer Terminal directement avec kill -9 (méthode Tranporter)
  if (process.platform === 'darwin') {
    const isTerminal = process.env.TERM_PROGRAM === 'Apple_Terminal' || 
                       process.env.TERM_PROGRAM === 'iTerm.app';
    
    if (isTerminal) {
      try {
        const { execSync } = require('child_process');
        
        let terminalPid;
        try {
          if (process.env.TERM_PROGRAM === 'Apple_Terminal') {
            terminalPid = execSync('pgrep -x Terminal', { encoding: 'utf8' }).trim();
          } else if (process.env.TERM_PROGRAM === 'iTerm.app') {
            terminalPid = execSync('pgrep -x iTerm2', { encoding: 'utf8' }).trim();
          }
        } catch (e) {
          try {
            const psOutput = execSync(`ps aux | grep -i "Terminal.app" | grep -v grep | awk '{print $2}' | head -1`, { encoding: 'utf8' }).trim();
            if (psOutput) terminalPid = psOutput;
          } catch (e2) {
            // Ignorer
          }
        }
        
        if (terminalPid) {
          execSync(`kill -9 ${terminalPid}`, { stdio: 'ignore', timeout: 1000 });
        } else {
          const script = `tell application "Terminal" to quit saving no`;
          execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { 
            timeout: 2000,
            stdio: 'ignore'
          });
        }
      } catch (error) {
        // Ignorer les erreurs
      }
    }
  }
  
  setTimeout(() => {
    process.exit(0);
  }, 300);
});

// Quitter l'application complètement
// Inspiré de Tranporter : ferme Terminal avec kill -9 pour éviter les confirmations
ipcMain.on('app-quit', () => {
  // Vérifier si un workflow est en cours
  if (isWorkflowRunning) {
    // Demander confirmation à l'utilisateur
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('confirm-quit-during-workflow');
    }
    return; // Ne pas quitter immédiatement
  }
  // Fermer toutes les fenêtres Electron d'abord
  const windows = BrowserWindow.getAllWindows();
  windows.forEach(win => {
    if (win && !win.isDestroyed()) {
      win.close();
    }
  });
  
  // Quitter l'application
  app.quit();
  
  // Fermer Terminal directement avec kill -9 (méthode Tranporter)
  if (process.platform === 'darwin') {
    const isTerminal = process.env.TERM_PROGRAM === 'Apple_Terminal' || 
                       process.env.TERM_PROGRAM === 'iTerm.app';
    
    if (isTerminal) {
      try {
        const { execSync } = require('child_process');
        
        // Méthode Tranporter : trouver le PID de Terminal et le tuer directement
        let terminalPid;
        try {
          if (process.env.TERM_PROGRAM === 'Apple_Terminal') {
            terminalPid = execSync('pgrep -x Terminal', { encoding: 'utf8' }).trim();
          } else if (process.env.TERM_PROGRAM === 'iTerm.app') {
            terminalPid = execSync('pgrep -x iTerm2', { encoding: 'utf8' }).trim();
          }
        } catch (e) {
          // Si pgrep ne trouve rien, essayer avec ps
          try {
            const psOutput = execSync(`ps aux | grep -i "Terminal.app" | grep -v grep | awk '{print $2}' | head -1`, { encoding: 'utf8' }).trim();
            if (psOutput) terminalPid = psOutput;
          } catch (e2) {
            // Ignorer
          }
        }
        
        if (terminalPid) {
          // Tuer Terminal de manière forcée (évite la modale) - méthode Tranporter
          execSync(`kill -9 ${terminalPid}`, { stdio: 'ignore', timeout: 1000 });
        } else {
          // Fallback : AppleScript avec saving no
          const script = `tell application "Terminal" to quit saving no`;
          execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { 
            timeout: 2000,
            stdio: 'ignore'
          });
        }
      } catch (error) {
        // Ignorer les erreurs
      }
    }
  }
  
  // Forcer la fermeture du processus Node.js après un court délai
  setTimeout(() => {
    process.exit(0);
  }, 300);
});

app.whenReady().then(async () => {
  // Initialiser les managers
  await initializeManagers();
  global.launcherSession = await readLauncherSession();
  console.log('[Session] mode:', global.launcherSession.connected ? 'connecté' : 'standalone');
  createWindow();
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Gérer la fermeture de toutes les fenêtres
app.on('window-all-closed', (event) => {
  // Si un workflow est en cours, empêcher la fermeture
  if (isWorkflowRunning) {
    event.preventDefault();
    // Demander confirmation à l'utilisateur
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('confirm-quit-during-workflow');
    }
    return;
  }
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Intercepter before-quit pour protéger contre la fermeture pendant un workflow
app.on('before-quit', (event) => {
  if (isWorkflowRunning) {
    event.preventDefault();
    // Demander confirmation à l'utilisateur
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('confirm-quit-during-workflow');
    }
  }
});

async function initializeManagers() {
  // Dossier de données
  const dataDir = path.join(os.homedir(), '.backupflow');
  const settings = await loadSettings();
  
  // Initialiser les managers
  nomenclatureManager = new NomenclatureManager(
    settings.ssdPersoPath || path.join(os.homedir(), 'Backups')
  );
  importManager = new ImportManager();
  if (Array.isArray(settings.allowedVideoExtensions) && settings.allowedVideoExtensions.length > 0) {
    importManager.setAllowedExtensions(settings.allowedVideoExtensions);
  }
  storageManager = new StorageManager();
  compressionManager = null; // Sera initialisé quand HandBrake sera détecté
  uploadManager = new UploadManager();
  metadataManager = new MetadataManager();
  nasConnector = new NASConnector();
  mailerManager = new MailerManager(settings.resendApiKey || null);

  // Configurer les destinations si disponibles
  if (settings.ssdPersoPath && settings.ssdStudioPath) {
    storageManager.setDestinations(settings.ssdPersoPath, settings.ssdStudioPath);
  }
  
  // Configurer le NAS si disponible
  if (settings.nas) {
    uploadManager.configure(settings.nas);
  }
  
  // Vérifier HandBrake
  const handbrakeCheck = await checkHandBrake();
  if (handbrakeCheck.installed) {
    handbrakePath = handbrakeCheck.path;
    compressionManager = new CompressionManager(handbrakePath);
  }
}

async function loadSettings() {
  try {
    const settingsFile = path.join(os.homedir(), '.backupflow', 'settings.json');
    if (await fs.pathExists(settingsFile)) {
      return await fs.readJson(settingsFile);
    }
  } catch (error) {
    console.error('Erreur lors du chargement des paramètres:', error);
  }
  return {};
}

async function saveSettings(settings) {
  try {
    const settingsFile = path.join(os.homedir(), '.backupflow', 'settings.json');
    await fs.ensureDir(path.dirname(settingsFile));
    await fs.writeJson(settingsFile, settings, { spaces: 2 });
  } catch (error) {
    console.error('Erreur lors de la sauvegarde des paramètres:', error);
  }
}

// ==================== IPC Handlers ====================

// Configuration
ipcMain.handle('get-app-version', () => appVersion);
ipcMain.handle('get-launcher-session', async () => {
  const fresh = await readLauncherSession();
  global.launcherSession = fresh;
  return fresh;
});
ipcMain.handle('spawn-launcher', () => {
  const { spawn } = require('child_process');
  spawn('open', ['-a', 'Launcher'], { detached: true, stdio: 'ignore' });
  return { ok: true };
});
ipcMain.handle('get-settings', async () => {
  return await loadSettings();
});

ipcMain.handle('save-settings', async (event, settings) => {
  await saveSettings(settings);
  
  // Mettre à jour les managers si nécessaire
  if (settings.ssdPersoPath && settings.ssdStudioPath) {
    storageManager.setDestinations(settings.ssdPersoPath, settings.ssdStudioPath);
  }
  
  if (settings.nas) {
    uploadManager.configure(settings.nas);
  }

  if (Array.isArray(settings.allowedVideoExtensions) && settings.allowedVideoExtensions.length > 0) {
    importManager.setAllowedExtensions(settings.allowedVideoExtensions);
  }

  if (settings.resendApiKey !== undefined && mailerManager) {
    mailerManager.setApiKey(settings.resendApiKey || null);
  }
  
  return { success: true };
});

// HandBrake
ipcMain.handle('check-handbrake', async () => {
  return await checkHandBrake();
});

async function checkHandBrake() {
  try {
    const { stdout } = await execAsync('which HandBrakeCLI');
    const path = stdout.trim();
    if (path && await fs.pathExists(path)) {
      handbrakePath = path;
      compressionManager = new CompressionManager(path);
      return { installed: true, path };
    }
  } catch (error) {
    // Continuer
  }
  
  // Essayer les chemins courants
  const possiblePaths = [
    '/usr/local/bin/HandBrakeCLI',
    '/opt/homebrew/bin/HandBrakeCLI',
    '/Applications/HandBrakeCLI'
  ];
  
  for (const possiblePath of possiblePaths) {
    if (await fs.pathExists(possiblePath)) {
      handbrakePath = possiblePath;
      compressionManager = new CompressionManager(possiblePath);
      return { installed: true, path: possiblePath };
    }
  }
  
  return { installed: false, path: null };
}

// Détection des sources
ipcMain.handle('detect-sources', async () => {
  return await importManager.detectSources();
});

ipcMain.handle('scan-directory', async (event, dirPath, recursive, opts) => {
  return await importManager.scanDirectory(dirPath, recursive !== false, opts || {});
});

ipcMain.handle('calculate-checksum', async (event, filePath) => {
  return await importManager.calculateChecksum(filePath);
});

ipcMain.handle('verify-integrity', async (event, sourcePath, destPath) => {
  return await importManager.verifyIntegrity(sourcePath, destPath);
});

// Nomenclature
ipcMain.handle('generate-project-name', async (event, params) => {
  // Récupérer tous les chemins possibles (settings + profils) pour l'incrémentation globale
  const settings = await loadSettings();
  const profiles = await metadataManager.getProfiles();
  
  // Collecter tous les chemins uniques
  const allPaths = new Set();
  
  // Ajouter le chemin des settings
  if (settings.ssdPersoPath) {
    allPaths.add(settings.ssdPersoPath);
  }
  
  // Ajouter les chemins de tous les profils
  profiles.forEach(profile => {
    if (profile.ssdPersoPath) {
      allPaths.add(profile.ssdPersoPath);
    }
  });
  
  // Convertir en tableau et exclure le basePath actuel (déjà inclus)
  const additionalPaths = Array.from(allPaths).filter(path => path !== nomenclatureManager.basePath);
  
  // Passer les chemins additionnels pour la recherche globale
  return await nomenclatureManager.generateProjectName({
    ...params,
    additionalPaths
  });
});

ipcMain.handle('get-next-letter', async (event, format) => {
  // Récupérer tous les chemins possibles (settings + profils) pour l'incrémentation globale
  const settings = await loadSettings();
  const profiles = await metadataManager.getProfiles();
  
  // Collecter tous les chemins uniques
  const allPaths = new Set();
  
  // Ajouter le chemin des settings
  if (settings.ssdPersoPath) {
    allPaths.add(settings.ssdPersoPath);
  }
  
  // Ajouter les chemins de tous les profils
  profiles.forEach(profile => {
    if (profile.ssdPersoPath) {
      allPaths.add(profile.ssdPersoPath);
    }
  });
  
  // Convertir en tableau et exclure le basePath actuel (déjà inclus)
  const additionalPaths = Array.from(allPaths).filter(path => path !== nomenclatureManager.basePath);
  
  // Passer les chemins additionnels pour la recherche globale
  return await nomenclatureManager.getNextLetter(format, additionalPaths);
});

ipcMain.handle('parse-project-name', async (event, projectName) => {
  return nomenclatureManager.parseProjectName(projectName);
});

ipcMain.handle('get-format-description', async (event, format) => {
  return nomenclatureManager.getFormatDescription(format);
});

// Disques et espace
ipcMain.handle('check-disk-space', async (event, directory, requiredBytes) => {
  return await storageManager.checkDiskSpace(directory, requiredBytes);
});

ipcMain.handle('get-file-size', async (event, filePath) => {
  if (!filePath) return 0;
  try {
    const stat = await fs.stat(filePath);
    return stat.size;
  } catch (e) {
    return 0;
  }
});


  ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  
  if (result.canceled) {
    return null;
  }
  
  return result.filePaths[0];
});

// Mode MultiCam Organizer — Lecture du manifest
const ORGANIZER_MANIFEST_NAME = 'BACKUPFLOW_MANIFEST.json';

ipcMain.handle('read-organizer-manifest', async (event, folderPath) => {
  if (!folderPath || typeof folderPath !== 'string') return null;
  const manifestPath = path.join(folderPath.trim(), ORGANIZER_MANIFEST_NAME);
  try {
    if (!await fs.pathExists(manifestPath)) return null;
    const content = await fs.readFile(manifestPath, 'utf-8');
    const data = JSON.parse(content);
    if (!data.projectCode && !data.sourcePath) return null;
    return { ...data, _manifestPath: manifestPath };
  } catch (e) {
    console.error('[MultiCam] Erreur lecture manifest:', e);
    return null;
  }
});

// Récupère la taille des sous-dossiers pour l'affichage MultiCam
async function getFolderSizeRecursive(dirPath) {
  let total = 0;
  try {
    const items = await fs.readdir(dirPath);
    for (const item of items) {
      const fullPath = path.join(dirPath, item);
      const stats = await fs.stat(fullPath);
      if (stats.isDirectory()) {
        total += await getFolderSizeRecursive(fullPath);
      } else {
        total += stats.size;
      }
    }
  } catch (e) {
    console.error('[MultiCam] Erreur calcul taille:', e);
  }
  return total;
}

ipcMain.handle('get-multicam-folder-summary', async (event, { sourcePath, sources }) => {
  if (!sourcePath) return { folders: [], totalSize: 0 };
  const basePath = sourcePath.replace(/\/$/, '');
  const folders = [];
  let totalSize = 0;
  let namesToCheck = [];
  if (Array.isArray(sources) && sources.length > 0) {
    namesToCheck = sources;
  } else {
    const items = await fs.readdir(basePath);
    for (const item of items) {
      const p = path.join(basePath, item);
      try {
        const s = await fs.stat(p);
        if (s.isDirectory()) namesToCheck.push(item);
      } catch (_) {}
    }
  }
  for (const name of namesToCheck) {
    const folderPath = path.join(basePath, String(name));
    try {
      const stat = await fs.stat(folderPath);
      if (stat.isDirectory()) {
        const size = await getFolderSizeRecursive(folderPath);
        folders.push({ name, path: folderPath, size });
        totalSize += size;
      }
    } catch (_) {}
  }
  totalSize = totalSize || await getFolderSizeRecursive(basePath);
  return { folders, totalSize };
});

const MULTICAM_VIDEO_EXT = ['.mp4', '.mov', '.mts', '.mxf'];

ipcMain.handle('execute-multicam-workflow', async (event, workflowData) => {
  isWorkflowRunning = true;
  const startTime = Date.now();
  let totalSizeBytes = 0;
  let processedBytes = 0;

  const send = (data) => {
    event.sender.send('multicam-progress', {
      ...data,
      elapsed: Math.floor((Date.now() - startTime) / 1000),
      totalProcessed: data.totalProcessed ?? (processedBytes / (1024 * 1024)),
      totalSize: data.totalSize ?? (totalSizeBytes / (1024 * 1024)),
      globalProgress: data.globalProgress ?? (totalSizeBytes > 0 ? (processedBytes / totalSizeBytes) * 100 : 0)
    });
  };

  try {
    const settings = await loadSettings();
    const ssdPerso = workflowData.ssdPersoPath || settings.ssdPersoPath;
    const ssdStudio = workflowData.ssdStudioPath || settings.ssdStudioPath;
    const sourcePath = workflowData.multiCamSourcePath;
    const projectName = workflowData.projectName;
    const compress = !!workflowData.compress;
    const uploadToNAS = !!workflowData.uploadToNAS;

    if (!ssdPerso || !sourcePath || !projectName) {
      throw new Error('Configuration incomplète (SSD Perso, source, projet)');
    }

    storageManager.setDestinations(ssdPerso, ssdStudio || ssdPerso);
    totalSizeBytes = await getFolderSizeRecursive(sourcePath);

    const destPerso = path.join(ssdPerso, projectName);
    event.sender.send('multicam-progress', {
      currentPhase: 'copying',
      globalProgress: 0,
      totalProcessed: 0,
      totalSize: totalSizeBytes / (1024 * 1024),
      elapsed: 0,
      currentFolder: path.basename(sourcePath),
      folderProgress: 0,
      folderTotal: 1,
      currentFile: '',
      currentFileProgress: 0
    });

    await fs.ensureDir(path.dirname(destPerso));
    await fs.copy(sourcePath, destPerso, { overwrite: true });
    processedBytes = totalSizeBytes;
    send({ currentPhase: 'copying', globalProgress: 100, totalProcessed: processedBytes / (1024 * 1024), totalSize: totalSizeBytes / (1024 * 1024) });

    if (ssdStudio && ssdStudio !== ssdPerso) {
      const destStudio = path.join(ssdStudio, projectName);
      await fs.ensureDir(path.dirname(destStudio));
      await fs.copy(sourcePath, destStudio, { overwrite: true });
    }

    let zipPath = null;
    if (uploadToNAS) {
      const tempDir = path.join(os.tmpdir(), `backupflow-multicam-${Date.now()}`);
      await fs.ensureDir(tempDir);
      const compressedDir = path.join(tempDir, projectName);
      await fs.ensureDir(compressedDir);

      const subfolders = workflowData.multiCamSources && workflowData.multiCamSources.length > 0
        ? workflowData.multiCamSources
        : (await fs.readdir(sourcePath)).filter(async n => {
            const p = path.join(sourcePath, n);
            const s = await fs.stat(p);
            return s.isDirectory();
          });
      const dirs = [];
      for (const n of (workflowData.multiCamSources || [])) {
        const p = path.join(sourcePath, n);
        try {
          if ((await fs.stat(p)).isDirectory()) dirs.push(n);
        } catch (_) {}
      }
      if (dirs.length === 0) {
        const items = await fs.readdir(sourcePath);
        for (const n of items) {
          const p = path.join(sourcePath, n);
          try {
            if ((await fs.stat(p)).isDirectory()) dirs.push(n);
          } catch (_) {}
        }
      }

      let folderIdx = 0;
      for (const subName of dirs) {
        const srcSub = path.join(sourcePath, subName);
        const destSub = path.join(compressedDir, subName);
        await fs.ensureDir(destSub);

        const files = await fs.readdir(srcSub);
        const allFiles = [];
        const walk = async (dir) => {
          const entries = await fs.readdir(dir);
          for (const e of entries) {
            const full = path.join(dir, e);
            const st = await fs.stat(full);
            if (st.isDirectory()) await walk(full);
            else allFiles.push({ path: full, rel: path.relative(srcSub, full) });
          }
        };
        await walk(srcSub);

        let fileIdx = 0;
        for (const f of allFiles) {
          const ext = path.extname(f.path).toLowerCase();
          const isVideo = MULTICAM_VIDEO_EXT.includes(ext);
          const destFile = isVideo && handbrakePath
            ? path.join(destSub, path.dirname(f.rel), path.basename(f.rel, ext) + '.mp4')
            : path.join(destSub, f.rel);
          await fs.ensureDir(path.dirname(destFile));

          if (isVideo && handbrakePath) {
            send({
              currentPhase: 'compressing',
              currentFolder: subName,
              folderProgress: fileIdx,
              folderTotal: allFiles.length,
              currentFile: path.basename(f.path),
              currentFileSize: Math.round((await fs.stat(f.path)).size / (1024 * 1024)),
              currentFileProgress: 0
            });
            await compressionManager.compressVideo(f.path, destFile, null, (p) => {
              send({
                currentPhase: 'compressing',
                currentFolder: subName,
                folderProgress: fileIdx,
                folderTotal: allFiles.length,
                currentFile: path.basename(f.path),
                currentFileProgress: p.progress || 0
              });
            });
          } else {
            await fs.ensureDir(path.dirname(destFile));
            await fs.copy(f.path, destFile);
          }
          fileIdx++;
        }
        folderIdx++;
      }

      zipPath = path.join(tempDir, `${projectName}.zip`);
      send({ currentPhase: 'zipping', currentFolder: '', currentFile: '' });
      await compressionManager.createZip(compressedDir, zipPath, (p) => {
        send({ currentPhase: 'zipping', globalProgress: (folderIdx / Math.max(1, dirs.length)) * 50 + (p.progress || 0) * 0.5 });
      });
    }

    if (uploadToNAS && zipPath) {
      uploadManager.configure({
        protocol: settings.nas?.protocol || 'smb',
        smbURL: settings.nas?.smbURL || settings.nasSMBURL,
        remotePath: settings.nas?.remotePath || settings.nasSMBRemotePath
      });
      await uploadManager.connect();
      send({ currentPhase: 'uploading', currentFile: path.basename(zipPath) });
      await uploadManager.uploadProjectArchive(zipPath, projectName, (p) => {
        send({
          currentPhase: 'uploading',
          currentFileProgress: p.progress || 0,
          globalSpeed: p.speed ? parseInt(String(p.speed).replace(/\D/g, '')) : null
        });
      });
      await uploadManager.disconnect();
      try {
        await fs.remove(path.dirname(zipPath));
      } catch (_) {}
    }

    // Mise à jour Monday faite par le renderer (triggerMondayUpdateAfterWorkflow) en fin de workflow

    isWorkflowRunning = false;
    return {
      success: true,
      projectName,
      ssdStudioProjectPath: ssdStudio ? path.join(ssdStudio, projectName) : path.join(ssdPerso, projectName)
    };
  } catch (err) {
    isWorkflowRunning = false;
    event.sender.send('multicam-progress', {
      currentPhase: 'error',
      globalProgress: 0,
      message: err.message
    });
    return { success: false, error: err.message };
  }
});

// Lister les GIFs de célébration dans assets/GIF
ipcMain.handle('list-celebration-gifs', async () => {
  try {
    const gifsDir = path.join(__dirname, 'assets', 'GIF');
    
    // Vérifier si le dossier existe
    if (!await fs.pathExists(gifsDir)) {
      console.warn('[GIF] Le dossier assets/GIF n\'existe pas');
      return [];
    }
    
    // Lire les fichiers du dossier
    const files = await fs.readdir(gifsDir);
    
    // Filtrer pour ne garder que les fichiers .gif
    const gifFiles = files.filter(file => 
      file.toLowerCase().endsWith('.gif')
    );
    
    console.log(`[GIF] ${gifFiles.length} GIF(s) trouvé(s) dans assets/GIF`);
    return gifFiles.map(file => path.join(gifsDir, file));
  } catch (error) {
    console.error('[GIF] Erreur lors de la lecture du dossier assets/GIF:', error);
    return [];
  }
});

// ==================== Monday.com API ====================
const MONDAY_API_URL = 'https://api.monday.com/v2';

async function mondayGraphQL(token, query, variables = {}) {
  const res = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': token,
      'Content-Type': 'application/json',
      'API-Version': '2023-10'
    },
    body: JSON.stringify({ query, variables })
  });
  const json = await res.json();
  if (json.errors && json.errors.length > 0) {
    throw new Error(json.errors.map(e => e.message).join('; ') || 'Monday API error');
  }
  return json.data;
}

function getMondayBoardColumns(token, boardId) {
  return mondayGraphQL(token, `
    query ($boardId: [ID!]!) {
      boards(ids: $boardId) {
        columns { id title type }
      }
    }
  `, { boardId: [String(boardId)] }).then(data => data?.boards?.[0]?.columns || []);
}

function getMondayColumnIds(cols) {
  const byTitle = (t) => cols.find(c => (c.title || '').toLowerCase().includes(t.toLowerCase()));
  return {
    status: byTitle('Statut Prod')?.id || byTitle('Statut')?.id || cols.find(c => c.type === 'color')?.id || null,
    formatCopy: byTitle('Format COPY')?.id || byTitle('format copy')?.id || null,
    dateTournage: byTitle('Date de tournage')?.id || byTitle('tournage')?.id || null,
    gofileLink: byTitle('Lien Swiss')?.id || byTitle('GoFile')?.id || byTitle('Lien Swiss/GoFile')?.id || byTitle('gofile')?.id || null,
    responsableBackup: byTitle('Responsable Backup')?.id || byTitle('Responsable backup')?.id || null
  };
}

ipcMain.handle('get-monday-users', async () => {
  try {
    const settings = await loadSettings();
    const token = (settings.mondayApiToken || '').trim();
    if (!token) return { users: [], error: 'Token Monday non configuré' };
    const data = await mondayGraphQL(token, 'query { users { id name email } }');
    const users = data?.users || [];
    return { users };
  } catch (err) {
    console.error('[Monday] get-monday-users:', err);
    return { users: [], error: err.message || 'Erreur API Monday' };
  }
});

ipcMain.handle('monday-get-column-ids', async (event, { boardId, token }) => {
  if (!token || !boardId) return null;
  const cols = await getMondayBoardColumns(token, boardId);
  const ids = getMondayColumnIds(cols);
  return {
    status: ids.status,
    formatCopy: ids.formatCopy,
    dateTournage: ids.dateTournage,
    gofileLink: ids.gofileLink,
    responsableBackup: ids.responsableBackup
  };
});

const MONDAY_STATUS_ORDER = ['1 - en projet', '2 - en tournage', '3 - backupé', '3 - BACKUPÉ'];

const FORMAT_CODES = ['TD3M', 'CQUOI', 'SELEC', 'TEASER', 'CEXP', 'ADLE', 'DDLE', 'CDLE', 'CORR', 'ITW', 'ITR', 'SCH', 'PROMO', 'ATE', 'REP', 'DOC', 'TEST', 'EME', 'BP', 'MT', 'AS'];

function extractFormatFromProjectName(name) {
  if (!name || typeof name !== 'string') return '';
  const s = name.trim();
  if (!s) return '';
  const sUpper = s.toUpperCase();
  for (const code of FORMAT_CODES) {
    const idx = sUpper.indexOf(code);
    if (idx === -1) continue;
    const before = idx === 0 ? ' ' : sUpper[idx - 1];
    const after = idx + code.length >= s.length ? ' ' : sUpper[idx + code.length];
    const isBoundary = /[\s_\-.,;:()\[\]]/.test(before) && /[\s_\-.,;:()\[\]]/.test(after);
    if (isBoundary) return code;
  }
  return '';
}

function matchesStatusFilter(statusText, excludeOption = true, includeBackedUp = false) {
  const s = (statusText || '').toLowerCase().trim();
  if (!s) return true;
  if (excludeOption && s.includes('option')) return false;
  if (includeBackedUp && s.includes('backup')) return true;
  return (s.startsWith('1') && s.includes('projet')) || (s.startsWith('2') && s.includes('tournage'));
}

ipcMain.handle('monday-get-projects', async (event, { boardId, token, includeBackedUp = false }) => {
  if (!token || !boardId) {
    return { error: 'missing_config', message: 'Clé API ou Board ID manquant' };
  }
  try {
    const boardMeta = await mondayGraphQL(token, `
      query ($boardId: [ID!]!) {
        boards(ids: $boardId) {
          columns { id title type }
        }
      }
    `, { boardId: [String(boardId)] });
    const cols = boardMeta?.boards?.[0]?.columns || [];
    const byTitle = (t) => cols.find(c => (c.title || '').toLowerCase().includes(t.toLowerCase()));
    const colIds = {
      status: byTitle('Statut Prod')?.id || byTitle('Statut prod')?.id || byTitle('Statut production')?.id || byTitle('Statut')?.id || cols.find(c => c.type === 'color')?.id || cols[0]?.id,
      formatCopy: cols.find(c => /format\s*copy/i.test((c.title || '')))?.id || byTitle('FORMAT COPY')?.id || byTitle('format copy')?.id || null,
      dateTournage: byTitle('Date de tournage')?.id || null
    };

    const statusColId = colIds.status;
    const colIdsToFetch = [statusColId, colIds.formatCopy, colIds.dateTournage].filter(Boolean);
    if (colIdsToFetch.length === 0) {
      return { error: 'api_error', message: 'Aucune colonne trouvée sur le board. Vérifiez que le board contient une colonne Statut.' };
    }

    let rawItems = [];
    let cursor = null;

    const pageLimit = 500;
    const itemsPageQuery = `
      query ($boardId: [ID!]!, $colIds: [String!]!, $limit: Int!) {
        boards(ids: $boardId) {
          items_page(limit: $limit) {
            cursor
            items {
              id
              name
              column_values(ids: $colIds) {
                id
                text
                type
              }
            }
          }
        }
      }
    `;
    const nextPageQueryWithCols = `
      query ($cursor: String!, $colIds: [String!]!, $limit: Int!) {
        next_items_page(cursor: $cursor, limit: $limit) {
          cursor
          items {
            id
            name
            column_values(ids: $colIds) {
              id
              text
              type
            }
          }
        }
      }
    `;
    const nextPageQuerySimple = `
      query ($cursor: String!, $limit: Int!) {
        next_items_page(cursor: $cursor, limit: $limit) {
          cursor
          items {
            id
            name
          }
        }
      }
    `;

    const firstData = await mondayGraphQL(token, itemsPageQuery, {
      boardId: [String(boardId)],
      colIds: colIdsToFetch,
      limit: pageLimit
    });
    const firstPage = firstData?.boards?.[0]?.items_page;
    rawItems = firstPage?.items || [];
    cursor = firstPage?.cursor;

    while (cursor) {
      let nextPage = null;
      try {
        const nextData = await mondayGraphQL(token, nextPageQueryWithCols, {
          cursor,
          colIds: colIdsToFetch,
          limit: pageLimit
        });
        nextPage = nextData?.next_items_page;
      } catch (e) {
        const nextData = await mondayGraphQL(token, nextPageQuerySimple, { cursor, limit: pageLimit });
        nextPage = nextData?.next_items_page;
      }
      const nextItems = nextPage?.items || [];
      rawItems = rawItems.concat(nextItems);
      cursor = nextPage?.cursor || null;
    }

    const allItems = [...rawItems];
    if (statusColId && rawItems.length > 0) {
      rawItems = rawItems.filter(item => {
        const cv = (item.column_values || []).reduce((acc, c) => { acc[c.id] = c; return acc; }, {});
        const statusText = cv[statusColId]?.text || '';
        return matchesStatusFilter(statusText, true, includeBackedUp);
      });
      if (rawItems.length === 0) rawItems = allItems;
    }

    const items = rawItems.map(item => {
      const cv = (item.column_values || []).reduce((acc, c) => { acc[c.id] = c; return acc; }, {});
      let statusLabel = '';
      let formatCopy = '';
      let dateTournage = '';
      if (cv[colIds.status]) statusLabel = cv[colIds.status].text || '';
      if (colIds.formatCopy && cv[colIds.formatCopy]) formatCopy = cv[colIds.formatCopy].text || '';
      if (colIds.dateTournage && cv[colIds.dateTournage]) dateTournage = cv[colIds.dateTournage].text || '';
      const formatResolved = extractFormatFromProjectName(item.name || '');
      return {
        id: item.id,
        name: item.name || '',
        status: statusLabel,
        formatCopy,
        format: formatResolved,
        dateTournage
      };
    });

    items.sort((a, b) => {
      const statusA = (a.status || '').toLowerCase();
      const statusB = (b.status || '').toLowerCase();
      const idxA = MONDAY_STATUS_ORDER.findIndex(t => statusA === t || statusA.startsWith(t));
      const idxB = MONDAY_STATUS_ORDER.findIndex(t => statusB === t || statusB.startsWith(t));
      const orderA = idxA >= 0 ? idxA : MONDAY_STATUS_ORDER.length;
      const orderB = idxB >= 0 ? idxB : MONDAY_STATUS_ORDER.length;
      if (orderA !== orderB) return orderA - orderB;
      return (a.name || '').localeCompare(b.name || '');
    });

    return { items, columnIds: colIds };
  } catch (err) {
    const msg = err.message || String(err);
    if (msg.includes('Unauthorized') || msg.includes('authentication')) {
      return { error: 'auth', message: 'Clé API invalide ou expirée' };
    }
    return { error: 'api_error', message: msg };
  }
});

ipcMain.handle('monday-test-connection', async (event, { token, boardId }) => {
  const tokenVal = (token || '').trim();
  const boardIdVal = (boardId || '').trim();

  if (!tokenVal) {
    return {
      success: false,
      errorCode: 'no_token',
      message: 'Clé API manquante',
      details: 'Veuillez coller votre token API Monday dans le champ prévu. Vous pouvez le récupérer depuis l\'API Playground de Monday.com.'
    };
  }

  if (!boardIdVal) {
    return {
      success: false,
      errorCode: 'no_board',
      message: 'Board ID manquant',
      details: 'Veuillez entrer l\'ID du board « Suivi de production vidéo 25-26 ». L\'ID se trouve dans l\'URL du board (ex: monday.com/board/1234567890 → 1234567890).'
    };
  }

  try {
    const data = await mondayGraphQL(tokenVal, `query { me { id name } }`);
    const me = data?.me;
    if (!me) {
      return {
        success: false,
        errorCode: 'auth',
        message: 'Token invalide',
        details: 'Le token ne permet pas d\'identifier votre compte. Vérifiez que la clé est correcte et qu\'elle n\'a pas expiré. Générez-en une nouvelle dans Monday.com si nécessaire.'
      };
    }

    const boardData = await mondayGraphQL(tokenVal, `
      query ($boardId: [ID!]!) {
        boards(ids: $boardId) {
          id
          name
          columns { id title }
        }
      }
    `, { boardId: [boardIdVal] });

    const board = boardData?.boards?.[0];
    if (!board) {
      return {
        success: false,
        errorCode: 'board_not_found',
        message: 'Board inaccessible',
        details: `Aucun board trouvé avec l'ID "${boardIdVal}". Vérifiez l'ID ou que vous avez accès à ce board. L'ID est visible dans l'URL du board (ex: monday.com/board/1234567890).`
      };
    }

    const projectsResult = await mondayGraphQL(tokenVal, `
      query ($boardId: [ID!]!) {
        boards(ids: $boardId) {
          items_page(limit: 5) { items { id } }
        }
      }
    `, { boardId: [boardIdVal] }).catch(() => null);

    const itemCount = projectsResult?.boards?.[0]?.items_page?.items?.length ?? 0;

    return {
      success: true,
      message: 'Connexion réussie',
      details: `Connecté en tant que ${me.name || 'utilisateur'}. Board « ${board.name} » accessible.`,
      userName: me.name,
      boardName: board.name,
      projectCount: itemCount
    };
  } catch (err) {
    const msg = (err.message || String(err)).toLowerCase();
    if (msg.includes('unauthorized') || msg.includes('authentication') || msg.includes('invalid') || msg.includes('token')) {
      return {
        success: false,
        errorCode: 'auth',
        message: 'Clé API invalide ou expirée',
        details: 'Le token a été rejeté par Monday.com. Vérifiez qu\'il est correct et qu\'il dispose des permissions nécessaires (lecture du board). Générez-en un nouveau depuis votre compte Monday.com si besoin.'
      };
    }
    if (msg.includes('complexity') || msg.includes('rate') || msg.includes('limit')) {
      return {
        success: false,
        errorCode: 'rate_limit',
        message: 'Limite d\'API atteinte',
        details: 'Monday.com limite le nombre de requêtes. Réessayez dans quelques minutes.'
      };
    }
    if (msg.includes('network') || msg.includes('fetch') || msg.includes('econnrefused') || msg.includes('enotfound')) {
      return {
        success: false,
        errorCode: 'network',
        message: 'Erreur réseau',
        details: 'Impossible de joindre l\'API Monday.com. Vérifiez votre connexion internet et que monday.com n\'est pas bloqué (firewall, VPN).'
      };
    }
    return {
      success: false,
      errorCode: 'api_error',
      message: 'Erreur Monday.com',
      details: err.message || 'Une erreur inattendue s\'est produite lors de la connexion à l\'API Monday.com.'
    };
  }
});

// Phase B : Mise à jour d'un item Monday en fin de workflow
ipcMain.handle('monday-update-item', async (event, { itemId, boardId, apiToken, updates, mondayUserId, projectName }) => {
  if (!itemId || !boardId || !apiToken) {
    const err = 'Paramètres manquants (itemId, boardId, apiToken)';
    console.error('[Monday] monday-update-item:', err);
    return { success: false, error: err, step: 'params' };
  }
  const token = String(apiToken).trim();
  const boardIdVal = String(boardId).trim();
  const itemIdVal = String(itemId);

  try {
    // Étape 0 : Récupérer les colonnes du board
    const cols = await getMondayBoardColumns(token, boardIdVal);
    const colIds = getMondayColumnIds(cols);
    const getCol = (id) => cols.find(c => c.id === id);

    console.log('[Monday] Colonnes détectées:', {
      statutProd: colIds.status ? getCol(colIds.status)?.title : null,
      gofileLink: colIds.gofileLink ? getCol(colIds.gofileLink)?.title : null,
      responsableBackup: colIds.responsableBackup ? getCol(colIds.responsableBackup)?.title : null
    });

    if (!colIds.status) {
      const err = 'Colonne Statut Prod introuvable sur le board';
      console.error('[Monday]', err, '- Colonnes disponibles:', cols.map(c => `${c.title} (${c.type})`).join(', '));
      return { success: false, error: err, step: 'columns' };
    }

    // Valeur inline pour éviter le conflit String! vs JSON! — on échappe les guillemets pour GraphQL
    const toGraphQLValue = (obj) => JSON.stringify(obj).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    const runMutation = async (columnId, valueObj, stepName) => {
      const valueStr = toGraphQLValue(valueObj);
      await mondayGraphQL(token, `
        mutation ($boardId: ID!, $itemId: ID!, $columnId: String!) {
          change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: "${valueStr}") { id }
        }
      `, { boardId: boardIdVal, itemId: itemIdVal, columnId });
      console.log('[Monday] OK:', stepName);
    };

    // 1. Statut Prod → 3 - BACKUPÉ (colonne Statut)
    try {
      if (colIds.status && updates.statutProd) {
        await runMutation(colIds.status, { label: updates.statutProd }, 'Statut Prod');
      }
    } catch (e) {
      const err = `Statut Prod: ${e.message || e}`;
      console.error('[Monday] Échec', err);
      return { success: false, error: err, step: 'statutProd' };
    }

    // 2. Lien Swiss/GoFile → gofileLink (si défini)
    try {
      if (colIds.gofileLink && updates.gofileLink) {
        const col = getCol(colIds.gofileLink);
        const isLink = col && (col.type === 'link' || col.type === 'links');
        const linkVal = isLink
          ? { url: updates.gofileLink, text: 'Gofile' }
          : { text: updates.gofileLink };
        await runMutation(colIds.gofileLink, linkVal, 'Lien Swiss/GoFile');
      }
    } catch (e) {
      const err = `Lien Swiss/GoFile: ${e.message || e}`;
      console.error('[Monday] Échec', err);
      return { success: false, error: err, step: 'gofileLink' };
    }

    // 3. Responsable Backup → nom du profil (colonne Statut)
    try {
      if (colIds.responsableBackup && updates.responsableBackup) {
        await runMutation(colIds.responsableBackup, { label: String(updates.responsableBackup) }, 'Responsable Backup');
      }
    } catch (e) {
      const err = `Responsable Backup (vérifiez que "${updates.responsableBackup}" existe dans les valeurs du statut): ${e.message || e}`;
      console.error('[Monday] Échec', err);
      return { success: false, error: err, step: 'responsableBackup' };
    }

    console.log('[Monday] Mise à jour terminée avec succès');

    if (mondayUserId) {
      try {
        await mondayGraphQL(token, `
          mutation ($userId: ID!, $targetId: ID!, $text: String!, $targetType: NotificationTargetType!) {
            create_notification(user_id: $userId, target_id: $targetId, text: $text, target_type: $targetType) { text }
          }
        `, {
          userId: String(mondayUserId),
          targetId: String(itemIdVal),
          text: `✅ Backup terminé : ${projectName || 'Projet'}`,
          targetType: 'Project'
        });
        console.log('[Monday] Notification envoyée à l\'utilisateur', mondayUserId);
      } catch (notifErr) {
        console.error('[Monday] create_notification échouée:', notifErr.message || notifErr);
      }
    } else {
      console.log('[Monday] Pas de mondayUserId sur ce profil — notification ignorée');
    }

    return { success: true };
  } catch (err) {
    const msg = err.message || String(err);
    console.error('[Monday] Erreur générale:', msg);
    return { success: false, error: msg, step: 'general' };
  }
});


// Fonction utilitaire pour convertir les tailles en bytes
function parseSizeToBytes(sizeString) {
  if (!sizeString || typeof sizeString !== 'string') return 0;
  const match = sizeString.match(/^([\d.]+)\s*([KMGT]?B)$/i);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const multipliers = { 'B': 1, 'KB': 1024, 'MB': 1024 * 1024, 'GB': 1024 * 1024 * 1024, 'TB': 1024 * 1024 * 1024 * 1024 };
  return value * (multipliers[unit] || 1);
}

// Workflow complet avec progression globale précise
ipcMain.handle('execute-backup-workflow', async (event, workflowData) => {
  // Marquer qu'un workflow est en cours
  isWorkflowRunning = true;
  workflowAbortController = new AbortController();
  const abortSignal = workflowAbortController.signal;

  function checkAborted() {
    if (abortSignal.aborted) throw new Error('WORKFLOW_ABORTED');
  }
  
  const {
    files,
    projectName: rawProjectName,
    format,
    sujet,
    initiales,
    compress,
    ssdPersoPath,
    ssdStudioPath,
    isSession,
    parentProjectPath,
    sessionFolderName,
    mondayItemId,
    profileId,
    zipNasEnabled
  } = workflowData;
  
  const uploadToNAS = !!workflowData.uploadToNAS;
  console.log('[DEBUG NAS] workflowData.uploadToNAS brut =', workflowData.uploadToNAS);
  console.log('[DEBUG NAS] uploadToNAS après !! =', uploadToNAS);
  console.log('[DEBUG NAS] compress =', compress);
  console.log('[DEBUG NAS] zipNasEnabled =', zipNasEnabled);
  
  // En mode Session : copier dans parent/SESSION_XX au lieu d'un nouveau dossier racine
  const projectName = isSession && parentProjectPath && sessionFolderName
    ? path.join(path.basename(parentProjectPath), sessionFolderName)
    : rawProjectName;
  
  const workflowStartTime = Date.now();
  
  // Configurer les destinations pour ce workflow
  // Utiliser les chemins du profil si fournis, sinon les settings
  const settings = await loadSettings();
  const finalSSDPersoPath = ssdPersoPath || settings.ssdPersoPath;
  const finalSSDStudioPath = ssdStudioPath || settings.ssdStudioPath;
  
  if (finalSSDPersoPath && finalSSDStudioPath) {
    storageManager.setDestinations(finalSSDPersoPath, finalSSDStudioPath);
  } else {
    return { success: false, error: 'Destinations SSD non configurées' };
  }
  
  const projectFolderPath = path.join(finalSSDPersoPath, projectName);
  
  // Gofile auto : chargé depuis les paramètres
  const gofileAutoUpload = !!settings.gofileAutoUpload;
  
  // Calculer les poids de chaque étape pour la progression globale
  // Si Gofile auto activé, on réserve 10% pour Gofile et on scale le reste
  const gofileWeight = gofileAutoUpload ? 0.1 : 0;
  const scale = gofileAutoUpload ? 0.9 : 1;
  const totalFilesSize = files.reduce((sum, f) => sum + (f.size || 0), 0);
  const copyWeight = 0.4 * scale; // 40% pour la copie
  const compressWeight = compress ? 0.3 * scale : 0; // 30% pour la compression vidéo
  const zipNASWeight = compress && uploadToNAS ? 0.15 * scale : 0; // 15% pour le ZIP NAS
  const uploadWeight = uploadToNAS ? 0.15 * scale : 0; // 15% pour l'upload

  let parallelGofileProgress = 0;
  let parallelCompressProgress = 0;
  
  let globalProgress = 0;
  
  function updateGlobalProgress(stepProgress, stepName, stepWeight) {
    // Calculer la progression globale en fonction du poids de chaque étape
    const stepContribution = (stepProgress / 100) * stepWeight * 100;
    
    // Mettre à jour la progression globale (en additionnant les contributions)
    // On recalcule à partir des étapes complétées
    let calculatedGlobal = 0;
    
    // Copie = 0-40%
    if (stepName === 'copying') {
      calculatedGlobal = stepContribution;
    }
    // Gofile = 40-50% (parallèle avec compression)
    else if (stepName === 'gofile' && gofileAutoUpload) {
      const compressContrib = (parallelCompressProgress / 100) * compressWeight * 100;
      calculatedGlobal = (copyWeight * 100) + stepContribution + compressContrib;
    }
    // Compression vidéo = 50-80% (parallèle avec Gofile)
    else if (stepName === 'compressing' && compress) {
      const gofileContrib = (parallelGofileProgress / 100) * gofileWeight * 100;
      calculatedGlobal = (copyWeight * 100) + gofileContrib + stepContribution;
    }
    // ZIP NAS = 80-95% (si compression activée)
    else if (stepName === 'creating_zip_nas' && compress && uploadToNAS) {
      calculatedGlobal = (copyWeight * 100) + (gofileWeight * 100) + (compressWeight * 100) + stepContribution;
    }
    // Upload = 95-100% (si activé, après compression et ZIP NAS)
    else if (stepName === 'uploading' && uploadToNAS) {
      calculatedGlobal = (copyWeight * 100) + (gofileWeight * 100) + (compressWeight * 100) + (zipNASWeight * 100) + stepContribution;
    }
    
    globalProgress = Math.min(100, calculatedGlobal);
    
    event.sender.send('workflow-progress', {
      step: stepName,
      progress: stepProgress,
      globalProgress: globalProgress,
      message: `${stepName}... ${Math.round(stepProgress)}%`
    });
  }
  
  try {
    // Étape 1: Copie vers destinations (0-40%)
    // Envoyer un message de démarrage avec globalProgress = 0
    event.sender.send('workflow-progress', {
      step: 'copying',
      status: 'starting',
      message: 'Démarrage de la copie des fichiers...',
      progress: 0,
      globalProgress: 0 // IMPORTANT: Toujours inclure globalProgress
    });
    
    const copyResults = await storageManager.copyToBothDestinations(
      projectName,
      files,
      (progress) => {
        const stepProgress = progress.progress || 0;
        
        // Toujours utiliser 'copying' pour SSD Studio (plus de ZIP)
        const stepName = 'copying';
        const stepWeight = copyWeight;
        
        // IMPORTANT: Toujours mettre à jour globalProgress avant d'envoyer
        updateGlobalProgress(stepProgress, stepName, stepWeight);
        
        // Calculer les bytes réels si disponibles
        let processedBytes = progress.processedBytes;
        if (!processedBytes && progress.processed && progress.total) {
          // Convertir les strings en bytes si nécessaire
          processedBytes = parseSizeToBytes(progress.processed);
        }
        
        event.sender.send('workflow-progress', {
          step: stepName,
          status: stepProgress > 0 ? 'active' : 'starting',
          globalProgress: globalProgress, // TOUJOURS inclure la progression globale mise à jour
          processedBytes: processedBytes, // Bytes réels pour le tracker
          ...progress
        });
      },
      checkAborted
    );
    
    if (!copyResults.success) {
      throw new Error('Échec de la copie');
    }
    
    updateGlobalProgress(100, 'copying', copyWeight);
    
    // Envoyer une dernière mise à jour pour la copie complétée
    event.sender.send('workflow-progress', {
      step: 'copying',
      status: 'completed',
      progress: 100,
      globalProgress: globalProgress // Copie terminée = 40% global
    });

    checkAborted();
    
    // Journaliser avec les noms originaux et les tailles
    await metadataManager.addHistoryEntry({
      type: 'backup',
      projectName,
      status: 'copy_completed',
      files: files.map(f => ({
        name: f.name || f.path?.split(/[/\\]/).pop() || 'Fichier inconnu',
        size: f.size || 0
      })),
      totalSize: totalFilesSize,
      profileId: profileId || null,
      mondayItemId: mondayItemId || null,
      projectFolderPath,
      isSession: isSession || false,
      sessionNumber: workflowData.sessionNumber,
      parentProjectPath: parentProjectPath || null
    });

    checkAborted();

    // Étape 2: Gofile + HandBrake EN PARALLÈLE — sur les fichiers copiés SSD Perso
    let gofileResult = null;
    let archiveResult = null;
    const ssdPersoProjectPath = path.join(finalSSDPersoPath, projectName);

    const runGofile = async (archiveResult = null) => {
      if (!gofileAutoUpload) return null;
      parallelGofileProgress = 0;
      updateGlobalProgress(0, 'gofile', gofileWeight);
      event.sender.send('workflow-progress', {
        step: 'gofile',
        status: 'starting',
        message: 'Envoi vers Gofile en cours...',
        progress: 0,
        globalProgress: globalProgress,
        parallelPhase: true
      });
      const gofileProgressCallback = (data) => {
        const pct = data.total > 0 ? Math.round((data.done / data.total) * 100) : 0;
        parallelGofileProgress = pct;
        updateGlobalProgress(pct, 'gofile', gofileWeight);
        event.sender.send('workflow-progress', {
          step: 'gofile',
          status: 'active',
          progress: pct,
          globalProgress: globalProgress,
          done: data.done,
          total: data.total,
          fileName: data.fileName,
          message: data.fileName ? `Envoi de ${data.fileName}...` : 'Finalisation...',
          processed: `${data.done}/${data.total}`,
          parallelPhase: true
        });
        event.sender.send('gofile-progress', data);
      };
      try {
        checkAborted();
        const compressedPath = archiveResult?.projectDir || null;
        const result = await performGofileUpload(
          ssdPersoProjectPath,
          gofileProgressCallback,
          compressedPath
        );
        parallelGofileProgress = 100;
        updateGlobalProgress(100, 'gofile', gofileWeight);
        event.sender.send('workflow-progress', {
          step: 'gofile',
          status: result.ok ? 'completed' : 'error',
          progress: 100,
          globalProgress: globalProgress,
          message: result.ok ? 'Envoi Gofile terminé' : (result.error || 'Erreur Gofile'),
          parallelPhase: true
        });
        return result;
      } catch (gofileErr) {
        parallelGofileProgress = 100;
        event.sender.send('workflow-progress', {
          step: 'gofile',
          status: 'error',
          progress: 100,
          globalProgress: globalProgress,
          message: gofileErr.message || 'Erreur Gofile',
          parallelPhase: true
        });
        return { ok: false, error: gofileErr.message || String(gofileErr) };
      }
    };

    const runCompress = async () => {
      if (!compress || !compressionManager) return null;
      parallelCompressProgress = 0;
      let videoIndex = 0;
      const ssdPersoFiles = files.map(f => {
        const ext = path.extname(f.path).toLowerCase();
        if (f.type === 'video') {
          videoIndex++;
          return { ...f, path: path.join(ssdPersoProjectPath, `${projectName}_${videoIndex}${ext}`) };
        }
        return { ...f, path: path.join(ssdPersoProjectPath, path.basename(f.path)) };
      });
      const tempDir = path.join(os.tmpdir(), 'backupflow');
      await fs.ensureDir(tempDir);
      const videoFilesList = ssdPersoFiles.filter(f => f.type === 'video');
      let compressionProgress = 0;
      let compressionCompleted = 0;
      updateGlobalProgress(0, 'compressing', compressWeight);
      event.sender.send('workflow-progress', {
        step: 'compressing',
        status: 'starting',
        message: 'Préparation de la compression vidéo...',
        progress: 0,
        globalProgress: globalProgress,
        parallelPhase: true
      });
      event.sender.send('workflow-progress', {
        step: 'compressing',
        status: 'active',
        message: `Compression de ${videoFilesList.length} fichier(s) vidéo...`,
        progress: 0,
        globalProgress: globalProgress,
        parallelPhase: true
      });
      let result = await compressionManager.createProjectArchive(
        projectName,
        ssdPersoFiles,
        tempDir,
        null,
        (progress) => {
          if (progress.step === 'creating_zip_nas') {
            updateGlobalProgress(progress.progress || 0, 'creating_zip_nas', zipNASWeight);
            event.sender.send('workflow-progress', {
              step: 'creating_zip_nas',
              globalProgress: globalProgress,
              progress: progress.progress || 0,
              status: progress.status || 'active',
              message: progress.message,
              processed: progress.processed,
              total: progress.total,
              speed: progress.speed,
              eta: progress.eta,
              elapsed: progress.elapsed,
              file: progress.file || `${projectName}.zip`
            });
            return;
          }
          if (progress.step === 'compressing' && progress.progress !== undefined) {
            const fileProgress = progress.progress || 0;
            const baseProgress = (compressionCompleted / videoFilesList.length) * 100;
            const currentFileProgress = (fileProgress / videoFilesList.length);
            compressionProgress = baseProgress + currentFileProgress;
          } else if (progress.step === 'compressing' && progress.status === 'completed') {
            compressionCompleted++;
            compressionProgress = (compressionCompleted / videoFilesList.length) * 100;
          }
          const stepProgress = Math.min(100, Math.max(0, compressionProgress));
          parallelCompressProgress = stepProgress;
          updateGlobalProgress(stepProgress, 'compressing', compressWeight);
          const realProgress = (progress.step === 'compressing' && progress.progress !== undefined)
            ? progress.progress : stepProgress;
          const workflowProgressData = {
            step: progress.step || 'compressing',
            globalProgress: globalProgress,
            progress: realProgress,
            status: progress.status || 'active',
            file: progress.file,
            message: progress.message,
            processed: progress.processed,
            total: progress.total,
            speed: progress.speed,
            eta: progress.eta,
            elapsed: progress.elapsed,
            fps: progress.fps,
            avgFps: progress.avgFps,
            taskNumber: progress.taskNumber,
            taskTotal: progress.taskTotal,
            taskInfo: progress.taskInfo,
            handbrakeLine: progress.handbrakeLine,
            infoMessage: progress.infoMessage,
            finalAvgFps: progress.finalAvgFps,
            parallelPhase: true
          };
          event.sender.send('workflow-progress', workflowProgressData);
        },
        null,
        checkAborted,
        !zipNasEnabled
      );
      if (result?.projectDir) {
        const VIDEO_EXT = ['.mp4', '.mov', '.mxf', '.avi'];
        const rootFiles = fs.readdirSync(result.projectDir);
        for (const name of rootFiles) {
          const fullPath = path.join(result.projectDir, name);
          if (!fs.statSync(fullPath).isFile()) continue;
          const ext = path.extname(name).toLowerCase();
          if (!VIDEO_EXT.includes(ext)) continue;
          const base = path.basename(name, ext);
          const newName = base + '_compressed' + ext;
          const newPath = path.join(result.projectDir, newName);
          await fs.rename(fullPath, newPath);
        }
      }
      parallelCompressProgress = 100;
      updateGlobalProgress(100, 'compressing', compressWeight);
      event.sender.send('workflow-progress', {
        step: 'compressing',
        status: 'completed',
        progress: 100,
        globalProgress: globalProgress,
        parallelPhase: true
      });
      return result;
    };

    const hasGofile = gofileAutoUpload;
    const hasCompress = compress && compressionManager;
    if (hasCompress) {
      archiveResult = await runCompress();
    }
    if (hasGofile) {
      gofileResult = await runGofile(archiveResult);
    }

    checkAborted();

    // Étape 3: Upload vers NAS si demandé (nécessite archiveResult de la compression)
    // Si zipNasEnabled : upload du .zip ; sinon : upload du dossier projet
    if (uploadToNAS && archiveResult) {
        updateGlobalProgress(0, 'uploading', uploadWeight);
        event.sender.send('workflow-progress', {
          step: 'uploading',
          status: 'starting',
          message: 'Vérification de l\'accès NAS...',
          progress: 0,
          globalProgress: globalProgress
        });

        // Vérification pré-upload NAS
        const nasSettings = await loadSettings();
        const nasRemotePath = nasSettings.nas?.remotePath;
        const nasSmbURL = nasSettings.nas?.smbURL;
        let nasAccessible = false;

        if (nasRemotePath) {
          const accessCheck = await nasConnector.checkNASAccess(nasRemotePath);
          nasAccessible = accessCheck.accessible;
        }

        if (!nasAccessible && nasSmbURL) {
          event.sender.send('workflow-progress', {
            step: 'uploading',
            status: 'reconnecting',
            message: 'NAS inaccessible — tentative de reconnexion...',
            progress: 0,
            globalProgress: globalProgress
          });
          const reconnect = await nasConnector.attemptReconnect(nasSmbURL, nasRemotePath, 3, (info) => {
            event.sender.send('workflow-progress', {
              step: 'uploading',
              status: 'reconnecting',
              message: `Reconnexion NAS — tentative ${info.attempt}/${info.maxRetries}...`,
              progress: 0,
              globalProgress: globalProgress,
              reconnectAttempt: info.attempt,
              reconnectMax: info.maxRetries
            });
          });
          nasAccessible = reconnect.success;
        }

        if (!nasAccessible) {
          throw new Error('NAS inaccessible après 3 tentatives de reconnexion');
        } else {
          event.sender.send('workflow-progress', {
            step: 'uploading',
            status: 'starting',
            message: 'Connexion au serveur NAS...',
            progress: 0,
            globalProgress: globalProgress
          });
          try {
            await uploadManager.connect();
            event.sender.send('workflow-progress', {
              step: 'uploading',
              status: 'active',
              message: 'Transfert du fichier vers le NAS...',
              progress: 0,
              globalProgress: globalProgress
            });

            // Démarrer la surveillance NAS pendant l'upload
            if (nasRemotePath) nasConnector.startPing(nasRemotePath, 10000);
            if (nasRemotePath && nasSmbURL) nasConnector.startKeepAlive(nasSmbURL, nasRemotePath, 30000);
            let nasLostDuringUpload = false;
            const onNASDisconnected = () => { nasLostDuringUpload = true; };
            nasConnector.once('nas-disconnected', onNASDisconnected);

            const uploadResult = archiveResult.zipPath
              ? await uploadManager.uploadProjectArchive(
                  archiveResult.zipPath,
                  projectName,
                  (progress) => {
                const stepProgress = progress.progress || 0;
                updateGlobalProgress(stepProgress, 'uploading', uploadWeight);
                let processedBytes = progress.processedBytes;
                if (!processedBytes && progress.transferred && progress.total) {
                  processedBytes = parseSizeToBytes(progress.transferred);
                }
                event.sender.send('workflow-progress', {
                  step: 'uploading',
                  status: 'active',
                  globalProgress: globalProgress,
                  processedBytes: processedBytes,
                  processed: progress.transferred || progress.processed,
                  total: progress.total,
                  speed: progress.speed,
                  eta: progress.eta,
                  elapsed: progress.elapsed,
                  file: progress.file || path.basename(archiveResult.zipPath),
                  message: progress.message || `Transfert vers NAS: ${Math.round(progress.progress || 0)}%`
                });
              }
            )
              : await uploadManager.uploadProjectFolder(
                  archiveResult.projectDir,
                  projectName,
                  (progress) => {
                const stepProgress = progress.progress || 0;
                updateGlobalProgress(stepProgress, 'uploading', uploadWeight);
                let processedBytes = progress.processedBytes;
                if (!processedBytes && progress.transferred && progress.total) {
                  processedBytes = parseSizeToBytes(progress.transferred);
                }
                event.sender.send('workflow-progress', {
                  step: 'uploading',
                  status: 'active',
                  globalProgress: globalProgress,
                  processedBytes: processedBytes,
                  processed: progress.transferred || progress.processed,
                  total: progress.total,
                  speed: progress.speed,
                  eta: progress.eta,
                  elapsed: progress.elapsed,
                  file: progress.file || progress.currentFile || path.basename(archiveResult.projectDir),
                  message: progress.message || `Transfert vers NAS: ${Math.round(progress.progress || 0)}%`
                });
              }
            );

            nasConnector.stopPing();
            nasConnector.stopKeepAlive();
            nasConnector.removeListener('nas-disconnected', onNASDisconnected);
            await uploadManager.disconnect();

            if (!uploadResult.success) {
              throw new Error('NAS — ' + (uploadResult.error || 'Échec upload'));
            }
            updateGlobalProgress(100, 'uploading', uploadWeight);
            event.sender.send('workflow-progress', {
              step: 'uploading',
              status: 'completed',
              progress: 100,
              globalProgress: globalProgress
            });
            await metadataManager.addHistoryEntry({
              type: 'upload',
              projectName,
              status: 'completed',
              uploadResult,
              mondayItemId: mondayItemId || null,
              projectFolderPath,
              profileId: profileId || null
            });
          } catch (uploadError) {
            nasConnector.stopPing();
            nasConnector.stopKeepAlive();
            try { await uploadManager.disconnect(); } catch { /* ignore */ }
            throw new Error('NAS — ' + (uploadError.message || 'Échec upload'));
          }
        }
    }

    checkAborted();

    await metadataManager.saveProjectMetadata(projectName, {
      format,
      sujet,
      initiales,
      filesCount: files.length,
      compressed: compress,
      uploaded: uploadToNAS
    });
    
    // Progression finale à 100%
    updateGlobalProgress(100, 'completed', 0);
    
    const totalTime = (Date.now() - workflowStartTime) / 1000;
    
    // Notification de fin
    if (Notification.isSupported()) {
      new Notification({
        title: 'BackupFlow',
        body: `Projet ${projectName} traité avec succès en ${Math.round(totalTime)}s`
      }).show();
    }
    
    await metadataManager.addHistoryEntry({
      type: 'backup',
      projectName,
      status: 'completed',
      profileId: profileId || null,
      mondayItemId: mondayItemId || null,
      projectFolderPath,
      isSession: isSession || false,
      sessionNumber: workflowData.sessionNumber,
      parentProjectPath: parentProjectPath || null,
      totalSize: totalFilesSize,
      nasUploadSuccess: uploadToNAS ? true : null,
      nasUploadError: null
    });
    
    isWorkflowRunning = false;
    
    return {
      success: true,
      copyResults,
      archiveResult,
      projectName,
      totalTime,
      ssdPersoProjectPath: path.join(finalSSDPersoPath, projectName),
      ssdStudioProjectPath: path.join(finalSSDStudioPath, projectName),
      gofileDownloadPage: gofileResult?.ok ? gofileResult.downloadPage : null,
      gofileError: gofileResult && !gofileResult.ok ? gofileResult.error : null,
      nasUploadSuccess: uploadToNAS ? true : null,
      nasUploadError: null,
      isPartial: false
    };
    
  } catch (error) {
    isWorkflowRunning = false;

    if (error.message === 'WORKFLOW_ABORTED') {
      return {
        success: false,
        aborted: true,
        projectName: projectName || null,
        ssdPersoProjectPath: finalSSDPersoPath && projectName
          ? path.join(finalSSDPersoPath, projectName) : null,
        ssdStudioProjectPath: finalSSDStudioPath && projectName
          ? path.join(finalSSDStudioPath, projectName) : null
      };
    }

    updateGlobalProgress(0, 'error', 0);
    
    await metadataManager.addHistoryEntry({
      type: 'backup',
      projectName,
      status: 'failed',
      error: error.message,
      mondayItemId: mondayItemId || null,
      projectFolderPath: path.join(finalSSDPersoPath || '', projectName),
      profileId: profileId || null
    });
    
    event.sender.send('workflow-progress', {
      step: 'error',
      progress: 0,
      status: 'error',
      message: `Erreur: ${error.message}`,
      globalProgress: 0
    });
    
    let errorType = 'COPY_ERROR';
    if (
      error.message?.includes('HandBrake') ||
      error.message?.includes('compression') ||
      error.message?.includes('compress')
    ) {
      errorType = 'COMPRESSION_FAILED';
    } else if (
      error.message?.includes('zip') ||
      error.message?.includes('ZIP') ||
      error.message?.includes('archive')
    ) {
      errorType = 'ZIP_FAILED';
    } else if (
      error.message?.includes('NAS') ||
      error.message?.includes('nas') ||
      error.message?.includes('upload') ||
      error.message?.includes('SMB') ||
      error.message?.includes('sftp')
    ) {
      errorType = 'NAS_UPLOAD_FAILED';
    }

    return {
      success: false,
      error: error.message,
      errorType
    };
  } finally {
    // S'assurer que l'état est réinitialisé même si une exception non capturée se produit
    isWorkflowRunning = false;
  }
});

// Relancer l'upload NAS pour un item batch partiel
ipcMain.handle('retry-nas-upload', async (event, { zipPath, projectName, remotePath }) => {
  try {
    const settings = await loadSettings();
    const nasRemotePath = remotePath || settings.nas?.remotePath;
    const nasSmbURL = settings.nas?.smbURL;

    const access = await nasConnector.checkNASAccess(nasRemotePath);
    if (!access.accessible) {
      if (nasSmbURL) {
        const reconnect = await nasConnector.attemptReconnect(nasSmbURL, nasRemotePath, 3);
        if (!reconnect.success) {
          return { success: false, error: 'NAS inaccessible après reconnexion' };
        }
      } else {
        return { success: false, error: 'NAS inaccessible' };
      }
    }
    uploadManager.configure(settings.nas);
    await uploadManager.connect();
    const result = await uploadManager.uploadProjectArchive(zipPath, projectName, (progress) => {
      event.sender.send('workflow-progress', {
        step: 'retry-nas',
        status: 'active',
        progress: progress.progress || 0,
        file: progress.file,
        message: `Relance NAS : ${Math.round(progress.progress || 0)}%`
      });
    });
    await uploadManager.disconnect();
    return result;
  } catch (e) {
    try { await uploadManager.disconnect(); } catch { /* ignore */ }
    return { success: false, error: e.message };
  }
});

// Historique et métadonnées
ipcMain.handle('get-history', async (event, limit) => {
  return await metadataManager.getHistory(limit);
});

ipcMain.handle('find-project-by-monday-item', async (event, mondayItemId) => {
  return await metadataManager.findProjectByMondayItemId(mondayItemId);
});

ipcMain.handle('get-next-session-number', async (event, parentFolderPath) => {
  if (!parentFolderPath) return 1;
  try {
    const items = await fs.readdir(parentFolderPath);
    const sessionRegex = /^SESSION_(\d{2})$/;
    let maxNum = 0;
    for (const name of items) {
      const m = name.match(sessionRegex);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxNum) maxNum = n;
      }
    }
    return maxNum + 1;
  } catch (e) {
    return 1;
  }
});

ipcMain.handle('path-exists', async (event, folderPath) => {
  if (!folderPath) return false;
  try {
    return await fs.pathExists(folderPath);
  } catch (e) {
    return false;
  }
});

ipcMain.handle('clear-history', async () => {
  return await metadataManager.clearHistory();
});

ipcMain.handle('get-project-metadata', async (event, projectName) => {
  return await metadataManager.getProjectMetadata(projectName);
});

ipcMain.handle('list-projects', async () => {
  return await metadataManager.listProjects();
});

// Test connexion NAS
ipcMain.handle('test-nas-connection', async (event, config) => {
  try {
    uploadManager.configure(config);
    await uploadManager.connect();
    await uploadManager.disconnect();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Obtenir le chemin monté SMB
ipcMain.handle('get-mounted-smb-path', async (event, smbURL) => {
  try {
    // Créer une configuration temporaire pour utiliser la méthode
    uploadManager.configure({ protocol: 'smb', smbURL });
    const mountedPath = await uploadManager.getMountedSMBShare(smbURL);
    return { success: true, path: mountedPath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ==================== GESTION DES PROFILS ====================

ipcMain.handle('get-profiles', async () => {
  return await metadataManager.getProfiles();
});

ipcMain.handle('get-profile', async (event, profileId) => {
  return await metadataManager.getProfile(profileId);
});

ipcMain.handle('create-profile', async (event, profileData) => {
  return await metadataManager.createProfile(profileData);
});

ipcMain.handle('update-profile', async (event, profileId, profileData) => {
  return await metadataManager.updateProfile(profileId, profileData);
});

ipcMain.handle('delete-profile', async (event, profileId) => {
  return await metadataManager.deleteProfile(profileId);
});

ipcMain.handle('archive-profile', async (event, profileId) => {
  return await metadataManager.archiveProfile(profileId);
});

ipcMain.handle('restore-profile', async (event, profileId) => {
  return await metadataManager.restoreProfile(profileId);
});

ipcMain.handle('send-workflow-success-mail', async (event, params) => {
  try { await mailerManager.sendWorkflowSuccess(params); } catch(e) { console.error('Mail erreur:', e); }
});

ipcMain.handle('send-batch-summary-mail', async (event, { toEmail, toName, projects }) => {
  if (!mailerManager) return { success: false, error: 'Mailer non initialisé' };
  return await mailerManager.sendBatchSummaryMail({ toEmail, toName, projects });
});

ipcMain.handle('send-workflow-stopped-mail', async (event, params) => {
  try { await mailerManager.sendWorkflowStopped(params); } catch(e) { console.error('Mail erreur:', e); }
});

ipcMain.handle('send-error-report-mail', async (event, params) => {
  try { await mailerManager.sendErrorReport(params); } catch(e) { console.error('Mail erreur:', e); }
});

ipcMain.handle('test-resend-connection', async (event, apiKey) => {
  try {
    const testMailer = new MailerManager(apiKey);
    await testMailer.resend.emails.send({
      from: testMailer.from,
      to: 'mpavloff@letudiant.fr',
      subject: '[BackUpFlow] Test de connexion Resend',
      html: '<p>Connexion Resend opérationnelle.</p>'
    });
    return { success: true };
  } catch(e) {
    return { success: false, message: e.message };
  }
});

ipcMain.handle('select-profile-photo', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Sélectionner une photo de profil',
    filters: [
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }
    ],
    properties: ['openFile']
  });
  
  if (result.canceled) {
    return null;
  }
  
  return { filePath: result.filePaths[0] };
});

// Handlers de protection de profil supprimés car la fonctionnalité a été retirée

// FortiClient VPN
// execAsync est déjà défini en haut du fichier

// FortiClient VPN - Handler pour vérifier et connecter le VPN
ipcMain.handle('check-and-connect-vpn', async (event) => {
  console.log('Handler check-and-connect-vpn appelé');
  try {
    // Vérifier si FortiClient est installé
    try {
      await execAsync('which forticlient');
    } catch {
      // FortiClient non trouvé dans PATH, chercher dans Applications
      try {
        await execAsync('test -d "/Applications/FortiClient.app"');
      } catch {
        return { success: false, error: 'FortiClient non installé' };
      }
    }
    
    // Vérifier la connexion VPN active
    try {
      const { stdout } = await execAsync('scutil --nc list | grep Connected');
      if (stdout && stdout.includes('Connected')) {
        // VPN déjà connecté
        return { success: true, connected: true, message: 'VPN déjà connecté' };
      }
    } catch {
      // Pas de VPN connecté, continuer
    }
    
    // Essayer de se connecter automatiquement
    // Note: FortiClient sur macOS nécessite généralement une authentification interactive
    // On peut essayer via scutil mais ça ne fonctionne que pour les VPN configurés dans macOS
    try {
      // Chercher une connexion VPN configurée
      const { stdout } = await execAsync('scutil --nc list');
      const lines = stdout.split('\n');
      
      for (const line of lines) {
        const match = line.match(/^\s*\*\s*(.+)$/);
        if (match) {
          const vpnName = match[1].trim();
          // Essayer de se connecter (nécessite généralement un mot de passe)
          // Pour l'instant, on retourne juste l'info
          return {
            success: true,
            connected: false,
            message: `VPN "${vpnName}" trouvé mais connexion nécessite authentification`,
            vpnName
          };
        }
      }
      
      return { success: false, error: 'Aucune connexion VPN configurée' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('mount-smb-share', async (event, smbURL) => {
  try {
    // Utiliser mount_smbfs ou open pour monter le partage
    // Extraire les informations de l'URL
    const urlMatch = smbURL.match(/^smb:\/\/([^\/]+)\/(.+)$/);
    if (!urlMatch) {
      throw new Error('URL SMB invalide');
    }
    
    const server = urlMatch[1];
    const share = urlMatch[2];
    
    // Essayer de monter avec open (ouvre Finder et permet le montage)
    // Pour un montage automatique, on peut utiliser mount_smbfs mais ça nécessite des credentials
    try {
      // Vérifier d'abord si c'est déjà monté
      const { stdout } = await execAsync(`mount | grep -i "${share}"`);
      if (stdout) {
        return { success: true, message: 'Partage déjà monté', path: `/Volumes/${share}` };
      }
    } catch {
      // Pas monté, continuer
    }
    
    // Essayer avec open pour ouvrir le partage (nécessite interaction utilisateur)
    // ou utiliser mount_smbfs avec credentials
    // Pour l'instant, on ouvre juste Finder avec CMD+K
    await execAsync(`open "smb://${server}/${share}"`);
    
    return {
      success: true,
      message: 'Fenêtre de connexion ouverte. Veuillez vous authentifier.',
      needsAuth: true
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ==================== NAS CONNECTOR ====================

ipcMain.handle('nas-check-vpn', async () => {
  try {
    return await nasConnector.checkVPN();
  } catch (e) {
    return { isRunning: false, isConnected: false, installed: false, error: e.message };
  }
});

ipcMain.handle('nas-connect-vpn', async (event, vpnName) => {
  try {
    return await nasConnector.connectVPN(vpnName);
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('nas-mount-smb', async (event, smbURL) => {
  try {
    return await nasConnector.mountSMB(smbURL);
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('nas-open-finder', async (event, mountedPath) => {
  try {
    await nasConnector.openFinderOnNAS(mountedPath);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('nas-full-protocol', async (event) => {
  try {
    const settings = await loadSettings();
    const result = await nasConnector.fullProtocol(settings, (step) => {
      event.sender.send('nas-protocol-step', step);
    });
    return result;
  } catch (e) {
    return { vpn: null, smb: null, finder: false, accessible: false, error: e.message };
  }
});

ipcMain.handle('nas-check-access', async (event, remotePath) => {
  try {
    if (!remotePath) {
      const settings = await loadSettings();
      remotePath = settings.nas?.remotePath;
    }
    return await nasConnector.checkNASAccess(remotePath);
  } catch (e) {
    return { accessible: false, reason: e.message };
  }
});

ipcMain.handle('nas-check-smb-mount', async (event, smbURL) => {
  try {
    if (!smbURL) {
      const settings = await loadSettings();
      smbURL = settings.nas?.smbURL;
    }
    return await nasConnector.checkSMBMount(smbURL);
  } catch (e) {
    return { mounted: false, path: null, error: e.message };
  }
});

ipcMain.handle('get-nas-status', async () => {
  try {
    const settings = await loadSettings();
    const remotePath = settings.nas?.remotePath;
    if (!remotePath) return { status: 'disabled', label: 'NAS désactivé' };
    const access = await nasConnector.checkNASAccess(remotePath);
    if (!access.accessible) return { status: 'disconnected', label: access.reason || 'NAS inaccessible', path: remotePath };
    if (!access.writable) return { status: 'warning', label: 'NAS monté, écriture impossible', path: remotePath };
    return { status: 'connected', label: `NAS monté — ${remotePath}`, path: remotePath };
  } catch (e) {
    return { status: 'disconnected', label: e.message };
  }
});

ipcMain.handle('nas-full-diagnostic', async (event, requiredBytes) => {
  try {
    const settings = await loadSettings();
    const remotePath = settings.nas?.remotePath;
    return await nasConnector.fullDiagnostic(remotePath, requiredBytes || 0);
  } catch (e) {
    return { accessible: false, writable: false, enoughSpace: false, errorKey: 'NAS_UNREACHABLE', error: e.message };
  }
});

ipcMain.handle('nas-verify-write-access', async (event, remotePath) => {
  try {
    if (!remotePath) {
      const settings = await loadSettings();
      remotePath = settings.nas?.remotePath;
    }
    return await nasConnector.verifyWriteAccess(remotePath);
  } catch (e) {
    return { writable: false, reason: e.message };
  }
});

// Ouvrir une URL externe dans le navigateur par défaut
ipcMain.handle('open-external-url', async (event, url) => {
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ==================== GOFILE ====================
// Endpoint actuel : /uploadFile (l’ancien /upload renvoie 404).
// FormData natif + Blob pour éviter "error-nextpart" du package form-data.

async function performGofileUpload(folderPath, progressCallback, compressedFolderPath = null) {
  try {
    if (!folderPath || !fs.existsSync(folderPath)) {
      return { ok: false, error: 'Dossier introuvable : ' + (folderPath || '(vide)') };
    }

    let server = null;
    try {
      const getServerRes = await fetch('https://api.gofile.io/getServer');
      const getServerData = await getServerRes.json();
      if (getServerData.status === 'ok' && getServerData.data?.server) {
        server = getServerData.data.server;
      }
    } catch (e) {
      // Fallback
    }
    if (!server) {
      try {
        const serverRes = await fetch('https://api.gofile.io/servers');
        const serverData = await serverRes.json();
        if (serverData.status === 'ok' && serverData.data?.servers?.length) {
          server = serverData.data.servers[0].name;
        }
      } catch (e2) {
        return { ok: false, error: 'Impossible de contacter les serveurs Gofile.' };
      }
    }
    if (!server) {
      return { ok: false, error: 'Impossible de contacter les serveurs Gofile.' };
    }

    const entries = fs.readdirSync(folderPath);
    const originalFiles = entries.filter(f => fs.statSync(path.join(folderPath, f)).isFile());
    const hasCompressed = compressedFolderPath && fs.existsSync(compressedFolderPath);
    let compressedFiles = [];
    if (hasCompressed) {
      const compEntries = fs.readdirSync(compressedFolderPath);
      compressedFiles = compEntries.filter(f => fs.statSync(path.join(compressedFolderPath, f)).isFile());
    }

    if (originalFiles.length === 0 && (!hasCompressed || compressedFiles.length === 0)) {
      return { ok: false, error: 'Le dossier projet est vide.' };
    }

    const totalFiles = originalFiles.length + (hasCompressed ? compressedFiles.length : 0);
    let downloadPage = null;
    let code = null;
    let folderId = null;
    let guestToken = null;

    async function uploadFile(filePath, fileName, targetFolderId) {
      const form = new FormData();
      form.append('file', fs.createReadStream(filePath), fileName);
      if (targetFolderId) {
        form.append('folderId', targetFolderId);
      }

      const uploadUrl = `https://${server}.gofile.io/uploadFile`;
      const urlObj = new URL(uploadUrl);
      const rawText = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: urlObj.hostname,
          path: urlObj.pathname,
          method: 'POST',
          headers: { ...form.getHeaders(), ...(guestToken ? { 'Authorization': `Bearer ${guestToken}` } : {}) }
        }, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => resolve(body));
        });
        req.on('error', reject);
        form.pipe(req);
      });
      const uploadData = JSON.parse(rawText);
      if (uploadData.status !== 'ok') {
        const msg = uploadData.message || uploadData.status || 'erreur inconnue';
        throw new Error(`Échec upload "${fileName}" : ${msg}`);
      }
      return uploadData;
    }

    // Upload des originaux dans le dossier racine
    for (let i = 0; i < originalFiles.length; i++) {
      const fileName = originalFiles[i];
      const filePath = path.join(folderPath, fileName);

      progressCallback({ done: i, total: totalFiles, fileName });

      const rawText = await new Promise((resolve, reject) => {
        const form = new FormData();
        form.append('file', fs.createReadStream(filePath), fileName);
        if (folderId) form.append('folderId', folderId);

        const uploadUrl = `https://${server}.gofile.io/uploadFile`;
        const urlObj = new URL(uploadUrl);
        const req = https.request({
          hostname: urlObj.hostname,
          path: urlObj.pathname,
          method: 'POST',
          headers: { ...form.getHeaders(), ...(guestToken ? { 'Authorization': `Bearer ${guestToken}` } : {}) }
        }, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => resolve(body));
        });
        req.on('error', reject);
        form.pipe(req);
      });

      let uploadData;
      try {
        uploadData = JSON.parse(rawText);
      } catch (parseErr) {
        const preview = rawText.length > 80 ? rawText.slice(0, 80) + '…' : rawText;
        return { ok: false, error: `Réponse Gofile invalide. Début : "${preview.replace(/"/g, "'")}"` };
      }

      if (uploadData.status !== 'ok') {
        const msg = uploadData.message || uploadData.status || 'erreur inconnue';
        return { ok: false, error: `Échec upload "${fileName}" : ${msg}` };
      }

      if (uploadData.data) {
        if (!folderId) {
          folderId = uploadData.data.parentFolder || null;
          guestToken = uploadData.data.guestToken || null;
        }
        const newCode = uploadData.data.code || code;
        const newPage = uploadData.data.downloadPage
          || uploadData.data.pageDownload?.fullUrl
          || (newCode ? `https://gofile.io/d/${newCode}` : null);
        if (newCode) code = newCode;
        if (newPage) downloadPage = newPage;
      }
    }

    // Si compressedFolderPath fourni : upload des compressés dans le même dossier racine
    if (hasCompressed) {
      let doneCount = originalFiles.length;
      for (let i = 0; i < compressedFiles.length; i++) {
        const fileName = compressedFiles[i];
        const filePath = path.join(compressedFolderPath, fileName);

        progressCallback({ done: doneCount, total: totalFiles, fileName });

        const uploadRes = await uploadFile(filePath, fileName, folderId);
        if (uploadRes.data) {
          if (!folderId) {
            folderId = uploadRes.data.parentFolder || null;
            guestToken = uploadRes.data.guestToken || null;
          }
          const newPage = uploadRes.data.downloadPage
            || uploadRes.data.pageDownload?.fullUrl
            || (uploadRes.data.code ? `https://gofile.io/d/${uploadRes.data.code}` : null);
          if (newPage) downloadPage = newPage;
        }
        doneCount++;
      }
    }

    progressCallback({ done: totalFiles, total: totalFiles, fileName: null });

    if (!downloadPage && code) {
      downloadPage = `https://gofile.io/d/${code}`;
    }
    return { ok: true, downloadPage: downloadPage || null };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

ipcMain.handle('gofile-upload', async (event, folderPath) => {
  const progressCallback = (data) => event.sender.send('gofile-progress', data);
  return await performGofileUpload(folderPath, progressCallback);
});
