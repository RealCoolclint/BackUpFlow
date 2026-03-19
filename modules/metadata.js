const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { app } = require('electron');

/**
 * Module de gestion des métadonnées et historique
 */
class MetadataManager {
  constructor() {
    this.dataDir = path.join(app.getPath('userData'), 'data');
    this.metadataFile = path.join(this.dataDir, 'metadata.json');
    this.historyFile = path.join(this.dataDir, 'history.json');
    this.profilesFile = path.join(this.dataDir, 'profiles.json');
    this.init();
  }

  /**
   * Initialise le système de métadonnées
   */
  async init() {
    await fs.ensureDir(this.dataDir);
    
    if (!(await fs.pathExists(this.metadataFile))) {
      await fs.writeJson(this.metadataFile, {
        projects: {},
        settings: {},
        lastSync: null
      });
    }
    
    if (!(await fs.pathExists(this.historyFile))) {
      await fs.writeJson(this.historyFile, {
        operations: []
      });
    }
    
    if (!(await fs.pathExists(this.profilesFile))) {
      await fs.writeJson(this.profilesFile, {
        profiles: []
      });
    }
  }

  /**
   * Sauvegarde les métadonnées d'un projet
   */
  async saveProjectMetadata(projectName, metadata) {
    const data = await fs.readJson(this.metadataFile);
    
    data.projects[projectName] = {
      name: projectName,
      created: new Date().toISOString(),
      ...metadata
    };
    
    data.lastSync = new Date().toISOString();
    await fs.writeJson(this.metadataFile, data, { spaces: 2 });
    
    return data.projects[projectName];
  }

  /**
   * Récupère les métadonnées d'un projet
   */
  async getProjectMetadata(projectName) {
    const data = await fs.readJson(this.metadataFile);
    return data.projects[projectName] || null;
  }

  /**
   * Liste tous les projets
   */
  async listProjects() {
    const data = await fs.readJson(this.metadataFile);
    return Object.values(data.projects);
  }

  /**
   * Ajoute une entrée à l'historique
   * Les champs mondayItemId et projectFolderPath sont alimentés en fin de workflow
   */
  async addHistoryEntry(operation) {
    const data = await fs.readJson(this.historyFile);
    
    const entry = {
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      profileId: operation.profileId || null,
      mondayItemId: operation.mondayItemId ?? null,
      projectFolderPath: operation.projectFolderPath ?? null,
      ...operation
    };
    
    data.operations.unshift(entry); // Ajouter au début
    
    // Garder seulement les 100 dernières opérations
    if (data.operations.length > 100) {
      data.operations = data.operations.slice(0, 100);
    }
    
    await fs.writeJson(this.historyFile, data, { spaces: 2 });
    
    return entry;
  }

  /**
   * Trouve un projet backupé existant par mondayItemId
   * @returns {Promise<Object|null>} L'entrée d'historique si trouvée, null sinon
   */
  async findProjectByMondayItemId(mondayItemId) {
    if (!mondayItemId) return null;
    const data = await fs.readJson(this.historyFile);
    const ops = data.operations || [];
    const existing = ops.find(op =>
      op.mondayItemId === String(mondayItemId) &&
      op.projectFolderPath &&
      (op.status === 'completed' || op.status === 'copy_completed')
    );
    return existing || null;
  }

  /**
   * Récupère l'historique
   */
  async getHistory(limit = 50) {
    const data = await fs.readJson(this.historyFile);
    return data.operations.slice(0, limit);
  }

  /**
   * Efface tout l'historique
   */
  async clearHistory() {
    const data = await fs.readJson(this.historyFile);
    data.operations = [];
    await fs.writeJson(this.historyFile, data, { spaces: 2 });
    return true;
  }

  /**
   * Sauvegarde les paramètres
   */
  async saveSettings(settings) {
    const data = await fs.readJson(this.metadataFile);
    data.settings = { ...data.settings, ...settings };
    await fs.writeJson(this.metadataFile, data, { spaces: 2 });
  }

