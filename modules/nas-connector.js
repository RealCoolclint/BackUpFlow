const { exec } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const { EventEmitter } = require('events');

class NASConnector extends EventEmitter {
  constructor() {
    super();
    this._autoMountInProgress = false;
    this._pingInterval = null;
    this._keepAliveInterval = null;
  }

  // --------------- SMB mount ---------------

  async mountSMB(smbURL) {
    return new Promise((resolve) => {
      exec(`open "${smbURL}"`, (error) => {
        if (error) {
          resolve({ success: false, error: error.message });
        } else {
          setTimeout(() => resolve({ success: true }), 3000);
        }
      });
    });
  }

  async checkSMBMount(smbURL) {
    if (!smbURL) return { mounted: false, path: null };
    try {
      const urlObj = new URL(smbURL);
      const shareName = urlObj.pathname.split('/').filter(Boolean).pop();
      const mountPath = `/Volumes/${shareName}`;
      const exists = await fs.pathExists(mountPath);
      return { mounted: exists, path: exists ? mountPath : null };
    } catch (e) {
      return { mounted: false, path: null, error: e.message };
    }
  }

  // --------------- NAS access checks ---------------

  async checkNASAccess(remotePath) {
    if (!remotePath) return { accessible: false, reason: 'Chemin NAS non configuré' };
    try {
      const exists = await fs.pathExists(remotePath);
      if (!exists) return { accessible: false, reason: 'Chemin NAS introuvable' };
      const writable = await this._testWrite(remotePath);
      return { accessible: true, writable, reason: writable ? null : 'Lecture seule' };
    } catch (e) {
      return { accessible: false, reason: e.message };
    }
  }

  async verifyWriteAccess(remotePath) {
    if (!remotePath) return { writable: false, reason: 'Chemin non fourni' };
    try {
      const writable = await this._testWrite(remotePath);
      return { writable, reason: writable ? null : 'Impossible d\'écrire sur le NAS' };
    } catch (e) {
      return { writable: false, reason: e.message };
    }
  }

  async _testWrite(dirPath) {
    const testFile = path.join(dirPath, `.backupflow_write_test_${Date.now()}`);
    try {
      await fs.writeFile(testFile, 'test');
      await fs.remove(testFile);
      return true;
    } catch {
      return false;
    }
  }

  // --------------- Reconnect ---------------

  async attemptReconnect(smbURL, remotePath, maxRetries = 3, progressCallback) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (progressCallback) progressCallback({ attempt, maxRetries });
      const mountResult = await this.mountSMB(smbURL);
      if (mountResult.success) {
        await new Promise((r) => setTimeout(r, 2000));
        const access = await this.checkNASAccess(remotePath);
        if (access.accessible) return { success: true, attempt };
      }
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    return { success: false };
  }

  // --------------- Ping (connection monitoring during upload) ---------------

  startPing(remotePath, intervalMs = 10000) {
    this.stopPing();
    this._pingInterval = setInterval(async () => {
      const exists = await fs.pathExists(remotePath);
      if (!exists) {
        this.emit('nas-disconnected', { path: remotePath });
      }
    }, intervalMs);
  }

  stopPing() {
    if (this._pingInterval) {
      clearInterval(this._pingInterval);
      this._pingInterval = null;
    }
  }

  // --------------- Keep-Alive SMB ---------------

  startKeepAlive(smbURL, remotePath, intervalMs = 30000) {
    this.stopKeepAlive();
    this._keepAliveInterval = setInterval(async () => {
      try {
        const testFile = path.join(remotePath, `.backupflow_keepalive_${Date.now()}`);
        await fs.writeFile(testFile, 'ka');
        await fs.remove(testFile);
        this.emit('nas-keepalive-ok', { path: remotePath });
      } catch (e) {
        console.warn('[KeepAlive] NAS inaccessible, tentative de remontage...');
        this.emit('nas-keepalive-lost', { path: remotePath });
        try {
          const mountResult = await this.mountSMB(smbURL);
          if (mountResult.success) {
            await new Promise((r) => setTimeout(r, 3000));
            const access = await this.checkNASAccess(remotePath);
            if (access.accessible) {
              console.log('[KeepAlive] NAS remonté avec succès');
              this.emit('nas-keepalive-reconnected', { path: remotePath });
            } else {
              this.emit('nas-keepalive-failed', { path: remotePath });
            }
          } else {
            this.emit('nas-keepalive-failed', { path: remotePath });
          }
        } catch (err) {
          this.emit('nas-keepalive-failed', { path: remotePath, error: err.message });
        }
      }
    }, intervalMs);
  }

  stopKeepAlive() {
    if (this._keepAliveInterval) {
      clearInterval(this._keepAliveInterval);
      this._keepAliveInterval = null;
    }
  }

  // --------------- Finder ---------------

  async openFinderOnNAS(mountedPath) {
    return new Promise((resolve, reject) => {
      exec(`open "${mountedPath}"`, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  // --------------- Full protocol ---------------

  async fullProtocol(settings, stepCallback) {
    const result = { smb: null, finder: false, accessible: false };
    try {
      if (settings.nas?.smbURL) {
        if (stepCallback) stepCallback({ step: 'smb', status: 'mounting' });
        result.smb = await this.mountSMB(settings.nas.smbURL);
        if (stepCallback) stepCallback({ step: 'smb', status: 'done', result: result.smb });
      }

      if (settings.nas?.remotePath) {
        if (stepCallback) stepCallback({ step: 'access', status: 'checking' });
        const access = await this.checkNASAccess(settings.nas.remotePath);
        result.accessible = access.accessible;
        if (stepCallback) stepCallback({ step: 'access', status: 'done', result: access });

        if (access.accessible) {
          result.finder = true;
        }
      }
    } catch (e) {
      result.error = e.message;
    }
    return result;
  }

  // --------------- Full diagnostic ---------------

  async fullDiagnostic(remotePath, requiredBytes = 0) {
    const diag = {
      accessible: false,
      writable: false,
      enoughSpace: false,
      freeBytes: 0,
      errorKey: null,
      error: null
    };

    if (!remotePath) {
      diag.errorKey = 'NAS_NOT_CONFIGURED';
      diag.error = 'Chemin NAS non configuré';
      return diag;
    }

    const exists = await fs.pathExists(remotePath);
    if (!exists) {
      diag.errorKey = 'NAS_UNREACHABLE';
      diag.error = 'Chemin NAS introuvable';
      return diag;
    }
    diag.accessible = true;

    diag.writable = await this._testWrite(remotePath);
    if (!diag.writable) {
      diag.errorKey = 'NAS_READ_ONLY';
      diag.error = 'Écriture impossible sur le NAS';
      return diag;
    }

    try {
      const stats = await fs.statfs(remotePath);
      diag.freeBytes = stats.bfree * stats.bsize;
      diag.enoughSpace = diag.freeBytes >= requiredBytes;
      if (!diag.enoughSpace) {
        diag.errorKey = 'NAS_NO_SPACE';
        diag.error = `Espace insuffisant (${Math.round(diag.freeBytes / 1e9)} Go libres)`;
      }
    } catch (e) {
      diag.enoughSpace = true;
    }

    return diag;
  }

  // --------------- Cleanup ---------------

  destroy() {
    this.stopPing();
    this.stopKeepAlive();
    this.removeAllListeners();
  }
}

module.exports = NASConnector;
