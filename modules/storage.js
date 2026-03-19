const fs = require('fs-extra');
const path = require('path');
const archiver = require('archiver');
const ProgressTracker = require('./progress-tracker');

/**
 * Module de stockage pour la copie simultanée vers deux destinations
 */
class StorageManager {
  constructor() {
    this.config = {
      ssdPerso: null,
      ssdStudio: null
    };
  }

  /**
   * Configure les chemins de destination
   */
  setDestinations(ssdPerso, ssdStudio) {
    this.config.ssdPerso = ssdPerso;
    this.config.ssdStudio = ssdStudio;
  }

  /**
   * Vérifie l'espace disque disponible
   */
  async checkDiskSpace(directory, requiredBytes) {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      
      // Utiliser df pour obtenir l'espace disponible
      const { stdout } = await execAsync(`df -k "${directory}"`);
      const lines = stdout.split('\n');
      if (lines.length > 1) {
        const parts = lines[1].split(/\s+/);
        const availableBytes = parseInt(parts[3]) * 1024; // Convertir KB en bytes
        
        return {
          available: availableBytes,
          required: requiredBytes,
          sufficient: availableBytes >= requiredBytes,
          formatted: {
            available: this.formatBytes(availableBytes),
            required: this.formatBytes(requiredBytes)
          }
        };
      }
    } catch (error) {
      console.error('Erreur lors de la vérification de l\'espace disque:', error);
    }
    
