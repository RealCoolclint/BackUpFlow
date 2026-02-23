const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

/**
 * Module d'importation avec détection automatique et vérification d'intégrité
 */
class ImportManager {
  static MIN_FILE_SIZE = 1 * 1024 * 1024; // 1 MB
  static EXCLUDED_PREFIX = 'Rendered - ';
  static MULTICAM_EXTRA_EXTENSIONS = ['.wav', '.mp3'];

  constructor() {
    this.supportedVideoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.m4v', '.mpg', '.mpeg', '.prores', '.MXF'];
    this.supportedAudioExtensions = ['.wav', '.aiff', '.aif', '.mp3', '.m4a'];
    this.allowedVideoExtensions = ['.mp4', '.mov'];
  }

  setAllowedExtensions(extensions) {
    if (Array.isArray(extensions) && extensions.length > 0) {
      this.allowedVideoExtensions = extensions.map(e => e.startsWith('.') ? e : `.${e}`);
    }
  }

  /**
   * Détecte les sources disponibles (cartes SD, SSD, appareils montés)
   */
  async detectSources() {
    const sources = [];
    
    try {
      // Utiliser df pour lister les volumes montés
      const { stdout } = await execAsync('df -h');
      const lines = stdout.split('\n').filter(line => line.trim());
      
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(/\s+/);
        if (parts.length >= 9) {
          const mountPoint = parts[8];
          const size = parts[1];
          const available = parts[3];
          const usePercent = parts[4];
          
          // Détecter les sources externes (Volumes/, disques réseau, etc.)
          if (mountPoint.startsWith('/Volumes/') && mountPoint !== '/Volumes/Macintosh HD') {
            const name = path.basename(mountPoint);
            
            // Détecter le type de source
            let type = 'unknown';
            if (name.includes('SD') || name.includes('NO NAME')) {
              type = 'sd_card';
            } else if (name.includes('SSD') || name.includes('disk')) {
              type = 'ssd';
            } else if (mountPoint.startsWith('//') || mountPoint.startsWith('smb://')) {
              type = 'network';
            } else {
              type = 'external';
            }
            
            sources.push({
              path: mountPoint,
              name: name,
              type: type,
              size: size,
              available: available,
              usePercent: usePercent
            });
          }
        }
      }
    } catch (error) {
      console.error('Erreur lors de la détection des sources:', error);
    }
    
    return sources;
  }

  /**
   * Scanne un répertoire et ne retient que les fichiers dont l'extension
   * figure dans la liste autorisée, en appliquant les règles d'exclusion.
   * @param {string} dirPath
   * @param {boolean} recursive
   * @param {object} opts - { multiCam: true } pour élargir aux extensions audio
   */
  async scanDirectory(dirPath, recursive = true, opts = {}) {
    const files = [];
    const allowed = this._buildAllowedSet(opts.multiCam);

    try {
      const items = await fs.readdir(dirPath);

      for (const item of items) {
        const fullPath = path.join(dirPath, item);
        const stats = await fs.stat(fullPath);

        if (stats.isDirectory() && recursive) {
          const subFiles = await this.scanDirectory(fullPath, recursive, opts);
          files.push(...subFiles);
        } else if (stats.isFile()) {
          const ext = path.extname(item).toLowerCase();
          if (!allowed.has(ext)) continue;
          if (stats.size < ImportManager.MIN_FILE_SIZE) continue;
          if (item.startsWith(ImportManager.EXCLUDED_PREFIX)) continue;
          const fileInfo = await this.getFileInfo(fullPath);
          if (fileInfo) files.push(fileInfo);
        }
      }
    } catch (error) {
      console.error(`Erreur lors du scan de ${dirPath}:`, error);
    }

    return files;
  }

  _buildAllowedSet(multiCam) {
    const exts = [...this.allowedVideoExtensions];
    if (multiCam) exts.push(...ImportManager.MULTICAM_EXTRA_EXTENSIONS);
    return new Set(exts.map(e => e.toLowerCase()));
  }

  isVideoFile(extension) {
    return this.allowedVideoExtensions.includes(extension.toLowerCase());
  }

  /**
   * Obtient les informations détaillées sur un fichier
   */
  async getFileInfo(filePath) {
    try {
      const stats = await fs.stat(filePath);
      const ext = path.extname(filePath).toLowerCase();
      
      return {
        path: filePath,
        name: path.basename(filePath),
        extension: ext,
        size: stats.size,
        sizeFormatted: this.formatBytes(stats.size),
        modified: stats.mtime,
        created: stats.birthtime,
        type: this.isVideoFile(ext) ? 'video' : 'other',
        checksum: null // Calculé à la demande
      };
    } catch (error) {
      console.error(`Erreur lors de la lecture de ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Calcule le checksum MD5 d'un fichier (pour vérification d'intégrité)
   */
  async calculateChecksum(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('md5');
      const stream = fs.createReadStream(filePath);
      
      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * Vérifie l'intégrité d'un fichier en comparant les checksums
   */
  async verifyIntegrity(sourcePath, destinationPath) {
    try {
      const sourceChecksum = await this.calculateChecksum(sourcePath);
      const destChecksum = await this.calculateChecksum(destinationPath);
      
      return {
        valid: sourceChecksum === destChecksum,
        sourceChecksum,
        destChecksum
      };
    } catch (error) {
      return {
        valid: false,
        error: error.message
      };
    }
  }

  /**
   * Formate les bytes en format lisible
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Extrait les métadonnées d'un fichier vidéo (si possible)
   */
  async extractMetadata(filePath) {
    // Pour une implémentation complète, on pourrait utiliser ffprobe
    // Ici on retourne les infos de base
    const info = await this.getFileInfo(filePath);
    return {
      filename: info.name,
      size: info.size,
      extension: info.extension,
      modified: info.modified,
      // Métadonnées vidéo pourraient être ajoutées avec ffprobe
      codec: null,
      resolution: null,
      duration: null,
      frameRate: null
    };
  }
}

module.exports = ImportManager;