  /**
   * Récupère les paramètres
   */
  async getSettings() {
    const data = await fs.readJson(this.metadataFile);
    return data.settings || {};
  }

  /**
   * Exporte les métadonnées
   */
  async exportMetadata(exportPath) {
    const metadata = await fs.readJson(this.metadataFile);
    const history = await fs.readJson(this.historyFile);
    
    const exportData = {
      exported: new Date().toISOString(),
      metadata,
      history
    };
    
    await fs.writeJson(exportPath, exportData, { spaces: 2 });
    return exportPath;
  }

  /**
   * Importe les métadonnées
   */
  async importMetadata(importPath) {
    const importData = await fs.readJson(importPath);
    
    if (importData.metadata) {
      await fs.writeJson(this.metadataFile, importData.metadata, { spaces: 2 });
    }
    
    if (importData.history) {
      await fs.writeJson(this.historyFile, importData.history, { spaces: 2 });
    }
    
    return true;
  }

  // ==================== GESTION DES PROFILS ====================

  /**
   * Récupère tous les profils
   */
  async getProfiles() {
    const data = await fs.readJson(this.profilesFile);
    return data.profiles || [];
  }

  /**
   * Récupère un profil par son ID
   */
  async getProfile(profileId) {
    const profiles = await this.getProfiles();
    return profiles.find(p => p.id === profileId) || null;
  }

  /**
   * Crée un nouveau profil
   */
  async createProfile(profileData) {
    const data = await fs.readJson(this.profilesFile);
    if (!data.profiles) {
      data.profiles = [];
    }
    
    const newProfile = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      name: profileData.name,
      initiales: profileData.initiales.toUpperCase(),
      ssdPersoPath: profileData.ssdPersoPath || null,
      ssdStudioPath: profileData.ssdStudioPath || null,
      photoPath: profileData.photoPath || null,
      color1: profileData.color1 || '#2563eb',
      color2: profileData.color2 || '#0f172a',
      color3: profileData.color3 || '#ffffff',
      theme: profileData.theme || 'dark',
      mondayMode: profileData.mondayMode || 'monday',
      isProtected: false,
      passwordHash: null,
      email: profileData.email !== undefined ? profileData.email : '',
      mondayUserId: profileData.mondayUserId || null,
      archived: false,
      zipNasEnabled: false,
      isAdmin: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    data.profiles.push(newProfile);
    await fs.writeJson(this.profilesFile, data, { spaces: 2 });
    return newProfile;
  }

  async archiveProfile(profileId) {
    const data = await fs.readJson(this.profilesFile);
    const profile = (data.profiles || []).find(p => p.id === profileId);
    if (!profile) throw new Error('Profil introuvable');
    profile.archived = true;
    profile.updatedAt = new Date().toISOString();
    await fs.writeJson(this.profilesFile, data, { spaces: 2 });
    return profile;
  }

  async restoreProfile(profileId) {
    const data = await fs.readJson(this.profilesFile);
    const profile = (data.profiles || []).find(p => p.id === profileId);
    if (!profile) throw new Error('Profil introuvable');
    profile.archived = false;
    profile.updatedAt = new Date().toISOString();
    await fs.writeJson(this.profilesFile, data, { spaces: 2 });
    return profile;
  }

