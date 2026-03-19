const { contextBridge, ipcRenderer } = require('electron');

// Exposer les APIs sécurisées au renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // Configuration
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  
  // HandBrake
  checkHandBrake: () => ipcRenderer.invoke('check-handbrake'),
  
  // Sources et import
  detectSources: () => ipcRenderer.invoke('detect-sources'),
  scanDirectory: (dirPath, recursive, opts) => ipcRenderer.invoke('scan-directory', dirPath, recursive, opts),
  calculateChecksum: (filePath) => ipcRenderer.invoke('calculate-checksum', filePath),
  verifyIntegrity: (source, dest) => ipcRenderer.invoke('verify-integrity', source, dest),
  
  // Nomenclature
  generateProjectName: (params) => ipcRenderer.invoke('generate-project-name', params),
  getNextLetter: (format) => ipcRenderer.invoke('get-next-letter', format),
  parseProjectName: (name) => ipcRenderer.invoke('parse-project-name', name),
  getFormatDescription: (format) => ipcRenderer.invoke('get-format-description', format),
  
  // Disques
  checkDiskSpace: (directory, bytes) => ipcRenderer.invoke('check-disk-space', directory, bytes),
  getFileSize: (filePath) => ipcRenderer.invoke('get-file-size', filePath),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  
  // Workflow
  executeBackupWorkflow: (workflowData) => ipcRenderer.invoke('execute-backup-workflow', workflowData),
  abortWorkflow: () => ipcRenderer.invoke('abort-workflow'),
  removeFolder: (folderPath) => ipcRenderer.invoke('remove-folder', folderPath),
  
  // Historique
  getHistory: (limit) => ipcRenderer.invoke('get-history', limit),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  getProjectMetadata: (projectName) => ipcRenderer.invoke('get-project-metadata', projectName),
  listProjects: () => ipcRenderer.invoke('list-projects'),
  
  // NAS
  testNASConnection: (config) => ipcRenderer.invoke('test-nas-connection', config),
  getMountedSMBShare: (smbURL) => ipcRenderer.invoke('get-mounted-smb-path', smbURL),
  
  // VPN
  checkAndConnectVPN: () => ipcRenderer.invoke('check-and-connect-vpn'),
  mountSMBShare: (smbURL) => ipcRenderer.invoke('mount-smb-share', smbURL),
  
  // Profils
  getProfiles: () => ipcRenderer.invoke('get-profiles'),
  getProfile: (profileId) => ipcRenderer.invoke('get-profile', profileId),
  createProfile: (profileData) => ipcRenderer.invoke('create-profile', profileData),
  updateProfile: (profileId, profileData) => ipcRenderer.invoke('update-profile', profileId, profileData),
  deleteProfile: (profileId) => ipcRenderer.invoke('delete-profile', profileId),
  archiveProfile: (profileId) => ipcRenderer.invoke('archive-profile', profileId),
  restoreProfile: (profileId) => ipcRenderer.invoke('restore-profile', profileId),
  selectProfilePhoto: () => ipcRenderer.invoke('select-profile-photo'),
  
  // Événements
  onWorkflowProgress: (callback) => {
    ipcRenderer.on('workflow-progress', (event, data) => callback(data));
  },
  
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },
  
  // Contrôles de fenêtre
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  quitApp: () => ipcRenderer.send('app-quit'),
  forceQuit: () => ipcRenderer.send('force-quit'),
  isWorkflowRunning: () => ipcRenderer.invoke('is-workflow-running'),
  
  // Écouter les confirmations de fermeture
  onConfirmQuit: (callback) => {
    ipcRenderer.on('confirm-quit-during-workflow', () => callback());
  },
  
  // GIFs de célébration
  listCelebrationGifs: () => ipcRenderer.invoke('list-celebration-gifs'),
  
  // Ouvrir URL externe
  openExternalURL: (url) => ipcRenderer.invoke('open-external-url', url),

  // Monday.com
  getMondayUsers: () => ipcRenderer.invoke('get-monday-users'),
  mondayTestConnection: (token, boardId) => ipcRenderer.invoke('monday-test-connection', { token, boardId }),
  mondayGetProjects: (boardId, token, includeBackedUp) => ipcRenderer.invoke('monday-get-projects', { boardId, token, includeBackedUp }),
  mondayGetColumnIds: (boardId, token) => ipcRenderer.invoke('monday-get-column-ids', { boardId, token }),
  mondayUpdateItem: (data) => ipcRenderer.invoke('monday-update-item', data),
  findProjectByMondayItemId: (mondayItemId) => ipcRenderer.invoke('find-project-by-monday-item', mondayItemId),

  // NAS Connector
  nasCheckVPN: () => ipcRenderer.invoke('nas-check-vpn'),
  nasConnectVPN: (vpnName) => ipcRenderer.invoke('nas-connect-vpn', vpnName),
  nasMountSMB: (smbURL) => ipcRenderer.invoke('nas-mount-smb', smbURL),
  nasOpenFinder: (mountedPath) => ipcRenderer.invoke('nas-open-finder', mountedPath),
  nasFullProtocol: () => ipcRenderer.invoke('nas-full-protocol'),
  nasCheckAccess: (remotePath) => ipcRenderer.invoke('nas-check-access', remotePath),
  nasCheckSMBMount: (smbURL) => ipcRenderer.invoke('nas-check-smb-mount', smbURL),
  getNASStatus: () => ipcRenderer.invoke('get-nas-status'),
  nasFullDiagnostic: (requiredBytes) => ipcRenderer.invoke('nas-full-diagnostic', requiredBytes),
  nasVerifyWriteAccess: (remotePath) => ipcRenderer.invoke('nas-verify-write-access', remotePath),

  // VPN / NAS auto-mount events
  onVpnStatusUpdate: (callback) => ipcRenderer.on('vpn-status-update', (_, data) => callback(data)),
  onNasAutoMounted: (callback) => ipcRenderer.on('nas-auto-mounted', (_, data) => callback(data)),
  onNasAutoMountFailed: (callback) => ipcRenderer.on('nas-auto-mount-failed', (_, data) => callback(data)),

  // Retry NAS
  retryNASUpload: (data) => ipcRenderer.invoke('retry-nas-upload', data),

  // Session
  getNextSessionNumber: (parentFolderPath) => ipcRenderer.invoke('get-next-session-number', parentFolderPath),
  pathExists: (folderPath) => ipcRenderer.invoke('path-exists', folderPath),

  // MultiCam
  readOrganizerManifest: (folderPath) => ipcRenderer.invoke('read-organizer-manifest', folderPath),
  getMulticamFolderSummary: (data) => ipcRenderer.invoke('get-multicam-folder-summary', data),
  executeMultiCamWorkflow: (workflowData) => ipcRenderer.invoke('execute-multicam-workflow', workflowData),
  onMultiCamProgress: (callback) => ipcRenderer.on('multicam-progress', (_, data) => callback(data)),

  // Gofile
  gofileUpload: (folderPath) => ipcRenderer.invoke('gofile-upload', folderPath),
  onGofileProgress: (callback) => ipcRenderer.on('gofile-progress', (_, data) => callback(data)),

  // Mailer (Resend)
  sendWorkflowSuccessMail: (params) => ipcRenderer.invoke('send-workflow-success-mail', params),
  sendBatchSummaryMail: (data) => ipcRenderer.invoke('send-batch-summary-mail', data),
  sendWorkflowStoppedMail: (params) => ipcRenderer.invoke('send-workflow-stopped-mail', params),
  sendErrorReportMail: (params) => ipcRenderer.invoke('send-error-report-mail', params),
  testResendConnection: (apiKey) => ipcRenderer.invoke('test-resend-connection', apiKey)
});
