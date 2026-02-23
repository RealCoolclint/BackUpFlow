/**
 * Utilitaire pour calculer la progression et l'ETA
 */
class ProgressTracker {
  constructor(totalSize) {
    this.totalSize = totalSize;
    this.processedSize = 0;
    this.startTime = Date.now();
    this.lastUpdateTime = this.startTime;
    this.lastProcessedSize = 0;
    this.speedHistory = []; // Historique des vitesses pour lissage
    this.maxHistorySize = 10;
  }

  /**
   * Met à jour la progression
   */
  update(processedSize) {
    this.processedSize = processedSize;
    const now = Date.now();
    const timeDelta = (now - this.lastUpdateTime) / 1000; // en secondes
    const sizeDelta = processedSize - this.lastProcessedSize;

    if (timeDelta > 0 && sizeDelta > 0) {
      const currentSpeed = sizeDelta / timeDelta; // bytes par seconde
      this.speedHistory.push(currentSpeed);
      
      // Garder seulement les N dernières mesures
      if (this.speedHistory.length > this.maxHistorySize) {
        this.speedHistory.shift();
      }
    }

    this.lastUpdateTime = now;
    this.lastProcessedSize = processedSize;
  }

  /**
   * Calcule la vitesse moyenne (bytes/seconde)
   */
  getAverageSpeed() {
    if (this.speedHistory.length === 0) return 0;
    const sum = this.speedHistory.reduce((a, b) => a + b, 0);
    return sum / this.speedHistory.length;
  }

  /**
   * Calcule le pourcentage de progression
   */
  getProgress() {
    if (this.totalSize === 0) return 0;
    return Math.min(100, (this.processedSize / this.totalSize) * 100);
  }

  /**
   * Calcule l'ETA (Estimated Time of Arrival) en secondes
   */
  getETA() {
    const remainingSize = this.totalSize - this.processedSize;
    const speed = this.getAverageSpeed();
    
    if (speed === 0 || remainingSize <= 0) return 0;
    
    return remainingSize / speed;
  }

  /**
   * Calcule le temps écoulé en secondes
   */
  getElapsedTime() {
    return (Date.now() - this.startTime) / 1000;
  }

  /**
   * Formate les bytes en format lisible
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Formate le temps en format lisible
   */
  formatTime(seconds) {
    if (seconds < 60) {
      return Math.round(seconds) + 's';
    } else if (seconds < 3600) {
      const mins = Math.floor(seconds / 60);
      const secs = Math.round(seconds % 60);
      return `${mins}m ${secs}s`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      return `${hours}h ${mins}m`;
    }
  }

  /**
   * Retourne un objet avec toutes les informations de progression
   */
  getProgressInfo() {
    const progress = this.getProgress();
    const speed = this.getAverageSpeed();
    const eta = this.getETA();
    const elapsed = this.getElapsedTime();

    return {
      progress: progress,
      processed: this.processedSize,
      total: this.totalSize,
      processedFormatted: this.formatBytes(this.processedSize),
      totalFormatted: this.formatBytes(this.totalSize),
      speed: speed,
      speedFormatted: this.formatBytes(speed) + '/s',
      eta: eta,
      etaFormatted: eta > 0 ? this.formatTime(eta) : 'Calcul...',
      elapsed: elapsed,
      elapsedFormatted: this.formatTime(elapsed)
    };
  }
}

module.exports = ProgressTracker;