  /**
   * Met à jour un profil existant
   */
  async updateProfile(profileId, profileData) {
    const data = await fs.readJson(this.profilesFile);
    if (!data.profiles) {
      data.profiles = [];
    }
    
    const index = data.profiles.findIndex(p => p.id === profileId);
    if (index === -1) {
      throw new Error('Profil introuvable');
    }
    
    data.profiles[index] = {
      ...data.profiles[index],
      name: profileData.name,
      initiales: profileData.initiales.toUpperCase(),
      ssdPersoPath: profileData.ssdPersoPath || null,
      ssdStudioPath: profileData.ssdStudioPath || null,
      photoPath: profileData.photoPath || null,
      color1: profileData.color1 || data.profiles[index].color1 || '#2563eb',
      color2: profileData.color2 || data.profiles[index].color2 || '#0f172a',
      color3: profileData.color3 || data.profiles[index].color3 || '#ffffff',
      theme: profileData.theme || data.profiles[index].theme || 'dark',
      mondayMode: profileData.mondayMode !== undefined ? profileData.mondayMode : (data.profiles[index].mondayMode || 'monday'),
      email: profileData.email !== undefined
        ? profileData.email
        : (data.profiles[index].email || ''),
      mondayUserId: profileData.mondayUserId !== undefined
        ? (profileData.mondayUserId || null)
        : (data.profiles[index].mondayUserId ?? null),
      archived: data.profiles[index].archived || false,
      zipNasEnabled: profileData.zipNasEnabled !== undefined
        ? profileData.zipNasEnabled
        : (data.profiles[index].zipNasEnabled || false),
      isAdmin: data.profiles[index].isAdmin || false,
      isProtected: data.profiles[index].isProtected || false,
      passwordHash: data.profiles[index].passwordHash || null,
      updatedAt: new Date().toISOString()
    };
    
    await fs.writeJson(this.profilesFile, data, { spaces: 2 });
    return data.profiles[index];
  }

  /**
   * Supprime un profil
   */
  async deleteProfile(profileId) {
    const data = await fs.readJson(this.profilesFile);
    if (!data.profiles) {
      data.profiles = [];
    }
    
    const index = data.profiles.findIndex(p => p.id === profileId);
    if (index === -1) {
      throw new Error('Profil introuvable');
    }
    
    // Supprimer la photo si elle existe
    const profile = data.profiles[index];
    if (profile.photoPath && await fs.pathExists(profile.photoPath)) {
      try {
        await fs.remove(profile.photoPath);
      } catch (error) {
        console.error('Erreur lors de la suppression de la photo:', error);
      }
    }
    
    data.profiles.splice(index, 1);
    await fs.writeJson(this.profilesFile, data, { spaces: 2 });
    return true;
  }

  /**
   * Définit un code secret pour un profil
   */
  async setProfileCode(profileId, code) {
    const data = await fs.readJson(this.profilesFile);
    if (!data.profiles) {
      data.profiles = [];
    }
    
    const index = data.profiles.findIndex(p => p.id === profileId);
    if (index === -1) {
      throw new Error('Profil introuvable');
    }
    
    // Hasher le code avec SHA256
    const hash = crypto.createHash('sha256').update(code).digest('hex');
    
    data.profiles[index].isProtected = true;
    data.profiles[index].passwordHash = hash;
    data.profiles[index].updatedAt = new Date().toISOString();
    
    await fs.writeJson(this.profilesFile, data, { spaces: 2 });
    return true;
  }

  /**
   * Vérifie le code secret d'un profil
   */
  async verifyProfileCode(profileId, code) {
    const profile = await this.getProfile(profileId);
    if (!profile) {
      return { success: false, error: 'Profil introuvable' };
    }
    
    if (!profile.isProtected || !profile.passwordHash) {
      return { success: true };
    }
    
    const hash = crypto.createHash('sha256').update(code).digest('hex');
    if (hash === profile.passwordHash) {
      return { success: true };
    }
    
    return { success: false, error: 'Code incorrect' };
  }

  /**
   * Retire la protection d'un profil
   */
  async removeProfileProtection(profileId) {
    const data = await fs.readJson(this.profilesFile);
    if (!data.profiles) {
      data.profiles = [];
    }
    
    const index = data.profiles.findIndex(p => p.id === profileId);
    if (index === -1) {
      throw new Error('Profil introuvable');
    }
    
    data.profiles[index].isProtected = false;
    data.profiles[index].passwordHash = null;
    data.profiles[index].updatedAt = new Date().toISOString();
    
    await fs.writeJson(this.profilesFile, data, { spaces: 2 });
    return true;
  }
}

module.exports = MetadataManager;

