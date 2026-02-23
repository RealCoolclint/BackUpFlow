const fs = require('fs-extra');
const path = require('path');

/**
 * Module de nomenclature pour générer les noms de projets
 * Format: AnnéeMoisJourLettre_FORMAT_Sujet_Initiales
 * Exemples: 251013A_ITW_Orelsan_AP, 251013B_BP_Reco_CF
 */
class NomenclatureManager {
  constructor(basePath) {
    this.basePath = basePath;
    this.dateFormats = {
      'BP': 'Reco',
      'CEXP': 'Campus Explorer',
      'ITW': 'L\'interview',
      'ITR': 'L\'interro',
      'SELEC': 'La sélection de l\'Etudiant',
      'CQUOI': 'C\'est quoi?',
      'SCH': 'Anecdote',
      'REC': 'Le récit',
      'ATE': 'Audrey t\'explique',
      'MT': 'Micro Trottoir',
      'ADLE': 'Actu',
      'DDLE': 'Décryptage',
      'CDLE': 'Conseil',
      'AS': 'Au salon',
      'TD3M': 'Ton Diplôme en 3 minutes',
      'EME': 'Etudes, mode d\'emploi',
      'TEASER': 'Teaser',
      'PROMO': 'Promo',
      'DOC': 'Le doc de l\'Etudiant',
      'REP': 'Reportage',
      'TEST': 'Test',
      'CORR': 'Corrigé'
    };
  }

  /**
   * Génère un nom de projet selon le format
   * @param {Object} params - {format, sujet, initiales, additionalPaths}
   * @returns {Promise<string>} Nom du projet généré
   */
  async generateProjectName({ format, sujet, initiales, additionalPaths = [], dateOverride = null }) {
    const date = dateOverride ? this.parseDateToYYYYMMDD(dateOverride) : this.getDateString();
    const letter = await this.getNextLetter(format, additionalPaths);
    
    // Forcer le sujet en majuscules et remplacer les espaces par underscores
    const sujetFormatted = sujet.toUpperCase().replace(/\s+/g, '_');
    
    return `${date}${letter}_${format}_${sujetFormatted}_${initiales.toUpperCase()}`;
  }

  /**
   * Obtient la date au format AnnéeMoisJour (ex: 251013 pour 13/10/2025)
   */
  getDateString() {
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2);
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  /**
   * Parse une date Monday (ISO, dd/mm/yyyy, etc.) en YYYYMMDD
   */
  parseDateToYYYYMMDD(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return this.getDateString();
    const trimmed = dateStr.trim();
    if (!trimmed) return this.getDateString();
    let d;
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      d = new Date(trimmed);
    } else if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(trimmed)) {
      const parts = trimmed.split(/[\/\-]/);
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const year = parseInt(parts[2], 10) < 100 ? 2000 + parseInt(parts[2], 10) : parseInt(parts[2], 10);
      d = new Date(year, month, day);
    } else {
      return this.getDateString();
    }
    if (isNaN(d.getTime())) return this.getDateString();
    const year = d.getFullYear().toString().slice(-2);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  /**
   * Trouve la prochaine lettre disponible (A, B, C...) pour la date
   * L'incrémentation est globale, indépendamment du format ou du profil
   * @param {string} format - Format du projet (ignoré pour la recherche, conservé pour compatibilité)
   * @param {Array<string>} additionalPaths - Chemins supplémentaires à vérifier (profils, etc.)
   */
  async getNextLetter(format, additionalPaths = []) {
    const dateStr = this.getDateString();
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    
    // Chercher dans tous les chemins possibles les projets existants
    let foundLetters = new Set();
    
    // Liste de tous les chemins à vérifier : basePath + chemins additionnels
    const pathsToCheck = [this.basePath, ...additionalPaths].filter(Boolean);
    
    // Chercher dans chaque chemin
    for (const checkPath of pathsToCheck) {
    try {
        if (await fs.pathExists(checkPath)) {
          const items = await fs.readdir(checkPath);
        
          // Pattern: date + lettre(s) + _ + format (2-6 caractères) + _
          // Cherche toutes les lettres pour la date, peu importe le format
          // Supporte les lettres simples (A-Z) et doubles (AA, AB, etc.)
          const pattern = new RegExp(`^${dateStr}([A-Z]+)_([A-Z]{2,6})_`);
        
        for (const item of items) {
          const match = item.match(pattern);
          if (match) {
              // Ajouter la lettre trouvée (peut être A, B, AA, AB, etc.)
            foundLetters.add(match[1]);
          }
        }
      }
    } catch (error) {
        // Ignorer les erreurs si le chemin n'existe pas ou n'est pas accessible
        console.warn(`Erreur lors de la recherche dans ${checkPath}:`, error.message);
      }
    }
    
    // Trouver la première lettre disponible (A, B, C, ..., Z)
    for (const letter of alphabet) {
      if (!foundLetters.has(letter)) {
        return letter;
      }
    }
    
    // Si toutes les lettres simples sont prises, utiliser AA, AB, AC, etc.
    // Il y a 26 * 26 = 676 combinaisons possibles (AA à ZZ)
    for (let i = 0; i < 676; i++) {
      const first = alphabet[Math.floor(i / 26)];
      const second = alphabet[i % 26];
      const doubleLetter = first + second;
      
      if (!foundLetters.has(doubleLetter)) {
        return doubleLetter;
      }
    }
    
    // Si toutes les combinaisons AA-ZZ sont prises, utiliser AAA
    console.warn('Trop de projets pour la date, utilisation de AAA');
    return 'AAA';
  }

  /**
   * Valide un format de projet
   */
  isValidFormat(format) {
    return Object.keys(this.dateFormats).includes(format);
  }

  /**
   * Obtient la description d'un format
   */
  getFormatDescription(format) {
    return this.dateFormats[format] || format;
  }

  /**
   * Parse un nom de projet pour extraire les informations
   * Supporte les formats courts (2 caractères comme MT) et longs (6 caractères comme TEASER)
   */
  parseProjectName(projectName) {
    // Pattern adapté pour accepter des acronymes de 2 à 6 caractères
    const match = projectName.match(/^(\d{6})([A-Z]+)_([A-Z]{2,6})_(.+)_([A-Z]+)$/);
    if (match) {
      return {
        date: match[1],
        letter: match[2],
        format: match[3],
        sujet: match[4],
        initiales: match[5],
        fullName: projectName
      };
    }
    return null;
  }
}

module.exports = NomenclatureManager;

