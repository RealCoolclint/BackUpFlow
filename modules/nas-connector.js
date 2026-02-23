const { exec } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const { EventEmitter } = require('events');

class NASConnector extends EventEmitter {
  constructor() {
    super();
    this._vpnPollingInterval = null;
    this._lastVpnConnected = null;
    this._autoMountInProgress = false;
    this._pingInterval = null;
  }

  // --------------- VPN detection ---------------

  _isVpnReachable() {
    return new Promise((resolve) => {
      exec('nc -z -w5 77.158.242.12 445', (error) => {
        resolve(!error);
      });
    });
  }

  async checkVPN() {
    const reachable = await this._isVpnReachable();
    return { isRunning: reachable, isConnected: reachable, installed: true };
  }

  async connectVPN(vpnName) {
    return new Promise((resolve) => {
      const cmd = `osascript -e 'tell application "FortiClient" to activate'`;
      exec(cmd, (error) => {
        if (error) {
          resolve({ success: false, error: error.message });
        } else {
          resolve({ success: true });
        }
      });
    });
  }

  // --------------- VPN polling + auto-mount ---------------

  startVpnPolling(smbURL, nasRemotePath) {
    this.stopVpnPolling();
    this._lastVpnConnected = null;

    const poll = async () => {
      const reachable = await this._isVpnReachable();

      this.emit('vpn-status', { connected: reachable });

      const wasDisconnected = this._lastVpnConnected === false || this._lastVpnConnected === null;
      if (reachable && wasDisconnected && !this._autoMountInProgress) {
        const alreadyMounted = await fs.pathExists(nasRemotePath);
        if (!alreadyMounted) {
          this._autoMountInProgress = true;
          try {
            exec(`open "${smbURL}"`, async (err) => {
              if (err) {
                this._autoMountInProgress = false;
                this.emit('nas-auto-mount-failed', { error: err.message });
                return;
              }
              await new Promise((r) => setTimeout(r, 3000));
              const mounted = await fs.pathExists(nasRemotePath);
              this._autoMountInProgress = false;
              if (mounted) {
                this.emit('nas-auto-mounted', { path: nasRemotePath });
              } else {
                this.emit('nas-auto-mount-failed', { error: 'Montage non vérifié après 3s' });
              }
            });
          } catch (e) {
            this._autoMountInProgress = false;
            this.emit('nas-auto-mount-failed', { error: e.message });
          }
        }
      }

      this._lastVpnConnected = reachable;
    };

    poll();
    this._vpnPollingInterval = setInterval(poll, 30000);
  }

  stopVpnPolling() {
    if (this._vpnPollingInterval) {
      clearInterval(this._vpnPollingInterval);
      this._vpnPollingInterval = null;
    }
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
    const result = { vpn: null, smb: null, finder: false, accessible: false };
    try {
      if (stepCallback) stepCallback({ step: 'vpn', status: 'checking' });
      result.vpn = await this.checkVPN();
      if (stepCallback) stepCallback({ step: 'vpn', status: 'done', result: result.vpn });

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
    this.stopVpnPolling();
    this.stopPing();
    this.removeAllListeners();
  }
}

module.exports = NASConnector;
