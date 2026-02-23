const fs = require('fs-extra');
const Client = require('ssh2-sftp-client');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const ProgressTracker = require('./progress-tracker');

const execAsync = promisify(exec);

/**
 * Module d'upload vers NAS avec support SFTP/SCP et SMB
 */
class UploadManager {
  constructor() {
    this.client = new Client();
    this.config = null;
    this.mountedSMBPath = null;
  }

  /**
   * Configure la connexion NAS
   */
  configure(config) {
    this.config = {
      protocol: config.protocol || 'sftp', // sftp, scp, smb
      // Pour SFTP/SCP
      host: config.host,
      port: config.port || 22,
      username: config.username,
      password: config.password,
      privateKey: config.privateKey || null,
      // Pour SMB
      smbURL: config.smbURL, // ex: smb://srvfiler01.etudiant.lan/Video
      remotePath: config.remotePath || (config.protocol === 'smb' ? '/' : '/backups')
    };
  }

  /**
   * Convertit une URL SMB en chemin monté ou retourne le chemin monté existant
   */
  async getMountedSMBShare(smbURL) {
    if (!smbURL || !smbURL.startsWith('smb://')) {
      throw new Error('URL SMB invalide. Format attendu: smb://server/share');
    }

    // Extraire le serveur et le partage de l'URL
    const urlParts = smbURL.replace('smb://', '').split('/');
    const server = urlParts[0];
    const share = urlParts.slice(1).join('/');

    // Vérifier si le partage est déjà monté
    try {
      const { stdout } = await execAsync('mount | grep -i smb');
      const lines = stdout.split('\n');
      
      for (const line of lines) {
        // Chercher un montage qui correspond au serveur
        if (line.includes(server)) {
          // Extraire le chemin de montage (généralement /Volumes/...)
          const mountMatch = line.match(/on (\/Volumes\/[^\s]+)/);
          if (mountMatch) {
            const mountPoint = mountMatch[1];
            const sharePath = share ? path.join(mountPoint, share) : mountPoint;
            
            // Vérifier si le chemin existe
            if (await fs.pathExists(sharePath)) {
              return sharePath;
            }
          }
        }
      }
    } catch (error) {
      // Aucun montage trouvé ou erreur
    }

    // Essayer de trouver dans /Volumes
    const possiblePaths = [
      `/Volumes/${share}`,
      `/Volumes/${server}/${share}`,
      `/Volumes/${server}-${share}`
    ];

    for (const possiblePath of possiblePaths) {
      if (await fs.pathExists(possiblePath)) {
        return possiblePath;
      }
    }

    // Si pas monté, suggérer de le monter
    throw new Error(
      `Le partage SMB n'est pas monté. Veuillez le monter manuellement:\n` +
      `1. Ouvrez Finder\n` +
      `2. Cmd+K ou Aller > Se connecter au serveur\n` +
      `3. Entrez: ${smbURL}\n` +
      `4. Une fois monté, relancez l'upload`
    );
  }

  /**
   * Connecte au serveur NAS (pour SFTP) ou vérifie le montage SMB
   */
  async connect() {
    if (!this.config) {
      throw new Error('Configuration NAS non définie');
    }

    if (this.config.protocol === 'smb') {
      // Pour SMB, vérifier que le partage est monté
      try {
        this.mountedSMBPath = await this.getMountedSMBShare(this.config.smbURL);
        return true;
      } catch (error) {
        throw new Error(`Partage SMB non accessible: ${error.message}`);
      }
    } else {
      // Pour SFTP/SCP, connexion classique
      try {
        await this.client.connect({
          host: this.config.host,
          port: this.config.port,
          username: this.config.username,
          password: this.config.password,
          privateKey: this.config.privateKey
        });
        return true;
      } catch (error) {
        throw new Error(`Échec de connexion au NAS: ${error.message}`);
      }
    }
  }

  /**
   * Déconnecte du serveur
   */
  async disconnect() {
    if (this.config && this.config.protocol === 'smb') {
      // Pour SMB, rien à faire (le système gère le montage)
      this.mountedSMBPath = null;
    } else {
      // Pour SFTP
      try {
        await this.client.end();
      } catch (error) {
        console.error('Erreur lors de la déconnexion:', error);
      }
    }
  }