    return { available: 0, required: requiredBytes, sufficient: false };
  }

  /**
   * Copie un fichier vers une destination avec progression détaillée
   */
  async copyFile(source, destination, onProgress = null) {
    try {
      const destDir = path.dirname(destination);
      
      // Ne pas essayer de créer le dossier si c'est la racine d'un volume (commence par /Volumes/ et n'a pas de sous-dossier)
      const isVolumeRoot = destDir.match(/^\/Volumes\/[^\/]+$/);
      
      if (isVolumeRoot) {
        // C'est la racine d'un volume, vérifier qu'il existe
        if (!await fs.pathExists(destDir)) {
          throw new Error(`Le volume ${destDir} n'existe pas`);
        }
        // Le volume existe, on peut continuer sans créer de dossier
      } else if (await fs.pathExists(destDir)) {
        // Le dossier existe déjà, pas besoin de le créer
      } else {
        // Créer le dossier - utiliser mkdir -p directement pour éviter les problèmes de permissions
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        try {
          await execAsync(`mkdir -p "${destDir}"`);
          // Vérifier que le dossier a bien été créé
          if (!await fs.pathExists(destDir)) {
            throw new Error(`Le dossier ${destDir} n'a pas pu être créé`);
          }
        } catch (mkdirErr) {
          // Si mkdir échoue, essayer avec fs.ensureDir en dernier recours
          try {
            await fs.ensureDir(destDir);
          } catch (ensureErr) {
            throw new Error(`Impossible de créer le dossier ${destDir}: ${mkdirErr.message || ensureErr.message}`);
          }
        }
      }
      
      const stats = await fs.stat(source);
      const fileSize = stats.size;
      const tracker = new ProgressTracker(fileSize);
      
      // Simuler la progression pendant la copie
      // Note: fs.copy ne fournit pas de callback de progression native
      // On utilise un intervalle pour simuler la progression
      const startTime = Date.now();
      const updateInterval = setInterval(() => {
        if (tracker.processedSize < fileSize) {
          // Estimer la progression basée sur le temps
          const elapsed = (Date.now() - startTime) / 1000;
          // Estimation basée sur une vitesse moyenne (à ajuster selon tests)
          const estimatedSpeed = 100 * 1024 * 1024; // 100 MB/s par défaut
          const estimated = Math.min(fileSize, elapsed * estimatedSpeed);
          tracker.update(estimated);
          
          if (onProgress) {
            const info = tracker.getProgressInfo();
            onProgress({
              file: path.basename(destination),
              progress: info.progress,
              status: 'copying',
              processed: info.processedFormatted,
              total: info.totalFormatted,
              speed: info.speedFormatted,
              eta: info.etaFormatted
            });
          }
        }
      }, 100); // Mise à jour toutes les 100ms
      
      await fs.copy(source, destination);
      
      clearInterval(updateInterval);
      tracker.update(fileSize);
      
      if (onProgress) {
        const info = tracker.getProgressInfo();
        onProgress({
          file: path.basename(destination),
          progress: 100,
          status: 'completed',
          processed: info.processedFormatted,
          total: info.totalFormatted,
          speed: info.speedFormatted,
          elapsed: info.elapsedFormatted
        });
      }
      
      return { success: true, path: destination };
    } catch (error) {
      if (onProgress) {
        onProgress({ file: path.basename(source), progress: 0, status: 'error', error: error.message });
      }
      return { success: false, error: error.message };
    }
  }

  /**
   * Génère un nom de fichier avec le nom du projet pour les fichiers vidéo
   * Ajoute un suffixe numérique (1, 2, etc.) pour différencier les fichiers multiples
   */
  generateProjectFileName(originalPath, projectName, fileIndex = null) {
    const ext = path.extname(originalPath).toLowerCase();
    // Si c'est un fichier vidéo (.mp4), utiliser le nom du projet avec suffixe
    if (ext === '.mp4') {
      if (fileIndex !== null && fileIndex !== undefined) {
        return `${projectName}_${fileIndex + 1}${ext}`;
      }
      return `${projectName}${ext}`;
    }
    // Sinon, garder le nom original
    return path.basename(originalPath);
  }

  /**
   * Copie simultanée vers SSD PERSO (dossier de projet complet)
   */
  async copyToSSDPerso(projectName, files, fileNames, onProgress = null, checkAborted = null) {
    if (!this.config.ssdPerso) {
      throw new Error('SSD PERSO non configuré');
    }
    
    const projectPath = path.join(this.config.ssdPerso, projectName);
    await fs.ensureDir(projectPath);
    
    const results = [];
    
    for (let i = 0; i < files.length; i++) {
      if (checkAborted) checkAborted();
      const file = files[i];
      const fileName = fileNames[i];
      const destPath = path.join(projectPath, fileName);
      
      let finalDestPath = destPath;
      if (await fs.pathExists(destPath) && file.path !== destPath) {
        const ext = path.extname(fileName);
        const nameWithoutExt = path.basename(fileName, ext);
        let counter = 1;
        do {
          finalDestPath = path.join(projectPath, `${nameWithoutExt}_${counter}${ext}`);
          counter++;
        } while (await fs.pathExists(finalDestPath));
      }
      
      if (onProgress) {
        onProgress({
          destination: 'SSD PERSO',
          file: fileName,
          progress: 0,
          status: 'copying'
        });
      }
      
      const result = await this.copyFile(file.path, finalDestPath, (progress) => {
        if (onProgress) {
          onProgress({
            destination: 'SSD PERSO',
            file: fileName,
            progress: progress.progress,
            status: progress.status
          });
        }
      });
      
      results.push({ ...result, originalPath: file.path, destPath: finalDestPath, renamed: finalDestPath !== destPath });
    }
    
    return {
      destination: this.config.ssdPerso,
      projectPath,
      results,
      success: results.every(r => r.success)
    };
  }

  /**
   * Crée un ZIP contenant un fichier .mp4 avec le même nom que le fichier
   */
  async createZipForMP4(mp4Path, zipPath, onProgress = null) {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', {
        zlib: { level: 9 } // Compression maximale
      });
      
      output.on('close', () => {
        if (onProgress) {
          onProgress({
            progress: 100,
            status: 'completed'
          });
        }
        resolve({
          success: true,
          zipPath,
          size: archive.pointer()
        });
      });
      
      archive.on('error', (err) => {
        reject(err);
      });
      
      if (onProgress) {
        archive.on('progress', (progress) => {
          const processed = progress.fs.processedBytes || 0;
          const total = progress.fs.totalBytes || 1;
          const percent = Math.min(100, (processed / total) * 100);
          
          onProgress({
            progress: percent,
            status: 'creating_zip'
          });
        });
      }
      
      archive.pipe(output);
      
      // Ajouter le fichier .mp4 dans le ZIP avec son nom de base
      const fileName = path.basename(mp4Path);
      archive.file(mp4Path, { name: fileName });
      
      archive.finalize();
    });
  }

  /**
   * Crée un ZIP contenant tous les fichiers du projet
   */
  async createProjectZip(projectName, files, zipPath, onProgress = null) {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', {
        zlib: { level: 9 } // Compression maximale
      });
      
      output.on('close', () => {
        if (onProgress) {
          onProgress({
            progress: 100,
            status: 'completed'
          });
        }
        resolve({
          success: true,
          zipPath,
          size: archive.pointer()
        });
      });
      
      archive.on('error', (err) => {
        reject(err);
      });
      
      if (onProgress) {
        archive.on('progress', (progress) => {
          const processed = progress.fs.processedBytes || 0;
          const total = progress.fs.totalBytes || 1;
          const percent = Math.min(100, (processed / total) * 100);
          
          onProgress({
            progress: percent,
            status: 'creating_zip'
          });
        });
      }
      
      archive.pipe(output);
      
      // Compter les fichiers vidéo pour la nomenclature
      const videoFiles = files.filter(f => {
        const ext = path.extname(f.path).toLowerCase();
        return ext === '.mp4' || f.type === 'video';
      });
      let videoIndex = 0;
      
      // Ajouter tous les fichiers au ZIP
      for (const file of files) {
        const isVideo = path.extname(file.path).toLowerCase() === '.mp4' || file.type === 'video';
        const fileName = this.generateProjectFileName(file.path, projectName, isVideo ? videoIndex : null);
        if (isVideo) videoIndex++;
        
        // Ajouter le fichier au ZIP avec son nouveau nom
        archive.file(file.path, { name: fileName });
      }
      
      archive.finalize();
    });
  }

  /**
   * Copie vers SSD STUDIO (fichiers dans un dossier portant le nom du projet)
   */
  async copyToSSDStudio(files, projectName, fileNames, onProgress = null, checkAborted = null) {
    if (!this.config.ssdStudio) {
      throw new Error('SSD STUDIO non configuré');
    }
    
    // Vérifier que le dossier SSD Studio existe (macOS : essayer NFD si NFC échoue)
    let studioPath = this.config.ssdStudio;
    let studioPathExists = await fs.pathExists(studioPath);
    if (!studioPathExists && typeof studioPath.normalize === 'function') {
      const nfdPath = studioPath.normalize('NFD');
      if (await fs.pathExists(nfdPath)) {
        studioPath = nfdPath;
        this.config.ssdStudio = nfdPath;
        studioPathExists = true;
      }
    }
    if (!studioPathExists) {
      throw new Error(`Le dossier SSD Studio n'existe pas :\n${this.config.ssdStudio}\n\nVérifiez le chemin dans Paramètres (SSD Studio) ou dans la configuration du profil.`);
    }
    
    const projectDir = path.join(studioPath, projectName);
    
    if (!await fs.pathExists(projectDir)) {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      try {
        await execAsync(`mkdir -p "${projectDir}"`);
        if (!await fs.pathExists(projectDir)) {
          throw new Error(`Le dossier ${projectDir} n'a pas pu être créé`);
        }
      } catch (mkdirErr) {
        try {
          await fs.ensureDir(projectDir);
        } catch (ensureErr) {
          throw new Error(`Impossible de créer le dossier ${projectDir}: ${mkdirErr.message || ensureErr.message}`);
        }
      }
    }
    
    const results = [];
    const totalFiles = files.length;
    let completedFiles = 0;
    
    for (let i = 0; i < files.length; i++) {
      if (checkAborted) checkAborted();
      const file = files[i];
      const fileName = fileNames[i];
      const destPath = path.join(projectDir, fileName);
      
      let finalDestPath = destPath;
      if (await fs.pathExists(finalDestPath)) {
        const ext = path.extname(fileName);
        const baseName = path.basename(fileName, ext);
        let counter = 1;
        do {
          finalDestPath = path.join(projectDir, `${baseName}_${counter}${ext}`);
          counter++;
        } while (await fs.pathExists(finalDestPath));
      }
      
      if (onProgress) {
        onProgress({
          destination: 'SSD STUDIO',
          file: fileName,
          progress: (completedFiles / totalFiles) * 100,
          status: 'copying',
          message: `Copie vers SSD Studio... ${completedFiles + 1}/${totalFiles}`
        });
      }
      
      const result = await this.copyFile(file.path, finalDestPath, (progress) => {
        if (onProgress) {
          const fileProgress = (completedFiles / totalFiles) * 100;
          const currentFileProgress = (progress.progress / totalFiles);
          onProgress({
            destination: 'SSD STUDIO',
            file: fileName,
            progress: fileProgress + currentFileProgress,
            status: progress.status,
            processed: progress.processed,
            total: progress.total,
            speed: progress.speed,
            eta: progress.eta
          });
        }
      });
      
      completedFiles++;
      results.push({ ...result, originalPath: file.path, destPath: finalDestPath, renamed: finalDestPath !== destPath });
    }
    
    return {
      destination: projectDir,
      projectPath: projectDir,
      results,
      success: results.every(r => r.success)
    };
  }

  /**
   * Copie simultanée vers les deux destinations avec progression globale
   */
  async copyToBothDestinations(projectName, files, onProgress = null, checkAborted = null) {
    // Pré-calculer les noms une seule fois pour les deux destinations
    let videoIndex = 0;
    const fileNames = files.map(f => {
      const isVideo = f.type === 'video';
      if (isVideo) {
        videoIndex++;
        const ext = path.extname(f.path).toLowerCase();
        return `${projectName}_${videoIndex}${ext}`;
      }
      return path.basename(f.path);
    });

    if (this.config.ssdPerso && this.config.ssdStudio) {
      const normPerso = path.resolve(this.config.ssdPerso);
      const normStudio = path.resolve(this.config.ssdStudio);
      if (normPerso === normStudio) {
        console.warn('[Storage] SSD Perso et SSD Studio pointent vers le même dossier — copie Studio ignorée pour éviter les doublons');
        const totalSizeSingle = files.reduce((sum, f) => sum + (f.size || 0), 0);
        const globalTracker = new ProgressTracker(totalSizeSingle);
        let globalProcessed = 0;
        const result = await this.copyToSSDPerso(projectName, files, fileNames, (progress) => {
          if (progress.progress === 100 && progress.status === 'completed') {
            globalProcessed += totalSizeSingle;
            globalTracker.update(globalProcessed);
          }
          if (onProgress) {
            const globalInfo = globalTracker.getProgressInfo();
            onProgress({
              ...progress,
              destination: 'SSD PERSO',
              globalProgress: globalInfo.progress,
              globalProcessed: globalInfo.processedFormatted,
              globalTotal: globalInfo.totalFormatted,
              globalSpeed: globalInfo.speedFormatted,
              globalETA: globalInfo.etaFormatted
            });
          }
        }, checkAborted);
        globalTracker.update(totalSizeSingle);
        if (onProgress) {
          const globalInfo = globalTracker.getProgressInfo();
          onProgress({
            step: 'copying',
            progress: 100,
            status: 'completed',
            message: 'Copie terminée',
            globalProgress: 100,
            globalProcessed: globalInfo.processedFormatted,
            globalTotal: globalInfo.totalFormatted,
            elapsed: globalInfo.elapsedFormatted
          });
        }
        return {
          ssdPerso: result,
          ssdStudio: { skipped: true, reason: 'same_path_as_perso' },
          success: result.success
        };
      }
    }

    let totalSize = files.reduce((sum, f) => sum + (f.size || 0), 0) * 2;
    const globalTracker = new ProgressTracker(totalSize);
    let globalProcessed = 0;

    const promises = [];
    
    // Copie vers SSD PERSO (dossier projet)
    promises.push(
      this.copyToSSDPerso(projectName, files, fileNames, (progress) => {
        // Mettre à jour la progression globale
        if (progress.progress === 100 && progress.status === 'completed') {
          globalProcessed += files.reduce((sum, f) => sum + (f.size || 0), 0);
          globalTracker.update(globalProcessed);
        }
        
        if (onProgress) {
          const globalInfo = globalTracker.getProgressInfo();
          onProgress({
            ...progress,
            destination: 'SSD PERSO',
            globalProgress: globalInfo.progress,
            globalProcessed: globalInfo.processedFormatted,
            globalTotal: globalInfo.totalFormatted,
            globalSpeed: globalInfo.speedFormatted,
            globalETA: globalInfo.etaFormatted
          });
        }
      }, checkAborted)
    );
    
    // Copie vers SSD STUDIO
    promises.push(
      this.copyToSSDStudio(files, projectName, fileNames, (progress) => {
        // Mettre à jour la progression globale
        if (progress.progress === 100 && progress.status === 'completed') {
          globalProcessed += files.reduce((sum, f) => sum + (f.size || 0), 0);
          globalTracker.update(globalProcessed);
        }
        
        if (onProgress) {
          const globalInfo = globalTracker.getProgressInfo();
          onProgress({
            ...progress,
            destination: 'SSD STUDIO',
            globalProgress: globalInfo.progress,
            globalProcessed: globalInfo.processedFormatted,
            globalTotal: globalInfo.totalFormatted,
            globalSpeed: globalInfo.speedFormatted,
            globalETA: globalInfo.etaFormatted
          });
        }
      }, checkAborted)
    );
    
    const results = await Promise.all(promises);
    
    // Mettre à jour la progression finale
    globalTracker.update(totalSize);
    if (onProgress) {
      const globalInfo = globalTracker.getProgressInfo();
      onProgress({
        step: 'copying',
        progress: 100,
        status: 'completed',
        message: 'Copie terminée',
        globalProgress: 100,
        globalProcessed: globalInfo.processedFormatted,
        globalTotal: globalInfo.totalFormatted,
        elapsed: globalInfo.elapsedFormatted
      });
    }
    
    return {
      ssdPerso: results[0],
      ssdStudio: results[1],
      success: results.every(r => r.success)
    };
  }

  /**
   * Crée un journal d'opération
   */
  async logOperation(operation, details) {
    const logDir = path.join(require('os').homedir(), '.backupflow', 'logs');
    await fs.ensureDir(logDir);
    
    const logFile = path.join(logDir, `operation_${Date.now()}.json`);
    const logEntry = {
      timestamp: new Date().toISOString(),
      operation,
      details
    };
    
    await fs.writeJson(logFile, logEntry, { spaces: 2 });
    return logFile;
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }
}

module.exports = StorageManager;