  /**
   * Vérifie si le fichier existe déjà sur le serveur
   */
  async fileExists(remotePath) {
    try {
      if (this.config.protocol === 'smb') {
        // Si remotePath est déjà absolu, l'utiliser tel quel
        const fullPath = path.isAbsolute(remotePath) 
          ? remotePath 
          : path.join(this.mountedSMBPath, remotePath);
        return await fs.pathExists(fullPath);
      } else {
        const stats = await this.client.stat(remotePath);
        return stats !== null;
      }
    } catch (error) {
      return false;
    }
  }

  /**
   * Upload un fichier avec gestion des reprises
   */
  async uploadFile(localPath, remotePath, onProgress = null, maxRetries = 3) {
    let attempt = 0;
    let lastError = null;

    while (attempt < maxRetries) {
      try {
        if (this.config.protocol === 'smb') {
          // Upload SMB via copie de fichier
          // Si remotePath est déjà un chemin absolu (commence par /), l'utiliser directement
          // sinon le construire depuis mountedSMBPath
          const fullRemotePath = path.isAbsolute(remotePath) 
            ? remotePath 
            : path.join(this.mountedSMBPath, remotePath);
          
          const remoteDir = path.dirname(fullRemotePath);
          
          // S'assurer que le dossier existe
          await fs.ensureDir(remoteDir);

          // Progression détaillée pour SMB
          const localStats = await fs.stat(localPath);
          const totalSize = localStats.size;
          const tracker = new ProgressTracker(totalSize);
          
          const startTime = Date.now();
          const updateInterval = setInterval(() => {
            if (tracker.processedSize < totalSize) {
              // Estimer la progression basée sur le temps
              const elapsed = (Date.now() - startTime) / 1000;
              // Estimation basée sur une vitesse moyenne (à ajuster selon tests)
              const estimatedSpeed = 50 * 1024 * 1024; // 50 MB/s par défaut pour réseau
              const estimated = Math.min(totalSize, elapsed * estimatedSpeed);
              tracker.update(estimated);
              
              if (onProgress) {
                const info = tracker.getProgressInfo();
                onProgress({
                  file: path.basename(localPath),
                  progress: info.progress,
                  transferred: info.processedFormatted,
                  total: info.totalFormatted,
                  speed: info.speedFormatted,
                  eta: info.etaFormatted,
                  elapsed: info.elapsedFormatted,
                  status: 'uploading'
                });
              }
            }
          }, 100);

          // Copier le fichier
          await fs.copy(localPath, fullRemotePath);
          
          clearInterval(updateInterval);
          tracker.update(totalSize);

          if (onProgress) {
            const info = tracker.getProgressInfo();
            onProgress({
              file: path.basename(localPath),
              progress: 100,
              transferred: info.processedFormatted,
              total: info.totalFormatted,
              speed: info.speedFormatted,
              elapsed: info.elapsedFormatted,
              status: 'completed'
            });
          }

          // Vérifier l'intégrité
          const remoteStats = await fs.stat(fullRemotePath);
          if (localStats.size !== remoteStats.size) {
            throw new Error('Les tailles de fichier ne correspondent pas après upload');
          }

          return {
            success: true,
            remotePath: fullRemotePath,
            size: localStats.size
          };
        } else {
          // Upload SFTP
          const remoteDir = path.dirname(remotePath);
          await this.ensureRemoteDirectory(remoteDir);

          // Upload avec progression détaillée
          const localStats = await fs.stat(localPath);
          const totalSize = localStats.size;
          const tracker = new ProgressTracker(totalSize);
          
          await this.client.fastPut(localPath, remotePath, {
            step: (transferred, chunk, total) => {
              if (onProgress && total > 0) {
                tracker.update(transferred);
                const info = tracker.getProgressInfo();
                
                onProgress({
                  file: path.basename(localPath),
                  progress: info.progress,
                  transferred: info.processedFormatted,
                  total: info.totalFormatted,
                  speed: info.speedFormatted,
                  eta: info.etaFormatted,
                  elapsed: info.elapsedFormatted,
                  status: 'uploading'
                });
              }
            }
          });
          
          // Mise à jour finale
          tracker.update(totalSize);
          if (onProgress) {
            const info = tracker.getProgressInfo();
            onProgress({
              file: path.basename(localPath),
              progress: 100,
              transferred: info.processedFormatted,
              total: info.totalFormatted,
              elapsed: info.elapsedFormatted,
              status: 'completed'
            });
          }

          // Vérifier l'intégrité (localStats est déjà déclaré plus haut)
          const remoteStats = await this.client.stat(remotePath);
          
          if (localStats.size !== remoteStats.size) {
            throw new Error('Les tailles de fichier ne correspondent pas après upload');
          }

          return {
            success: true,
            remotePath,
            size: localStats.size
          };
        }
      } catch (error) {
        attempt++;
        lastError = error;
        
        if (onProgress) {
          onProgress({
            file: path.basename(localPath),
            progress: 0,
            status: 'retrying',
            attempt: attempt,
            maxRetries: maxRetries
          });
        }

        // Attendre avant de réessayer (backoff exponentiel)
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }

    return {
      success: false,
      error: lastError?.message || 'Échec après plusieurs tentatives',
      attempts: attempt
    };
  }

  /**
   * S'assure qu'un dossier distant existe
   */
  async ensureRemoteDirectory(remoteDir) {
    if (this.config.protocol === 'smb') {
      // Si remoteDir est déjà absolu, l'utiliser tel quel
      const fullPath = path.isAbsolute(remoteDir) 
        ? remoteDir 
        : path.join(this.mountedSMBPath, remoteDir);
      await fs.ensureDir(fullPath);
    } else {
      try {
        await this.client.mkdir(remoteDir, true); // true = récursif
      } catch (error) {
        // Le dossier existe peut-être déjà
        if (error.code !== 4) { // Code 4 = fichier existe déjà
          throw error;
        }
      }
    }
  }

  /**
   * Upload un fichier ZIP de projet (directement dans le dossier configuré, pas dans un sous-dossier)
   */
  async uploadProjectArchive(zipPath, projectName, onProgress = null) {
    // Utiliser le nom du projet pour le fichier ZIP
    const remoteFileName = `${projectName}.zip`;
    
    // Construire le chemin distant : directement dans remotePath
    // Pour SMB, remotePath contient déjà le chemin complet sélectionné par l'utilisateur
    // (ex: /Volumes/Video/backups), donc on l'utilise tel quel sans ajouter mountedSMBPath
    const remotePath = path.join(this.config.remotePath, remoteFileName);

    // Vérifier si le fichier existe déjà
    const exists = await this.fileExists(remotePath);
    if (exists && onProgress) {
      onProgress({
        file: remoteFileName,
        status: 'exists',
        message: 'Le fichier existe déjà sur le serveur'
      });
      return { success: true, skipped: true, remotePath };
    }

    return await this.uploadFile(zipPath, remotePath, onProgress);
  }

  /**
   * Liste les fichiers sur le serveur
   */
  async listFiles(remotePath = null) {
    const pathToList = remotePath || this.config.remotePath;
    
    try {
      if (this.config.protocol === 'smb') {
        // Si pathToList est déjà absolu, l'utiliser tel quel
        const fullPath = path.isAbsolute(pathToList) 
          ? pathToList 
          : path.join(this.mountedSMBPath, pathToList);
        const items = await fs.readdir(fullPath);
        const files = [];
        
        for (const item of items) {
          const itemPath = path.join(fullPath, item);
          const stats = await fs.stat(itemPath);
          files.push({
            name: item,
            type: stats.isDirectory() ? 'directory' : 'file',
            size: stats.size,
            modified: stats.mtime
          });
        }
        
        return files;
      } else {
        return await this.client.list(pathToList);
      }
    } catch (error) {
      throw new Error(`Erreur lors de la liste des fichiers: ${error.message}`);
    }
  }

  /**
   * Supprime un fichier sur le serveur
   */
  async deleteFile(remotePath) {
    try {
      if (this.config.protocol === 'smb') {
        // Si remotePath est déjà absolu, l'utiliser tel quel
        const fullPath = path.isAbsolute(remotePath) 
          ? remotePath 
          : path.join(this.mountedSMBPath, remotePath);
        await fs.remove(fullPath);
        return { success: true };
      } else {
        await this.client.delete(remotePath);
        return { success: true };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = UploadManager;
