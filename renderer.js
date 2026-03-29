// État global de l'application
let state = {
  currentView: 'home', // Vue par défaut: accueil
  selectedProfile: null,
  workflow: {
    projectName: '',
    format: '',
    sujet: '',
    initiales: '',
    mondayItemId: null, // ID Monday de l'item sélectionné (Phase B)
    dateTournage: null, // Date de tournage Monday pour nomenclature
    files: [],
    compress: true,
    uploadNAS: false,
    verifyIntegrity: true,
    ssdPersoPath: null, // Chemin SSD perso du profil si sélectionné
    ssdStudioPath: null, // Chemin SSD studio du profil (si différent des paramètres)
    // Mode MultiCam Organizer
    isMultiCam: false,
    multiCamSourcePath: null,
    multiCamSources: [],
    multiCamFolderSummary: null, // { folders, totalSize }
    // Mode Session (rushs multiples)
    isSession: false,
    parentProjectPath: null,
    sessionNumber: null,
    sessionFolderName: null,
    existingProjectInfo: null // { projectFolderPath, projectName } si projet déjà backupé et dossier existe
  },
  sources: [],
  settings: {},
  processing: false,
  workflowState: {
    currentStep: null,
    globalProgress: 0,
    steps: {},
    completedSteps: new Set()
  },
  // Tracker de progression basé sur les bytes réels
  realProgressTracker: {
    totalBytes: 0,
    processedBytes: 0,
    startTime: null,
    lastUpdateTime: null,
    averageSpeed: 0, // bytes par seconde
    eta: null
  },
  // Système de queue BATCH
  mondayUpdateError: null, // Message d'erreur si mise à jour Monday échoue en fin de workflow
  batchQueue: {
    items: [],
    currentIndex: -1,
    isRunning: false,
    stopRequested: false,
    startTime: null
  }
};

const thumbnailCache = new Map();

const CHANGELOG = [
  {
    version: 'V1.05.03.26',
    date: '5 mars 2026',
    notes: [
      'Numéro de version désormais statique, basé sur la date du build (format 1.JJ.MM.AA)',
      'Correction de la flèche des menus déroulants : repositionnée pour une meilleure harmonie visuelle',
      'Compression HandBrake : si le fichier compressé est plus lourd que l\'original, le fichier original est conservé et transmis au NAS',
      'Correction des mails de confirmation : le mail est désormais envoyé au profil actif qui a lancé le workflow, et non systématiquement à l\'administrateur'
    ]
  },
  {
    version: 'V1.21.02.26',
    date: '21 février 2026',
    notes: [
      'Tri des projets Monday par date de tournage croissante',
      'Tri des fichiers source par taille décroissante',
      'Archivage de profils (restaurable depuis les Paramètres)',
      'Profil Admin avec accès aux paramètres étendus',
      'Corrections accents manquants (Arrêter, Arrêt...)',
      'Numéro de version lisible en mode clair',
      'Pastille NAS lisible en mode clair',
    ]
  }
];

// Clé API Monday par défaut (Tableau suivi de production) — peut être modifiée dans les paramètres
const DEFAULT_MONDAY_API_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjYxODY3ODk2NCwiYWFpIjoxMSwidWlkIjo2NzA4Mjk3NSwiaWFkIjoiMjAyNi0wMi0wOVQwOToxMzowOC45NzNaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTUxMzM5NDAsInJnbiI6ImV1YzEifQ.FsgVKBIv_xaWxaA4nzgJQVBnNWVTtLTeXY9IukoaMFI';

// Initialisation
document.addEventListener('DOMContentLoaded', async () => {
  // Affichage du numéro de version (depuis package.json)
  const version = await window.electronAPI.getAppVersion();
  const splashV = document.getElementById('splashVersion');
  const appV = document.getElementById('appVersion');
  if (splashV) splashV.textContent = version;
  if (appV) {
    appV.textContent = version;
    appV.style.cursor = 'pointer';
    appV.title = 'Voir les notes de version';
    appV.addEventListener('click', openChangelogModal);
  }

  const _launcherSession = await window.electronAPI.getLauncherSession();
  window._launcherSession = _launcherSession;
  const _sessionConnected = _launcherSession.connected;

  if (!_sessionConnected) {
    try {
      const hour = new Date().getHours();
      let jingleId;
      if (hour >= 6 && hour < 12)       jingleId = 'jingleMatin';
      else if (hour >= 12 && hour < 14)  jingleId = 'jingleMidi';
      else if (hour >= 14 && hour < 19)  jingleId = 'jingleAprem';
      else                               jingleId = 'jingleSoir';

      const jingle = document.getElementById(jingleId);
      if (jingle) {
        jingle.volume = 0.7;
        jingle.play().catch(err => {
          console.log('Impossible de jouer le jingle:', err);
        });
      }
    } catch (e) {
      console.log('Erreur jingle:', e);
    }
  }
  runSplash();

function runSplash(onComplete) {
  const dg = document.getElementById('dot-grid');
  const rs = document.getElementById('ring-svg');
  const rd = document.getElementById('ring-draw');
  const pe = document.getElementById('patch-el');
  const ve = document.getElementById('ver-el');
  const fe = document.getElementById('flash-el');

  if (ve && window.APP_VERSION) ve.textContent = window.APP_VERSION;

  [dg, rs, pe, ve, fe].forEach(el => {
    if (!el) return;
    el.style.transition = 'none';
    el.style.opacity = '0';
  });
  if (rd) { rd.style.transition = 'none'; rd.style.strokeDashoffset = '722'; }
  if (pe) pe.style.transform = 'scale(0.88) rotate(5deg)';
  if (dg) void dg.offsetHeight;

  // Grille de points
  if (dg) {
    const ctx = dg.getContext('2d');
    dg.width = window.innerWidth;
    dg.height = window.innerHeight;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    for (let x = 0; x < dg.width; x += 28)
      for (let y = 0; y < dg.height; y += 28) {
        ctx.beginPath(); ctx.arc(x, y, 0.8, 0, Math.PI * 2); ctx.fill();
      }
  }

  const t = (fn, ms) => setTimeout(fn, ms);

  t(() => { if (dg) { dg.style.transition = 'opacity 0.7s'; dg.style.opacity = '1'; } }, 180);
  t(() => { if (rs) { rs.style.transition = 'opacity 0.3s'; rs.style.opacity = '1'; } }, 350);
  t(() => { if (rd) { rd.style.transition = 'stroke-dashoffset 1.5s cubic-bezier(0.4,0,0.2,1)'; rd.style.strokeDashoffset = '0'; } }, 410);
  t(() => {
    if (pe) {
      pe.style.transition = 'opacity 1.8s cubic-bezier(0.16,1,0.3,1), transform 2.5s cubic-bezier(0.16,1,0.3,1)';
      pe.style.opacity = '1';
      pe.style.transform = 'scale(1) rotate(0deg)';
    }
  }, 550);
  t(() => { if (ve) { ve.style.transition = 'opacity 0.5s'; ve.style.opacity = '1'; } }, 1650);
  t(() => { if (fe) { fe.style.transition = 'opacity 0.22s ease-in'; fe.style.opacity = '1'; } }, 4000);
  t(() => {
    if (fe) { fe.style.transition = 'opacity 0.5s ease-out'; fe.style.opacity = '0'; }
    const splash = document.getElementById('splashScreen');
    if (splash) splash.style.display = 'none';
    const app = document.querySelector('.app-container');
    if (app) app.style.opacity = '1';
    if (onComplete) onComplete();
  }, 4230);
}

  await initializeApp();
  setupEventListeners();
  await loadSettings();
  updateOrganizerOptionVisibility();
  updateProjectNamePreview();
  
  // Toujours charger les profils sur la home au démarrage
  function showSessionView(session) {
    const sessionView = document.getElementById('sessionView');
    const waitingView = document.getElementById('waitingView');
    if (!sessionView) return;
    if (waitingView) { waitingView.classList.remove('active'); waitingView.style.display = 'none'; }
    sessionView.style.display = '';
    sessionView.classList.add('active');
    const initials = session.profileName
      ? session.profileName.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase() : '?';
    const nameEl = document.getElementById('session-profile-name');
    const initialsEl = document.getElementById('session-avatar-initials');
    if (nameEl) nameEl.textContent = session.profileName || '';
    if (initialsEl) initialsEl.textContent = initials;
    const continueBtn = document.getElementById('session-continue-btn');
    const changeBtn = document.getElementById('session-change-btn');
    if (continueBtn) {
      continueBtn.replaceWith(continueBtn.cloneNode(true));
      document.getElementById('session-continue-btn').addEventListener('click', () => {
        sessionView.classList.remove('active');
        sessionView.style.display = 'none';
        selectLauncherProfile(session);
      });
    }
    if (changeBtn) {
      changeBtn.replaceWith(changeBtn.cloneNode(true));
      document.getElementById('session-change-btn').addEventListener('click', () => {
        showProfileSwitchModal();
      });
    }
  }

  function showWaitingView() {
    const waitingView = document.getElementById('waitingView');
    const sessionView = document.getElementById('sessionView');
    if (!waitingView) return;
    if (sessionView) { sessionView.classList.remove('active'); sessionView.style.display = 'none'; }
    waitingView.style.display = 'flex';
    waitingView.classList.add('active');
    const statusEl = document.getElementById('waitingStatus');
    const launchBtn = document.getElementById('waitingLaunchBtn');
    if (launchBtn) {
      launchBtn.replaceWith(launchBtn.cloneNode(true));
      document.getElementById('waitingLaunchBtn').addEventListener('click', async () => {
        if (statusEl) statusEl.textContent = 'Ouverture de Launcher…';
        await window.electronAPI.spawnLauncher();
      });
    }
    let pollInterval = setInterval(async () => {
      const session = await window.electronAPI.getLauncherSession();
      if (session && session.connected) {
        clearInterval(pollInterval);
        window._launcherSession = session;
        showSessionView(session);
      }
    }, 2000);
  }

  function showProfileSwitchModal() {
    const modal = document.getElementById('profileSwitchModal');
    const grid = document.getElementById('profileSwitchGrid');
    if (!modal || !grid) return;
    const profiles = (window._launcherSession && window._launcherSession.allProfiles) || [];
    grid.innerHTML = profiles.map(p => {
      const bf = (p.appSettings && p.appSettings.backupflow) || {};
      const initials = bf.initiales || (p.name ? p.name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase() : '?');
      const color = bf.color || '#2563eb';
      const avatarStyle = p.avatar
        ? `background:${color};background-image:url(${p.avatar});background-size:cover;background-position:center;`
        : `background:${color};display:flex;align-items:center;justify-content:center;`;
      const avatarContent = p.avatar ? '' : initials;
      return `<button class="profile-switch-card" data-profile-id="${p.id}" style="background:var(--bg-tertiary);border:2px solid transparent;border-radius:12px;padding:16px;cursor:pointer;text-align:center;transition:border-color 0.2s;">
        <div style="width:48px;height:48px;border-radius:50%;${avatarStyle}margin:0 auto 8px;font-size:1.1rem;font-weight:700;color:#fff;">${avatarContent}</div>
        <div style="font-size:0.85rem;font-weight:600;color:var(--text-primary);">${p.name}</div>
      </button>`;
    }).join('');
    grid.querySelectorAll('.profile-switch-card').forEach(btn => {
      btn.addEventListener('click', () => {
        const profileId = btn.dataset.profileId;
        const profile = profiles.find(p => p.id === profileId);
        if (!profile) return;
        modal.style.display = 'none';
        const sessionView = document.getElementById('sessionView');
        if (sessionView) { sessionView.classList.remove('active'); sessionView.style.display = 'none'; }
        selectLauncherProfile({
          connected: true,
          profileId: profile.id,
          profileName: profile.name,
          profileRole: (profile.appSettings && profile.appSettings.backupflow && profile.appSettings.backupflow.role) || 'user',
          appSettings: profile.appSettings || {},
          allProfiles: profiles,
          apiKeys: window._launcherSession.apiKeys || {}
        });
      });
    });
    const closeBtn = document.getElementById('profileSwitchCloseBtn');
    if (closeBtn) {
      closeBtn.replaceWith(closeBtn.cloneNode(true));
      document.getElementById('profileSwitchCloseBtn').addEventListener('click', () => {
        modal.style.display = 'none';
      });
    }
    modal.style.display = 'flex';
  }
  window.showProfileSwitchModal = showProfileSwitchModal;

  if (_launcherSession.connected) {
    showSessionView(_launcherSession);
  } else {
    showWaitingView();
  }
});

async function initializeApp() {
  // Vérifier et connecter FortiClient VPN si nécessaire
  // (Optionnel - ne pas bloquer l'initialisation en cas d'erreur)
  try {
    if (window.electronAPI && window.electronAPI.checkAndConnectVPN) {
      const vpnResult = await window.electronAPI.checkAndConnectVPN();
      if (vpnResult && vpnResult.success) {
        console.log('VPN check:', vpnResult.message || 'OK');
      }
    }
  } catch (error) {
    // Erreur non bloquante - l'app peut fonctionner sans VPN
    console.log('VPN check (non bloquant):', error.message || error);
  }
  
  // Charger les paramètres
  state.settings = await window.electronAPI.getSettings();
  
  // Remplir les champs de paramètres
  if (state.settings.ssdPersoPath) {
    document.getElementById('ssdPersoPath').value = state.settings.ssdPersoPath;
  }
  if (state.settings.ssdStudioPath) {
    document.getElementById('ssdStudioPath').value = state.settings.ssdStudioPath;
  }
  if (state.settings.nas) {
    const protocol = state.settings.nas.protocol || 'smb';
    document.getElementById('nasProtocol').value = protocol;
    
    // Afficher la configuration appropriée
    toggleNASProtocol();
    
    if (protocol === 'smb') {
      document.getElementById('nasSMBURL').value = state.settings.nas.smbURL || 'smb://srvfiler01.etudiant.lan/Video';
      document.getElementById('nasSMBRemotePath').value = state.settings.nas.remotePath || '/';
    } else {
      document.getElementById('nasHost').value = state.settings.nas.host || '';
      document.getElementById('nasPort').value = state.settings.nas.port || 22;
      document.getElementById('nasUsername').value = state.settings.nas.username || '';
      document.getElementById('nasPassword').value = state.settings.nas.password || '';
      document.getElementById('nasRemotePath').value = state.settings.nas.remotePath || '/backups';
    }
  } else {
    // Valeur par défaut SMB
    document.getElementById('nasSMBURL').value = 'smb://srvfiler01.etudiant.lan/Video';
  }
  
  const gofileAuto = document.getElementById('gofileAutoUpload');
  if (gofileAuto) gofileAuto.checked = !!state.settings.gofileAutoUpload;

  // Options workflow
  const settingsCompress = document.getElementById('settingsCompress');
  if (settingsCompress) settingsCompress.checked = state.settings.compress !== false;
  const settingsUploadNAS = document.getElementById('settingsUploadNAS');
  if (settingsUploadNAS) settingsUploadNAS.checked = state.settings.uploadToNAS !== false;
  const settingsZipNas = document.getElementById('settingsZipNas');
  if (settingsZipNas) settingsZipNas.checked = state.settings.zipNasEnabled || false;
  const settingsVerifyIntegrity = document.getElementById('settingsVerifyIntegrity');
  if (settingsVerifyIntegrity) settingsVerifyIntegrity.checked = state.settings.verifyIntegrity !== false;
  // Charger les extensions vidéo autorisées
  renderAllowedExtensions();

  // VPN Name
  const vpnNameInput = document.getElementById('vpnName');
  if (vpnNameInput) vpnNameInput.value = state.settings.vpnName || '';

  // Organizer (MultiCam) — option masquée par défaut en V1
  const organizerToggle = document.getElementById('organizerModeEnabledToggle');
  if (organizerToggle) organizerToggle.checked = state.settings.organizerModeEnabled === true;

  // Rafraîchir les indicateurs NAS/VPN (non bloquant)
  nasRefreshIndicators().catch(() => {});

  // Monday.com (Tableau suivi de production)
  const mondayInput = document.getElementById('mondayApiToken');
  if (mondayInput) {
    mondayInput.value = state.settings.mondayApiToken || DEFAULT_MONDAY_API_TOKEN || '';
  }
  const mondayBoardInput = document.getElementById('mondayBoardId');
  if (mondayBoardInput) {
    mondayBoardInput.value = state.settings.mondayBoardId || '';
  }

  const resendInput = document.getElementById('resendApiKey');
  if (resendInput) resendInput.value = state.settings.resendApiKey || '';
  
  // Vérifier HandBrake
  const handbrakeCheck = await window.electronAPI.checkHandBrake();
  if (!handbrakeCheck.installed) {
    const sc = document.getElementById('settingsCompress');
    if (sc) { sc.disabled = true; sc.checked = false; }
    state.settings.compress = false;
    showNotification('HandBrake CLI non trouvé. La compression ne sera pas disponible.', 'warning');
  }
  
  // Charger l'historique
  await loadHistory();
  
  // Écouter les événements de progression
  // DEBUG OPTION 1: Logger toutes les données reçues via IPC
  window.electronAPI.onWorkflowProgress((data) => {
    console.log(`[Renderer DEBUG] Received workflow-progress via IPC:`, {
      step: data.step,
      progress: data.progress,
      globalProgress: data.globalProgress,
      status: data.status,
      fps: data.fps,
      avgFps: data.avgFps,
      eta: data.eta,
      file: data.file
    });
    
    updateWorkflowProgress(data);
  });
}

function openChangelogModal() {
  const modal = document.getElementById('changelogModal');
  const content = document.getElementById('changelogContent');
  if (!modal || !content) return;
  content.innerHTML = CHANGELOG.map(entry => `
    <div class="changelog-entry">
      <div class="changelog-version">${escapeHtml(entry.version)}</div>
      <div class="changelog-date">${escapeHtml(entry.date)}</div>
      <ul class="changelog-notes">
        ${entry.notes.map(n => `<li>${escapeHtml(n)}</li>`).join('')}
      </ul>
    </div>
  `).join('');
  modal.style.display = 'flex';
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const cl = document.getElementById('changelogModal');
    if (cl && cl.style.display !== 'none') cl.style.display = 'none';
    const vp = document.getElementById('videoPreviewModal');
    if (vp && vp.classList.contains('show')) closeVideoPreview();
  }
});

function setupEventListeners() {
  // Navigation - délégation sur la barre de navigation
  const navContainer = document.querySelector('.top-bar-nav') || document.querySelector('.sidebar-nav');
  if (navContainer) {
    navContainer.addEventListener('click', (e) => {
      const navBtn = e.target.closest('.nav-btn');
      if (!navBtn) return;
      e.preventDefault();
      e.stopPropagation();
      const viewName = navBtn.dataset.view;
      if (viewName) switchView(viewName);
    });
  }
  
  // Également attacher directement sur les boutons comme backup
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const viewName = btn.dataset.view;
      if (viewName) {
        console.log('Clic direct sur bouton, vue:', viewName);
        switchView(viewName);
      }
    });
  });
  
  // Toggle thème
  document.getElementById('themeToggle').addEventListener('click', toggleTheme);
  
  // Bouton Quitter
  const quitBtn = document.getElementById('quitBtn');
  if (quitBtn) {
    quitBtn.addEventListener('click', async () => {
      // Vérifier si un workflow est en cours
      if (window.electronAPI && window.electronAPI.isWorkflowRunning) {
        const isRunning = await window.electronAPI.isWorkflowRunning();
        if (isRunning) {
          // Afficher le modal de confirmation
          showQuitConfirmModal();
          return;
        }
      }
      // Si pas de workflow en cours, quitter directement
      if (window.electronAPI && window.electronAPI.quitApp) {
        window.electronAPI.quitApp();
      }
    });
  }
  
  // Écouter les demandes de confirmation depuis le main process
  if (window.electronAPI && window.electronAPI.onConfirmQuit) {
    window.electronAPI.onConfirmQuit(() => {
      showQuitConfirmModal();
    });
  }
  
  // Gérer les boutons du modal de confirmation
  const quitConfirmModal = document.getElementById('quitConfirmModal');
  const quitConfirmCancelBtn = document.getElementById('quitConfirmCancelBtn');
  const quitConfirmOkBtn = document.getElementById('quitConfirmOkBtn');
  
  if (quitConfirmCancelBtn) {
    quitConfirmCancelBtn.addEventListener('click', () => {
      quitConfirmModal.classList.remove('show');
    });
  }
  
  if (quitConfirmOkBtn) {
    quitConfirmOkBtn.addEventListener('click', () => {
      quitConfirmModal.classList.remove('show');
      // Forcer la fermeture
      if (window.electronAPI && window.electronAPI.forceQuit) {
        window.electronAPI.forceQuit();
      }
    });
  }
  
  // Fermer le modal en cliquant à l'extérieur
  if (quitConfirmModal) {
    quitConfirmModal.addEventListener('click', (e) => {
      if (e.target === quitConfirmModal) {
        quitConfirmModal.classList.remove('show');
      }
    });
  }
  
  // Workflow - Source du projet (Monday / Manuel / Organizer)
  const mondayToggle = document.getElementById('mondayModeToggle');
  if (mondayToggle) {
    mondayToggle.addEventListener('click', (e) => {
      const opt = e.target.closest('.toggle-option');
      if (!opt) return;
      const newMode = opt.dataset.mode;
      const toggle = document.getElementById('mondayModeToggle');
      if (toggle) toggle.dataset.mode = newMode;
      if (newMode === 'organizer') {
        importOrganizerProject();
        return;
      }
      applySourceMode(newMode);
      saveMondayModeToProfile(newMode);
      if (newMode === 'monday') loadMondayProjects();
      else {
        state.workflow.mondayItemId = null;
        state.workflow.dateTournage = null;
        state.workflow.isMultiCam = false;
        state.workflow.multiCamSourcePath = null;
        state.workflow.multiCamSources = [];
        state.workflow.multiCamFolderSummary = null;
      }
      renderStep2Content();
      updateWorkflowValidation();
    });
  }
  document.getElementById('mondayProjectSelect')?.addEventListener('change', onMondayProjectSelect);
  document.getElementById('mondayRetryBtn')?.addEventListener('click', () => loadMondayProjects());
  document.getElementById('mondayBoardIdHelp')?.addEventListener('click', (e) => {
    e.preventDefault();
    window.electronAPI.openExternalURL('https://support.monday.com');
  });
  document.getElementById('btnNewProject')?.addEventListener('click', onBtnNewProject);
  document.getElementById('btnAddSession')?.addEventListener('click', onBtnAddSession);
  document.getElementById('btnManualAddSession')?.addEventListener('click', onManualAddSession);

  // Workflow - Informations projet
  document.getElementById('projectFormat').addEventListener('change', updateProjectNamePreview);
  
  // Forcer majuscules sur le sujet à la saisie
  const sujetInput = document.getElementById('projectSujet');
  sujetInput.addEventListener('input', (e) => {
    const originalValue = e.target.value;
    const cursorPos = e.target.selectionStart;
    // Convertir en majuscules
    const upperValue = originalValue.toUpperCase();
    e.target.value = upperValue;
    // Restaurer la position du curseur
    e.target.setSelectionRange(cursorPos, cursorPos);
    updateProjectNamePreview();
  });
  
  document.getElementById('projectInitiales').addEventListener('input', (e) => {
    // Forcer majuscules pour les initiales aussi
    e.target.value = e.target.value.toUpperCase();
    updateProjectNamePreview();
  });
  
  // Workflow - Sélection fichiers
  document.getElementById('selectFilesBtn').addEventListener('click', selectFiles);
  
  // Paramètres - Options workflow
  document.getElementById('settingsCompress')?.addEventListener('change', (e) => {
    state.settings.compress = e.target.checked;
  });
  document.getElementById('settingsUploadNAS')?.addEventListener('change', (e) => {
    state.settings.uploadToNAS = e.target.checked;
  });
  document.getElementById('settingsZipNas')?.addEventListener('change', (e) => {
    state.settings.zipNasEnabled = e.target.checked;
  });
  document.getElementById('settingsVerifyIntegrity')?.addEventListener('change', (e) => {
    state.settings.verifyIntegrity = e.target.checked;
  });
  document.getElementById('addExtensionBtn')?.addEventListener('click', addVideoExtension);
  document.getElementById('newExtensionInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addVideoExtension(); }
  });
  
  // Actions workflow
  document.getElementById('startWorkflowBtn').addEventListener('click', startWorkflow);
  document.getElementById('addToBatchBtn').addEventListener('click', addToBatchQueue);
  document.getElementById('cancelWorkflowBtn').addEventListener('click', cancelWorkflow);

  // Arrêt workflow en cours
  document.getElementById('stopWorkflowBtn')?.addEventListener('click', () => {
    document.getElementById('stopWorkflowConfirmModal')?.classList.add('show');
  });
  document.getElementById('stopWorkflowCancelBtn')?.addEventListener('click', () => {
    document.getElementById('stopWorkflowConfirmModal')?.classList.remove('show');
  });
  document.getElementById('stopWorkflowConfirmBtn')?.addEventListener('click', handleStopWorkflowConfirm);

  document.getElementById('workflowAbortedDeleteBtn')?.addEventListener('click', async () => {
    const paths = state._abortedPaths || {};
    if (paths.ssdPerso) {
      try { await window.electronAPI.removeFolder(paths.ssdPerso); } catch {}
    }
    if (paths.ssdStudio) {
      try { await window.electronAPI.removeFolder(paths.ssdStudio); } catch {}
    }
    showNotification('Fichiers copiés supprimés', 'info');
    window.electronAPI.sendWorkflowStoppedMail({
      toEmail: state.selectedProfile?.email,
      toName: state.selectedProfile?.name || 'Utilisateur',
      projectName: state.workflow.projectName || 'Projet'
    });
    state._workflowAborted = false;
    state._abortedPaths = null;
    returnToWorkflowConfig();
  });

  document.getElementById('workflowAbortedKeepBtn')?.addEventListener('click', () => {
    showNotification('Fichiers copiés conservés', 'info');
    window.electronAPI.sendWorkflowStoppedMail({
      toEmail: state.selectedProfile?.email,
      toName: state.selectedProfile?.name || 'Utilisateur',
      projectName: state.workflow.projectName || 'Projet'
    });
    state._workflowAborted = false;
    state._abortedPaths = null;
    returnToWorkflowConfig();
  });

  document.getElementById('workflowAbortedQuitBtn')?.addEventListener('click', () => {
    window.electronAPI.sendWorkflowStoppedMail({
      toEmail: state.selectedProfile?.email,
      toName: state.selectedProfile?.name || 'Utilisateur',
      projectName: state.workflow.projectName || 'Projet'
    });
    window.electronAPI.forceQuit?.();
  });

  // Boutons BATCH
  document.getElementById('startBatchBtn').addEventListener('click', startBatchQueue);
  document.getElementById('clearBatchBtn').addEventListener('click', clearBatchQueue);
  document.getElementById('stopBatchBtn')?.addEventListener('click', () => {
    document.getElementById('stopBatchConfirmModal')?.classList.add('show');
  });
  document.getElementById('stopBatchCancelBtn')?.addEventListener('click', () => {
    document.getElementById('stopBatchConfirmModal')?.classList.remove('show');
  });
  document.getElementById('stopBatchConfirmBtn')?.addEventListener('click', async () => {
    document.getElementById('stopBatchConfirmModal')?.classList.remove('show');
    state.batchQueue.stopRequested = true;
    try { await window.electronAPI.abortWorkflow(); } catch { /* ignore */ }
    showNotification('Batch arrete', 'warning');
  });
  document.getElementById('newBatchBtn')?.addEventListener('click', () => {
    state.batchQueue.items = [];
    state.batchQueue.startTime = null;
    switchView('batch');
  });
  
  // Paramètres
  document.getElementById('selectSSDPersoBtn').addEventListener('click', () => selectDestination('ssdPerso'));
  document.getElementById('selectSSDStudioBtn').addEventListener('click', () => selectDestination('ssdStudio'));
  document.getElementById('nasProtocol').addEventListener('change', toggleNASProtocol);
  document.getElementById('selectNASFolderBtn').addEventListener('click', selectNASFolder);
  document.getElementById('testNASBtn').addEventListener('click', testNASConnection);
  document.getElementById('testMondayBtn')?.addEventListener('click', testMondayConnection);
  document.getElementById('testResendBtn')?.addEventListener('click', async () => {
    const key = document.getElementById('resendApiKey').value.trim();
    const resultEl = document.getElementById('resendTestResult');
    if (!key) { resultEl.textContent = 'Clé manquante.'; resultEl.style.color = 'red'; return; }
    resultEl.textContent = 'Test en cours...';
    resultEl.style.color = 'var(--text-secondary)';
    const result = await window.electronAPI.testResendConnection(key);
    resultEl.textContent = result.success
      ? 'Connexion réussie — mail de test envoyé.'
      : `Erreur : ${result.message}`;
    resultEl.style.color = result.success ? 'var(--color-primary)' : 'red';
  });
  document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);

  // Toggle Organizer (admin) — effet immédiat + persistance
  document.getElementById('organizerModeEnabledToggle')?.addEventListener('change', async (e) => {
    state.settings.organizerModeEnabled = e.target.checked;
    updateOrganizerOptionVisibility();
    try {
      await saveSettings();
    } catch (err) {
      console.error('Erreur sauvegarde organizerModeEnabled:', err);
    }
  });

  // Sections Paramètres rétractables
  document.querySelectorAll('.settings-section-toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
      const isCollapsed = toggle.dataset.collapsed === 'true';
      const body = toggle.nextElementSibling;
      if (!body || !body.classList.contains('settings-section-body')) return;
      if (isCollapsed) {
        toggle.dataset.collapsed = 'false';
        body.style.display = 'block';
      } else {
        toggle.dataset.collapsed = 'true';
        body.style.display = 'none';
      }
    });
  });

  // Polling VPN + auto-mount NAS (evenements venant du main process)
  if (window.electronAPI.onVpnStatusUpdate) {
    window.electronAPI.onVpnStatusUpdate((data) => {
      updateVPNIndicator(
        data.connected ? 'connected' : 'disconnected',
        data.connected ? 'VPN : connecte' : 'VPN : deconnecte'
      );
    });
  }
  if (window.electronAPI.onNasAutoMounted) {
    window.electronAPI.onNasAutoMounted(() => {
      setNASDotColor('green');
      const nasInd = document.getElementById('nasStatusIndicator');
      const nasLab = document.getElementById('nasStatusLabel');
      if (nasInd) nasInd.dataset.status = 'connected';
      if (nasLab) nasLab.textContent = 'NAS : monte';
    });
  }
  if (window.electronAPI.onNasAutoMountFailed) {
    window.electronAPI.onNasAutoMountFailed(() => {
      setNASDotColor('red');
      const nasInd = document.getElementById('nasStatusIndicator');
      const nasLab = document.getElementById('nasStatusLabel');
      if (nasInd) nasInd.dataset.status = 'disconnected';
      if (nasLab) nasLab.textContent = 'NAS : non monte';
    });
  }

  // Historique
  document.getElementById('refreshHistoryBtn').addEventListener('click', loadHistory);
  document.getElementById('clearHistoryBtn').addEventListener('click', clearHistory);
  document.getElementById('historyProfileFilter').addEventListener('change', (e) => {
    currentHistoryFilter = e.target.value;
    loadHistory();
  });
  
  // Onglets Historique/Statistiques - SUPPRIMÉ
  
  // Actions workflow terminé
  document.getElementById('returnToWorkflowBtn').addEventListener('click', () => {
    // Retour à l'accueil
    switchView('home');
  });
  
  document.getElementById('closeWorkflowBtn').addEventListener('click', () => {
    // Quitter l'application
    window.electronAPI.quitApp();
  });

  document.getElementById('diskSpaceAlertOkBtn')?.addEventListener('click', () => {
    const modal = document.getElementById('diskSpaceAlertModal');
    if (modal) modal.classList.remove('show');
  });

  document.getElementById('multicamDiskSpaceRevoirBtn')?.addEventListener('click', () => {
    document.getElementById('multicamDiskSpaceModal')?.classList.remove('show');
    switchView('settings');
  });
  document.getElementById('multicamDiskSpaceRetryBtn')?.addEventListener('click', async () => {
    document.getElementById('multicamDiskSpaceModal')?.classList.remove('show');
    await startWorkflow();
  });

  // Bouton Gofile (écran workflow terminé)
  document.getElementById('btn-gofile')?.addEventListener('click', async () => {
    const section = document.getElementById('gofile-section');
    const folderPath = section?.dataset.folderPath;
    if (!folderPath) {
      renderGofileResult(false, null, 'Chemin du projet non disponible.');
      return;
    }

    const btn = document.getElementById('btn-gofile');
    btn.disabled = true;
    btn.textContent = 'Upload en cours…';
    document.getElementById('gofile-progress-zone').style.display = 'block';
    document.getElementById('gofile-result-zone').style.display = 'none';

    window.electronAPI.onGofileProgress(({ done, total, fileName }) => {
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      document.getElementById('gofile-progress-bar').style.width = pct + '%';
      document.getElementById('gofile-progress-label').textContent =
        fileName
          ? `Envoi : ${fileName} (${done + 1}/${total})`
          : 'Finalisation…';
    });

    const res = await window.electronAPI.gofileUpload(folderPath);

    btn.style.display = 'none';
    document.getElementById('gofile-progress-zone').style.display = 'none';
    renderGofileResult(res.ok, res.downloadPage, res.error);
  });
  
  // Profils (page d'accueil)
  const addProfileBtn = document.getElementById('addProfileBtn');
  if (addProfileBtn) addProfileBtn.addEventListener('click', () => openProfileModal());
  const _safe = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  _safe('closeProfileModal', closeProfileModal);
  _safe('cancelProfileBtn', closeProfileModal);
  _safe('saveProfileBtn', saveProfile);
  _safe('selectProfileSSDPersoBtn', () => selectProfileDestination('perso'));
  _safe('selectProfileSSDStudioBtn', () => selectProfileDestination('studio'));
  _safe('resetProfileSSDStudioBtn', () => { const el = document.getElementById('profileSSDStudioPath'); if (el) el.value = ''; });
  _safe('selectProfilePhotoBtn', selectProfilePhoto);
  _safe('removeProfilePhotoBtn', removeProfilePhoto);
  const _importBtn = document.getElementById('select-profile-photo-btn-import');
  if (_importBtn) _importBtn.addEventListener('click', async () => {
    const filePath = await window.electronAPI.selectProfilePhoto();
    if (filePath) {
      currentProfilePhoto = filePath;
      const photoPreview = document.getElementById('profile-photo-preview');
      if (photoPreview) photoPreview.style.backgroundImage = `url(file://${filePath})`;
      const _label = document.getElementById('profile-photo-imported-label');
      if (_label) _label.style.display = 'inline';
      const avatarGrid = document.getElementById('profile-avatar-grid');
      if (avatarGrid) avatarGrid.querySelectorAll('.avatar-option').forEach(a => a.classList.remove('selected'));
    }
  });

  const profileMondayUserSelect = document.getElementById('profileMondayUser');
  if (profileMondayUserSelect) {
    const populateMondayUsers = async (preselectedId = null) => {
      if (profileMondayUserSelect.options.length > 1 && !preselectedId) return;
      try {
        const { users, error } = await window.electronAPI.getMondayUsers();
        if (error) {
          showNotification(`Monday: ${error}`, 'warning');
          return;
        }
        const selected = preselectedId || profileMondayUserSelect.value;
        profileMondayUserSelect.innerHTML = '<option value="">— Non lié —</option>' +
          users.map(u => `<option value="${escapeHtml(String(u.id))}">${escapeHtml(`${(u.name || '').trim() || u.email || u.id} (${u.email || ''})`)}</option>`).join('');
        if (selected) profileMondayUserSelect.value = selected;
      } catch (e) {
        showNotification('Erreur chargement utilisateurs Monday', 'error');
      }
    };
    profileMondayUserSelect.addEventListener('focus', () => populateMondayUsers());
    profileMondayUserSelect.addEventListener('click', () => populateMondayUsers());
  }
  
  // Fermer le modal en cliquant à l'extérieur
  const profileModal = document.getElementById('profileModal');
  if (profileModal) {
    profileModal.addEventListener('click', (e) => {
      if (e.target.id === 'profileModal') {
        closeProfileModal();
      }
    });
  }
  
  // Fermer le modal avec la touche ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('profileModal');
      if (modal && modal.classList.contains('show')) {
        closeProfileModal();
      }
    }
  });
  
  // Photo de profil cliquable dans l'en-tête
  document.addEventListener('click', (e) => {
    if (e.target.closest('#profileHeaderPhoto')) {
      const photoEl = document.getElementById('profileHeaderPhoto');
      const profileId = photoEl?.dataset?.profileId;
      if (profileId && state.selectedProfile) {
        window.showProfileSwitchModal();
      }
    }
  });
  
  // Contrôles de fenêtre
  // Les contrôles de fenêtre sont gérés par macOS nativement
}

// Navigation
function switchView(viewName) {
  console.log('=== switchView appelé avec:', viewName);

  if (viewName === 'home') {
    document.querySelectorAll('.view').forEach(v => { v.classList.remove('active'); v.style.display = ''; });
    if (window._launcherSession && window._launcherSession.connected) {
      const sv = document.getElementById('sessionView');
      if (sv) { sv.style.display = ''; sv.classList.add('active'); }
    } else {
      const wv = document.getElementById('waitingView');
      if (wv) { wv.style.display = 'flex'; wv.classList.add('active'); }
    }
    return;
  }

  // Protection des espaces : obliger à choisir un profil pour accéder au reste
  if (viewName !== 'home' && !state.selectedProfile) {
    showNotification('Veuillez d\'abord sélectionner un profil', 'warning');
    // Forcer le retour à la home
    const homeBtn = document.querySelector('.nav-btn[data-view="home"]');
    if (homeBtn) {
      homeBtn.classList.add('active');
      document.querySelectorAll('.nav-btn').forEach(btn => {
        if (btn !== homeBtn) btn.classList.remove('active');
      });
    }
    return;
  }
  
  // Vérifier que la vue existe
  const viewId = `${viewName}View`;
  console.log('Recherche de la vue:', viewId);
  
  // Masquer toutes les vues
  const allViews = document.querySelectorAll('.view');
  console.log('Nombre de vues trouvées:', allViews.length);
  allViews.forEach(view => {
    view.classList.remove('active');
    console.log('Vue masquée:', view.id);
  });
  
  // Afficher la vue sélectionnée
  const targetView = document.getElementById(viewId);
  if (targetView) {
    targetView.classList.add('active');
    console.log('Vue activée:', viewId);
    
    // Forcer l'affichage avec style inline aussi
    targetView.style.display = 'block';
  } else {
    console.error('Vue introuvable:', viewId);
    // Lister toutes les vues disponibles pour débogage
    allViews.forEach(v => console.log('  Vue disponible:', v.id));
    // Pour les vues spéciales qui n'ont pas le format standard, essayer une recherche différente
    if (viewName === 'workflowRunning') {
      const altView = document.getElementById('workflowRunningView');
      if (altView) {
        altView.classList.add('active');
        altView.style.display = 'block';
        return;
      }
    }
    if (viewName === 'workflowCompleted') {
      const altView = document.getElementById('workflowCompletedView');
      if (altView) {
        altView.classList.add('active');
        altView.style.display = 'block';
        return;
      }
    }
  }
  
  // Mettre à jour les boutons de navigation
  const allNavBtns = document.querySelectorAll('.nav-btn');
  console.log('Nombre de boutons navigation:', allNavBtns.length);
  allNavBtns.forEach(btn => {
    const isActive = btn.dataset.view === viewName;
    if (isActive) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
    console.log(`  Bouton "${btn.dataset.view}": ${isActive ? 'ACTIF' : 'inactif'}`);
  });
  
  state.currentView = viewName;
  
  // En quittant la vue workflow terminé, effacer le message d'erreur Monday
  if (viewName !== 'workflowCompleted') {
    state.mondayUpdateError = null;
    const mondayErrEl = document.getElementById('mondayUpdateErrorMsg');
    if (mondayErrEl) { mondayErrEl.style.display = 'none'; mondayErrEl.textContent = ''; }
  }

  // Si on affiche la vue batch, mettre à jour l'affichage de la queue
  if (viewName === 'batch') {
    renderBatchQueue();
    updateBatchControls();
  }
  
  // Si on affiche la vue workflow, appliquer le mode source et initiales du profil
  if (viewName === 'workflow') {
    updateOrganizerOptionVisibility();
    if (!state.settings.organizerModeEnabled && state.workflow.isMultiCam) {
      state.workflow.isMultiCam = false;
      state.workflow.multiCamSourcePath = null;
      state.workflow.multiCamSources = [];
      state.workflow.multiCamFolderSummary = null;
    }
    applyMultiCamUI();
    if (!state.workflow.isMultiCam) {
      let mode = state.selectedProfile?.mondayMode === 'manual' ? 'manual' : 'monday';
      if (mode === 'organizer' && !state.settings.organizerModeEnabled) mode = 'manual';
      applySourceMode(mode);
      if (mode === 'monday') loadMondayProjects();
    } else {
      applySourceMode('organizer');
    }
    if (state.selectedProfile?.initiales) {
      const initialesInput = document.getElementById('projectInitiales');
      if (initialesInput && !initialesInput.value) {
        initialesInput.value = state.selectedProfile.initiales;
        state.workflow.initiales = state.selectedProfile.initiales;
        updateProjectNamePreview();
      }
    }
    renderStep2Content();
    updateWorkflowValidation();
  }
  
  // Si on affiche la vue des paramètres, mettre à jour l'affichage avec le profil si sélectionné
  if (viewName === 'settings' && state.selectedProfile) {
    const ssdPersoInput = document.getElementById('ssdPersoPath');
    if (ssdPersoInput) {
      const pathToDisplay = state.selectedProfile.ssdPersoPath || state.settings.ssdPersoPath || '';
      ssdPersoInput.value = pathToDisplay;
      if (state.selectedProfile.ssdPersoPath) {
        state.settings.ssdPersoPath = state.selectedProfile.ssdPersoPath;
      }
    }
  }
  
  const adminSection = document.getElementById('adminSection');
  if (adminSection) {
    const isAdmin = state.selectedProfile?.isAdmin === true;
    adminSection.style.display = (viewName === 'settings' && isAdmin) ? 'block' : 'none';
    if (viewName === 'settings' && isAdmin) renderArchivedProfiles();
  }
  
  // Gérer l'affichage de l'en-tête de profil
  if (state.selectedProfile && viewName !== 'home') {
    displayProfileHeader(state.selectedProfile);
  } else {
    const header = document.getElementById('profileHeader');
    if (header) header.style.display = 'none';
  }
  
  // Charger les données si nécessaire
  if (viewName === 'home') {
    loadProfiles();
  } else if (viewName === 'history') {
    loadHistory();
  } else if (viewName === 'workflowRunning') {
    // La vue workflowRunning est déjà active, pas besoin de charger
  } else if (viewName === 'workflowCompleted') {
    // La vue workflowCompleted est déjà active, pas besoin de charger
  }
  
  console.log('=== Fin switchView');
}

// Thème
function toggleTheme() {
  const body = document.body;
  const isDark = body.classList.contains('dark-theme');
  
  body.classList.toggle('dark-theme', !isDark);
  body.classList.toggle('light-theme', isDark);
  
  const btn = document.getElementById('themeToggle');
  btn.textContent = isDark ? 'Mode sombre' : 'Mode clair';
}

/**
 * Retire l'acronyme du format du sujet pour éviter la redondance dans le nom généré
 * Ex: "Projet ITW - Orelsan" + format ITW -> "Projet - Orelsan"
 */
function stripFormatFromSujet(sujet, format) {
  if (!format || !sujet || typeof sujet !== 'string') return sujet || '';
  const escaped = format.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('([\\s_\\-.,;:()\\[\\]]|^)' + escaped + '([\\s_\\-.,;:()\\[\\]]|$)', 'gi');
  let out = sujet.replace(re, (_, pre, post) => {
    const p = pre || '';
    const a = post || '';
    if (/[\s]/.test(p) && /[\s]/.test(a)) return ' ';
    if (/[\s]/.test(p)) return a;
    if (/[\s]/.test(a)) return p;
    return (p === a && /_/.test(p)) ? '_' : (p + a);
  });
  out = out.replace(/\s{2,}/g, ' ').replace(/_{2,}/g, '_')
    .replace(/\s*-\s*-\s*/g, ' - ').replace(/^[\s_\-.,;:]+|[\s_\-.,;:]+$/g, '').trim();
  return out;
}

// Génération du nom de projet - Affichage dynamique même si incomplet
async function updateProjectNamePreview() {
  const previewElement = document.getElementById('projectNamePreview');
  if (state.workflow.isSession && state.workflow.parentProjectPath && state.workflow.sessionFolderName) {
    const parentName = (state.workflow.parentProjectPath || '').split(/[/\\]/).pop() || '';
    state.workflow.projectName = parentName + '/' + state.workflow.sessionFolderName;
    if (previewElement) {
      previewElement.textContent = state.workflow.projectName;
      previewElement.style.opacity = '1';
    }
    updateWorkflowValidation();
    return;
  }
  const format = document.getElementById('projectFormat').value;
  const sujet = document.getElementById('projectSujet').value;
  const initiales = document.getElementById('projectInitiales').value;
  
  state.workflow.format = format;
  state.workflow.sujet = sujet ? sujet.toUpperCase() : ''; // Forcer majuscules pour le sujet
  state.workflow.initiales = initiales ? initiales.toUpperCase() : '';
  const previewEl = document.getElementById('projectNamePreview');
  // Construire un aperçu dynamique même si incomplet - MAJUSCULES pour le sujet
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const dateStr = `${year}${month}${day}`;
  
  // Formater le sujet : retirer l'acronyme du format pour éviter la redondance, puis majuscules et underscores
  const sujetSansFormat = format ? stripFormatFromSujet(sujet, format) : (sujet || '');
  const sujetFormatted = sujetSansFormat ? sujetSansFormat.toUpperCase().replace(/\s+/g, '_') : '';
  const initialesFormatted = initiales ? initiales.toUpperCase() : '';
  
  // Si on a tous les champs, générer le nom complet avec la lettre
  if (format && sujet && initiales) {
    try {
      const params = {
        format,
        sujet: sujetFormatted, // Déjà en majuscules
        initiales: initialesFormatted
      };
      if (state.workflow.dateTournage) params.dateOverride = state.workflow.dateTournage;
      const projectName = await window.electronAPI.generateProjectName(params);
      
      state.workflow.projectName = projectName;
      previewEl.textContent = projectName;
      previewEl.style.opacity = '1';
      updateWorkflowValidation();
      return;
    } catch (error) {
      console.error('Erreur génération nom projet:', error);
      previewEl.textContent = 'Erreur';
      return;
    }
  }
  
  // Construire un aperçu dynamique partiel
  let preview = dateStr;
  
  if (format) {
    preview += '?'; // Lettre inconnue jusqu'à ce qu'on ait tous les champs
    preview += '_' + format;
  }
  
  if (sujetFormatted) {
    preview += '_' + sujetFormatted; // Sujet en majuscules
  } else if (format) {
    preview += '_...'; // Placeholder pour sujet manquant
  }
  
  if (initialesFormatted) {
    preview += '_' + initialesFormatted;
  } else if (format || sujetFormatted) {
    preview += '_...'; // Placeholder pour initiales manquantes
  }
  
  // Toujours afficher l'aperçu si on a au moins quelque chose
  if (format || sujet || initiales) {
    previewEl.textContent = preview;
    previewEl.style.opacity = format && sujet && initiales ? '1' : '0.7'; // Plus clair si complet
  } else if (dateStr) {
    previewEl.textContent = dateStr + '_...';
    previewEl.style.opacity = '0.5';
  } else {
    previewEl.textContent = '--';
    previewEl.style.opacity = '1';
  }
  
  state.workflow.projectName = '';
  updateWorkflowValidation();
}

// Visibilité de l'option Organizer (MultiCam) — contrôlée par paramètre admin
function updateOrganizerOptionVisibility() {
  const pill = document.getElementById('mondayModeToggle');
  if (!pill) return;
  const enabled = state.settings?.organizerModeEnabled === true;
  if (enabled) {
    pill.classList.remove('organizer-option-hidden');
  } else {
    pill.classList.add('organizer-option-hidden');
    if (pill.dataset.mode === 'organizer') {
      const fallback = state.selectedProfile?.mondayMode === 'manual' ? 'manual' : 'monday';
      applySourceMode(fallback);
      if (fallback === 'monday') loadMondayProjects();
    }
  }
}

// Source du projet - Toggle et affichage
function applySourceMode(mode) {
  const toggle = document.getElementById('mondayModeToggle');
  const mondaySection = document.getElementById('mondayProjectSection');
  const manualAddSection = document.getElementById('manualAddSessionSection');
  if (toggle) toggle.dataset.mode = mode;
  if (mondaySection) mondaySection.style.display = mode === 'monday' ? 'block' : 'none';
  if (manualAddSection) manualAddSection.style.display = mode === 'manual' ? 'block' : 'none';
  if (mode !== 'monday') {
    state.workflow.existingProjectInfo = null;
    hideExistingProjectBandeau();
  }
  if (mode !== 'manual' && state.workflow.isSession) {
    onBtnNewProject();
  }
}

function applyMondayMode(isMonday) {
  applySourceMode(isMonday ? 'monday' : 'manual');
}

async function saveMondayModeToProfile(mode) {
  if (!state.selectedProfile) return;
  try {
    await window.electronAPI.updateProfile(state.selectedProfile.id, {
      ...state.selectedProfile,
      mondayMode: mode
    });
    state.selectedProfile.mondayMode = mode;
  } catch (e) {
    console.error('Erreur sauvegarde mondayMode:', e);
  }
}

async function importOrganizerProject() {
  const previousMode = state.workflow.isMultiCam ? 'organizer'
    : (state.selectedProfile?.mondayMode === 'manual' ? 'manual' : 'monday');
  const restoreToggle = () => {
    const t = document.getElementById('mondayModeToggle');
    if (t) t.dataset.mode = previousMode;
  };
  const folder = await window.electronAPI.selectFolder();
  if (!folder) { restoreToggle(); return; }
  const manifest = await window.electronAPI.readOrganizerManifest(folder);
  if (!manifest) {
    showNotification('Aucun manifest Organizer trouve dans ce dossier', 'error');
    restoreToggle();
    return;
  }
  applySourceMode('organizer');
  state.workflow.isMultiCam = true;
  state.workflow.multiCamSourcePath = manifest.sourcePath || folder;
  state.workflow.multiCamSources = manifest.sources || [];
  state.workflow.mondayItemId = manifest.mondayItemId || null;
  state.workflow.projectName = manifest.projectCode ? String(manifest.projectCode) : '';
  state.workflow.sujet = manifest.projectCode ? String(manifest.projectCode).toUpperCase() : '';
  state.workflow.format = manifest.format ? String(manifest.format) : '';
  state.workflow.dateTournage = manifest.date ? String(manifest.date) : null;
  state.workflow.files = [];

  document.getElementById('projectSujet').value = state.workflow.sujet;
  document.getElementById('projectFormat').value = state.workflow.format;
  const formatSel = document.getElementById('projectFormat');
  if (formatSel && !formatSel.querySelector(`option[value="${manifest.format}"]`) && manifest.format) {
    const opt = document.createElement('option');
    opt.value = manifest.format;
    opt.textContent = manifest.format;
    formatSel.appendChild(opt);
  }
  state.workflow.mondayItemId = manifest.mondayItemId || null;
  if (manifest.mondayItemId) applyMondayMode(true);
  else applyMondayMode(false);

  const summary = await window.electronAPI.getMulticamFolderSummary({
    sourcePath: state.workflow.multiCamSourcePath,
    sources: state.workflow.multiCamSources
  });
  state.workflow.multiCamFolderSummary = summary;

  applyMultiCamUI();
  renderStep2Content();
  updateProjectNamePreview();
  updateWorkflowValidation();
  showNotification(`Projet Organizer « ${manifest.projectCode} » importé`, 'success');
}

function applyMultiCamUI() {
  const isMultiCam = state.workflow.isMultiCam;
  const bandeau = document.getElementById('multicamBandeau');
  const toggleWrapper = document.querySelector('.monday-mode-toggle-wrapper');
  const mondaySection = document.getElementById('mondayProjectSection');
  const gofileDisabled = document.getElementById('gofileDisabledMultiCam');
  const gofileAuto = document.getElementById('gofileAutoUpload');
  const proposeGofile = document.getElementById('proposeGofileAtEnd');

  if (bandeau) {
    bandeau.style.display = isMultiCam ? 'flex' : 'none';
    const nameEl = document.getElementById('multicamProjectName');
    if (nameEl) nameEl.textContent = isMultiCam ? (state.workflow.projectName || state.workflow.sujet || '') : '';
  }
  if (toggleWrapper) {
    toggleWrapper.style.pointerEvents = isMultiCam ? 'none' : '';
    toggleWrapper.style.opacity = isMultiCam ? '0.6' : '1';
  }
  if (mondaySection && isMultiCam) {
    mondaySection.style.display = state.workflow.mondayItemId ? 'block' : 'none';
  }
  if (gofileDisabled) gofileDisabled.style.display = isMultiCam ? 'inline' : 'none';
  if (gofileAuto && isMultiCam) gofileAuto.checked = false;
  if (proposeGofile && isMultiCam) proposeGofile.checked = false;
}

function renderStep2Content() {
  const classic = document.getElementById('step2Classic');
  const multicam = document.getElementById('step2MultiCam');
  if (!classic || !multicam) return;

  if (state.workflow.isMultiCam) {
    classic.style.display = 'none';
    multicam.style.display = 'block';
    const pathEl = document.getElementById('multicamSourcePath');
    const foldersEl = document.getElementById('multicamFoldersList');
    const totalEl = document.getElementById('multicamTotalSize');
    if (pathEl) pathEl.textContent = state.workflow.multiCamSourcePath || '—';
    if (foldersEl) {
      const s = state.workflow.multiCamFolderSummary;
      if (s && s.folders && s.folders.length > 0) {
        foldersEl.innerHTML = s.folders.map(f => `
          <div class="folder-item">
            <span>${escapeHtml(f.name)}</span>
            <span>${formatBytes(f.size)}</span>
          </div>
        `).join('');
      } else {
        foldersEl.innerHTML = '<p>Chargement des dossiers…</p>';
      }
    }
    if (totalEl) {
      const s = state.workflow.multiCamFolderSummary;
      totalEl.textContent = s && s.totalSize !== undefined ? `Total : ${formatBytes(s.totalSize)}` : '—';
    }
  } else {
    classic.style.display = 'block';
    multicam.style.display = 'none';
  }
}

async function loadMondayProjects(includeBackedUp = false) {
  const select = document.getElementById('mondayProjectSelect');
  const statusEl = document.getElementById('mondayProjectStatus');
  const retryBtn = document.getElementById('mondayRetryBtn');
  const backedUpMention = document.getElementById('mondayBackedUpMention');
  if (!select || !statusEl) return;

  const token = (state.settings.mondayApiToken || DEFAULT_MONDAY_API_TOKEN || '').trim();
  const boardId = (state.settings.mondayBoardId || '').trim();

  if (!token) {
    statusEl.textContent = 'Clé API Monday manquante';
    statusEl.className = 'monday-status-msg monday-error';
    statusEl.innerHTML = 'Clé API Monday manquante — <a href="#" id="mondayGoToSettings">configurez-la dans les Paramètres</a>';
    retryBtn.style.display = 'none';
    select.disabled = true;
    select.innerHTML = '<option value="">-- Sélectionner un projet --</option>';
    document.getElementById('mondayGoToSettings')?.addEventListener('click', (e) => {
      e.preventDefault();
      switchView('settings');
    });
    return;
  }

  if (!boardId) {
    statusEl.textContent = 'Board ID Monday manquant — configurez-le dans les Paramètres';
    statusEl.className = 'monday-status-msg monday-error';
    retryBtn.style.display = 'none';
    select.disabled = true;
    select.innerHTML = '<option value="">-- Sélectionner un projet --</option>';
    return;
  }

  statusEl.textContent = 'Chargement des projets Monday...';
  statusEl.className = 'monday-status-msg monday-loading';
  retryBtn.style.display = 'none';
  select.disabled = true;
  select.innerHTML = '<option value="">Chargement des projets Monday...</option>';

  try {
    const result = await window.electronAPI.mondayGetProjects(boardId, token, includeBackedUp);

    if (result.error) {
      if (result.error === 'missing_config' || result.error === 'auth') {
        statusEl.textContent = result.message || 'Clé API invalide ou absente';
        statusEl.className = 'monday-status-msg monday-error';
        if (result.error === 'missing_config') {
          statusEl.innerHTML = 'Clé API Monday manquante — <a href="#" id="mondayGoToSettings2">configurez-la dans les Paramètres</a>';
          document.getElementById('mondayGoToSettings2')?.addEventListener('click', (e) => {
            e.preventDefault();
            switchView('settings');
          });
        }
      } else {
        statusEl.textContent = 'Impossible de charger les projets Monday';
        statusEl.className = 'monday-status-msg monday-error';
        retryBtn.style.display = 'inline-block';
      }
      select.innerHTML = '<option value="">-- Sélectionner un projet --</option>';
      select.disabled = false;
      return;
    }

    const items = result.items || [];
    items.sort((a, b) => {
      const da = a.dateTournage ? new Date(a.dateTournage) : new Date('9999-12-31');
      const db = b.dateTournage ? new Date(b.dateTournage) : new Date('9999-12-31');
      return da - db;
    });
    const isBackedUp = (s) => (s || '').toLowerCase().includes('backup');
    const optionsHtml = '<option value="">-- Sélectionner un projet --</option>' +
      items.map(item => {
        const label = item.status ? `[${item.status}] — ${item.name}` : item.name;
        const backedUp = isBackedUp(item.status);
        const cls = backedUp ? ' class="monday-option-backed-up"' : '';
        return `<option value="${item.id}"${cls} data-sujet="${escapeHtml(item.name)}" data-format-resolved="${escapeHtml(item.format || '')}" data-date="${escapeHtml(item.dateTournage)}">${escapeHtml(label)}</option>`;
      }).join('');
    const separator = includeBackedUp ? '' : '<option disabled>──────────────────</option><option value="__show_backed_up__">↩ Afficher les projets backupés</option>';
    select.innerHTML = optionsHtml + separator;

    if (backedUpMention) backedUpMention.style.display = includeBackedUp ? 'block' : 'none';

    if (items.length === 0) {
      statusEl.textContent = 'Aucun projet en cours sur Monday';
      statusEl.className = 'monday-status-msg';
    } else {
      statusEl.textContent = '';
      statusEl.className = 'monday-status-msg';
    }
  } catch (err) {
    statusEl.textContent = 'Impossible de charger les projets Monday';
    statusEl.className = 'monday-status-msg monday-error';
    retryBtn.style.display = 'inline-block';
    select.innerHTML = '<option value="">-- Sélectionner un projet --</option>';
  }
  select.disabled = false;
}

async function onMondayProjectSelect() {
  const select = document.getElementById('mondayProjectSelect');
  const opt = select?.selectedOptions?.[0];
  if (!opt || !opt.value) {
    state.workflow.mondayItemId = null;
    state.workflow.dateTournage = null;
    state.workflow.existingProjectInfo = null;
    hideExistingProjectBandeau();
    hideSessionBandeau();
    document.getElementById('projectFormat').value = '';
    document.getElementById('projectSujet').value = '';
    updateProjectNamePreview();
    return;
  }
  if (opt.value === '__show_backed_up__') {
    await loadMondayProjects(true);
    select.value = '';
    state.workflow.mondayItemId = null;
    state.workflow.existingProjectInfo = null;
    hideExistingProjectBandeau();
    return;
  }
  const sujet = opt.dataset.sujet || '';
  const formatResolved = (opt.dataset.formatResolved || '').trim();
  const dateTournage = opt.dataset.date || '';
  state.workflow.mondayItemId = opt.value;
  state.workflow.dateTournage = dateTournage || null;

  document.getElementById('projectSujet').value = sujet;
  const formatSelect = document.getElementById('projectFormat');
  const opts = Array.from(formatSelect.options).filter(o => o.value);
  const found = formatResolved ? opts.find(o => o.value === formatResolved) : null;
  formatSelect.value = found ? found.value : '';
  if (found) state.workflow.format = found.value;

  if (state.selectedProfile?.initiales) {
    document.getElementById('projectInitiales').value = state.selectedProfile.initiales;
    state.workflow.initiales = state.selectedProfile.initiales.toUpperCase();
  }

  // Détection projet déjà backupé
  state.workflow.existingProjectInfo = null;
  hideExistingProjectBandeau();
  hideSessionBandeau();
  try {
    const existing = await window.electronAPI.findProjectByMondayItemId(opt.value);
    if (existing?.projectFolderPath) {
      const exists = await window.electronAPI.pathExists(existing.projectFolderPath);
      if (exists) {
        const projectName = existing.projectFolderPath.split(/[/\\]/).pop() || 'Projet';
        state.workflow.existingProjectInfo = { projectFolderPath: existing.projectFolderPath, projectName };
        await showExistingProjectBandeau(projectName);
      }
    }
  } catch (e) { /* ignore */ }

  updateProjectNamePreview();
}

async function showExistingProjectBandeau(projectName) {
  const bandeau = document.getElementById('existingProjectBandeau');
  if (!bandeau) return;
  let sessionNum = 2;
  try {
    sessionNum = await window.electronAPI.getNextSessionNumber(state.workflow.existingProjectInfo?.projectFolderPath || '');
  } catch (e) { /* fallback 2 */ }
  const sessionLabel = `SESSION_${String(sessionNum).padStart(2, '0')}`;
  const nameEl = bandeau.querySelector('.existing-project-name');
  if (nameEl) nameEl.textContent = projectName;
  const btnAdd = bandeau.querySelector('#btnAddSession');
  if (btnAdd) btnAdd.textContent = `Ajouter une session → ${sessionLabel}`;
  bandeau.style.display = 'flex';
  bandeau.classList.add('visible');
}

function hideExistingProjectBandeau() {
  const bandeau = document.getElementById('existingProjectBandeau');
  if (bandeau) {
    bandeau.style.display = 'none';
    bandeau.classList.remove('visible');
  }
}

function hideSessionBandeau() {
  const bandeau = document.getElementById('sessionBandeau');
  if (bandeau) {
    bandeau.style.display = 'none';
    bandeau.classList.remove('visible');
  }
}

function showSessionBandeau() {
  const bandeau = document.getElementById('sessionBandeau');
  if (!bandeau) return;
  const parentName = (state.workflow.parentProjectPath || '').split(/[/\\]/).pop() || 'Projet';
  bandeau.querySelector('.session-folder-name')?.setAttribute('data-folder', state.workflow.sessionFolderName || '');
  const folderEl = bandeau.querySelector('.session-folder-name');
  if (folderEl) folderEl.textContent = state.workflow.sessionFolderName || '';
  const parentEl = bandeau.querySelector('.session-parent-name');
  if (parentEl) parentEl.textContent = parentName;
  bandeau.style.display = 'flex';
  bandeau.classList.add('visible');
}

function onBtnNewProject() {
  state.workflow.existingProjectInfo = null;
  state.workflow.isSession = false;
  state.workflow.parentProjectPath = null;
  state.workflow.sessionNumber = null;
  state.workflow.sessionFolderName = null;
  hideExistingProjectBandeau();
  hideSessionBandeau();
  updateSessionFieldsEditable(true);
  updateProjectNamePreview();
}

async function onBtnAddSession() {
  const info = state.workflow.existingProjectInfo;
  if (!info?.projectFolderPath) return;
  try {
    const nextNum = await window.electronAPI.getNextSessionNumber(info.projectFolderPath);
    state.workflow.isSession = true;
    state.workflow.parentProjectPath = info.projectFolderPath;
    state.workflow.sessionNumber = nextNum;
    state.workflow.sessionFolderName = `SESSION_${String(nextNum).padStart(2, '0')}`;
    hideExistingProjectBandeau();
    showSessionBandeau();
    updateSessionFieldsEditable(false);
    updateProjectNamePreview();
  } catch (e) {
    showNotification('Impossible de calculer le numéro de session', 'error');
  }
}

function updateSessionFieldsEditable(editable) {
  const formatSelect = document.getElementById('projectFormat');
  const sujetInput = document.getElementById('projectSujet');
  const dateInput = document.getElementById('projectDateTournage');
  [formatSelect, sujetInput, dateInput].forEach(el => {
    if (el) {
      el.disabled = !editable;
      el.style.opacity = editable ? '' : '0.7';
    }
  });
}

async function onManualAddSession() {
  const folder = await window.electronAPI.selectFolder();
  if (!folder) return;
  try {
    const exists = await window.electronAPI.pathExists(folder);
    if (!exists) {
      showNotification('Le dossier sélectionné n\'existe pas', 'error');
      return;
    }
    const nextNum = await window.electronAPI.getNextSessionNumber(folder);
    const parentName = folder.split(/[/\\]/).pop() || 'Projet';
    state.workflow.isSession = true;
    state.workflow.parentProjectPath = folder;
    state.workflow.sessionNumber = nextNum;
    state.workflow.sessionFolderName = `SESSION_${String(nextNum).padStart(2, '0')}`;
    state.workflow.mondayItemId = null;
    try {
      const parsed = await window.electronAPI.parseProjectName(parentName);
      if (parsed?.format) {
        state.workflow.format = parsed.format;
        document.getElementById('projectFormat').value = parsed.format;
      }
      if (parsed?.sujet) {
        state.workflow.sujet = parsed.sujet;
        document.getElementById('projectSujet').value = parsed.sujet.replace(/_/g, ' ');
      }
      if (parsed?.date) state.workflow.dateTournage = parsed.date;
      if (parsed?.initiales) {
        state.workflow.initiales = parsed.initiales;
        document.getElementById('projectInitiales').value = parsed.initiales;
      }
    } catch (e) { /* ignorer */ }
    hideExistingProjectBandeau();
    showSessionBandeau();
    updateSessionFieldsEditable(!(state.workflow.format && state.workflow.sujet));
    updateProjectNamePreview();
    showNotification(`Session ${state.workflow.sessionFolderName} prête à être ajoutée`, 'success');
  } catch (e) {
    showNotification('Impossible d\'initialiser la session', 'error');
  }
}

// Détection des sources
async function detectSources() {
  try {
    state.sources = await window.electronAPI.detectSources();
    renderSources();
  } catch (error) {
    showNotification('Erreur lors de la détection des sources', 'error');
  }
}

function renderSources() {
  const container = document.getElementById('sourcesList');
  
  if (state.sources.length === 0) {
    container.innerHTML = '<p style="color: var(--text-secondary);">Aucune source détectée</p>';
    return;
  }
  
  container.innerHTML = state.sources.map((source, index) => `
    <div class="source-item">
      <div class="source-item-info">
        <div class="source-item-name">${escapeHtml(source.name)}</div>
        <div class="source-item-type">
          ${getSourceTypeLabel(source.type)} • ${source.available} disponibles
        </div>
      </div>
      <button class="scan-btn" onclick="scanSource(${index})">Scanner</button>
    </div>
  `).join('');
}

function getSourceTypeLabel(type) {
  const labels = {
    'sd_card': 'Carte SD',
    'ssd': 'SSD',
    'network': 'Réseau/NAS',
    'external': 'Disque externe',
    'unknown': 'Inconnu'
  };
  return labels[type] || type;
}

window.scanSource = async function(index) {
  const source = state.sources[index];
  try {
    showNotification(`Scan de ${source.name} en cours...`, 'info');
    const files = await window.electronAPI.scanDirectory(source.path, true);
    addFilesToWorkflow(files);
    showNotification(`${files.length} fichiers trouvés`, 'success');
  } catch (error) {
    showNotification('Erreur lors du scan', 'error');
  }
};

async function scanFolder() {
  const folder = await window.electronAPI.selectFolder();
  if (!folder) return;
  
  try {
    showNotification('Scan en cours...', 'info');
    const files = await window.electronAPI.scanDirectory(folder, true);
    addFilesToWorkflow(files);
    showNotification(`${files.length} fichiers trouvés`, 'success');
  } catch (error) {
    showNotification('Erreur lors du scan', 'error');
  }
}

async function selectFiles() {
  // Pour la sélection directe, on pourrait utiliser dialog mais ici on scanne un dossier
  await scanFolder();
}

function addFilesToWorkflow(files) {
  const filteredFiles = files;
  
  // Afficher une notification si des fichiers ont été filtrés
  const excludedCount = files.length - filteredFiles.length;
  if (excludedCount > 0) {
    showNotification(`${excludedCount} fichier(s) de moins de 50ko exclu(s)`, 'info');
  }
  
  // Ajouter les nouveaux fichiers (éviter doublons)
  for (const file of filteredFiles) {
    if (!state.workflow.files.find(f => f.path === file.path)) {
      state.workflow.files.push(file);
    }
  }
  
  state.workflow.files.sort((a, b) => (b.size || 0) - (a.size || 0));
  renderFilesList();
  updateWorkflowValidation();
}

function generateThumbnail(filePath) {
  return new Promise((resolve) => {
    if (thumbnailCache.has(filePath)) {
      return resolve(thumbnailCache.get(filePath));
    }
    const video = document.createElement('video');
    video.src = 'file://' + filePath;
    video.muted = true;
    video.preload = 'metadata';
    video.addEventListener('loadedmetadata', () => {
      video.currentTime = Math.min(video.duration * 0.1, 3);
    });
    video.addEventListener('seeked', () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataURL = canvas.toDataURL('image/jpeg', 0.7);
      thumbnailCache.set(filePath, dataURL);
      video.src = '';
      resolve(dataURL);
    });
    video.addEventListener('error', () => {
      resolve(null);
    });
  });
}

function renderFilesList() {
  const container = document.getElementById('filesList');
  
  if (state.workflow.files.length === 0) {
    container.innerHTML = '<p style="color: var(--text-secondary);">Aucun fichier sélectionné</p>';
    return;
  }
  
  container.innerHTML = state.workflow.files.map((file, index) => `
    <div class="file-item">
      <div class="file-item-thumbnail-placeholder" id="thumb-placeholder-${index}"><span>...</span></div>
      <div class="file-item-info" style="flex: 1; min-width: 0; margin: 0 10px;">
        <div class="file-item-name">${escapeHtml(file.name)}</div>
        <div class="file-item-size">${file.sizeFormatted || formatBytes(file.size)} • ${file.type || 'unknown'}</div>
      </div>
      <div style="display: flex; gap: 6px; align-items: center;">
        <button class="btn btn-secondary" style="padding: 6px 12px; font-size: 0.9em;" onclick="previewFile(${index})">Voir</button>
        <button class="btn btn-danger" style="padding: 6px 12px; font-size: 0.9em;" onclick="removeFile(${index})">X</button>
      </div>
    </div>
  `).join('');

  state.workflow.files.forEach((file, index) => {
    generateThumbnail(file.path).then(dataURL => {
      const placeholder = document.getElementById(`thumb-placeholder-${index}`);
      if (!placeholder) return;
      if (dataURL) {
        const img = document.createElement('img');
        img.src = dataURL;
        img.className = 'file-item-thumbnail';
        img.title = 'Cliquer pour prévisualiser';
        img.addEventListener('click', () => previewFile(index));
        placeholder.replaceWith(img);
      } else {
        placeholder.innerHTML = '<span>?</span>';
      }
    });
  });
}

window.removeFile = function(index) {
  state.workflow.files.splice(index, 1);
  renderFilesList();
  updateWorkflowValidation();
};

window.previewFile = function(index) {
  const file = state.workflow.files[index];
  if (!file || !file.path) return;

  const modal = document.getElementById('videoPreviewModal');
  const player = document.getElementById('videoPreviewPlayer');
  const content = document.getElementById('videoPreviewContent');
  const title = document.getElementById('videoPreviewTitle');

  title.textContent = file.name || 'Aperçu';
  player.src = 'file://' + file.path;

  player.addEventListener('loadedmetadata', function onMeta() {
    player.removeEventListener('loadedmetadata', onMeta);
    const ratio = player.videoWidth / player.videoHeight;
    const maxH = window.innerHeight * 0.75;
    const videoH = Math.min(maxH, window.innerHeight * 0.75);
    const videoW = videoH * ratio;
    const totalW = Math.min(videoW, window.innerWidth * 0.92);
    content.style.width = totalW + 'px';
    content.style.maxWidth = totalW + 'px';
  });

  player.load();
  modal.classList.add('show');
  player.play().catch(() => {});
};

function closeVideoPreview() {
  const player = document.getElementById('videoPreviewPlayer');
  const modal = document.getElementById('videoPreviewModal');
  const content = document.getElementById('videoPreviewContent');
  player.pause();
  player.src = '';
  content.style.width = '';
  content.style.maxWidth = '';
  modal.classList.remove('show');
}

document.getElementById('closeVideoPreviewModal').addEventListener('click', closeVideoPreview);

document.getElementById('videoPreviewModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('videoPreviewModal')) {
    closeVideoPreview();
  }
});

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Validation workflow
// ==================== GESTION BATCH QUEUE ====================

function addToBatchQueue() {
  // Vérifier que le workflow est valide
  const hasProjectName = state.workflow.projectName && state.workflow.projectName.trim() !== '';
  const hasFiles = state.workflow.files && state.workflow.files.length > 0;
  const effectiveSSDPerso = state.workflow.ssdPersoPath || state.settings.ssdPersoPath;
  const effectiveSSDStudio = state.workflow.ssdStudioPath || state.settings.ssdStudioPath;
  const hasDestinations = effectiveSSDPerso && effectiveSSDStudio;
  
  if (!hasProjectName || !hasFiles || !hasDestinations) {
    showNotification('Veuillez compléter toutes les informations du workflow avant de l\'ajouter à la queue', 'error');
    return;
  }
  
  // Créer une copie du workflow pour la queue
  // Pour les batchs, l'option NAS est toujours activée par défaut
  const workflowItem = {
    id: Date.now() + Math.random(), // ID unique
    projectName: state.workflow.projectName,
    format: state.workflow.format,
    sujet: state.workflow.sujet,
    initiales: state.workflow.initiales,
    mondayItemId: state.workflow.mondayItemId || null,
    mondayUserId: state.selectedProfile?.mondayUserId || null,
    files: [...state.workflow.files], // Copie des fichiers
    compress: state.settings.compress !== false,
    uploadToNAS: state.settings.uploadToNAS !== false,
    zipNasEnabled: state.selectedProfile?.zipNasEnabled || false,
    ssdPersoPath: state.workflow.ssdPersoPath || null,
    ssdStudioPath: state.workflow.ssdStudioPath || null,
    profileId: state.selectedProfile ? state.selectedProfile.id : null,
    isSession: state.workflow.isSession || false,
    parentProjectPath: state.workflow.parentProjectPath || null,
    sessionNumber: state.workflow.sessionNumber || null,
    sessionFolderName: state.workflow.sessionFolderName || null,
    status: 'pending', // pending, running, completed, partial, failed
    progress: 0,
    steps: {
      ssdPerso: 'pending',
      ssdStudio: 'pending',
      compression: 'pending',
      nas: 'pending',
      monday: 'pending'
    },
    errors: [],
    addedAt: new Date().toISOString(),
    profileName: state.selectedProfile?.name || ''
  };
  
  state.batchQueue.items.push(workflowItem);
  
  showNotification(`Workflow "${workflowItem.projectName}" ajouté à la queue BATCH`, 'success');
  
  // Réinitialiser le formulaire pour le prochain workflow
  state.workflow = {
    projectName: '',
    format: '',
    sujet: '',
    initiales: '',
    mondayItemId: null,
    dateTournage: null,
    files: [],
    compress: true,
    uploadNAS: false,
    verifyIntegrity: true,
    ssdPersoPath: null,
    ssdStudioPath: null,
    isMultiCam: false,
    multiCamSourcePath: null,
    multiCamSources: [],
    multiCamFolderSummary: null,
    isSession: false,
    parentProjectPath: null,
    sessionNumber: null,
    sessionFolderName: null,
    existingProjectInfo: null
  };

  const mondaySelect = document.getElementById('mondayProjectSelect');
  const mondayStatus = document.getElementById('mondayProjectStatus');
  const mondayRetry = document.getElementById('mondayRetryBtn');
  if (mondaySelect) {
    mondaySelect.value = '';
    mondaySelect.innerHTML = '<option value="">-- Sélectionner un projet --</option>';
  }
  if (mondayStatus) mondayStatus.textContent = '';
  if (mondayRetry) mondayRetry.style.display = 'none';
  hideExistingProjectBandeau();
  hideSessionBandeau();
  updateSessionFieldsEditable(true);
  if (state.selectedProfile?.mondayMode !== 'manual') loadMondayProjects();
  
  document.getElementById('projectFormat').value = '';
  document.getElementById('projectSujet').value = '';
  document.getElementById('projectNamePreview').textContent = '--';
  document.getElementById('filesList').innerHTML = '';
  
  // Réappliquer les initiales du profil sélectionné
  if (state.selectedProfile && state.selectedProfile.initiales) {
    document.getElementById('projectInitiales').value = state.selectedProfile.initiales;
    state.workflow.initiales = state.selectedProfile.initiales;
  } else {
    document.getElementById('projectInitiales').value = '';
  }
  
  updateWorkflowValidation();
  renderBatchQueue();
  
  // Activer les boutons BATCH si nécessaire
  updateBatchControls();
}

function _renderBatchRunningDetail(item) {
  const pct = Math.round(item.progress || 0);
  const ws = state.workflowState;
  const stepLabels = {
    copying: 'Copie SSD',
    compressing: 'Compression',
    creating_zip_nas: 'ZIP NAS',
    uploading: 'Upload NAS',
    gofile: 'Envoi Gofile'
  };
  const currentStep = ws?.currentStep || '';
  let stepLabel = stepLabels[currentStep] || currentStep || 'Preparation';
  if (ws?.parallelPhase && (currentStep === 'gofile' || currentStep === 'compressing')) {
    stepLabel = 'Gofile + Compression';
  }

  let todoHtml = '';
  if (ws?.fileTodo) {
    const sectionMap = { copying: 'copy', compressing: 'compress', creating_zip_nas: 'nas', uploading: 'nas', gofile: 'gofile' };
    const sectionKey = sectionMap[currentStep];
    const ftSection = sectionKey ? ws.fileTodo[sectionKey] : null;
    const ftGofile = ws.fileTodo?.gofile;
    const ftCompress = ws.fileTodo?.compress;

    if (ws?.parallelPhase && (currentStep === 'gofile' || currentStep === 'compressing')) {
      const parts = [];
      if (ftGofile?._summary) parts.push(`<div class="batch-todo-summary">${escapeHtml(ftGofile._summary)}</div>`);
      if (ftCompress?._ordered?.length > 0) {
        parts.push(ftCompress._ordered.map(name => {
          const info = ftCompress[name] || { state: 'pending', progress: 0 };
          const filePct = Math.max(0, Math.min(100, info.progress || 0));
          const showCircle = info.state === 'active' || info.state === 'completed' || info.state === 'error';
          const truncName = name.length > 40 ? name.slice(0, 37) + '...' : name;
          return `<div class="file-todo-item" data-state="${info.state}">
            <span class="file-todo-dot"></span>
            <span class="file-todo-name" title="${escapeHtml(name)}">${escapeHtml(truncName)}</span>
            ${showCircle ? `<svg class="file-todo-circle" viewBox="0 0 24 24"><circle class="file-todo-circle-bg" cx="12" cy="12" r="9"/><circle class="file-todo-circle-fg" cx="12" cy="12" r="9" stroke-dasharray="56.5" stroke-dashoffset="${56.5 - (56.5 * filePct / 100)}"/></svg>` : ''}
            <span class="file-todo-status"></span>
          </div>`;
        }).join(''));
      }
      todoHtml = parts.join('');
    } else if (sectionKey === 'gofile' && ftSection?._summary) {
      todoHtml = `<div class="batch-todo-summary">${escapeHtml(ftSection._summary)}</div>`;
    } else if (ftSection?._ordered?.length > 0) {
      todoHtml = ftSection._ordered.map(name => {
        const info = ftSection[name] || { state: 'pending', progress: 0 };
        const filePct = Math.max(0, Math.min(100, info.progress || 0));
        const showCircle = info.state === 'active' || info.state === 'completed' || info.state === 'error';
        const truncName = name.length > 40 ? name.slice(0, 37) + '...' : name;
        return `<div class="file-todo-item" data-state="${info.state}">
          <span class="file-todo-dot"></span>
          <span class="file-todo-name" title="${escapeHtml(name)}">${escapeHtml(truncName)}</span>
          ${showCircle ? `<svg class="file-todo-circle" viewBox="0 0 24 24"><circle class="file-todo-circle-bg" cx="12" cy="12" r="9"/><circle class="file-todo-circle-fg" cx="12" cy="12" r="9" stroke-dasharray="56.5" stroke-dashoffset="${56.5 - (56.5 * filePct / 100)}"/></svg>` : ''}
          <span class="file-todo-status"></span>
        </div>`;
      }).join('');
    }
  }

  return `<div class="batch-running-detail">
    <div class="batch-running-step">
      <span class="batch-running-step-label">${escapeHtml(stepLabel)}</span>
      <span class="batch-running-step-pct">${pct}%</span>
    </div>
    <div class="batch-queue-item-progress">
      <div class="progress-bar-wrapper">
        <div class="progress-bar" style="width: ${pct}%"></div>
      </div>
    </div>
    ${todoHtml ? `<div class="batch-running-todo">${todoHtml}</div>` : ''}
  </div>`;
}

function renderBatchQueue() {
  const container = document.getElementById('batchQueueList');
  if (!container) return;
  
  if (state.batchQueue.items.length === 0) {
    container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 40px;">Aucun workflow dans la queue. Ajoutez des workflows depuis la page Workflow.</p>';
    return;
  }

  function stepBadge(label, stepStatus) {
    const icon = stepStatus === 'ok' ? 'OK' : stepStatus === 'failed' ? 'Erreur' : stepStatus === 'skipped' ? 'Passe' : '';
    const cls = stepStatus === 'ok' ? 'step-ok' : stepStatus === 'failed' ? 'step-failed' : stepStatus === 'skipped' ? 'step-skipped' : 'step-pending';
    return `<span class="batch-step-badge ${cls}">${label} ${icon}</span>`;
  }
  
  container.innerHTML = state.batchQueue.items.map((item, index) => {
    const statusClass = item.status === 'completed' ? 'completed' : 
                       item.status === 'partial' ? 'partial' :
                       item.status === 'running' ? 'running' : 
                       item.status === 'failed' ? 'failed' :
                       item.status === 'cancelled' ? 'cancelled' : 'pending';
    const statusIcon = item.status === 'completed' ? 'OK' : 
                       item.status === 'partial' ? 'Partiel' :
                       item.status === 'running' ? '...' : 
                       item.status === 'failed' ? 'Erreur' :
                       item.status === 'cancelled' ? 'Annule' : 'Pause';
    const statusLabel = item.status === 'completed' ? 'Complet' : 
                       item.status === 'partial' ? 'Partiel' :
                       item.status === 'running' ? 'En cours...' : 
                       item.status === 'failed' ? 'Echoue' :
                       item.status === 'cancelled' ? 'Annule' : 'En attente';
    
    const fileCount = item.files ? item.files.length : 0;
    const fileSize = item.files ? item.files.reduce((sum, f) => sum + (f.size || 0), 0) : 0;
    
    const retryBtn = (!state.batchQueue.isRunning && item.status === 'partial')
      ? `<button class="btn btn-secondary btn-small batch-retry-nas-btn" data-index="${index}">↩ Relancer NAS</button>` : '';
    const removeBtn = (!state.batchQueue.isRunning && item.status === 'pending')
      ? `<button class="btn btn-danger btn-small remove-batch-item" data-index="${index}">Supprimer</button>` : '';

    const steps = item.steps || {};
    const showSteps = item.status !== 'pending';
    const stepBadges = showSteps ? `
      <div class="batch-step-badges">
        ${stepBadge('SSD', steps.ssdPerso)}
        ${item.uploadToNAS ? stepBadge('NAS', steps.nas) : ''}
        ${item.compress ? stepBadge('Compression', steps.compression) : ''}
        ${stepBadge('Monday', steps.monday)}
      </div>` : '';

    return `
      <div class="batch-queue-item ${statusClass}" data-index="${index}">
        <div class="batch-queue-item-header">
          <div class="batch-queue-item-info">
            <span class="batch-queue-item-number">${statusIcon}</span>
            <h3 class="batch-queue-item-name">${escapeHtml(item.projectName)}</h3>
            <span class="batch-queue-item-status ${statusClass}">${statusLabel}</span>
          </div>
        </div>
        ${index === state.batchQueue.currentIndex && state.batchQueue.isRunning ? 
          _renderBatchRunningDetail(item) : ''}
        ${stepBadges}
        <div class="batch-queue-item-details">
          <div class="batch-queue-item-detail">
            <span class="detail-label">Fichiers:</span>
            <span class="detail-value">${fileCount} fichier(s) (${formatBytes(fileSize)})</span>
          </div>
        </div>
        ${retryBtn}${removeBtn}
      </div>
    `;
  }).join('');
  
  container.querySelectorAll('.remove-batch-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const index = parseInt(e.target.dataset.index);
      removeFromBatchQueue(index);
    });
  });
  container.querySelectorAll('.batch-retry-nas-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const index = parseInt(e.target.dataset.index);
      retryBatchNAS(index);
    });
  });
}

function removeFromBatchQueue(index) {
  if (index < 0 || index >= state.batchQueue.items.length) return;
  
  const item = state.batchQueue.items[index];
  state.batchQueue.items.splice(index, 1);
  
  // Ajuster currentIndex si nécessaire
  if (state.batchQueue.currentIndex > index) {
    state.batchQueue.currentIndex--;
  } else if (state.batchQueue.currentIndex === index) {
    state.batchQueue.currentIndex = -1;
  }
  
  showNotification(`Workflow "${item.projectName}" retiré de la queue`, 'info');
  renderBatchQueue();
  updateBatchControls();
}

async function retryBatchNAS(index) {
  const item = state.batchQueue.items[index];
  if (!item || item.status !== 'partial') return;
  showNotification(`Relance NAS pour « ${item.projectName} »...`, 'info');
  item.status = 'running';
  item.progress = 0;
  renderBatchQueue();
  try {
    const result = await window.electronAPI.retryNASUpload({
      zipPath: item.archiveZipPath || null,
      projectName: item.projectName,
      remotePath: null
    });
    if (result.success) {
      item.status = 'completed';
      item.progress = 100;
      item.nasUploadError = null;
      if (item.steps) item.steps.nas = 'ok';
      showNotification(`NAS OK pour « ${item.projectName} »`, 'success');
    } else {
      item.status = 'partial';
      item.nasUploadError = result.error || 'NAS toujours inaccessible';
      if (item.steps) item.steps.nas = 'failed';
      showNotification(`NAS échoué pour « ${item.projectName} » : ${result.error || ''}`, 'error');
    }
  } catch (e) {
    item.status = 'partial';
    item.nasUploadError = e.message;
    if (item.steps) item.steps.nas = 'failed';
    showNotification(`Erreur relance NAS : ${e.message}`, 'error');
  }
  renderBatchQueue();
}

function clearBatchQueue() {
  if (state.batchQueue.isRunning) {
    showNotification('Impossible de vider la queue pendant l\'exécution', 'error');
    return;
  }
  
  if (state.batchQueue.items.length === 0) {
    showNotification('La queue est déjà vide', 'info');
    return;
  }
  
  if (confirm(`Êtes-vous sûr de vouloir vider la queue (${state.batchQueue.items.length} workflow(s)) ?`)) {
    state.batchQueue.items = [];
    state.batchQueue.currentIndex = -1;
    renderBatchQueue();
    updateBatchControls();
    showNotification('Queue vidée', 'success');
  }
}

function updateBatchControls() {
  const startBtn = document.getElementById('startBatchBtn');
  const clearBtn = document.getElementById('clearBatchBtn');
  const stopBtn = document.getElementById('stopBatchBtn');
  
  if (startBtn) {
    startBtn.disabled = state.batchQueue.items.length === 0 || state.batchQueue.isRunning;
    startBtn.style.display = state.batchQueue.isRunning ? 'none' : '';
  }
  
  if (clearBtn) {
    clearBtn.disabled = state.batchQueue.items.length === 0 || state.batchQueue.isRunning;
    clearBtn.style.display = state.batchQueue.isRunning ? 'none' : '';
  }
  
  if (stopBtn) {
    stopBtn.style.display = state.batchQueue.isRunning ? '' : 'none';
  }
}

async function startBatchQueue() {
  if (state.batchQueue.isRunning) {
    showNotification('La queue est déjà en cours d\'exécution', 'error');
    return;
  }
  
  if (state.batchQueue.items.length === 0) {
    showNotification('Aucun workflow dans la queue', 'error');
    return;
  }
  
  // Filtrer seulement les workflows en attente
  const pendingItems = state.batchQueue.items.filter(item => item.status === 'pending');
  if (pendingItems.length === 0) {
    showNotification('Aucun workflow en attente dans la queue', 'info');
    return;
  }
  
  state.batchQueue.isRunning = true;
  state.batchQueue.currentIndex = 0;
  state.batchQueue.stopRequested = false;
  state.batchQueue.startTime = Date.now();
  updateBatchControls();
  
  switchView('batch');
  
  for (let i = 0; i < state.batchQueue.items.length; i++) {
    if (state.batchQueue.stopRequested) break;
    
    const item = state.batchQueue.items[i];
    if (item.status !== 'pending') continue;
    
    state.batchQueue.currentIndex = i;
    item.status = 'running';
    item.progress = 0;

    state.workflowState = {
      currentStep: null,
      globalProgress: 0,
      steps: {},
      completedSteps: new Set(),
      fileProgress: {},
      sectionTasks: { copy: {}, compress: {}, nas: {}, gofile: {} },
      fileTodo: { copy: { _ordered: [] }, compress: { _ordered: [] }, nas: { _ordered: [] }, gofile: {} },
      parallelPhase: false
    };
    const fileNames = (item.files || []).map(f => f.name || f.path?.split(/[/\\]/).pop() || 'Fichier');
    fileNames.forEach(name => {
      state.workflowState.fileTodo.copy[name] = { state: 'pending', progress: 0 };
      state.workflowState.fileTodo.copy._ordered.push(name);
      state.workflowState.fileTodo.compress[name] = { state: 'pending', progress: 0 };
      state.workflowState.fileTodo.compress._ordered.push(name);
    });

    renderBatchQueue();
    
    try {
      // Préparer les données du workflow
      const workflowData = {
        files: item.files,
        projectName: item.projectName,
        format: item.format,
        sujet: item.sujet,
        initiales: item.initiales,
        mondayItemId: item.mondayItemId || null,
        mondayUserId: item.mondayUserId || null,
        compress: item.compress,
        uploadToNAS: (item.uploadToNAS ?? state.settings.uploadToNAS) !== false,
        ssdPersoPath: item.ssdPersoPath,
        ssdStudioPath: item.ssdStudioPath,
        profileId: item.profileId,
        isSession: item.isSession || false,
        parentProjectPath: item.parentProjectPath || null,
        sessionNumber: item.sessionNumber || null,
        sessionFolderName: item.sessionFolderName || null
      };
      
      const progressListener = (data) => {
        if (data.globalProgress !== undefined) {
          item.progress = Math.min(100, Math.max(0, data.globalProgress));
        }
        updateFileTodoFromProgress(data);
        renderBatchQueue();
      };
      
      // Vérifier l'espace disque avant d'exécuter ce workflow du batch
      const itemPersoPath = item.ssdPersoPath || state.settings.ssdPersoPath;
      const itemStudioPath = item.ssdStudioPath || state.settings.ssdStudioPath;
      if (itemPersoPath && itemStudioPath && item.files.length > 0) {
        let reqBytes = item.files.reduce((sum, f) => sum + (f.size || 0), 0);
        const checkP = await window.electronAPI.checkDiskSpace(itemPersoPath, reqBytes);
        const checkS = await window.electronAPI.checkDiskSpace(itemStudioPath, reqBytes);
        const insufficientBatch = [];
        if (!checkP.sufficient) insufficientBatch.push({ diskName: 'SSD PERSO', path: itemPersoPath, requiredFormatted: checkP.formatted.required, availableFormatted: checkP.formatted.available, toFreeBytes: Math.max(0, checkP.required - checkP.available) });
        if (!checkS.sufficient) insufficientBatch.push({ diskName: 'SSD STUDIO', path: itemStudioPath, requiredFormatted: checkS.formatted.required, availableFormatted: checkS.formatted.available, toFreeBytes: Math.max(0, checkS.required - checkS.available) });
        if (insufficientBatch.length > 0) {
          window.electronAPI.removeAllListeners('workflow-progress');
          showDiskSpaceAlert(insufficientBatch);
          item.status = 'failed';
          showNotification(`Workflow "${item.projectName}" non lancé : espace disque insuffisant`, 'error');
          renderBatchQueue();
          continue;
        }
      }
      
      // Ajouter le listener temporairement
      window.electronAPI.onWorkflowProgress(progressListener);
      
      try {
        const result = await window.electronAPI.executeBackupWorkflow(workflowData);
        window.electronAPI.removeAllListeners('workflow-progress');
        
        // Mettre à jour les steps individuels
        if (!item.steps) item.steps = {};
        
        if (result.success) {
          item.steps.ssdPerso = 'ok';
          item.steps.ssdStudio = 'ok';
          item.steps.compression = item.compress ? 'ok' : 'skipped';

          item.status = 'completed';
          item.steps.nas = item.uploadToNAS ? 'ok' : 'skipped';
          item.progress = 100;
          showNotification(`Workflow "${item.projectName}" terminé avec succès`, 'success');
          item.gofileLink = result.gofileDownloadPage || null;

          const profileName = state.profiles?.find(p => p.id === item.profileId)?.name || item.profileName || state.selectedProfile?.name || '';
          if (item.mondayItemId) {
            try {
              const token = (state.settings?.mondayApiToken || DEFAULT_MONDAY_API_TOKEN || '').trim();
              const boardId = (state.settings?.mondayBoardId || '').trim();
              if (token && boardId) {
                const mondayRes = await window.electronAPI.mondayUpdateItem({
                  itemId: item.mondayItemId,
                  boardId,
                  apiToken: token,
                  mondayUserId: item.mondayUserId || null,
                  projectName: item.projectName || '',
                  updates: {
                    statutProd: '3 - BACKUPÉ',
                    gofileLink: result.gofileDownloadPage || item.gofileLink || null,
                    responsableBackup: profileName || ''
                  }
                });
                item.steps.monday = mondayRes.success ? 'ok' : 'failed';
                if (!mondayRes.success) {
                  item.errors = item.errors || [];
                  item.errors.push({ step: 'monday', message: mondayRes.error });
                }
              } else {
                item.steps.monday = 'skipped';
              }
            } catch (mondayErr) {
              item.steps.monday = 'failed';
              item.errors = item.errors || [];
              item.errors.push({ step: 'monday', message: mondayErr.message });
            }
          } else {
            item.steps.monday = 'skipped';
          }
        } else {
          item.status = 'failed';
          item.steps.ssdPerso = 'failed';
          item.steps.ssdStudio = 'failed';
          item.steps.compression = 'skipped';
          item.steps.nas = 'skipped';
          item.steps.monday = 'skipped';
          item.errors = item.errors || [];
          item.errors.push({ step: 'general', message: result.error });
          showNotification(`Workflow "${item.projectName}" a échoué: ${result.error}`, 'error');
        }
      } catch (error) {
        window.electronAPI.removeAllListeners('workflow-progress');
        throw error;
      }
    } catch (error) {
      item.status = 'failed';
      showNotification(`Erreur lors de l'exécution de "${item.projectName}": ${error.message}`, 'error');
    }
    
    renderBatchQueue();
  }
  
  // Items encore en pending après un stop → cancelled
  if (state.batchQueue.stopRequested) {
    state.batchQueue.items.forEach(it => {
      if (it.status === 'pending') it.status = 'cancelled';
      if (it.status === 'running') it.status = 'failed';
    });
  }

  state.batchQueue.isRunning = false;
  state.batchQueue.stopRequested = false;
  state.batchQueue.currentIndex = -1;
  updateBatchControls();

  await loadHistory();

  const batchProfile = state.selectedProfile;
  const batchSummary = state.batchQueue.items
    .filter(it => it.status === 'completed' || it.status === 'partial')
    .map(it => ({
      projectName: it.projectName,
      gofileLink: it.gofileLink || null,
      status: it.status
    }));

  if (batchSummary.length > 0) {
    window.electronAPI.sendBatchSummaryMail({
      toEmail: batchProfile?.email,
      toName: batchProfile?.name || 'Utilisateur',
      projects: batchSummary
    });
  }

  showBatchCompleteScreen();
}

function showBatchCompleteScreen() {
  const items = state.batchQueue.items;
  const completed = items.filter(it => it.status === 'completed').length;
  const partial = items.filter(it => it.status === 'partial').length;
  const failed = items.filter(it => it.status === 'failed').length;
  const cancelled = items.filter(it => it.status === 'cancelled').length;
  const total = items.length;
  const elapsed = state.batchQueue.startTime ? Date.now() - state.batchQueue.startTime : 0;

  function fmtDuration(ms) {
    const totalSec = Math.round(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  let summaryParts = [];
  if (completed > 0) summaryParts.push(`<span class="batch-recap-ok">${completed} complet(s)</span>`);
  if (partial > 0) summaryParts.push(`<span class="batch-recap-partial">${partial} partiel(s)</span>`);
  if (failed > 0) summaryParts.push(`<span class="batch-recap-failed">${failed} echoue(s)</span>`);
  if (cancelled > 0) summaryParts.push(`<span class="batch-recap-cancelled">${cancelled} annule(s)</span>`);

  function shortPath(p) {
    if (!p) return '';
    const parts = p.split('/').filter(Boolean);
    return parts.length > 2 ? parts.slice(-2).join('/') : parts.join('/');
  }

  const projectRows = items.map(it => {
    const statusCls = it.status === 'completed' ? 'batch-recap-ok' :
                      it.status === 'partial' ? 'batch-recap-partial' :
                      it.status === 'cancelled' ? 'batch-recap-cancelled' : 'batch-recap-failed';
    const statusLabel = it.status === 'completed' ? 'Complet' :
                        it.status === 'partial' ? 'Partiel' :
                        it.status === 'cancelled' ? 'Annule' : 'Echoue';
    const fileSize = it.files ? it.files.reduce((sum, f) => sum + (f.size || 0), 0) : 0;

    const perso = it.ssdPersoPath || state.settings.ssdPersoPath || '';
    const studio = it.ssdStudioPath || state.settings.ssdStudioPath || '';
    const nasPath = state.settings.nas?.remotePath || state.settings.nasSMBRemotePath || '';
    const destLines = [];
    if (perso) destLines.push(`Perso : ${shortPath(perso)}`);
    if (studio) destLines.push(`Studio : ${shortPath(studio)}`);
    if (it.uploadToNAS && nasPath) destLines.push(`NAS : ${shortPath(nasPath)}`);

    return `<tr>
      <td>${escapeHtml(it.projectName)}</td>
      <td class="batch-recap-dest">${destLines.map(l => escapeHtml(l)).join('<br>')}</td>
      <td>${formatBytes(fileSize)}</td>
      <td><span class="${statusCls}">${statusLabel}</span></td>
    </tr>`;
  }).join('');

  const recapEl = document.getElementById('batchCompleteRecap');
  if (recapEl) {
    recapEl.innerHTML = `
      <div class="batch-recap-header">
        <p>${total} projet(s) traite(s) en <strong>${fmtDuration(elapsed)}</strong></p>
        <p class="batch-recap-summary">${summaryParts.join(' / ')}</p>
      </div>
      <table class="batch-recap-table">
        <thead><tr><th>Projet</th><th>Destination</th><th>Poids</th><th>Statut</th></tr></thead>
        <tbody>${projectRows}</tbody>
      </table>`;
  }

  _loadBatchCelebrationGif();
  switchView('batchComplete');
}

async function _loadBatchCelebrationGif() {
  const container = document.getElementById('batchCelebrationGifContainer');
  const img = document.getElementById('batchCelebrationGif');
  if (!container || !img) return;
  container.style.display = 'none';
  img.style.display = 'none';
  img.style.opacity = '0';

  const onLoad = () => { container.style.display = 'flex'; img.style.display = 'block'; img.style.opacity = '1'; img.removeEventListener('load', onLoad); img.removeEventListener('error', onErr); };
  const onErr = () => { container.style.display = 'none'; img.removeEventListener('load', onLoad); img.removeEventListener('error', onErr); };
  img.addEventListener('load', onLoad);
  img.addEventListener('error', onErr);

  try {
    const gifPaths = await window.electronAPI.listCelebrationGifs();
    if (!gifPaths || gifPaths.length === 0) { container.style.display = 'none'; return; }
    const selected = gifPaths[Math.floor(Math.random() * gifPaths.length)];
    img.src = `file://${selected}?t=${Date.now()}`;
  } catch { container.style.display = 'none'; }
}

function updateWorkflowValidation() {
  const hasProjectName = state.workflow.projectName.length > 0;
  const isMultiCam = state.workflow.isMultiCam;
  const hasFiles = isMultiCam
    ? !!(state.workflow.multiCamSourcePath && state.workflow.multiCamFolderSummary)
    : state.workflow.files.length > 0;
  const effectiveSSDPerso = state.workflow.ssdPersoPath || state.settings.ssdPersoPath;
  const effectiveSSDStudio = state.workflow.ssdStudioPath || state.settings.ssdStudioPath;
  const hasDestinations = effectiveSSDPerso && effectiveSSDStudio;
  
  const startBtn = document.getElementById('startWorkflowBtn');
  const addToBatchBtn = document.getElementById('addToBatchBtn');
  
  if (startBtn) {
    startBtn.disabled = !hasProjectName || !hasFiles || !hasDestinations || state.processing;
  }
  
  if (addToBatchBtn) {
    addToBatchBtn.disabled = !hasProjectName || !hasFiles || !hasDestinations || state.processing;
  }
  
  // Mettre à jour l'étape de vérification
  updateVerificationStep();
}

async function updateVerificationStep() {
  const container = document.getElementById('verificationInfo');
  const isMultiCam = state.workflow.isMultiCam;
  const hasSource = isMultiCam
    ? !!(state.workflow.multiCamSourcePath && state.workflow.multiCamFolderSummary)
    : state.workflow.files.length > 0;

  if (!state.workflow.projectName || !hasSource) {
    container.innerHTML = '<p style="color: var(--text-secondary);">Complétez les étapes précédentes</p>';
    return;
  }

  const totalSize = isMultiCam
    ? (state.workflow.multiCamFolderSummary?.totalSize || 0)
    : state.workflow.files.reduce((sum, f) => sum + (f.size || 0), 0);
  
  let info = `
    <div class="verification-item">
      <strong>Projet:</strong> ${escapeHtml(state.workflow.projectName)}
    </div>
    <div class="verification-item">
      <strong>${isMultiCam ? 'Mode:' : 'Fichiers:'}</strong> ${isMultiCam ? 'MultiCam (dossier Organizer)' : state.workflow.files.length}
    </div>
    <div class="verification-item">
      <strong>Taille totale:</strong> ${formatBytes(totalSize)}
    </div>
  `;
  
  // Afficher les détails des fichiers (nom original et poids) — sauf en MultiCam
  if (!isMultiCam && state.workflow.files.length > 0) {
    info += `<div class="verification-item" style="margin-top: 15px;"><strong>Détails des fichiers:</strong></div>`;
    state.workflow.files.forEach((file, index) => {
      const fileName = file.name || file.path?.split(/[/\\]/).pop() || `Fichier ${index + 1}`;
      const fileSize = file.size || 0;
      info += `
        <div class="verification-item" style="margin-left: 20px; font-size: 0.9em; color: var(--text-secondary);">
          ${escapeHtml(fileName)} - ${formatBytes(fileSize)}
        </div>
      `;
    });
  }
  
  // Utiliser le chemin du profil si disponible, sinon celui des settings
  const ssdPersoPath = state.workflow.ssdPersoPath || state.settings.ssdPersoPath;
  const ssdStudioPath = state.workflow.ssdStudioPath || state.settings.ssdStudioPath;
  if (ssdPersoPath) {
    try {
      const spaceCheck = await window.electronAPI.checkDiskSpace(ssdPersoPath, totalSize);
      const pathLabel = state.workflow.ssdPersoPath ? '(Profil)' : '';
      info += `
        <div class="verification-item" style="margin-top: 15px;">
          <strong>Espace SSD PERSO ${pathLabel}:</strong> 
          ${spaceCheck.sufficient ? 'Disponible' : 'Insuffisant'}: ${spaceCheck.formatted.available} disponibles
        </div>
      `;
    } catch (error) {
      info += `<div class="verification-item"><strong>SSD PERSO:</strong> Erreur de vérification</div>`;
    }
  }
  if (ssdStudioPath) {
    try {
      const spaceCheckStudio = await window.electronAPI.checkDiskSpace(ssdStudioPath, totalSize);
      const studioPathLabel = state.workflow.ssdStudioPath ? '(Profil)' : '';
      info += `
        <div class="verification-item" style="margin-top: 6px;">
          <strong>Espace SSD STUDIO ${studioPathLabel}:</strong> 
          ${spaceCheckStudio.sufficient ? 'Disponible' : 'Insuffisant'}: ${spaceCheckStudio.formatted.available} disponibles
        </div>
      `;
    } catch (error) {
      info += `<div class="verification-item"><strong>SSD STUDIO:</strong> Erreur de vérification</div>`;
    }
  }
  
  container.innerHTML = info;
}

// Workflow
async function startWorkflow() {
  if (state.processing) return;
  
  // Vérifier qu'un profil est sélectionné
  if (!state.selectedProfile) {
    showNotification('Veuillez d\'abord sélectionner un profil', 'error');
    switchView('home');
    return;
  }

  const isMultiCam = state.workflow.isMultiCam;
  const ssdPersoPath = state.workflow.ssdPersoPath || state.settings.ssdPersoPath;
  const ssdStudioPath = state.workflow.ssdStudioPath || state.settings.ssdStudioPath;

  let sourceSizeBytes = 0;
  if (isMultiCam) {
    sourceSizeBytes = state.workflow.multiCamFolderSummary?.totalSize || 0;
  } else {
    sourceSizeBytes = state.workflow.files.reduce((sum, f) => sum + (f.size || 0), 0);
  }

  // Vérification espace disque avant lancement
  if (ssdPersoPath && ssdStudioPath && sourceSizeBytes > 0) {
    const ssdRequired = sourceSizeBytes * 1.0;
    let insufficient = [];
    const checkPerso = await window.electronAPI.checkDiskSpace(ssdPersoPath, ssdRequired);
    const checkStudio = await window.electronAPI.checkDiskSpace(ssdStudioPath, ssdRequired);
    if (!checkPerso.sufficient) {
      insufficient.push({ diskName: 'SSD Perso', path: ssdPersoPath, requiredFormatted: checkPerso.formatted.required, availableFormatted: checkPerso.formatted.available, toFreeBytes: Math.max(0, checkPerso.required - checkPerso.available) });
    }
    if (!checkStudio.sufficient) {
      insufficient.push({ diskName: 'SSD Studio', path: ssdStudioPath, requiredFormatted: checkStudio.formatted.required, availableFormatted: checkStudio.formatted.available, toFreeBytes: Math.max(0, checkStudio.required - checkStudio.available) });
    }
    const uploadNAS = state.settings.uploadToNAS !== false;
    if (uploadNAS && isMultiCam) {
      const settings = await window.electronAPI.getSettings?.() || state.settings;
      const nasPath = settings.nas?.remotePath || settings.nasSMBRemotePath;
      if (nasPath) {
        const nasRequired = Math.ceil(sourceSizeBytes * 1.5);
        const checkNAS = await window.electronAPI.checkDiskSpace(nasPath, nasRequired);
        if (!checkNAS.sufficient) {
          insufficient.push({ diskName: 'NAS', path: nasPath, requiredFormatted: checkNAS.formatted.required, availableFormatted: checkNAS.formatted.available, toFreeBytes: Math.max(0, checkNAS.required - checkNAS.available) });
        }
      }
    }
    if (uploadNAS && !isMultiCam) {
      // Vérif classique pour NAS (pas de multiplicateur spécifié dans le spec pour mode classique)
      const settings = await window.electronAPI.getSettings?.() || state.settings;
      const nasPath = settings.nas?.remotePath || settings.nasSMBRemotePath;
      if (nasPath) {
        const checkNAS = await window.electronAPI.checkDiskSpace(nasPath, sourceSizeBytes);
        if (!checkNAS.sufficient) {
          insufficient.push({ diskName: 'NAS', path: nasPath, requiredFormatted: checkNAS.formatted.required, availableFormatted: checkNAS.formatted.available, toFreeBytes: Math.max(0, checkNAS.required - checkNAS.available) });
        }
      }
    }
    if (insufficient.length > 0) {
      if (isMultiCam) {
        showMulticamDiskSpaceAlert(insufficient);
      } else {
        showDiskSpaceAlert(insufficient);
      }
      return;
    }
  }
  
  // Vérifier la connexion NAS si l'upload est activé
  const uploadNASEnabled = state.settings.uploadToNAS !== false;
  let skipNAS = false;
  if (uploadNASEnabled) {
    const nasResult = await checkNASBeforeWorkflow();
    if (nasResult === false) return;
    if (nasResult === 'skip') skipNAS = true;
  }
  
  state.processing = true;
  state.workflowState = {
    currentStep: null,
    globalProgress: 0,
    steps: {},
    completedSteps: new Set(),
    fileProgress: {},
    sectionTasks: { copy: {}, compress: {}, nas: {}, gofile: {} },
    fileTodo: { copy: {}, compress: {}, nas: {}, gofile: {} },
    parallelPhase: false
  };
  
  document.getElementById('startWorkflowBtn').disabled = true;
  document.getElementById('cancelWorkflowBtn').style.display = 'block';
  document.getElementById('workflowProgress').style.display = 'block';
  document.getElementById('workflowSummary').style.display = 'none';
  
  // Changer de vue vers "workflow en cours"
  switchView('workflowRunning');
  
  // Attendre un peu pour que la vue soit bien affichée
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Réinitialiser les 4 sections (vider les tâches)
  ['workflowSectionCopyTasks', 'workflowSectionGofileTasks', 'workflowSectionCompressTasks', 'workflowSectionNasTasks'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });
  state.workflowState.sectionTasks = { copy: {}, compress: {}, nas: {}, gofile: {} };
  state.workflowState.fileTodo = { copy: {}, compress: {}, nas: {}, gofile: {} };
  state.workflowState.parallelPhase = false;
  state.workflowState.completedSteps.clear();
  initializeFileTodoLists();
  const gofileSection = document.getElementById('workflowSectionGofile');
  if (gofileSection) {
    const isMultiCam = state.lastWorkflowData?.isMultiCam;
    if (isMultiCam) {
      gofileSection.classList.remove('workflow-section-visible');
      gofileSection.style.display = 'none';
    } else if (state.settings.gofileAutoUpload) {
      gofileSection.classList.add('workflow-section-visible');
      gofileSection.style.display = '';
    } else {
      gofileSection.classList.remove('workflow-section-visible');
      gofileSection.style.display = '';
    }
  }
  const multicamLevels = document.getElementById('multicamProgressLevels');
  if (multicamLevels) multicamLevels.style.display = state.lastWorkflowData?.isMultiCam ? 'block' : 'none';
  
  // Calculer la taille totale pour le tracker de progression réel
  const totalBytes = state.workflow.isMultiCam
    ? (state.workflow.multiCamFolderSummary?.totalSize || 0)
    : state.workflow.files.reduce((sum, f) => sum + (f.size || 0), 0);
  let totalSize = totalBytes * 2;
  initializeRealProgressTracker(totalSize);
  
  updateRunningGlobalProgress(0, 'Initialisation...');
  
  // Sauvegarder les données du workflow pour le retour
  state.lastWorkflowData = {
    files: state.workflow.files,
    projectName: state.workflow.projectName,
    format: state.workflow.format,
    sujet: state.workflow.sujet,
    initiales: state.workflow.initiales,
    compress: state.settings.compress !== false,
    uploadToNAS: state.settings.uploadToNAS !== false,
    zipNasEnabled: state.selectedProfile?.zipNasEnabled || false,
    ssdPersoPath: state.workflow.ssdPersoPath || null,
    isMultiCam: state.workflow.isMultiCam,
    multiCamSourcePath: state.workflow.multiCamSourcePath,
    multiCamSources: state.workflow.multiCamSources
  };
  
  const workflowStartTime = Date.now();
  
  try {
    const isMultiCam = state.workflow.isMultiCam;
    let result;

    if (isMultiCam) {
      const workflowData = {
        projectName: state.workflow.projectName,
        format: state.workflow.format,
        sujet: state.workflow.sujet,
        initiales: state.workflow.initiales,
        mondayItemId: state.workflow.mondayItemId || null,
        mondayUserId: state.selectedProfile?.mondayUserId || null,
        compress: document.getElementById('optionCompress').checked,
        uploadToNAS: skipNAS ? false : (state.settings.uploadToNAS !== false),
        zipNasEnabled: state.selectedProfile?.zipNasEnabled || false,
        ssdPersoPath: state.workflow.ssdPersoPath || null,
        ssdStudioPath: state.workflow.ssdStudioPath || null,
        profileId: state.selectedProfile ? state.selectedProfile.id : null,
        multiCamSourcePath: state.workflow.multiCamSourcePath,
        multiCamSources: state.workflow.multiCamSources
      };
      window.electronAPI.onMultiCamProgress((data) => updateMulticamProgressUI(data));
      result = await window.electronAPI.executeMultiCamWorkflow(workflowData);
      window.electronAPI.removeAllListeners?.('multicam-progress');
    } else {
      const workflowData = {
        files: state.workflow.files,
        projectName: state.workflow.projectName,
        format: state.workflow.format,
        sujet: state.workflow.sujet,
        initiales: state.workflow.initiales,
        mondayItemId: state.workflow.mondayItemId || null,
        mondayUserId: state.selectedProfile?.mondayUserId || null,
        compress: state.settings.compress !== false,
        uploadToNAS: skipNAS ? false : (state.settings.uploadToNAS !== false),
        zipNasEnabled: state.selectedProfile?.zipNasEnabled || false,
        ssdPersoPath: state.workflow.ssdPersoPath || null,
        ssdStudioPath: state.workflow.ssdStudioPath || null,
        profileId: state.selectedProfile ? state.selectedProfile.id : null,
        isSession: state.workflow.isSession || false,
        parentProjectPath: state.workflow.parentProjectPath || null,
        sessionNumber: state.workflow.sessionNumber || null,
        sessionFolderName: state.workflow.sessionFolderName || null
      };
      result = await window.electronAPI.executeBackupWorkflow(workflowData);
    }
    
    const totalTime = ((Date.now() - workflowStartTime) / 1000);

    if (result.aborted) {
      state._abortedPaths = {
        ssdPerso: result.ssdPersoProjectPath || null,
        ssdStudio: result.ssdStudioProjectPath || null
      };
      switchView('workflowAborted');
      const nameEl = document.getElementById('workflowAbortedProjectName');
      if (nameEl) nameEl.textContent = state.workflow.projectName || '';
      return;
    }
    
    if (result.success) {
      updateRunningGlobalProgress(100, 'Terminé!');

      if (result.gofileError) {
        await showGofileWarningModal(result.gofileError);
      }

      switchView('workflowCompleted');
      triggerMondayUpdateAfterWorkflow({
        mondayItemId: state.workflow.mondayItemId,
        mondayUserId: state.selectedProfile?.mondayUserId || null,
        projectName: state.workflow.projectName || '',
        gofileLink: result.gofileDownloadPage || null,
        profileName: state.selectedProfile?.name || '',
        showInCompletedView: true
      });
      setTimeout(() => { loadCelebrationGif(); }, 100);
      showNotification('Workflow terminé avec succès!', 'success');
      await loadHistory();
      state.lastWorkflowResult = { ...result, totalTime };

      if (!state._workflowAborted) {
        window.electronAPI.sendWorkflowSuccessMail({
          toEmail: state.selectedProfile?.email,
          toName: state.selectedProfile?.name || 'Utilisateur',
          projectName: state.workflow.projectName || 'Projet',
          gofileLink: result.gofileDownloadPage || null
        });
      }

      // Section Gofile : affichée si proposeGofileAtEnd ou gofileAutoUpload
      const gofileSectionEl = document.getElementById('gofile-section');
      const gofileFolderPath = result.ssdPersoProjectPath || result.ssdStudioProjectPath;
      if (!gofileFolderPath || (!state.settings.proposeGofileAtEnd && !state.settings.gofileAutoUpload)) {
        if (gofileSectionEl) gofileSectionEl.style.display = 'none';
      } else if (state.settings.gofileAutoUpload) {
        if (gofileSectionEl) {
          gofileSectionEl.style.display = 'block';
          gofileSectionEl.dataset.folderPath = gofileFolderPath;
        }
        document.getElementById('gofile-progress-zone').style.display = 'none';
        const btn = document.getElementById('btn-gofile');
        if (btn) btn.style.display = 'none';
        if (result.gofileDownloadPage) {
          renderGofileResult(true, result.gofileDownloadPage, null);
        } else if (result.gofileError) {
          renderGofileResult(false, null, result.gofileError);
        } else {
          renderGofileResult(false, null, 'Gofile non disponible');
        }
      } else if (state.settings.proposeGofileAtEnd) {
        if (gofileSectionEl) {
          gofileSectionEl.style.display = 'block';
          gofileSectionEl.dataset.folderPath = gofileFolderPath;
        }
        activateGofileSection(gofileFolderPath);
      }
    } else if (!result.aborted) {
      updateRunningGlobalProgress(0, 'Erreur: ' + result.error);
      showNotification(`Erreur: ${result.error}`, 'error');
      const errorKey = result.errorType || 'COPY_ERROR';
      await showErrorModal(errorKey, result.error || 'Erreur inconnue');
      returnToWorkflowConfig();
    }
  } catch (error) {
    updateRunningGlobalProgress(0, 'Erreur: ' + error.message);
    showNotification(`Erreur: ${error.message}`, 'error');
    await showErrorModal('COPY_ERROR', error.message || 'Erreur inconnue');
    returnToWorkflowConfig();
  } finally {
    state.processing = false;
    // Réappliquer les initiales du profil après la fin du workflow
    if (state.selectedProfile && state.selectedProfile.initiales) {
      document.getElementById('projectInitiales').value = state.selectedProfile.initiales;
      state.workflow.initiales = state.selectedProfile.initiales;
    }
    document.getElementById('startWorkflowBtn').disabled = false;
    document.getElementById('cancelWorkflowBtn').style.display = 'none';
  }
}

function cancelWorkflow() {
  state.processing = false;
  showNotification('Workflow annulé', 'info');
}

async function handleStopWorkflowConfirm() {
  document.getElementById('stopWorkflowConfirmModal')?.classList.remove('show');
  try { await window.electronAPI.abortWorkflow(); } catch { }
  state.processing = false;
  state._workflowAborted = true;
}

function returnToWorkflowConfig() {
  state._workflowAborted = false;
  document.getElementById('startWorkflowBtn').disabled = false;
  document.getElementById('cancelWorkflowBtn').style.display = 'none';
  switchView('workflow');
}

/**
 * Phase B : Met à jour l'item Monday en fin de workflow (appel asynchrone, non bloquant).
 * En cas d'échec, affiche un message discret sur l'écran "Workflow terminé" ou une notification (batch).
 * @param {Object} params - { mondayItemId, gofileLink, profileName, showInCompletedView }
 */
function triggerMondayUpdateAfterWorkflow({ mondayItemId, mondayUserId, projectName, gofileLink, profileName, showInCompletedView = true }) {
  if (!mondayItemId) return;
  const token = (state.settings?.mondayApiToken || DEFAULT_MONDAY_API_TOKEN || '').trim();
  const boardId = (state.settings?.mondayBoardId || '').trim();
  if (!token || !boardId) return;

  state.mondayUpdateError = null;
  const el = document.getElementById('mondayUpdateErrorMsg');
  if (el) { el.style.display = 'none'; el.textContent = ''; }
  const onFail = (errMsg, step) => {
    const fallback = 'Vous pouvez mettre à jour manuellement avec le statut cible : 3 - BACKUPÉ';
    const fullMsg = errMsg ? `Mise a jour Monday echouee — ${errMsg}. ${fallback}` : `Mise a jour Monday echouee — ${fallback}`;
    if (showInCompletedView) {
      state.mondayUpdateError = fullMsg;
      const msgEl = document.getElementById('mondayUpdateErrorMsg');
      if (msgEl) {
        msgEl.textContent = fullMsg;
        msgEl.style.display = 'block';
      }
    } else {
      showNotification(fullMsg, 'warning');
    }
  };

  window.electronAPI.mondayUpdateItem({
    itemId: mondayItemId,
    boardId,
    apiToken: token,
    mondayUserId: mondayUserId || null,
    projectName: projectName || '',
    updates: {
      statutProd: '3 - BACKUPÉ',
      gofileLink: gofileLink || null,
      responsableBackup: profileName || ''
    }
  }).then(r => {
    if (!r.success) onFail(r.error || 'Erreur inconnue', r.step);
  }).catch(err => onFail(err?.message || String(err), 'network'));
}

function showDiskSpaceAlert(insufficientList) {
  const modal = document.getElementById('diskSpaceAlertModal');
  const detailsEl = document.getElementById('diskSpaceAlertDetails');
  if (!modal || !detailsEl) return;
  const parts = insufficientList.map(item => {
    const toFreeFormatted = formatBytes(item.toFreeBytes);
    return `<div class="disk-space-alert-item">
      <strong>${escapeHtml(item.diskName)}</strong><br>
      <span class="disk-space-alert-numbers">Espace requis : ${escapeHtml(item.requiredFormatted)} — Disponible : ${escapeHtml(item.availableFormatted)}</span><br>
      <span class="disk-space-alert-free">→ Libérez au moins <strong>${escapeHtml(toFreeFormatted)}</strong> sur ce disque.</span>
    </div>`;
  });
  detailsEl.innerHTML = parts.join('');
  modal.classList.add('show');
}

function showMulticamDiskSpaceAlert(insufficientList) {
  const modal = document.getElementById('multicamDiskSpaceModal');
  const detailsEl = document.getElementById('multicamDiskSpaceDetails');
  if (!modal || !detailsEl) return;
  const parts = insufficientList.map(item => {
    const toFreeFormatted = formatBytes(item.toFreeBytes);
    return `<div class="disk-space-alert-item">
      <strong>${escapeHtml(item.diskName)} :</strong><br>
      <span class="disk-space-alert-numbers">Requis : ${escapeHtml(item.requiredFormatted)}</span><br>
      <span class="disk-space-alert-numbers">Dispo : ${escapeHtml(item.availableFormatted)}</span><br>
      <span class="disk-space-alert-free">Manque : ${escapeHtml(toFreeFormatted)}</span>
    </div>`;
  });
  detailsEl.innerHTML = parts.join('');
  modal.classList.add('show');
}

function activateGofileSection(projectFolderPath) {
  const section = document.getElementById('gofile-section');
  if (!section) return;
  section.dataset.folderPath = projectFolderPath || '';
  section.style.display = 'block';
  const btn = document.getElementById('btn-gofile');
  if (btn) {
    btn.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Envoyer vers Gofile';
  }
  document.getElementById('gofile-progress-zone').style.display = 'none';
  document.getElementById('gofile-result-zone').style.display = 'none';
  document.getElementById('gofile-result-zone').innerHTML = '';
}

function renderGofileResult(success, downloadPage, errorMsg) {
  const zone = document.getElementById('gofile-result-zone');
  if (!zone) return;
  zone.style.display = 'block';

  if (success) {
    zone.innerHTML = `
      <div class="gofile-success">
        <p class="gofile-success-title">Envoi reussi !</p>
        <a class="gofile-link" id="gofile-link-url" href="#">${downloadPage}</a>
        <div class="gofile-actions">
          <button class="btn btn-sm btn-secondary" id="btn-copy-gofile">Copier le lien</button>
          <button class="btn btn-sm btn-ghost" id="btn-open-gofile">Ouvrir dans le navigateur</button>
        </div>
      </div>
    `;
    document.getElementById('btn-copy-gofile').addEventListener('click', () => {
      navigator.clipboard.writeText(downloadPage);
      document.getElementById('btn-copy-gofile').textContent = 'Copie !';
    });
    document.getElementById('btn-open-gofile').addEventListener('click', () => {
      window.electronAPI.openExternalURL(downloadPage);
    });
    document.getElementById('gofile-link-url').addEventListener('click', (e) => {
      e.preventDefault();
      window.electronAPI.openExternalURL(downloadPage);
    });
  } else {
    zone.innerHTML = `
      <div class="gofile-error">
        Erreur : ${errorMsg || 'Une erreur inconnue est survenue.'}
      </div>
    `;
  }
}

function updateGlobalProgress(progress, message = '') {
  const progressBar = document.getElementById('globalProgressBar');
  const progressText = document.getElementById('globalProgressText');
  const progressDetails = document.getElementById('globalProgressDetails');
  
  if (progressBar) {
    const clampedProgress = Math.max(0, Math.min(100, progress));
    progressBar.style.width = `${clampedProgress}%`;
    progressBar.textContent = ''; // Le pourcentage est affiché au-dessus
    // Forcer un reflow pour l'animation
    void progressBar.offsetHeight;
  }
  if (progressText) {
    progressText.textContent = `${Math.round(progress)}%`;
  }
  if (message && progressDetails) {
    progressDetails.textContent = message;
  }
}

// Tracker de progression basé sur les bytes réels
function initializeRealProgressTracker(totalBytes) {
  state.realProgressTracker = {
    totalBytes: totalBytes,
    processedBytes: 0,
    startTime: Date.now(),
    lastUpdateTime: Date.now(),
    averageSpeed: 0,
    eta: null,
    speedHistory: [] // Pour calculer la vitesse moyenne
  };
}

function updateRealProgressTracker(processedBytes, currentSpeed = null) {
  const tracker = state.realProgressTracker;
  if (!tracker || tracker.totalBytes === 0) return;
  
  const now = Date.now();
  tracker.processedBytes = processedBytes;
  tracker.lastUpdateTime = now;
  
  // Calculer la vitesse moyenne
  const elapsed = (now - tracker.startTime) / 1000; // en secondes
  if (elapsed > 0) {
    tracker.averageSpeed = processedBytes / elapsed;
  }
  
  // Si on a une vitesse actuelle, l'ajouter à l'historique
  if (currentSpeed !== null && currentSpeed > 0) {
    tracker.speedHistory = tracker.speedHistory || [];
    tracker.speedHistory.push({
      speed: currentSpeed,
      time: now
    });
    // Garder seulement les 10 dernières mesures
    if (tracker.speedHistory.length > 10) {
      tracker.speedHistory.shift();
    }
    
    // Calculer la vitesse moyenne récente (sur les 5 dernières mesures)
    const recentSpeeds = tracker.speedHistory.slice(-5).map(s => s.speed);
    const recentAvgSpeed = recentSpeeds.reduce((a, b) => a + b, 0) / recentSpeeds.length;
    tracker.averageSpeed = recentAvgSpeed;
  }
  
  // Calculer l'ETA
  const remainingBytes = tracker.totalBytes - processedBytes;
  if (tracker.averageSpeed > 0 && remainingBytes > 0) {
    const remainingSeconds = remainingBytes / tracker.averageSpeed;
    tracker.eta = remainingSeconds;
  } else {
    tracker.eta = null;
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function formatTime(seconds) {
  if (!seconds || seconds < 0) return 'Calcul...';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

function parseSizeToBytes(sizeString) {
  if (!sizeString || typeof sizeString !== 'string') return 0;
  const match = sizeString.match(/^([\d.]+)\s*([KMGT]?B)$/i);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const multipliers = { 'B': 1, 'KB': 1024, 'MB': 1024 * 1024, 'GB': 1024 * 1024 * 1024, 'TB': 1024 * 1024 * 1024 * 1024 };
  return value * (multipliers[unit] || 1);
}

function parseSpeedToBytes(speedString) {
  if (!speedString || typeof speedString !== 'string') return null;
  // Format: "X MB/s" ou "X KB/s"
  const match = speedString.match(/^([\d.]+)\s*([KMGT]?B)\/s$/i);
  if (!match) return null;
  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const multipliers = { 'B': 1, 'KB': 1024, 'MB': 1024 * 1024, 'GB': 1024 * 1024 * 1024 };
  return value * (multipliers[unit] || 1);
}

function updateRunningGlobalProgress(progress, message = '') {
  const progressBar = document.getElementById('runningGlobalProgressBar');
  const progressPercent = document.getElementById('runningGlobalProgressPercent');
  const progressDetails = document.getElementById('globalProgressDetails');
  const progressData = document.getElementById('globalProgressData');
  const globalETA = document.getElementById('globalETA');
  
  if (progressBar) {
    const clampedProgress = Math.max(0, Math.min(100, progress));
    progressBar.style.width = `${clampedProgress}%`;
  }
  
  if (progressPercent) {
    progressPercent.textContent = `${Math.round(progress)}%`;
  }
  
  if (message && progressDetails) {
    progressDetails.textContent = message;
  }
  
  // Mettre à jour les données réelles si disponibles
  const tracker = state.realProgressTracker;
  if (tracker && tracker.totalBytes > 0) {
    const realProgress = (tracker.processedBytes / tracker.totalBytes) * 100;
    
    if (progressData) {
      progressData.textContent = `${formatBytes(tracker.processedBytes)} / ${formatBytes(tracker.totalBytes)}`;
    }
    
    if (globalETA && tracker.eta !== null) {
      globalETA.textContent = formatTime(tracker.eta);
    } else if (globalETA) {
      globalETA.textContent = 'Calcul...';
    }
    
    // Utiliser la progression réelle si disponible
    if (realProgress > 0) {
      if (progressBar) {
        progressBar.style.width = `${Math.min(100, realProgress)}%`;
      }
      if (progressPercent) {
        progressPercent.textContent = `${Math.round(realProgress)}%`;
      }
    }
  }
}

const MULTICAM_PHASE_LABELS = {
  copying: 'COPIE',
  compressing: 'COMPRESSION',
  zipping: 'ZIP NAS',
  uploading: 'UPLOAD NAS'
};

function updateMulticamProgressUI(data) {
  const phase = data.currentPhase || 'copying';
  const phaseLabel = MULTICAM_PHASE_LABELS[phase] || phase;
  const phaseEl = document.getElementById('globalProgressPhaseLabel');
  if (phaseEl) phaseEl.textContent = phaseLabel;

  const progress = Math.max(0, Math.min(100, data.globalProgress ?? 0));
  const progressBar = document.getElementById('runningGlobalProgressBar');
  const progressPercent = document.getElementById('runningGlobalProgressPercent');
  if (progressBar) progressBar.style.width = `${progress}%`;
  if (progressPercent) progressPercent.textContent = `${Math.round(progress)}%`;

  const totalProcessed = (data.totalProcessed ?? 0) / (1024 * 1024);
  const totalSize = (data.totalSize ?? 1) / (1024 * 1024);
  const progressData = document.getElementById('globalProgressData');
  if (progressData) progressData.textContent = `${(totalProcessed / 1024).toFixed(1)} / ${(totalSize / 1024).toFixed(1)} Go`;

  const globalETA = document.getElementById('globalETA');
  if (globalETA) globalETA.textContent = data.globalETA != null ? formatTime(data.globalETA) : 'Calcul...';

  const details = document.getElementById('globalProgressDetails');
  if (details) details.textContent = phaseLabel + '...';

  const folderEl = document.getElementById('multicamCurrentFolder');
  const folderProgEl = document.getElementById('multicamFolderProgress');
  if (folderEl) folderEl.textContent = data.currentFolder ? data.currentFolder : '—';
  if (folderProgEl) folderProgEl.textContent = data.folderTotal != null ? `${data.folderProgress ?? 0} / ${data.folderTotal} fichiers` : '—';

  const fileEl = document.getElementById('multicamCurrentFile');
  const fileSizeEl = document.getElementById('multicamFileSize');
  const fileBar = document.getElementById('multicamFileProgressBar');
  if (fileEl) fileEl.textContent = data.currentFile || '—';
  if (fileSizeEl) fileSizeEl.textContent = data.currentFileSize != null ? `${(data.currentFileSize / 1024).toFixed(1)} Mo` : '';
  if (fileBar) fileBar.style.width = `${Math.max(0, Math.min(100, data.currentFileProgress ?? 0))}%`;

  const speedEl = document.getElementById('multicamSpeed');
  const etaEl = document.getElementById('multicamETA');
  const elapsedEl = document.getElementById('multicamElapsed');
  if (speedEl) speedEl.textContent = data.globalSpeed != null ? `${Math.round(data.globalSpeed)} Mo/s` : '— Mo/s';
  if (etaEl) etaEl.textContent = data.globalETA != null ? `ETA ${formatTime(data.globalETA)}` : 'ETA —';
  if (elapsedEl) elapsedEl.textContent = data.elapsed != null ? `Écoulé ${formatTime(data.elapsed)}` : 'Écoulé —';
}

function initializeFileTodoLists() {
  const files = state.workflow.files || [];
  const fileNames = files.map(f => f.name || f.path?.split(/[/\\]/).pop() || 'Fichier');
  const ft = state.workflowState.fileTodo;

  ft.copy = { _ordered: [] };
  ft.compress = { _ordered: [] };
  fileNames.forEach(name => {
    ft.copy[name] = { state: 'pending', progress: 0 };
    ft.copy._ordered.push(name);
    ft.compress[name] = { state: 'pending', progress: 0 };
    ft.compress._ordered.push(name);
  });
  ft.nas = { _ordered: [] };
  ft.gofile = {};

  ['fileTodoCopy', 'fileTodoCompress', 'fileTodoNas', 'fileTodoGofile'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });
  renderFileTodoList('copy');
  renderFileTodoList('compress');
}

function renderFileTodoList(section) {
  const containerId = {
    copy: 'fileTodoCopy',
    compress: 'fileTodoCompress',
    nas: 'fileTodoNas',
    gofile: 'fileTodoGofile'
  }[section];
  const container = document.getElementById(containerId);
  if (!container) return;

  if (section === 'gofile') {
    const ft = state.workflowState.fileTodo.gofile;
    if (ft._summary) {
      container.innerHTML = `<div class="file-todo-gofile-summary">${escapeHtml(ft._summary)}</div>`;
    } else {
      container.innerHTML = '';
    }
    return;
  }

  const ftSection = state.workflowState.fileTodo[section] || {};
  const ordered = ftSection._ordered || [];
  if (ordered.length === 0) { container.innerHTML = ''; return; }

  container.innerHTML = ordered.map(name => {
    const info = ftSection[name] || { state: 'pending', progress: 0 };
    const pct = Math.max(0, Math.min(100, info.progress || 0));
    const showCircle = info.state === 'active' || info.state === 'completed' || info.state === 'error';
    return `<div class="file-todo-item" data-state="${info.state}" data-file="${escapeHtml(name)}">
      <span class="file-todo-dot"></span>
      <span class="file-todo-name">${escapeHtml(name)}</span>
      ${showCircle ? `<svg class="file-todo-circle" viewBox="0 0 24 24"><circle class="file-todo-circle-bg" cx="12" cy="12" r="9"/><circle class="file-todo-circle-fg" cx="12" cy="12" r="9" stroke-dasharray="56.5" stroke-dashoffset="${56.5 - (56.5 * pct / 100)}"/></svg>` : ''}
      <span class="file-todo-status"></span>
    </div>`;
  }).join('');

  const activeItem = container.querySelector('[data-state="active"]');
  if (activeItem) activeItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function _findTodoKeyForFile(ftSection, eventFileName) {
  if (ftSection[eventFileName]) return eventFileName;
  const ordered = ftSection._ordered || [];
  for (const name of ordered) {
    if (ftSection[name] && ftSection[name].state === 'active') return name;
  }
  for (const name of ordered) {
    if (ftSection[name] && ftSection[name].state === 'pending') return name;
  }
  return null;
}

function _markAllDone(ftSection) {
  const ordered = ftSection._ordered || [];
  ordered.forEach(k => {
    if (ftSection[k] && ftSection[k].state !== 'error') {
      ftSection[k] = { state: 'completed', progress: 100 };
    }
  });
}

function updateFileTodoFromProgress(data) {
  if (!state.workflowState || !state.workflowState.fileTodo) return;

  const step = data.step;
  const fileName = data.file;
  const progress = data.progress ?? 0;
  const status = data.status || '';
  const isCompleted = status === 'completed';
  const isError = status === 'error' || status === 'failed';

  if (step === 'copying') {
    const ft = state.workflowState.fileTodo.copy;
    if (!fileName && isCompleted) {
      _markAllDone(ft);
      renderFileTodoList('copy');
      return;
    }
    if (!fileName) return;
    const dest = data.destination || '';

    if (!ft._nameMap) ft._nameMap = {};
    if (!ft._seenPerDest) ft._seenPerDest = {};
    const destKey = dest + '|' + fileName;
    let mappedKey = ft._nameMap[destKey];
    if (!mappedKey) {
      const sdKey = dest || '_';
      if (!ft._seenPerDest[sdKey]) ft._seenPerDest[sdKey] = 0;
      const idx = ft._seenPerDest[sdKey];
      if (idx < ft._ordered.length) {
        mappedKey = ft._ordered[idx];
        ft._nameMap[destKey] = mappedKey;
        ft._seenPerDest[sdKey] = idx + 1;
      }
    }

    if (!ft._perFile) ft._perFile = {};
    const pfKey = (mappedKey || fileName) + '|' + dest;
    if (!ft._perFile[pfKey]) ft._perFile[pfKey] = { progress: 0, done: false };

    const fileCompleted = isCompleted || progress >= 99.5;
    ft._perFile[pfKey].progress = progress;
    if (fileCompleted) ft._perFile[pfKey].done = true;

    const key = mappedKey || fileName;
    if (ft[key]) {
      const pf1 = ft._perFile[key + '|SSD PERSO'];
      const pf2 = ft._perFile[key + '|SSD STUDIO'];
      const avgProgress = ((pf1?.progress || 0) + (pf2?.progress || 0)) / 2;
      const allDone = pf1?.done && pf2?.done;
      if (ft[key].state === 'completed') { renderFileTodoList('copy'); return; }
      ft[key] = {
        state: allDone ? 'completed' : (isError ? 'error' : 'active'),
        progress: allDone ? 100 : avgProgress
      };
    }
    renderFileTodoList('copy');

  } else if (step === 'compressing') {
    const ft = state.workflowState.fileTodo.compress;
    if (!fileName && isCompleted) {
      _markAllDone(ft);
      renderFileTodoList('compress');
      return;
    }
    if (!fileName) return;

    if (!ft._nameMap) ft._nameMap = {};
    let key = ft._nameMap[fileName];
    if (!key) {
      if (ft[fileName]) {
        key = fileName;
      } else {
        key = _findTodoKeyForFile(ft, fileName);
      }
      if (key) ft._nameMap[fileName] = key;
    }
    if (key && ft[key]) {
      const fileCompleted = isCompleted || progress >= 99.5;
      if (ft[key].state === 'completed') { renderFileTodoList('compress'); return; }
      if (!fileCompleted) {
        (ft._ordered || []).forEach(k => {
          if (k !== key && ft[k] && ft[k].state === 'active') ft[k].state = 'pending';
        });
      }
      ft[key] = { state: fileCompleted ? 'completed' : (isError ? 'error' : 'active'), progress: fileCompleted ? 100 : progress };
    }
    renderFileTodoList('compress');

  } else if (step === 'creating_zip_nas' || step === 'uploading') {
    const ft = state.workflowState.fileTodo.nas;
    if (!fileName && isCompleted) {
      _markAllDone(ft);
      renderFileTodoList('nas');
      return;
    }
    if (!fileName) return;

    if (!ft[fileName]) {
      ft[fileName] = { state: 'pending', progress: 0 };
      if (!ft._ordered) ft._ordered = [];
      ft._ordered.push(fileName);
    }
    const fileCompleted = isCompleted || progress >= 99.5;
    ft[fileName] = { state: fileCompleted ? 'completed' : (isError ? 'error' : 'active'), progress: fileCompleted ? 100 : progress };
    renderFileTodoList('nas');

  } else if (step === 'gofile') {
    const ft = state.workflowState.fileTodo.gofile;
    const total = data.total ?? '?';
    ft._summary = `Envoi du dossier vers Gofile (${total} fichiers)`;
    renderFileTodoList('gofile');
  }
}

/** Remplit les 4 sections (COPIE, COMPRESSION, TRANSFERT NAS, ENVOI GOFILE) à partir de state.workflowState.sectionTasks */
function renderWorkflowSections() {
  if (!state.workflowState || !state.workflowState.sectionTasks) return;
  const tasks = state.workflowState.sectionTasks;
  const sectionIds = [
    { key: 'copy', containerId: 'workflowSectionCopyTasks' },
    { key: 'gofile', containerId: 'workflowSectionGofileTasks' },
    { key: 'compress', containerId: 'workflowSectionCompressTasks' },
    { key: 'nas', containerId: 'workflowSectionNasTasks' }
  ];
  sectionIds.forEach(({ key, containerId }) => {
    const container = document.getElementById(containerId);
    if (!container) return;
    const sectionTasks = tasks[key] || {};
    const entries = Object.entries(sectionTasks);
    container.innerHTML = entries.map(([taskId, t]) => {
      const progress = Math.max(0, Math.min(100, t.progress ?? 0));
      const isCompleted = t.status === 'completed' || progress >= 99.5;
      const isError = t.status === 'error' || t.status === 'failed';
      const detailParts = [];
      if (t.processed && t.total) detailParts.push(`${t.processed} / ${t.total}`);
      if (t.speed) detailParts.push(t.speed);
      if (t.fps && key === 'compress') detailParts.push(`${t.fps} fps`);
      const detailsHtml = detailParts.length ? `<div class="workflow-task-details">${escapeHtml(detailParts.join(' • '))}</div>` : '';
      const percentText = key === 'compress' ? progress.toFixed(2) + '%' : Math.round(progress) + '%';
      return `
        <div class="workflow-task ${isCompleted ? 'completed' : ''} ${isError ? 'error' : ''}" data-task-id="${escapeHtml(taskId)}">
          <div class="workflow-task-label">
            <span>${escapeHtml(t.label || taskId)}</span>
            <span class="workflow-task-percent">${percentText}</span>
          </div>
          <div class="workflow-task-bar-wrapper">
            <div class="workflow-task-bar" style="width: ${progress}%;"></div>
          </div>
          ${detailsHtml}
        </div>`;
    }).join('');
  });
}

function updateWorkflowProgress(data) {
  // Mettre à jour le tracker de progression réel si on a des données de bytes
  if (data.processedBytes !== undefined || (data.processed && data.total)) {
    const tracker = state.realProgressTracker;
    if (tracker && tracker.totalBytes > 0) {
      let processedBytes = data.processedBytes;
      let currentSpeed = data.speed ? parseSpeedToBytes(data.speed) : null;
      
      // Si on a processed/total en format string, les convertir
      if (!processedBytes && data.processed && data.total) {
        processedBytes = parseSizeToBytes(data.processed);
        // Mettre à jour le total si nécessaire
        const totalBytes = parseSizeToBytes(data.total);
        if (totalBytes > tracker.totalBytes) {
          tracker.totalBytes = totalBytes;
        }
      }
      
      if (processedBytes !== undefined) {
        updateRealProgressTracker(processedBytes, currentSpeed);
        // Mettre à jour l'affichage global
        const realProgress = (tracker.processedBytes / tracker.totalBytes) * 100;
        updateRunningGlobalProgress(realProgress, data.message || '');
      }
    }
  }
  
  // DEBUG OPTION 1: Logger l'entrée dans updateWorkflowProgress
  console.log(`[Renderer DEBUG] updateWorkflowProgress called with:`, {
    step: data.step,
    progress: data.progress,
    globalProgress: data.globalProgress,
    status: data.status,
    fps: data.fps,
    avgFps: data.avgFps,
    isCompressing: data.step === 'compressing'
  });
  
  const step = data.step || 'unknown';
  
  // Vérifier si cette étape doit être affichée selon le workflow
  if (step === 'copying_non_video') {
    const hasNonVideoFiles = state.lastWorkflowData && state.lastWorkflowData.files && 
      state.lastWorkflowData.files.some(f => f.type !== 'video');
    if (!hasNonVideoFiles) return;
  }
  if (step === 'uploading') {
    const uploadEnabled = state.lastWorkflowData && state.lastWorkflowData.uploadToNAS;
    if (!uploadEnabled) return;
  }
  if (step === 'compressing') {
    const compressEnabled = state.lastWorkflowData && state.lastWorkflowData.compress;
    if (!compressEnabled) return;
  }
  if (step === 'gofile') {
    const gofileEnabled = state.settings && state.settings.gofileAutoUpload;
    if (!gofileEnabled) return;
  }
  
  const shouldShow = data.status === 'starting' || data.status === 'active' || 
                     data.status === 'completed' ||
                     (data.progress !== undefined && data.progress >= 0) ||
                     data.message || data.file || step === 'compressing' || step === 'gofile';
  if (!shouldShow) return;
  
  if (step) {
    state.workflowState.currentStep = step;
    state.workflowState.steps[step] = { ...state.workflowState.steps[step], ...data };
    if (data.parallelPhase) state.workflowState.parallelPhase = true;
    else if (step === 'creating_zip_nas' || step === 'uploading') state.workflowState.parallelPhase = false;
  }
  
  const progressPercent = data.progress !== undefined ? data.progress : 0;
  const status = data.status || '';
  const isCompleted = step === 'compressing' 
    ? (status === 'completed' && (progressPercent >= 99.5 || data.finalAvgFps !== undefined))
    : (status === 'completed');
  const isError = status === 'error' || status === 'failed';
  
  // Mise à jour des 4 sections (COPIE, COMPRESSION, TRANSFERT NAS, ENVOI GOFILE)
  if (!state.workflowState.sectionTasks) {
    state.workflowState.sectionTasks = { copy: {}, compress: {}, nas: {}, gofile: {} };
  }
  const st = state.workflowState.sectionTasks;
  
  let section, taskId, label;
  if (step === 'copying') {
    section = 'copy';
    taskId = (data.destination || 'copy').replace(/\s+/g, '_');
    label = 'Copie vers ' + (data.destination || '…');
  } else if (step === 'compressing') {
    section = 'compress';
    taskId = (data.file || 'current').replace(/[/\\]/g, '_');
    label = 'Compression ' + (data.file || '…');
  } else if (step === 'creating_zip_nas') {
    section = 'nas';
    taskId = 'zip_nas';
    label = 'Création du ZIP' + (data.file ? ' ' + data.file : '');
  } else if (step === 'uploading') {
    section = 'nas';
    taskId = 'upload_nas';
    label = 'Transfert ' + (data.file || 'archive.zip') + ' vers le NAS';
  } else if (step === 'gofile') {
    section = 'gofile';
    taskId = 'gofile_upload';
    label = 'Envoi vers Gofile' + (data.processed ? ' ' + data.processed : '');
  } else {
    section = null;
  }
  
  if (section) {
    const taskData = {
      label,
      progress: progressPercent,
      status: isCompleted ? 'completed' : (isError ? 'error' : 'active'),
      processed: data.processed,
      total: data.total,
      speed: data.speed,
      fps: data.fps,
      eta: data.eta,
      elapsed: data.elapsed
    };
    st[section][taskId] = { ...st[section][taskId], ...taskData };
    renderWorkflowSections();
  }

  updateFileTodoFromProgress(data);
  
  const statusMessage = generateStatusMessage(step, data, progressPercent, status);
  
  // (Ancienne UI par étapes dynamiques supprimée — affichage par 4 sections uniquement)
  // Bloc désactivé : référençait stepElement, statusDetails, isPending non définis
  if (false) {
    let stepProgressValue = 0;
    let stepElement = null;
    let stepProgressContainer = stepElement ? stepElement.querySelector('.step-progress-container') : null;
    if (!stepProgressContainer && stepElement) {
      stepProgressContainer = document.createElement('div');
      stepProgressContainer.className = 'step-progress-container';
      stepProgressContainer.innerHTML = `
        <div class="step-progress-header">
          <span class="step-progress-label">Progression</span>
          <span class="step-progress-percent">${stepProgressValue.toFixed(1)}%</span>
        </div>
        <div class="step-progress-bar-wrapper">
          <div class="step-progress-bar" style="width: ${stepProgressValue}%;">
            ${stepProgressValue > 5 ? `<span class="step-progress-bar-text">${stepProgressValue.toFixed(1)}%</span>` : ''}
          </div>
        </div>
      `;
      // Insérer après le header
      const header = stepElement.querySelector('h4');
      if (header && header.nextSibling) {
        stepElement.insertBefore(stepProgressContainer, header.nextSibling);
      } else if (header) {
        header.insertAdjacentElement('afterend', stepProgressContainer);
      }
    } else if (stepProgressContainer) {
      // Mettre à jour la barre existante
      const stepProgressBar = stepProgressContainer.querySelector('.step-progress-bar');
      const stepProgressPercent = stepProgressContainer.querySelector('.step-progress-percent');
      if (stepProgressBar) {
        stepProgressBar.style.width = `${stepProgressValue}%`;
        const barText = stepProgressBar.querySelector('.step-progress-bar-text');
        if (stepProgressValue > 5) {
          if (!barText) {
            const textSpan = document.createElement('span');
            textSpan.className = 'step-progress-bar-text';
            stepProgressBar.appendChild(textSpan);
          }
          stepProgressBar.querySelector('.step-progress-bar-text').textContent = `${stepProgressValue.toFixed(1)}%`;
        } else if (barText) {
          barText.remove();
        }
      }
      if (stepProgressPercent) {
        stepProgressPercent.textContent = `${stepProgressValue.toFixed(1)}%`;
      }
    }
  }
  
  // Ancienne UI désactivée (stepElement, statusDetails, isPending non définis — remplacée par renderWorkflowSections)
  if (false) {
  // Gérer les détails par fichier pour copie et compression
  if ((step === 'copying' || step === 'compressing') && !isCompleted) {
    // Initialiser le tracker de fichiers si nécessaire
    if (!state.workflowState.fileProgress) {
      state.workflowState.fileProgress = {};
    }
    
    // Mettre à jour la progression du fichier actuel
    if (data.file) {
      const fileName = data.file;
      if (!state.workflowState.fileProgress[step]) {
        state.workflowState.fileProgress[step] = {};
      }
      
      state.workflowState.fileProgress[step][fileName] = {
        name: fileName,
        progress: data.progress || 0,
        speed: data.speed || null,
        processed: data.processed || null,
        total: data.total || null,
        eta: data.eta || null,
        fps: data.fps || null,
        avgFps: data.avgFps || null
      };
    }
    
    // Construire la liste des fichiers
    const fileProgressList = state.workflowState.fileProgress[step] || {};
    const files = Object.values(fileProgressList);
    
    if (files.length > 0) {
      statusDetails += '<div class="file-progress-list">';
      files.forEach(fileData => {
        const fileProgress = fileData.progress || 0;
        const fileName = escapeHtml(fileData.name);
        const fileSpeed = fileData.speed ? escapeHtml(fileData.speed) : '';
        const fileProcessed = fileData.processed ? escapeHtml(fileData.processed) : '';
        const fileTotal = fileData.total ? escapeHtml(fileData.total) : '';
        const fileEta = fileData.eta && fileData.eta !== 'Calcul...' ? escapeHtml(fileData.eta) : '';
        
        // Pour la compression, afficher aussi les FPS
        const fpsInfo = (step === 'compressing' && fileData.fps) 
          ? ` • ${fileData.fps} fps` 
          : '';
        
        statusDetails += `
          <div class="file-progress-item">
            <div class="file-progress-item-header">
              <span class="file-progress-item-name">${fileName}</span>
              <span class="file-progress-item-percent">${fileProgress.toFixed(step === 'compressing' ? 2 : 1)}%</span>
            </div>
            <div class="file-progress-item-bar-wrapper">
              <div class="file-progress-item-bar" style="width: ${fileProgress}%;"></div>
            </div>
            <div class="file-progress-item-details">
              <span>${fileProcessed} / ${fileTotal}</span>
              <span class="file-progress-item-speed">${fileSpeed}${fpsInfo}</span>
            </div>
          </div>
        `;
      });
      statusDetails += '</div>';
    }
  }
  
  // Informations communes
  if (data.processed && data.total && step !== 'copying' && step !== 'compressing') {
    statusDetails += `<div class="progress-status-item"><strong>Données:</strong> ${data.processed} / ${data.total}</div>`;
  }
  if (data.speed && step !== 'copying' && step !== 'compressing') {
    statusDetails += `<div class="progress-status-item"><strong>Vitesse de transfert:</strong> ${data.speed}</div>`;
  }
  if (data.eta && data.eta !== 'Calcul...' && !isCompleted && step !== 'copying' && step !== 'compressing') {
    statusDetails += `<div class="progress-status-item"><strong>Temps restant:</strong> ${data.eta}</div>`;
  }
  if (data.elapsed && step !== 'copying' && step !== 'compressing') {
    statusDetails += `<div class="progress-status-item"><strong>Temps écoulé:</strong> ${data.elapsed}</div>`;
  }
  
  const statusClass = isCompleted ? 'completed' : isError ? 'error' : isPending ? 'pending' : 'active';
  const statusIcon = '';
  
  // Pour la compression, TOUJOURS utiliser le pourcentage réel de HandBrakeCLI
  // Il vient directement des logs HandBrake et est mis à jour en temps réel
  // IMPORTANT: Utiliser data.progress même s'il est 0 pour montrer le début de la progression
  // Pour les ZIP, utiliser aussi data.progress directement
  const displayProgress = ((step === 'compressing' || step === 'creating_zip_nas') && data.progress !== undefined) 
    ? Math.max(0, Math.min(100, data.progress)) // Clamp entre 0 et 100
    : Math.max(0, Math.min(100, progressPercent));
  
  // DEBUG OPTION 1: Logger la progression calculée pour la compression
  if (step === 'compressing') {
    console.log(`[Renderer DEBUG] Compression displayProgress: ${displayProgress}% (from data.progress: ${data.progress}, progressPercent: ${progressPercent})`);
  }
  
  // Optimisation: Ne mettre à jour que les parties qui changent pour améliorer les performances
  // Mettre à jour le titre et le statut
  const headerElement = stepElement.querySelector('h4');
  if (!headerElement) {
    stepElement.innerHTML = `
      <h4>
        <span>${statusIcon} ${getStepLabel(step)}</span>
        <span class="progress-item-status ${statusClass}">${statusMessage}</span>
      </h4>
    `;
  } else {
    const iconSpan = headerElement.querySelector('span:first-child');
    const statusSpan = headerElement.querySelector('.progress-item-status');
    if (iconSpan) iconSpan.innerHTML = getStepLabel(step);
    if (statusSpan) {
      statusSpan.textContent = statusMessage;
      statusSpan.className = `progress-item-status ${statusClass}`;
    }
  }
  
  // Mettre à jour la barre de progression de manière optimisée
  if (!isPending) {
    let progressBarContainer = stepElement.querySelector('.progress-bar-container');
    if (!progressBarContainer) {
      progressBarContainer = document.createElement('div');
      progressBarContainer.className = 'progress-bar-container';
      
      // Ajouter le pourcentage AU-DESSUS du conteneur (pas à l'intérieur)
      const progressPercent = document.createElement('div');
      progressPercent.className = 'step-progress-percent-above';
      progressPercent.textContent = '0%';
      
      // Créer le wrapper de la barre
      const progressBarWrapper = document.createElement('div');
      progressBarWrapper.className = 'progress-bar-wrapper';
      progressBarContainer.appendChild(progressBarWrapper);
      
      const header = stepElement.querySelector('h4');
      if (header && header.nextSibling) {
        // Insérer le pourcentage puis le conteneur
        stepElement.insertBefore(progressPercent, header.nextSibling);
        stepElement.insertBefore(progressBarContainer, progressPercent.nextSibling);
      } else {
        stepElement.appendChild(progressPercent);
        stepElement.appendChild(progressBarContainer);
      }
    }
    
    // Mettre à jour le pourcentage au-dessus - TOUJOURS visible et mis à jour
    // Le pourcentage est maintenant un élément séparé au-dessus du conteneur
    const progressPercentAbove = stepElement.querySelector('.step-progress-percent-above');
    if (!progressPercentAbove) {
      // Créer le pourcentage si il n'existe pas
      const progressPercent = document.createElement('div');
      progressPercent.className = 'step-progress-percent-above';
      const header = stepElement.querySelector('h4');
      if (header && header.nextSibling) {
        stepElement.insertBefore(progressPercent, header.nextSibling);
      } else {
        stepElement.appendChild(progressPercent);
      }
    }
    
    if (progressPercentAbove || stepElement.querySelector('.step-progress-percent-above')) {
      const percentElement = progressPercentAbove || stepElement.querySelector('.step-progress-percent-above');
      const clampedProgress = Math.max(0, Math.min(100, displayProgress));
      // Pour compression et ZIP, afficher avec 2 décimales pour plus de précision
      const roundedProgress = (step === 'compressing' || step === 'creating_zip_nas')
        ? clampedProgress.toFixed(2) 
        : Math.round(clampedProgress);
      percentElement.textContent = `${roundedProgress}%`;
      // S'assurer qu'il est visible
      percentElement.style.display = 'block';
    }
    
    // Créer le wrapper si nécessaire
    let progressBarWrapper = progressBarContainer.querySelector('.progress-bar-wrapper');
    if (!progressBarWrapper) {
      progressBarWrapper = document.createElement('div');
      progressBarWrapper.className = 'progress-bar-wrapper';
      progressBarContainer.appendChild(progressBarWrapper);
    }
    
    let progressBar = progressBarWrapper.querySelector('.progress-bar');
    if (!progressBar) {
      progressBar = document.createElement('div');
      progressBar.className = `progress-bar ${isCompleted ? 'completed' : ''} ${isActive ? 'active' : ''}`;
      progressBarWrapper.appendChild(progressBar);
    }
    
    // Mise à jour directe de la largeur pour de meilleures performances
    const clampedProgress = Math.max(0, Math.min(100, displayProgress));
    
    // IMPORTANT: Toujours mettre à jour la barre même si la valeur change peu (pour animation fluide)
    // Utiliser requestAnimationFrame pour garantir une animation fluide pour toutes les étapes
    requestAnimationFrame(() => {
      // Mettre à jour la barre de progression standard
      progressBar.style.width = `${clampedProgress}%`;
      progressBar.textContent = ''; // Le pourcentage est au-dessus
      // Forcer un reflow pour garantir l'animation
      void progressBar.offsetHeight;
      
      // Pour la compression, mettre à jour également la barre de progression dynamique
      if (step === 'compressing') {
        const compressionProgressBar = stepElement.querySelector('.compression-progress-bar');
        if (compressionProgressBar) {
          compressionProgressBar.style.width = `${clampedProgress}%`;
          compressionProgressBar.setAttribute('data-progress', clampedProgress.toString());
          
          // Afficher/cacher le texte dans la barre selon la progression
          let barText = compressionProgressBar.querySelector('.compression-progress-bar-text');
          if (clampedProgress > 5) {
            // Afficher le texte si > 5%
            if (!barText) {
              barText = document.createElement('span');
              barText.className = 'compression-progress-bar-text';
              compressionProgressBar.appendChild(barText);
            }
            barText.textContent = `${clampedProgress.toFixed(2)}%`;
          } else if (barText) {
            // Cacher le texte si <= 5% (barre trop petite)
            barText.remove();
          }
        }
        
        // Mettre à jour le pourcentage dans le header (toujours visible)
        const compressionProgressPercent = stepElement.querySelector('.compression-progress-percent');
        if (compressionProgressPercent) {
          compressionProgressPercent.textContent = `${clampedProgress.toFixed(2)}%`;
        }
      }
    });
    
    // Mettre à jour les classes pour les couleurs
    if (isCompleted && !progressBar.classList.contains('completed')) {
      progressBar.classList.add('completed');
      progressBar.classList.remove('active');
    } else if (isActive && !progressBar.classList.contains('active')) {
      progressBar.classList.add('active');
      progressBar.classList.remove('completed');
    }
    
    // S'assurer que la barre est visible pendant la progression
    if (clampedProgress > 0 && clampedProgress < 100 && isActive) {
      progressBar.style.opacity = '1';
      progressBarContainer.style.display = 'block';
    }
  } else {
    // Supprimer la barre si en attente
    const existingBar = stepElement.querySelector('.progress-bar-container');
    if (existingBar) existingBar.remove();
  }
  
  // Mettre à jour les détails de statut
  // OPTIMISATION: Pour la compression, mettre à jour uniquement les valeurs qui changent
  // pour éviter les flash frames causés par la recréation complète du DOM
  if (step === 'compressing' && !isCompleted) {
    // Créer ou récupérer les conteneurs si nécessaire
    let compressionContainer = stepElement.querySelector('.compression-progress-container');
    let statsGrid = stepElement.querySelector('.handbrake-stats-grid');
    let statusContainer = stepElement.querySelector('.progress-status');
    
    if (!statusContainer) {
      statusContainer = document.createElement('div');
      statusContainer.className = 'progress-status';
      stepElement.appendChild(statusContainer);
    }
    
    // Créer le conteneur de compression s'il n'existe pas
    if (!compressionContainer) {
      const progressValue = (data.progress !== undefined) 
        ? Math.max(0, Math.min(100, data.progress)) 
        : 0;
      compressionContainer = document.createElement('div');
      compressionContainer.className = 'compression-progress-container';
      compressionContainer.innerHTML = `
        <div class="compression-progress-header">
          <span class="compression-progress-label">Progression de compression</span>
          <span class="compression-progress-percent">${progressValue.toFixed(2)}%</span>
        </div>
        <div class="compression-progress-bar-wrapper">
          <div class="compression-progress-bar" style="width: ${progressValue}%;" data-progress="${progressValue}">
            ${progressValue > 5 ? `<span class="compression-progress-bar-text">${progressValue.toFixed(2)}%</span>` : ''}
          </div>
        </div>
      `;
      statusContainer.appendChild(compressionContainer);
    } else {
      // Mettre à jour uniquement le pourcentage et la largeur de la barre
      const progressValue = (data.progress !== undefined) 
        ? Math.max(0, Math.min(100, data.progress)) 
        : 0;
      const percentElement = compressionContainer.querySelector('.compression-progress-percent');
      const progressBar = compressionContainer.querySelector('.compression-progress-bar');
      const barText = progressBar?.querySelector('.compression-progress-bar-text');
      
      if (percentElement) {
        percentElement.textContent = `${progressValue.toFixed(2)}%`;
      }
      if (progressBar) {
        progressBar.style.width = `${progressValue}%`;
        progressBar.setAttribute('data-progress', progressValue.toString());
        
        // Mettre à jour le texte dans la barre
        if (progressValue > 5) {
          if (!barText) {
        const textSpan = document.createElement('span');
        textSpan.className = 'compression-progress-bar-text';
        textSpan.textContent = `${progressValue.toFixed(2)}%`;
        progressBar.appendChild(textSpan);
          } else {
        barText.textContent = `${progressValue.toFixed(2)}%`;
          }
        } else if (barText) {
          barText.remove();
        }
      }
    }
    
    // Créer ou mettre à jour la grille de stats
    if (!statsGrid) {
      statsGrid = document.createElement('div');
      statsGrid.className = 'handbrake-stats-grid';
      statusContainer.appendChild(statsGrid);
    }
    
    // Mettre à jour les stats individuellement sans recréer toute la grille
    // Utiliser des data-attributes pour identifier chaque item
    const updateStatItem = (label, value, dataKey) => {
      let item = statsGrid.querySelector(`[data-stat-key="${dataKey}"]`);
      if (value !== null && value !== undefined && value !== '' && value !== 'Calcul...') {
        if (!item) {
          item = document.createElement('div');
          item.className = 'handbrake-stat-item';
          item.setAttribute('data-stat-key', dataKey);
          item.innerHTML = `
            <div class="handbrake-stat-label">${label}</div>
            <div class="handbrake-stat-value">${escapeHtml(String(value))}</div>
          `;
          statsGrid.appendChild(item);
        } else {
          const valueElement = item.querySelector('.handbrake-stat-value');
          if (valueElement) {
            valueElement.textContent = String(value);
          }
        }
      } else if (item) {
        item.remove();
      }
    };
    
    updateStatItem('Vitesse', data.fps ? `${data.fps} fps` : null, 'fps');
    updateStatItem('Vitesse moyenne', data.avgFps ? `${data.avgFps} fps` : null, 'avgFps');
    updateStatItem('Temps restant', data.eta, 'eta');
    updateStatItem('Temps écoulé', data.elapsed, 'elapsed');
    if (data.taskNumber && data.taskTotal) {
      updateStatItem('Tâche', `${data.taskNumber} / ${data.taskTotal}`, 'task');
    }
  } else {
    // Pour les autres étapes ou si complété, utiliser la méthode normale
    let statusContainer = stepElement.querySelector('.progress-status');
    if (!statusContainer) {
      statusContainer = document.createElement('div');
      statusContainer.className = 'progress-status';
      stepElement.appendChild(statusContainer);
    }
    
    // Mettre à jour le contenu des détails
    let detailContent = statusDetails;
    if (data.file) {
      detailContent += `<div class="progress-status-item"><strong>Fichier:</strong> ${escapeHtml(data.file)}</div>`;
    }
    if (data.destination) {
      detailContent += `<div class="progress-status-item"><strong>Destination:</strong> ${escapeHtml(data.destination)}</div>`;
    }
    
    statusContainer.innerHTML = detailContent;
  }
  }
  
  // TOUJOURS mettre à jour la progression globale si fournie
  // Cela permet une animation continue de 0% à 100%
  if (data.globalProgress !== undefined && data.globalProgress !== null) {
    // Utiliser la fonction appropriée selon la vue active
    if (state.currentView === 'workflowRunning') {
      // Mettre à jour la progression globale avec le pourcentage au-dessus
      const globalProgressText = document.getElementById('runningGlobalProgressText');
      const globalProgressBar = document.getElementById('runningGlobalProgressBar');
      if (globalProgressText) {
        globalProgressText.textContent = `${Math.round(data.globalProgress)}%`;
      }
      if (globalProgressBar) {
        globalProgressBar.style.width = `${data.globalProgress}%`;
        globalProgressBar.textContent = '';
      }
      updateRunningGlobalProgress(data.globalProgress, statusMessage);
    } else {
      updateGlobalProgress(data.globalProgress, statusMessage);
    }
  }
  
  // Si globalProgress n'est pas fourni mais qu'on a des données de progression, estimer
  // (fallback pour compatibilité)
  if (data.globalProgress === undefined && progressPercent >= 100 && isCompleted) {
    const steps = Object.keys(state.workflowState.steps);
    const completedSteps = steps.filter(s => 
      state.workflowState.steps[s].progress >= 100 || 
      state.workflowState.steps[s].status === 'completed'
    );
    const estimatedGlobalProgress = (completedSteps.length / 4) * 100; // 4 étapes principales
    if (state.currentView === 'workflowRunning') {
      updateRunningGlobalProgress(Math.min(100, estimatedGlobalProgress), statusMessage);
    } else {
      updateGlobalProgress(Math.min(100, estimatedGlobalProgress), statusMessage);
    }
  }
}

/**
 * Construit un bilan résumé pour une étape complétée
 */
function buildProgressSummary(step, stepData) {
  let summary = '';
  
  switch (step) {
    case 'copying':
      if (stepData.processed && stepData.total) {
        summary += `<div class="summary-item"><strong>Données copiées:</strong> ${stepData.processed} / ${stepData.total}</div>`;
      }
      if (stepData.speed) {
        summary += `<div class="summary-item"><strong>Vitesse:</strong> ${stepData.speed}</div>`;
      }
      if (stepData.elapsed) {
        summary += `<div class="summary-item"><strong>Durée:</strong> ${stepData.elapsed}</div>`;
      }
      if (stepData.file) {
        summary += `<div class="summary-item long-text"><strong>Fichiers traités:</strong> <span class="summary-item-value">${escapeHtml(stepData.file)}</span></div>`;
      }
      break;
      
    case 'compressing':
      summary += `<div class="summary-item"><strong>Compression:</strong> 100%</div>`;
      if (stepData.finalAvgFps) {
        summary += `<div class="summary-item"><strong>Vitesse moyenne finale:</strong> ${stepData.finalAvgFps.toFixed(2)} fps</div>`;
      } else if (stepData.avgFps) {
        summary += `<div class="summary-item"><strong>FPS moyen:</strong> ${stepData.avgFps}</div>`;
      }
      if (stepData.taskNumber && stepData.taskTotal) {
        summary += `<div class="summary-item"><strong>Tâches complétées:</strong> ${stepData.taskNumber}/${stepData.taskTotal}</div>`;
      }
      if (stepData.elapsed) {
        summary += `<div class="summary-item"><strong>Durée totale:</strong> ${stepData.elapsed}</div>`;
      }
      if (stepData.file) {
        summary += `<div class="summary-item long-text"><strong>Fichier compressé:</strong> <span class="summary-item-value">${escapeHtml(stepData.file)}</span></div>`;
      }
      // Ne pas afficher les lignes HandBrake dans le bilan, seulement les stats finales
      break;
      
    case 'creating_zip':
      summary += `<div class="summary-item"><strong>Archive créée:</strong> 100%</div>`;
      if (stepData.processed && stepData.total) {
        summary += `<div class="summary-item"><strong>Taille:</strong> ${stepData.processed} / ${stepData.total}</div>`;
      }
      if (stepData.elapsed) {
        summary += `<div class="summary-item"><strong>Durée:</strong> ${stepData.elapsed}</div>`;
      }
      if (stepData.speed) {
        summary += `<div class="summary-item"><strong>Vitesse:</strong> ${stepData.speed}</div>`;
      }
      break;
      
    case 'uploading':
      summary += `<div class="summary-item"><strong>Upload terminé:</strong> 100%</div>`;
      if (stepData.destination) {
        summary += `<div class="summary-item long-text"><strong>Destination:</strong> <span class="summary-item-value">${escapeHtml(stepData.destination)}</span></div>`;
      }
      if (stepData.processed && stepData.total) {
        summary += `<div class="summary-item"><strong>Données transférées:</strong> ${stepData.processed} / ${stepData.total}</div>`;
      }
      if (stepData.speed) {
        summary += `<div class="summary-item"><strong>Vitesse moyenne:</strong> ${stepData.speed}</div>`;
      }
      if (stepData.elapsed) {
        summary += `<div class="summary-item"><strong>Durée:</strong> ${stepData.elapsed}</div>`;
      }
      break;
      
    default:
      if (stepData.elapsed) {
        summary += `<div class="summary-item"><strong>Durée:</strong> ${stepData.elapsed}</div>`;
      }
      if (stepData.message) {
        summary += `<div class="summary-item"><strong>Message:</strong> ${escapeHtml(stepData.message)}</div>`;
      }
  }
  
  return summary || '<div class="summary-item">Tâche complétée avec succès</div>';
}

/**
 * Génère un message d'état clair et vulgarisé pour chaque étape
 */
function generateStatusMessage(step, data, progress, status) {
  if (status === 'completed') {
    return 'Terminé';
  }
  if (status === 'error' || status === 'failed') {
    return 'Erreur';
  }
  if (status === 'pending' || (!status && progress === 0)) {
    return 'En attente...';
  }
  
  // Messages spécifiques par étape
  switch (step) {
    case 'copying':
      if (progress > 0 && progress < 100) {
        return `Copie en cours... ${Math.round(progress)}%`;
      }
      return 'Copie des fichiers vers les disques de sauvegarde';
      
    case 'compressing':
      if (data.progress !== undefined) {
        const fileInfo = data.file ? ` • ${escapeHtml(data.file)}` : '';
        if (data.taskInfo) {
          return `Encoding: ${data.taskInfo}, ${data.progress.toFixed(2)}%${fileInfo}`;
        }
        if (data.fps) {
          return `Compression: ${data.progress.toFixed(2)}%${fileInfo} • ${data.fps}`;
        }
        return `Compression: ${data.progress.toFixed(2)}%${fileInfo}`;
      }
      return 'Préparation de la compression vidéo';
      
    case 'creating_zip':
      if (progress > 0 && progress < 100) {
        return `Création de l'archive ZIP: ${Math.round(progress)}%`;
      }
      return "Regroupement des fichiers dans l'archive";
      
    case 'uploading':
      if (progress > 0 && progress < 100) {
        return `Transfert vers le NAS: ${Math.round(progress)}%`;
      }
      return 'Connexion au serveur NAS...';
      
    case 'copying_non_video':
      return 'Copie des fichiers audio et autres';
      
    case 'adding_audio':
      return 'Ajout du fichier audio de backup';
      
    default:
      return status || 'En cours...';
  }
}

function showWorkflowSummary(result, totalTime) {
  // Ancienne fonction - maintenue pour compatibilité avec l'ancienne vue
  const summaryContainer = document.getElementById('summaryContent');
  const summary = document.getElementById('workflowSummary');
  
  if (summaryContainer && summary) {
    const formatTime = (seconds) => {
      if (seconds < 60) return `${Math.round(seconds)}s`;
      const mins = Math.floor(seconds / 60);
      const secs = Math.round(seconds % 60);
      return `${mins}m ${secs}s`;
    };
    
    let summaryHTML = `
      <div class="summary-item">
        <div class="summary-item-label">Projet</div>
        <div class="summary-item-value">${escapeHtml(result.projectName || 'N/A')}</div>
      </div>
      <div class="summary-item">
        <div class="summary-item-label">Temps total</div>
        <div class="summary-item-value">${formatTime(totalTime)}</div>
      </div>
    `;
    
    if (result.copyResults) {
      const filesCount = state.workflow.files.length;
      summaryHTML += `
        <div class="summary-item">
          <div class="summary-item-label">Fichiers copiés</div>
          <div class="summary-item-value">${filesCount}</div>
        </div>
      `;
    }
    
    if (result.archiveResult) {
      const zipSize = result.archiveResult.zipSize || 0;
      const formatBytes = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
      };
      
      summaryHTML += `
        <div class="summary-item">
          <div class="summary-item-label">Archive ZIP</div>
          <div class="summary-item-value">${formatBytes(zipSize)}</div>
        </div>
      `;
    }
    
    summaryContainer.innerHTML = summaryHTML;
    summary.style.display = 'block';
    
    // Faire défiler vers le résumé
    summary.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// Charger un GIF aléatoire depuis assets/GIF
async function loadCelebrationGif() {
  const gifContainer = document.getElementById('celebrationGifContainer');
  const gifElement = document.getElementById('celebrationGif');
  
  if (!gifContainer || !gifElement) return;
  
  // Cacher le conteneur par défaut
  gifContainer.style.display = 'none';
  gifElement.style.display = 'none';
  gifElement.style.opacity = '0';
  gifElement.style.visibility = 'hidden';
  
  // Listener pour afficher le GIF une fois chargé
  const onGifLoad = () => {
    // Afficher le conteneur seulement quand le GIF est chargé
    gifContainer.style.display = 'flex';
    gifElement.style.display = 'block';
    gifElement.style.opacity = '1';
    gifElement.style.visibility = 'visible';
    gifElement.removeEventListener('load', onGifLoad);
    gifElement.removeEventListener('error', onGifError);
  };
  
  const onGifError = (e) => {
    console.error('[GIF] Erreur de chargement de l\'image:', e);
    gifElement.removeEventListener('load', onGifLoad);
    gifElement.removeEventListener('error', onGifError);
    gifContainer.style.display = 'none';
  };
  
  gifElement.addEventListener('load', onGifLoad);
  gifElement.addEventListener('error', onGifError);
  
  try {
    // Lister les GIFs disponibles dans assets/GIF
    const gifPaths = await window.electronAPI.listCelebrationGifs();
    
    if (!gifPaths || gifPaths.length === 0) {
      console.warn('[GIF] Aucun GIF trouvé dans assets/GIF');
      gifContainer.style.display = 'none';
      return;
    }
    
    // Sélectionner un GIF aléatoire
    const randomIndex = Math.floor(Math.random() * gifPaths.length);
    const selectedGifPath = gifPaths[randomIndex];
    
    console.log(`[GIF] Chargement du GIF: ${selectedGifPath}`);
    
    // Convertir le chemin de fichier en URL de fichier pour l'affichage dans Electron
    // Encoder le chemin pour gérer les espaces et caractères spéciaux
    const gifUrl = `file://${encodeURI(selectedGifPath.replace(/\\/g, '/'))}`;
    
    // Définir le src - cela déclenchera l'événement 'load'
    gifElement.src = gifUrl;
    gifElement.alt = 'Celebration';
    
    // Forcer l'affichage après un court délai au cas où l'événement load ne se déclenche pas
    setTimeout(() => {
      if (gifElement.complete && gifElement.naturalHeight !== 0) {
        // Le GIF est déjà chargé, afficher le conteneur et le GIF
        gifContainer.style.display = 'flex';
        gifElement.style.display = 'block';
        gifElement.style.opacity = '1';
        gifElement.style.visibility = 'visible';
      }
    }, 300);
    
  } catch (error) {
    console.error('[GIF] Erreur lors du chargement du GIF:', error);
    // En cas d'erreur, cacher le conteneur
    gifContainer.style.display = 'none';
  }
}


function getStepLabel(step) {
  const labels = {
    'copying': 'Copie des fichiers',
    'compressing': 'Compression vidéo',
    'creating_zip': 'Création archive ZIP',
    'creating_zip_nas': 'Création ZIP NAS',
    'uploading': 'Upload vers NAS',
    'copying_non_video': 'Copie fichiers non-vidéo',
    'adding_audio': 'Ajout fichier audio'
  };
  return labels[step] || step;
}

/**
 * Parse une chaîne ETA (ex: "2m 30s" ou "1h 30m") en secondes
 */
function parseETA(etaString) {
  if (!etaString || etaString === 'Calcul...') return null;
  
  // Format: "Xh Ym" ou "Xm Ys" ou "Xs"
  const hoursMatch = etaString.match(/(\d+)h/);
  const minutesMatch = etaString.match(/(\d+)m/);
  const secondsMatch = etaString.match(/(\d+)s/);
  
  const hours = hoursMatch ? parseInt(hoursMatch[1]) : 0;
  const minutes = minutesMatch ? parseInt(minutesMatch[1]) : 0;
  const seconds = secondsMatch ? parseInt(secondsMatch[1]) : 0;
  
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Formate des secondes au format HandBrake ETA (00h00m00s)
 */
function formatETA(seconds) {
  if (seconds < 60) {
    return `${seconds.toString().padStart(2, '0')}s`;
  }
  
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}h${mins.toString().padStart(2, '0')}m${secs.toString().padStart(2, '0')}s`;
  }
  return `${mins.toString().padStart(2, '0')}m${secs.toString().padStart(2, '0')}s`;
}

// Paramètres
async function selectDestination(type) {
  const folder = await window.electronAPI.selectFolder();
  if (!folder) return;
  
  if (type === 'ssdPerso') {
    document.getElementById('ssdPersoPath').value = folder;
    state.settings.ssdPersoPath = folder;
  } else {
    document.getElementById('ssdStudioPath').value = folder;
    state.settings.ssdStudioPath = folder;
  }
  
  updateWorkflowValidation();
}

async function selectNASFolder() {
  const folder = await window.electronAPI.selectFolder();
  if (!folder) return;
  
  document.getElementById('nasSMBRemotePath').value = folder;
  state.settings.nas = state.settings.nas || {};
  state.settings.nas.remotePath = folder;
}

function toggleNASProtocol() {
  const protocol = document.getElementById('nasProtocol').value;
  const smbConfig = document.getElementById('smbConfig');
  const sftpConfig = document.getElementById('sftpConfig');
  
  if (protocol === 'smb') {
    smbConfig.style.display = 'block';
    sftpConfig.style.display = 'none';
  } else {
    smbConfig.style.display = 'none';
    sftpConfig.style.display = 'block';
  }
}

async function testNASConnection() {
  const btn = document.getElementById('testNASBtn');
  if (!btn) {
    console.error('Bouton testNASBtn non trouvé');
    return;
  }
  
  const originalText = btn.textContent;
  
  try {
    btn.disabled = true;
    btn.textContent = 'Test en cours...';
    
    const protocol = document.getElementById('nasProtocol')?.value || 'smb';
    let config = { protocol };
    
    if (protocol === 'smb') {
      const smbURLInput = document.getElementById('nasSMBURL');
      if (!smbURLInput) {
        showNotification('Champ URL SMB non trouvé', 'error');
        return;
      }
      
      const smbURL = smbURLInput.value.trim();
      const remotePath = document.getElementById('nasSMBRemotePath')?.value.trim() || '/';
      
      if (!smbURL || !smbURL.startsWith('smb://')) {
        showNotification('Veuillez entrer une URL SMB valide (format: smb://serveur/partage)', 'warning');
        return;
      }
      
      config.smbURL = smbURL;
      config.remotePath = remotePath;
      
      // Tester si le partage est monté
      try {
        showNotification('Vérification du montage SMB...', 'info');
        const result = await window.electronAPI.getMountedSMBShare(smbURL);
        
        if (result && result.success && result.path) {
          showNotification(`Partage SMB accessible!\nChemin: ${result.path}`, 'success');
          nasRefreshIndicators().catch(() => {});
          
          // Tester aussi la connexion complète via le backend
          try {
            const connectResult = await window.electronAPI.testNASConnection(config);
            if (connectResult && connectResult.success) {
              showNotification('Connexion et accès au partage réussis!', 'success');
            } else {
              const errorMsg = connectResult?.error || 'Erreur inconnue';
              showNotification(`Partage trouvé mais erreur: ${errorMsg}`, 'warning');
            }
          } catch (connectError) {
            showNotification(`Partage trouvé mais erreur: ${connectError.message || connectError}`, 'warning');
          }
        } else {
          const errorMsg = (result && result.error) || 'Partage non monté';
          showNotification(`${errorMsg}\n\nVeuillez monter le partage dans Finder:\n1. Cmd+K\n2. Entrez: ${smbURL}`, 'warning');
        }
      } catch (error) {
        const errorMsg = error.message || error.toString() || 'Erreur inconnue';
        showNotification(`Erreur: ${errorMsg}`, 'error');
        console.error('Erreur test SMB:', error);
      }
    } else {
      // SFTP
      const hostInput = document.getElementById('nasHost');
      const usernameInput = document.getElementById('nasUsername');
      
      if (!hostInput || !usernameInput) {
        showNotification('Champs SFTP non trouvés', 'error');
        return;
      }
      
      config.host = hostInput.value.trim();
      config.port = parseInt(document.getElementById('nasPort')?.value || '22');
      config.username = usernameInput.value.trim();
      config.password = document.getElementById('nasPassword')?.value || '';
      config.remotePath = document.getElementById('nasRemotePath')?.value.trim() || '/backups';
      
      if (!config.host || !config.username) {
        showNotification('Veuillez remplir tous les champs requis (Hôte et Utilisateur)', 'warning');
        return;
      }
      
      try {
        showNotification('Test de connexion SFTP en cours...', 'info');
        const result = await window.electronAPI.testNASConnection(config);
        
        if (result && result.success) {
          showNotification('Connexion SFTP réussie!', 'success');
          nasRefreshIndicators().catch(() => {});
        } else {
          const errorMsg = result?.error || 'Erreur inconnue';
          showNotification(`Échec de connexion: ${errorMsg}`, 'error');
        }
      } catch (error) {
        const errorMsg = error.message || error.toString() || 'Erreur inconnue';
        showNotification(`Erreur: ${errorMsg}`, 'error');
        console.error('Erreur test SFTP:', error);
      }
    }
  } catch (error) {
    const errorMsg = error.message || error.toString() || 'Erreur inattendue';
    showNotification(`Erreur inattendue: ${errorMsg}`, 'error');
    console.error('Erreur testNASConnection:', error);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

async function testMondayConnection() {
  const btn = document.getElementById('testMondayBtn');
  const resultEl = document.getElementById('mondayTestResult');
  if (!btn || !resultEl) return;

  const token = (document.getElementById('mondayApiToken')?.value || state.settings.mondayApiToken || DEFAULT_MONDAY_API_TOKEN || '').trim();
  const boardId = (document.getElementById('mondayBoardId')?.value || state.settings.mondayBoardId || '').trim();

  const originalText = btn.textContent;
  try {
    btn.disabled = true;
    resultEl.style.display = 'none';
    resultEl.className = 'monday-test-result';
    btn.textContent = 'Test en cours...';

    const r = await window.electronAPI.mondayTestConnection(token, boardId);

    resultEl.style.display = 'block';
    if (r.success) {
      resultEl.classList.add('success');
      resultEl.innerHTML = `
        <strong>Connexion réussie</strong>
        <p>${escapeHtml(r.details || r.message)}</p>
        ${r.boardName ? `<p class="monday-test-detail">Board : ${escapeHtml(r.boardName)}</p>` : ''}
      `;
      showNotification('Connexion Monday.com validée', 'success');
    } else {
      resultEl.classList.add('error');
      resultEl.innerHTML = `
        <strong>${escapeHtml(r.message || 'Erreur')}</strong>
        <p>${escapeHtml(r.details || '')}</p>
      `;
      showNotification(r.message || 'Erreur de connexion Monday', 'error');
    }
  } catch (err) {
    resultEl.style.display = 'block';
    resultEl.className = 'monday-test-result error';
    resultEl.innerHTML = `
      <strong>Erreur inattendue</strong>
      <p>${escapeHtml(err.message || String(err))}</p>
    `;
    showNotification('Erreur lors du test Monday', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

// Vérification connexion NAS : on demande à l'utilisateur de vérifier (VPN FortiClient + serveur accessible)
async function checkNASBeforeWorkflow() {
  showNotification('Vérification de l\'accès NAS...', 'info');
  const remotePath = state.settings.nas?.remotePath;
  if (!remotePath) {
    const action = await showErrorModal('NAS_NOT_MOUNTED', 'Chemin NAS non configuré dans les Paramètres');
    if (action === 'retry') return await checkNASBeforeWorkflow();
    if (action === 'continue_without_nas') return 'skip';
    return false;
  }
  try {
    // 1. NAS monté ?
    const access = await window.electronAPI.nasCheckAccess(remotePath);
    if (!access.accessible) {
      const action = await showErrorModal('NAS_NOT_MOUNTED', access.reason || `${remotePath} introuvable`);
      if (action === 'retry') return await checkNASBeforeWorkflow();
      if (action === 'continue_without_nas') return 'skip';
      return false;
    }
    // 2. NAS accessible en écriture ?
    if (window.electronAPI.nasVerifyWriteAccess) {
      const write = await window.electronAPI.nasVerifyWriteAccess(remotePath);
      if (!write.writable) {
        const action = await showErrorModal('NAS_UNREACHABLE', write.reason || 'Écriture impossible sur le NAS');
        if (action === 'retry') return await checkNASBeforeWorkflow();
        if (action === 'continue_without_nas') return 'skip';
        return false;
      }
    }
    // 3. Espace suffisant ?
    const totalSize = state.workflow.isMultiCam
      ? (state.workflow.multiCamFolderSummary?.totalSize || 0)
      : state.workflow.files.reduce((sum, f) => sum + (f.size || 0), 0);
    if (totalSize > 0 && window.electronAPI.nasFullDiagnostic) {
      const diag = await window.electronAPI.nasFullDiagnostic(totalSize);
      if (diag.errorKey === 'NAS_FULL') {
        const spaceInfo = diag.space
          ? `Espace dispo : ${formatBytes(diag.space.available)} / Requis : ${formatBytes(totalSize)}`
          : '';
        const action = await showErrorModal('NAS_FULL', spaceInfo);
        if (action === 'continue_without_nas') return 'skip';
        return false;
      }
    }
    showNotification('NAS accessible.', 'success');
    return true;
  } catch (e) {
    const action = await showErrorModal('NAS_UNREACHABLE', e.message || 'Erreur inattendue');
    if (action === 'retry') return await checkNASBeforeWorkflow();
    if (action === 'continue_without_nas') return 'skip';
    return false;
  }
}

function showNASAlertModal() {
  return new Promise((resolve) => {
    const modal = document.getElementById('nasAlertModal');
    const reconnectStatus = document.getElementById('nasAlertReconnectStatus');
    if (reconnectStatus) reconnectStatus.style.display = 'none';
    modal.style.display = 'flex';

    const cleanup = (result) => {
      modal.style.display = 'none';
      protocolBtn.removeEventListener('click', onProtocol);
      skipBtn.removeEventListener('click', onSkip);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    };

    const protocolBtn = document.getElementById('nasAlertProtocolBtn');
    const skipBtn = document.getElementById('nasAlertSkipBtn');
    const cancelBtn = document.getElementById('nasAlertCancelBtn');

    const onProtocol = async () => {
      protocolBtn.disabled = true;
      protocolBtn.textContent = 'Connexion en cours...';
      if (reconnectStatus) reconnectStatus.style.display = 'block';
      try {
        const result = await window.electronAPI.nasFullProtocol();
        if (result.accessible) {
          showNotification('NAS connecté avec succès.', 'success');
          cleanup(true);
        } else {
          showNotification('Le protocole n\'a pas pu rétablir l\'accès au NAS.', 'warning');
          protocolBtn.disabled = false;
          protocolBtn.textContent = 'Réessayer le protocole';
          if (reconnectStatus) reconnectStatus.style.display = 'none';
        }
      } catch {
        protocolBtn.disabled = false;
        protocolBtn.textContent = 'Réessayer le protocole';
        if (reconnectStatus) reconnectStatus.style.display = 'none';
      }
    };
    const onSkip = () => { cleanup('skip'); };
    const onCancel = () => { cleanup(false); };

    protocolBtn.addEventListener('click', onProtocol);
    skipBtn.addEventListener('click', onSkip);
    cancelBtn.addEventListener('click', onCancel);
  });
}

// ==================== NAS CONNECTOR UI ====================

function updateVPNIndicator(status, label) {
  const indicator = document.getElementById('vpnStatusIndicator');
  const labelEl = document.getElementById('vpnStatusLabel');
  if (indicator) indicator.dataset.status = status;
  if (labelEl) labelEl.textContent = label;
}
function updateNASSettingsIndicator(status, label) {
  const indicator = document.getElementById('nasStatusIndicator');
  const labelEl = document.getElementById('nasStatusLabel');
  if (indicator) indicator.dataset.status = status;
  if (labelEl) labelEl.textContent = label;
}

async function nasRefreshIndicators() {
  try {
    const vpn = await window.electronAPI.nasCheckVPN();
    if (vpn.isConnected) updateVPNIndicator('connected', 'VPN : connecté' + (vpn.vpnName ? ` (${vpn.vpnName})` : ''));
    else if (vpn.isRunning) updateVPNIndicator('disconnected', 'VPN : déconnecté (FortiClient lancé)');
    else if (!vpn.installed) updateVPNIndicator('disconnected', 'VPN : FortiClient non installé');
    else updateVPNIndicator('disconnected', 'VPN : déconnecté');
  } catch { updateVPNIndicator('unknown', 'VPN : erreur de vérification'); }
  try {
    const nasStatus = await window.electronAPI.getNASStatus();
    const status = nasStatus.status || 'unknown';
    const label = nasStatus.label || 'NAS : inconnu';
    updateNASSettingsIndicator(status === 'connected' ? 'connected' : status === 'warning' ? 'warning' : status === 'disabled' ? 'unknown' : 'disconnected', label);
  } catch { updateNASSettingsIndicator('unknown', 'NAS : erreur de vérification'); }
}


function getAllowedExtensions() {
  return state.settings.allowedVideoExtensions || ['.mp4', '.mov'];
}

function renderAllowedExtensions() {
  const container = document.getElementById('allowedExtensionsTags');
  if (!container) return;
  const exts = getAllowedExtensions();
  container.innerHTML = exts.map(ext =>
    `<span class="extension-tag">${ext}<button type="button" class="extension-tag-remove" data-ext="${ext}">x</button></span>`
  ).join('');
  container.querySelectorAll('.extension-tag-remove').forEach(btn => {
    btn.addEventListener('click', () => removeVideoExtension(btn.dataset.ext));
  });
}

async function addVideoExtension() {
  const input = document.getElementById('newExtensionInput');
  if (!input) return;
  let ext = input.value.trim().toLowerCase();
  if (!ext) return;
  if (!ext.startsWith('.')) ext = '.' + ext;
  if (!/^\.[a-z0-9]{1,10}$/.test(ext)) {
    showNotification('Extension invalide', 'error');
    return;
  }
  const exts = getAllowedExtensions();
  if (exts.includes(ext)) {
    showNotification('Extension deja presente', 'warning');
    input.value = '';
    return;
  }
  exts.push(ext);
  state.settings.allowedVideoExtensions = exts;
  input.value = '';
  renderAllowedExtensions();
  await saveSettings();
}

async function removeVideoExtension(ext) {
  const exts = getAllowedExtensions().filter(e => e !== ext);
  if (exts.length === 0) {
    showNotification('Au moins une extension doit etre conservee', 'warning');
    return;
  }
  state.settings.allowedVideoExtensions = exts;
  renderAllowedExtensions();
  await saveSettings();
}

async function saveSettings() {
  const protocol = document.getElementById('nasProtocol').value;
  const settings = {
    ...state.settings,
    ssdPersoPath: document.getElementById('ssdPersoPath').value,
    ssdStudioPath: document.getElementById('ssdStudioPath').value,
    nas: {
      protocol: protocol
    },
    compress: document.getElementById('settingsCompress')?.checked !== false,
    uploadToNAS: document.getElementById('settingsUploadNAS')?.checked !== false,
    zipNasEnabled: document.getElementById('settingsZipNas')?.checked || false,
    verifyIntegrity: document.getElementById('settingsVerifyIntegrity')?.checked !== false,
    allowedVideoExtensions: state.settings.allowedVideoExtensions || ['.mp4', '.mov'],
    gofileAutoUpload: document.getElementById('gofileAutoUpload')?.checked || false,
    proposeGofileAtEnd: document.getElementById('proposeGofileAtEnd')?.checked || false,
    mondayApiToken: (document.getElementById('mondayApiToken')?.value || '').trim() || undefined,
    mondayBoardId: (document.getElementById('mondayBoardId')?.value || '').trim() || undefined,
    vpnName: (document.getElementById('vpnName')?.value || '').trim() || undefined,
    resendApiKey: (document.getElementById('resendApiKey')?.value || '').trim() || undefined,
    organizerModeEnabled: document.getElementById('organizerModeEnabledToggle')?.checked || false
  };
  
  // Configurer NAS selon le protocole
  if (protocol === 'smb') {
    settings.nas.smbURL = document.getElementById('nasSMBURL').value;
    settings.nas.remotePath = document.getElementById('nasSMBRemotePath').value || '/';
  } else {
    settings.nas.host = document.getElementById('nasHost').value;
    settings.nas.port = parseInt(document.getElementById('nasPort').value);
    settings.nas.username = document.getElementById('nasUsername').value;
    settings.nas.password = document.getElementById('nasPassword').value;
    settings.nas.remotePath = document.getElementById('nasRemotePath').value;
  }
  
  try {
    await window.electronAPI.saveSettings(settings);
    state.settings = settings;
    
    // Si un profil est sélectionné, mettre à jour son ssdPersoPath avec la nouvelle valeur
    if (state.selectedProfile && settings.ssdPersoPath) {
      try {
        const updatedProfile = await window.electronAPI.updateProfile(state.selectedProfile.id, {
          ...state.selectedProfile,
          ssdPersoPath: settings.ssdPersoPath
        });
        // Mettre à jour le profil dans l'état
        state.selectedProfile = updatedProfile;
        // Mettre à jour le workflow si nécessaire
        if (state.workflow.ssdPersoPath) {
          state.workflow.ssdPersoPath = settings.ssdPersoPath;
        }
        showNotification('Paramètres et profil enregistrés', 'success');
      } catch (profileError) {
        console.error('Erreur lors de la mise à jour du profil:', profileError);
        showNotification('Paramètres enregistrés, mais erreur lors de la mise à jour du profil', 'warning');
      }
    } else {
      showNotification('Paramètres enregistrés', 'success');
    }
    
    updateWorkflowValidation();
  } catch (error) {
    showNotification(`Erreur: ${error.message}`, 'error');
  }
}

async function loadSettings() {
  state.settings = await window.electronAPI.getSettings();
  const organizerToggle = document.getElementById('organizerModeEnabledToggle');
  if (organizerToggle) organizerToggle.checked = state.settings.organizerModeEnabled === true;
}

// Historique
let currentHistoryFilter = '';

async function loadHistory() {
  try {
    const history = await window.electronAPI.getHistory(50);
    
    // Charger les profils pour le filtre
    const profiles = await window.electronAPI.getProfiles();
    populateProfileFilter(profiles);
    
    // Filtrer par profil si nécessaire
    let filteredHistory = history;
    if (currentHistoryFilter) {
      filteredHistory = history.filter(entry => entry.profileId === currentHistoryFilter);
    }
    
    renderHistory(filteredHistory);
  } catch (error) {
    console.error('Erreur chargement historique:', error);
  }
}

function populateProfileFilter(profiles) {
  const filterSelect = document.getElementById('historyProfileFilter');
  if (!filterSelect) return;
  
  // Garder l'option "Tous les profils"
  const allOption = filterSelect.querySelector('option[value=""]');
  filterSelect.innerHTML = '';
  if (allOption) filterSelect.appendChild(allOption);
  
  // Ajouter les profils
  profiles.forEach(profile => {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.name;
    filterSelect.appendChild(option);
  });
  
  // Restaurer la sélection
  if (currentHistoryFilter) {
    filterSelect.value = currentHistoryFilter;
  }
}

function renderHistory(history) {
  const container = document.getElementById('historyContainer');
  if (!container) return;
  
  if (history.length === 0) {
    container.innerHTML = '<p style="color: var(--text-secondary); text-align: center;">Aucun historique</p>';
    return;
  }
  
  container.innerHTML = history.map(entry => {
    const date = new Date(entry.timestamp);
    const statusClass = entry.status === 'completed' || entry.status === 'copy_completed' ? 'success' : 'failed';
    
    // Afficher les fichiers avec leurs noms originaux et tailles
    let filesInfo = '';
    if (entry.files && Array.isArray(entry.files) && entry.files.length > 0) {
      if (typeof entry.files[0] === 'object' && entry.files[0].name) {
        // Format nouveau avec nom et taille
        filesInfo = entry.files.map(f => {
          const fileName = f.name || 'Fichier inconnu';
          const fileSize = f.size || 0;
          return `<div style="margin-left: 15px; font-size: 0.9em; color: var(--text-secondary); margin-top: 5px;">
            ${escapeHtml(fileName)} - ${formatBytes(fileSize)}
          </div>`;
        }).join('');
      } else {
        // Format ancien avec juste les noms
        filesInfo = entry.files.map(name => {
          return `<div style="margin-left: 15px; font-size: 0.9em; color: var(--text-secondary); margin-top: 5px;">
            ${escapeHtml(name)}
          </div>`;
        }).join('');
      }
    }
    
    const totalSize = entry.totalSize || 0;
    const totalSizeDisplay = totalSize > 0 ? ` - ${formatBytes(totalSize)}` : '';
    
    return `
      <div class="history-item ${statusClass}">
        <div class="history-header">
          <span class="history-project">${escapeHtml(entry.projectName || 'N/A')}</span>${totalSizeDisplay}
          <span class="history-time">${date.toLocaleString('fr-FR')}</span>
        </div>
        <div class="history-details">
          Type: ${entry.type} • Status: ${entry.status}
          ${entry.format ? ` • Format: ${escapeHtml(entry.format)}` : ''}
          ${entry.filesCount ? ` • Fichiers: ${entry.filesCount}` : ''}
          ${entry.error ? `<br>Erreur: ${escapeHtml(entry.error)}` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// Fonction renderStatistics supprimée - fonctionnalité retirée
async function renderStatistics_DEPRECATED(history, profiles) {
  const container = document.getElementById('statisticsContainer');
  if (!container) return;
  
  if (history.length === 0) {
    container.innerHTML = '<p style="color: var(--text-secondary); text-align: center;">Aucune donnée disponible</p>';
    return;
  }
  
  // Statistiques par profil
  const statsByProfile = {};
  profiles.forEach(profile => {
    statsByProfile[profile.id] = {
      name: profile.name,
      count: 0,
      formats: {},
      totalSize: 0
    };
  });
  
  // Statistiques globales
  const formatStats = {};
  let totalBackups = 0;
  let totalSize = 0;
  
  history.forEach(entry => {
    totalBackups++;
    if (entry.totalSize) totalSize += entry.totalSize;
    
    if (entry.format) {
      formatStats[entry.format] = (formatStats[entry.format] || 0) + 1;
    }
    
    if (entry.profileId && statsByProfile[entry.profileId]) {
      statsByProfile[entry.profileId].count++;
      if (entry.format) {
        statsByProfile[entry.profileId].formats[entry.format] = (statsByProfile[entry.profileId].formats[entry.format] || 0) + 1;
      }
      if (entry.totalSize) {
        statsByProfile[entry.profileId].totalSize += entry.totalSize;
      }
    }
  });
  
  // Trier les profils par activité
  const activeProfiles = Object.values(statsByProfile)
    .filter(s => s.count > 0)
    .sort((a, b) => b.count - a.count);
  
  // Trier les formats par fréquence
  const sortedFormats = Object.entries(formatStats)
    .sort((a, b) => b[1] - a[1]);
  
  function formatBytes(bytes) {
    if (!bytes) return 'N/A';
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  }
  
  container.innerHTML = `
    <div class="statistics-grid">
      <div class="stat-card">
        <h3>CONtenus backupés</h3>
        <div class="stat-value">${totalBackups}</div>
      </div>
      
      <div class="stat-card">
        <h3>Volume total</h3>
        <div class="stat-value">${formatBytes(totalSize)}</div>
      </div>
      
      <div class="stat-card">
        <h3>Types de formats</h3>
        <div class="stat-value">${sortedFormats.length}</div>
      </div>
    </div>
    
    <div class="statistics-section">
      <h3>Formats les plus utilisés</h3>
      <div class="format-list">
        ${sortedFormats.slice(0, 10).map(([format, count]) => `
          <div class="format-item">
            <span class="format-name">${escapeHtml(format)}</span>
            <span class="format-count">${count}</span>
          </div>
        `).join('')}
      </div>
    </div>
    
    <div class="statistics-section">
      <h3>Profils les plus actifs</h3>
      <div class="profile-stats-list">
        ${activeProfiles.slice(0, 10).map(stat => `
          <div class="profile-stat-item">
            <span class="profile-stat-name">${escapeHtml(stat.name)}</span>
            <span class="profile-stat-count">${stat.count} opérations</span>
            <span class="profile-stat-size">${formatBytes(stat.totalSize)}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

async function clearHistory() {
  // Boîte de dialogue de confirmation plus visible
  const confirmed = confirm('Êtes-vous sûr de vouloir effacer tout l\'historique ?\n\nCette action est irréversible et supprimera toutes les opérations enregistrées.');
  
  if (confirmed) {
    try {
      await window.electronAPI.clearHistory();
      showNotification('Historique effacé avec succès', 'success');
      await loadHistory();
    } catch (error) {
      console.error('Erreur lors de l\'effacement de l\'historique:', error);
      showNotification('Erreur lors de l\'effacement de l\'historique', 'error');
    }
  }
}

// ==================== GESTION DES PROFILS ====================

let currentProfilePhoto = null;

async function loadProfiles() {
  try {
    const profiles = await window.electronAPI.getProfiles();
    renderProfiles(profiles);
  } catch (error) {
    console.error('Erreur lors du chargement des profils:', error);
    showNotification('Erreur lors du chargement des profils', 'error');
  }
}

function renderProfiles(profiles) {
  const grid = document.getElementById('profilesGrid');
  if (!grid) return;
  
  const visible = profiles.filter(p => !p.archived);
  
  if (visible.length === 0) {
    grid.innerHTML = '<p style="color: var(--text-secondary); text-align: center; grid-column: 1 / -1;">Aucun profil configuré. Cliquez sur "Ajouter un profil" pour commencer.</p>';
    return;
  }
  
  grid.innerHTML = visible.map(profile => {
    const photoSrc = profile.photoPath ? `file://${profile.photoPath}` : '';
    const adminBadge = profile.isAdmin ? '<span class="profile-admin-badge">ADMIN</span>' : '';
    return `
      <div class="profile-card" data-profile-id="${profile.id}">
        <div class="profile-card-menu">
          <button class="profile-menu-toggle" onclick="toggleProfileMenu('${profile.id}', event)" data-profile-id="${profile.id}">...</button>
          <div class="profile-menu-dropdown" id="menu-${profile.id}" style="display: none;">
            <button class="profile-menu-item" onclick="editProfile('${profile.id}')">MODIFIER</button>
            <button class="profile-menu-item danger" onclick="archiveProfile('${profile.id}')">ARCHIVER</button>
          </div>
        </div>
        ${adminBadge}
        ${photoSrc ? `<img src="${photoSrc}" alt="${escapeHtml(profile.name)}" class="profile-photo">` : `<div class="profile-photo-placeholder"></div>`}
        <h4>${escapeHtml(profile.name)}</h4>
        <div class="profile-initiales">${escapeHtml(profile.initiales)}</div>
        ${profile.email ? `<div class="profile-email">${escapeHtml(profile.email)}</div>` : ''}
      </div>
    `;
  }).join('');
  
  // Ajouter les event listeners pour la sélection
  grid.querySelectorAll('.profile-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (!e.target.closest('.profile-card-menu') && !e.target.closest('.profile-menu-dropdown')) {
        const profileId = card.dataset.profileId;
        selectProfile(profileId);
      }
    });
  });
  
  // Fermer les menus au clic extérieur
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.profile-card-menu') && !e.target.closest('.profile-menu-dropdown')) {
      document.querySelectorAll('.profile-menu-dropdown').forEach(menu => {
        menu.style.display = 'none';
      });
    }
  });
}

window.toggleProfileMenu = function(profileId, event) {
  event.stopPropagation();
  const menu = document.getElementById(`menu-${profileId}`);
  const allMenus = document.querySelectorAll('.profile-menu-dropdown');
  
  // Fermer tous les autres menus
  allMenus.forEach(m => {
    if (m.id !== `menu-${profileId}`) {
      m.style.display = 'none';
    }
  });
  
  // Toggle le menu actuel
  if (menu) {
    if (menu.style.display === 'none' || !menu.style.display) {
      menu.style.display = 'block';
    } else {
      menu.style.display = 'none';
    }
  }
};

window.editProfile = function(profileId) {
  // Fermer le menu
  document.getElementById(`menu-${profileId}`).style.display = 'none';
  openProfileModal(profileId);
};

window.deleteProfile = async function(profileId) {
  const menu = document.getElementById(`menu-${profileId}`);
  if (menu) menu.style.display = 'none';
  
  if (!confirm('Êtes-vous sûr de vouloir supprimer ce profil ?')) {
    return;
  }
  
  try {
    await window.electronAPI.deleteProfile(profileId);
    showNotification('Profil supprimé', 'success');
    loadProfiles();
  } catch (error) {
    console.error('Erreur lors de la suppression:', error);
    showNotification('Erreur lors de la suppression du profil', 'error');
  }
};

window.archiveProfile = async function(profileId) {
  const menu = document.getElementById(`menu-${profileId}`);
  if (menu) menu.style.display = 'none';
  if (!confirm('Archiver ce profil ? Il disparaîtra de l\'accueil mais pourra être restauré dans les Paramètres.')) return;
  try {
    await window.electronAPI.archiveProfile(profileId);
    showNotification('Profil archivé', 'success');
    loadProfiles();
  } catch (e) {
    showNotification('Erreur lors de l\'archivage', 'error');
  }
};

window.restoreProfile = async function(profileId) {
  try {
    await window.electronAPI.restoreProfile(profileId);
    showNotification('Profil restauré', 'success');
    renderArchivedProfiles();
  } catch (e) {
    showNotification('Erreur lors de la restauration', 'error');
  }
};

async function renderArchivedProfiles() {
  const container = document.getElementById('archivedProfilesList');
  if (!container) return;
  const profiles = await window.electronAPI.getProfiles();
  const archived = profiles.filter(p => p.archived);
  if (archived.length === 0) {
    container.innerHTML = '<p style="color: var(--text-secondary);">Aucun profil archivé.</p>';
    return;
  }
  container.innerHTML = archived.map(p => `
    <div class="archived-profile-row">
      <span class="archived-profile-name">${escapeHtml(p.name)}</span>
      <button class="btn btn-secondary btn-sm" onclick="restoreProfile('${p.id}')">Restaurer</button>
    </div>
  `).join('');
}

async function selectLauncherProfile(session) {
  // Profil construit depuis la session Launcher — pas de lookup local
  const profile = {
    id: session.profileId,
    name: session.profileName || 'Utilisateur',
    firstName: session.profileName ? session.profileName.split(' ')[0] : '',
    lastName: session.profileName ? session.profileName.split(' ').slice(1).join(' ') : '',
    initiales: session.profileName
      ? session.profileName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
      : '?',
    role: session.profileRole || 'user',
    isAdmin: session.profileRole === 'admin',
    fromLauncher: true,
    avatar: session.profileAvatar || null,
  };

  const bf = (session.appSettings && session.appSettings.backupflow) ? session.appSettings.backupflow : {};

  // Enrichir le profil avec les champs métier backupflow
  profile.initiales     = bf.initiales     || profile.initiales;
  profile.ssdPersoPath  = bf.ssdPersoPath  || null;
  profile.ssdStudioPath = bf.ssdStudioPath || null;
  profile.mondayUserId  = bf.mondayUserId  || session.profileId || null;
  profile.mondayMode    = bf.mondayMode    || 'monday';
  profile.zipNasEnabled = typeof bf.zipNasEnabled === 'boolean' ? bf.zipNasEnabled : false;
  profile.email         = bf.email         || null;
  profile.color         = bf.color         || null;

  state.selectedProfile = profile;

  // Propager les chemins SSD dans state.settings (fallback utilisé partout dans le workflow)
  if (profile.ssdPersoPath)  state.settings.ssdPersoPath  = profile.ssdPersoPath;
  if (profile.ssdStudioPath) state.settings.ssdStudioPath = profile.ssdStudioPath;
  if (typeof profile.zipNasEnabled === 'boolean') state.settings.zipNasEnabled = profile.zipNasEnabled;

  // Mettre à jour le champ initiales dans le workflow
  if (profile.initiales) {
    const el = document.getElementById('projectInitiales');
    if (el) { el.value = profile.initiales; state.workflow.initiales = profile.initiales; }
  }

  applyProfileTheme('dark');
  displayProfileHeader(profile);

  updateProjectNamePreview();
  showNotification(`Profil "${profile.name}" chargé via Launcher`, 'success');
  switchView('workflow');
}

async function selectProfile(profileId) {
  try {
    const profile = await window.electronAPI.getProfile(profileId);
    if (!profile) {
      showNotification('Profil introuvable', 'error');
      return;
    }
    
    // Sauvegarder le profil sélectionné
    state.selectedProfile = profile;
    
    // Appliquer le thème du profil
    applyProfileTheme(profile.theme || 'dark');
    
    // Appliquer les couleurs personnalisées
    applyProfileColors(profile);
    
    // Afficher l'en-tête de profil
    displayProfileHeader(profile);
    
    // Pré-remplir les champs du workflow
    if (profile.initiales) {
      document.getElementById('projectInitiales').value = profile.initiales;
      state.workflow.initiales = profile.initiales;
    }
    
    // Mettre à jour les destinations SSD pour ce workflow
    if (profile.ssdPersoPath) {
      state.workflow.ssdPersoPath = profile.ssdPersoPath;
      const ssdPersoInput = document.getElementById('ssdPersoPath');
      if (ssdPersoInput) {
        ssdPersoInput.value = profile.ssdPersoPath;
        state.settings.ssdPersoPath = profile.ssdPersoPath;
      }
    } else if (state.settings.ssdPersoPath) {
      state.workflow.ssdPersoPath = state.settings.ssdPersoPath;
    }
    if (profile.ssdStudioPath) {
      state.workflow.ssdStudioPath = profile.ssdStudioPath;
    } else {
      state.workflow.ssdStudioPath = null; // Utiliser le défaut des paramètres
    }
    
    updateProjectNamePreview();
    showNotification(`Profil "${profile.name}" sélectionné`, 'success');
    
    // Aller au workflow
    switchView('workflow');
  } catch (error) {
    console.error('Erreur lors de la sélection du profil:', error);
    showNotification('Erreur lors de la sélection du profil', 'error');
  }
}

function applyProfileTheme(theme) {
  const body = document.body;
  if (theme === 'light') {
    body.classList.remove('dark-theme');
    body.classList.add('light-theme');
    const btn = document.getElementById('themeToggle');
    if (btn) btn.textContent = 'MODE SOMBRE';
  } else {
    body.classList.remove('light-theme');
    body.classList.add('dark-theme');
    const btn = document.getElementById('themeToggle');
    if (btn) btn.textContent = 'MODE CLAIR';
  }
}

function applyProfileColors(profile) {
  const root = document.documentElement;
  
  // Couleurs par défaut si non définies
  const color1 = profile.color1 || '#2563eb';
  const color2 = profile.color2 || '#0f172a';
  const color3 = profile.color3 || '#ffffff';
  
  // Appliquer les couleurs personnalisées
  root.style.setProperty('--profile-primary', color1);
  root.style.setProperty('--profile-secondary', color2);
  root.style.setProperty('--profile-accent', color3);
  
  // Calculer des variantes pour les effets hover, etc.
  // Fonction simple pour assombrir une couleur (percent négatif = assombrir)
  function darkenColor(hex, percent) {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = (num >> 16) & 0xff;
    const g = (num >> 8) & 0xff;
    const b = num & 0xff;
    const factor = 1 - (percent / 100);
    const newR = Math.max(0, Math.min(255, Math.round(r * factor)));
    const newG = Math.max(0, Math.min(255, Math.round(g * factor)));
    const newB = Math.max(0, Math.min(255, Math.round(b * factor)));
    return '#' + ((1 << 24) + (newR << 16) + (newG << 8) + newB).toString(16).slice(1);
  }
  
  root.style.setProperty('--profile-primary-dark', darkenColor(color1, 15));
}

function displayProfileHeader(profile) {
  const header = document.getElementById('profileHeader');
  if (!header) return;
  
  // Afficher l'en-tête sauf sur la vue home
  if (state.selectedProfile) {
    header.style.display = 'block';
    
    // Nom du profil
    const nameEl = document.getElementById('profileHeaderName');
    if (nameEl) nameEl.textContent = profile.name || '';
    
    // Initiales avec guillemets
    const initialesEl = document.getElementById('profileHeaderInitiales');
    if (initialesEl) initialesEl.textContent = `"${profile.initiales || ''}"`;
    
    // Photo cliquable
    const photoEl = document.getElementById('profileHeaderPhoto');
    if (photoEl) {
      // Stocker l'ID du profil pour le clic
      photoEl.dataset.profileId = profile.id;
      
      const photoSource = profile.photoPath || profile.avatar || null;
      if (photoSource) {
        photoEl.style.backgroundImage = `url(${photoSource})`;
        photoEl.style.backgroundSize = 'cover';
        photoEl.style.backgroundPosition = 'center';
        photoEl.innerHTML = '';
      } else {
        photoEl.style.backgroundImage = 'none';
        photoEl.innerHTML = '<div class="profile-header-photo-placeholder"></div>';
      }
    }
  } else {
    header.style.display = 'none';
  }
}

const AVATARS = Array.from({length: 28}, (_, i) => `avatar_${String(i+1).padStart(2,'0')}`);

function openProfileModal(profileId = null) {
  const modal = document.getElementById('profileModal');
  const title = document.getElementById('profileModalTitle');
  const nameInput = document.getElementById('profileName');
  const initialesInput = document.getElementById('profileInitiales');
  const ssdPathInput = document.getElementById('profileSSDPersoPath');
  const hiddenId = document.getElementById('profileId');
  const photoPreview = document.getElementById('profilePhotoPreview');
  const removePhotoBtn = document.getElementById('removeProfilePhotoBtn');
  
  // Réinitialiser
  nameInput.value = '';
  initialesInput.value = '';
  ssdPathInput.value = '';
  document.getElementById('profileSSDStudioPath').value = '';
  document.getElementById('profileEmail').value = '';
  const mondayUserSelect = document.getElementById('profileMondayUser');
  if (mondayUserSelect) mondayUserSelect.innerHTML = '<option value="">— Non lié —</option>';
  const zipNasCheckbox = document.getElementById('profileZipNasEnabled');
  if (zipNasCheckbox) zipNasCheckbox.checked = false;
  hiddenId.value = '';
  currentProfilePhoto = null;
  photoPreview.innerHTML = '<span></span>';
  photoPreview.style.backgroundImage = '';
  removePhotoBtn.style.display = 'none';
  
  if (profileId) {
    title.textContent = 'Modifier le profil';
    hiddenId.value = profileId;
    
    // Charger les données du profil
    window.electronAPI.getProfile(profileId).then(profile => {
      if (profile) {
        nameInput.value = profile.name || '';
        initialesInput.value = profile.initiales || '';
        ssdPathInput.value = profile.ssdPersoPath || '';
        document.getElementById('profileSSDStudioPath').value = profile.ssdStudioPath || '';
        document.getElementById('profileEmail').value = profile.email || '';
        // Rendre la grille d'avatars
        const avatarGrid = document.getElementById('profile-avatar-grid');
        if (avatarGrid) {
          avatarGrid.innerHTML = AVATARS.map(id => `
            <div class="avatar-option ${(profile?.avatar === id) ? 'selected' : ''}" data-avatar="${id}">
              <img src="assets/avatars/${id}.jpeg" style="width:48px;height:48px;border-radius:50%;object-fit:cover;">
            </div>
          `).join('');
          avatarGrid.querySelectorAll('.avatar-option').forEach(el => {
            el.addEventListener('click', () => {
              avatarGrid.querySelectorAll('.avatar-option').forEach(a => a.classList.remove('selected'));
              el.classList.add('selected');
              currentProfilePhoto = null;
              document.getElementById('profile-photo-imported-label').style.display = 'none';
            });
          });
        }
        // Checkbox admin
        const adminCheckbox = document.getElementById('profileIsAdmin');
        if (adminCheckbox) adminCheckbox.checked = profile?.isAdmin === true;
        
        // Charger les couleurs
        const color1Input = document.getElementById('profileColor1');
        const color2Input = document.getElementById('profileColor2');
        const color3Input = document.getElementById('profileColor3');
        if (color1Input) color1Input.value = profile.color1 || '#2563eb';
        if (color2Input) color2Input.value = profile.color2 || '#0f172a';
        if (color3Input) color3Input.value = profile.color3 || '#ffffff';
        
        // Charger le thème
        const themeInput = document.getElementById('profileTheme');
        if (themeInput) themeInput.value = profile.theme || 'dark';
        
        if (zipNasCheckbox) zipNasCheckbox.checked = profile.zipNasEnabled || false;
        
        if (profile.photoPath) {
          currentProfilePhoto = profile.photoPath;
          photoPreview.style.backgroundImage = `url(file://${profile.photoPath})`;
          photoPreview.style.backgroundSize = 'cover';
          photoPreview.style.backgroundPosition = 'center';
          photoPreview.innerHTML = '';
          removePhotoBtn.style.display = 'inline-block';
        }
        if (profile.mondayUserId) {
          const sel = document.getElementById('profileMondayUser');
          if (sel) {
            window.electronAPI.getMondayUsers().then(({ users, error }) => {
              if (!error && users && users.length) {
                sel.innerHTML = '<option value="">— Non lié —</option>' +
                  users.map(u => `<option value="${escapeHtml(String(u.id))}">${escapeHtml(`${(u.name || '').trim() || u.email || u.id} (${u.email || ''})`)}</option>`).join('');
                sel.value = profile.mondayUserId;
              }
            }).catch(() => {});
          }
        }
      }
    }).catch(err => {
      console.error('Erreur lors du chargement du profil:', err);
    });
  } else {
    title.textContent = 'Nouveau profil';
    // Réinitialiser les couleurs par défaut
    const color1Input = document.getElementById('profileColor1');
    const color2Input = document.getElementById('profileColor2');
    const color3Input = document.getElementById('profileColor3');
    if (color1Input) color1Input.value = '#2563eb';
    if (color2Input) color2Input.value = '#0f172a';
    if (color3Input) color3Input.value = '#ffffff';
    
    // Réinitialiser le thème par défaut
    const themeInput = document.getElementById('profileTheme');
    if (themeInput) themeInput.value = 'dark';
  }
  
  modal.classList.add('show');
}

function closeProfileModal() {
  const modal = document.getElementById('profileModal');
  if (modal) {
    modal.classList.remove('show');
    // Réinitialiser les champs pour éviter les conflits
    document.getElementById('profileName').value = '';
    document.getElementById('profileInitiales').value = '';
    document.getElementById('profileSSDPersoPath').value = '';
    document.getElementById('profileSSDStudioPath').value = '';
    document.getElementById('profileId').value = '';
    const mondayUserSelectReset = document.getElementById('profileMondayUser');
    if (mondayUserSelectReset) mondayUserSelectReset.innerHTML = '<option value="">— Non lié —</option>';
    document.getElementById('profileColor1').value = '#2563eb';
    document.getElementById('profileColor2').value = '#0f172a';
    document.getElementById('profileColor3').value = '#ffffff';
    document.getElementById('profileTheme').value = 'dark';
    const zipNasCheckbox2 = document.getElementById('profileZipNasEnabled');
    if (zipNasCheckbox2) zipNasCheckbox2.checked = false;
  }
}

async function saveProfile() {
  const name = document.getElementById('profileName').value.trim();
  const initiales = document.getElementById('profileInitiales').value.trim().toUpperCase();
  const ssdPersoPath = document.getElementById('profileSSDPersoPath').value.trim();
  const ssdStudioPath = document.getElementById('profileSSDStudioPath').value.trim();
  const profileId = document.getElementById('profileId').value;
  const color1 = document.getElementById('profileColor1').value;
  const color2 = document.getElementById('profileColor2').value;
  const color3 = document.getElementById('profileColor3').value;
  const theme = document.getElementById('profileTheme').value || 'dark';
  
  if (!name || !initiales) {
    showNotification('Le nom et les initiales sont requis', 'error');
    return;
  }
  
  try {
    const mondayUserSelect = document.getElementById('profileMondayUser');
    const mondayUserId = (mondayUserSelect?.value || '').trim() || null;
    const profileData = {
      name,
      initiales,
      email: document.getElementById('profileEmail').value.trim(),
      mondayUserId,
      ssdPersoPath: ssdPersoPath || null,
      ssdStudioPath: ssdStudioPath || null,
      photoPath: currentProfilePhoto || null,
      color1: color1 || '#2563eb',
      color2: color2 || '#0f172a',
      color3: color3 || '#ffffff',
      theme: theme || 'dark',
      zipNasEnabled: document.getElementById('profileZipNasEnabled')?.checked || false,
      isAdmin: document.getElementById('profileIsAdmin')?.checked || false,
      avatar: document.getElementById('profile-avatar-grid')?.querySelector('.avatar-option.selected')?.dataset?.avatar || null,
    };
    
    if (profileId) {
      const updatedProfile = await window.electronAPI.updateProfile(profileId, profileData);
      // Si c'est le profil actuellement sélectionné, mettre à jour
      if (state.selectedProfile && state.selectedProfile.id === profileId) {
        state.selectedProfile = updatedProfile;
        applyProfileTheme(updatedProfile.theme || 'dark');
        applyProfileColors(updatedProfile);
        displayProfileHeader(updatedProfile);
      }
      showNotification('Profil modifié avec succès', 'success');
    } else {
      await window.electronAPI.createProfile(profileData);
      showNotification('Profil créé avec succès', 'success');
    }
    
    closeProfileModal();
    await loadProfiles();
  } catch (error) {
    console.error('Erreur lors de la sauvegarde:', error);
    showNotification('Erreur lors de la sauvegarde du profil', 'error');
  }
}

async function selectProfileDestination(type) {
  try {
    const path = await window.electronAPI.selectFolder();
    if (path) {
      const inputId = type === 'studio' ? 'profileSSDStudioPath' : 'profileSSDPersoPath';
      document.getElementById(inputId).value = path;
    }
  } catch (error) {
    console.error('Erreur lors de la sélection du dossier:', error);
  }
}

async function selectProfilePhoto() {
  try {
    const result = await window.electronAPI.selectProfilePhoto();
    if (result && result.filePath) {
      currentProfilePhoto = result.filePath;
      const preview = document.getElementById('profilePhotoPreview');
      preview.style.backgroundImage = `url(file://${result.filePath})`;
      preview.style.backgroundSize = 'cover';
      preview.style.backgroundPosition = 'center';
      preview.innerHTML = '';
      document.getElementById('removeProfilePhotoBtn').style.display = 'inline-block';
    }
  } catch (error) {
    console.error('Erreur lors de la sélection de la photo:', error);
  }
}

function removeProfilePhoto() {
  currentProfilePhoto = null;
  const preview = document.getElementById('profilePhotoPreview');
  preview.style.backgroundImage = '';
  preview.innerHTML = '<span></span>';
  document.getElementById('removeProfilePhotoBtn').style.display = 'none';
}

// Utilitaires
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showQuitConfirmModal() {
  const modal = document.getElementById('quitConfirmModal');
  if (modal) {
    modal.classList.add('show');
  }
}

function showNotification(message, type = 'info') {
  console.log(`[${type.toUpperCase()}] ${message}`);
  
  // Créer une notification visuelle
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  
  // Gérer les messages multi-lignes
  const messageLines = message.split('\n');
  if (messageLines.length > 1) {
    notification.innerHTML = messageLines.map(line => `<div>${escapeHtml(line)}</div>`).join('');
  } else {
    notification.textContent = message;
  }
  
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 15px 20px;
    border-radius: 8px;
    color: white;
    z-index: 10000;
    max-width: 500px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    animation: slideIn 0.3s ease-out;
    font-size: 14px;
    line-height: 1.5;
    white-space: pre-line;
  `;
  
  // Couleurs selon le type
  const colors = {
    success: '#28a745',
    error: '#dc3545',
    warning: '#ffc107',
    info: '#17a2b8'
  };
  notification.style.background = colors[type] || colors.info;
  
  document.body.appendChild(notification);
  
  // Retirer après 8 secondes (plus long pour les messages importants)
  const displayTime = type === 'error' || type === 'warning' ? 8000 : 5000;
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.remove();
      }
    }, 300);
  }, displayTime);
}

// Ajouter les animations CSS
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from {
      transform: translateX(400px);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  @keyframes slideOut {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(400px);
      opacity: 0;
    }
  }
`;
document.head.appendChild(style);

// ==================== DICTIONNAIRE ERREURS (RENDERER) ====================
const ERROR_MESSAGES = {
  VPN_NOT_CONNECTED:{title:'VPN non connecte',vulgarized:"Le VPN n'est pas actif sur ce Mac.",causes:["FortiClient n'est pas lancé","La connexion VPN_ETUDIANT n'a pas été établie","Une mise à jour FortiClient a réinitialisé les paramètres"],steps:["Ouvre FortiClient sur ton Mac","Connecte-toi à VPN_ETUDIANT","Reviens dans BackUpFlow et clique sur Réessayer"],actions:['retry','continue_without_nas','cancel']},
  VPN_UNSTABLE:{title:'VPN instable',vulgarized:'Le VPN est connecté mais la connexion est fragile.',causes:['Signal WiFi faible dans le studio','Interférence réseau','Charge élevée sur le serveur VPN'],steps:['Rapproche-toi de la borne WiFi si possible','Déconnecte et reconnecte le VPN dans FortiClient','Clique sur Réessayer'],actions:['retry','continue_without_nas','cancel']},
  NAS_NOT_MOUNTED:{title:'NAS non monte',vulgarized:"Le NAS n'est pas branché à ce Mac.",causes:["Le VPN vient d'être connecté mais le NAS n'a pas encore été monté","La session Finder sur le NAS a expiré","Le Mac a redémarré depuis la dernière connexion"],steps:['Ouvre le Finder','Fais Cmd+K et entre : smb://srvfiler01.etudiant.lan/Video','Connecte-toi avec tes identifiants','Reviens dans BackUpFlow et clique sur Réessayer'],actions:['retry','continue_without_nas','cancel']},
  NAS_UNREACHABLE:{title:'NAS inaccessible',vulgarized:'Le NAS est monté mais ne répond pas.',causes:["Le VPN s'est déconnecté après le montage",'Le serveur NAS a redémarré','Problème réseau temporaire'],steps:['Vérifie que le VPN est toujours actif dans FortiClient',"Essaie d'ouvrir le NAS dans le Finder",'Si le Finder ne répond pas, reconnecte le VPN et remonte le NAS','Clique sur Réessayer'],actions:['retry','continue_without_nas','cancel']},
  NAS_DISCONNECTED_DURING_UPLOAD:{title:'NAS decroche en cours de transfert',vulgarized:"Le NAS s'est décroché pendant le transfert.",causes:["Le VPN s'est déconnecté automatiquement",'La connexion WiFi a été interrompue','Le serveur NAS a redémarré'],steps:['Vérifie que le VPN est actif dans FortiClient','Vérifie ta connexion WiFi','Clique sur Réessayer — le transfert reprendra depuis le début du fichier en cours'],actions:['retry','continue_without_nas','cancel']},
  NAS_TIMEOUT:{title:'NAS trop lent',vulgarized:'Le NAS met trop de temps à répondre.',causes:['Connexion WiFi faible','Charge importante sur le serveur NAS','VPN instable'],steps:['Vérifie la qualité de ta connexion WiFi','Attends quelques secondes et clique sur Réessayer',"Si le problème persiste, continue sans NAS et relance l'upload plus tard"],actions:['retry','continue_without_nas','cancel']},
  NAS_AUTH_FAILED:{title:'Identifiants NAS incorrects',vulgarized:"Le nom d'utilisateur ou mot de passe NAS est incorrect.",causes:['Le mot de passe du serveur a changé','Les identifiants enregistrés dans BackUpFlow sont obsolètes'],steps:['Va dans Paramètres > Connexion NAS',"Mets à jour ton nom d'utilisateur et mot de passe",'Clique sur Enregistrer puis Réessayer'],actions:['open_settings','cancel']},
  NAS_PATH_NOT_FOUND:{title:'Dossier NAS introuvable',vulgarized:"Le dossier de destination sur le NAS n'existe plus.",causes:['Le dossier a été renommé ou supprimé sur le serveur','Le chemin configuré dans BackUpFlow ne correspond plus à la structure du NAS'],steps:['Va dans Paramètres > Connexion NAS','Vérifie et corrige le chemin de destination','Clique sur Enregistrer puis Réessayer'],actions:['open_settings','cancel']},
  SSD_PERSO_FULL:{title:'SSD personnel plein',vulgarized:"Ton SSD personnel n'a pas assez de place pour ce backup.",causes:["Des anciens projets occupent trop d'espace","Le volume de ce projet dépasse l'espace disponible"],steps:['Ouvre ton SSD dans le Finder','Supprime ou archive des projets anciens','Clique sur Vérifier à nouveau'],actions:['retry','cancel']},
  SSD_STUDIO_FULL:{title:'SSD Studio plein',vulgarized:"Le SSD Studio n'a pas assez de place pour ce backup.",causes:["Des anciens projets occupent trop d'espace sur le SSD Studio"],steps:['Ouvre le SSD Studio dans le Finder','Supprime ou archive des projets anciens','Clique sur Vérifier à nouveau'],actions:['retry','skip_ssd_studio','cancel']},
  NAS_FULL:{title:'NAS plein',vulgarized:"Le NAS n'a pas assez de place pour ce backup.",causes:['Le stockage du serveur NAS est saturé'],steps:["Contacte le responsable technique pour libérer de l'espace sur le NAS",'Tu peux continuer sans NAS — le backup SSD est déjà sécurisé'],actions:['continue_without_nas','cancel']},
  DISK_FULL_COMPRESSION:{title:'Pas assez de place pour la compression',vulgarized:'Pas assez de place pour compresser les vidéos avant envoi.',causes:['La compression HandBrake nécessite un espace temporaire important'],steps:["Libère de l'espace sur le SSD utilisé comme espace de travail",'Ou désactive la compression dans les Options du workflow'],actions:['retry','skip_compression','cancel']},
  SOURCE_FILE_UNREADABLE:{title:'Fichier source illisible',vulgarized:'Un fichier source est corrompu ou inaccessible.',causes:['La carte SD ou le disque source a un problème de lecture','Le fichier a été partiellement transféré et est incomplet'],steps:['Vérifie que la carte SD ou le disque source est bien connecté',"Essaie d'ouvrir le fichier directement dans le Finder",'Clique sur Ignorer ce fichier pour continuer avec les autres'],actions:['retry','skip_file','cancel']},
  SOURCE_FOLDER_EMPTY:{title:'Dossier source vide',vulgarized:'Le dossier sélectionné ne contient aucun fichier à backuper.',causes:['Le mauvais dossier a été sélectionné','Les fichiers sont dans un sous-dossier'],steps:["Retourne à l'étape 2 et sélectionne le bon dossier source"],actions:['go_back','cancel']},
  CHECKSUM_FAILED:{title:'Copie incorrecte detectee',vulgarized:"La copie n'est pas identique à l'original — le fichier est peut-être corrompu.",causes:['Problème de lecture sur le disque source',"Problème d'écriture sur le disque de destination",'Interruption pendant la copie'],steps:['Clique sur Réessayer — BackUpFlow va recopier ce fichier',"Si le problème persiste, vérifie l'état de tes disques"],actions:['retry','skip_file','cancel']},
  HANDBRAKE_NOT_FOUND:{title:'HandBrake non installe',vulgarized:"Le logiciel de compression n'est pas installé sur ce Mac.",causes:["HandBrakeCLI n'a pas été installé ou a été désinstallé"],steps:['Installe HandBrakeCLI via Homebrew : brew install handbrake','Ou désactive la compression dans les Options du workflow'],actions:['skip_compression','cancel']},
  HANDBRAKE_FAILED:{title:'Compression echouee',vulgarized:'La compression a échoué sur un fichier vidéo.',causes:['Le fichier vidéo est dans un format non supporté','HandBrake a planté sur ce fichier'],steps:['Clique sur Ignorer ce fichier pour continuer avec les autres','Ou désactive la compression pour ce workflow'],actions:['skip_file','skip_compression','cancel']},
  MONDAY_AUTH_FAILED:{title:'Connexion Monday refusee',vulgarized:"La connexion à Monday n'est pas autorisée — la clé API est peut-être expirée.",causes:['La clé API Monday a expiré ou a été révoquée','La clé API saisie dans les Paramètres est incorrecte'],steps:['Va dans Paramètres > Monday.com','Génère une nouvelle clé API dans Monday (Mon profil > API)','Colle la nouvelle clé et clique sur Enregistrer'],actions:['open_settings','continue_without_monday','cancel']},
  MONDAY_BOARD_NOT_FOUND:{title:'Tableau Monday introuvable',vulgarized:"Le tableau Monday configuré n'existe plus ou a changé.",causes:['Le Board ID configuré dans BackUpFlow est incorrect','Le tableau a été supprimé ou archivé dans Monday'],steps:['Va dans Paramètres > Monday.com','Vérifie et corrige le Board ID','Clique sur Tester la connexion pour vérifier'],actions:['open_settings','continue_without_monday','cancel']},
  MONDAY_COLUMN_NOT_FOUND:{title:'Colonne Monday manquante',vulgarized:'Une colonne attendue dans Monday a été renommée ou supprimée.',causes:['La colonne Statut Prod, Lien Swiss/GoFile ou Responsable Backup a été modifiée dans Monday'],steps:['Vérifie dans Monday que ces colonnes existent bien : Statut Prod, Lien Swiss/GoFile, Responsable Backup','La mise à jour Monday sera ignorée pour ce projet'],actions:['continue_without_monday','cancel']},
  MONDAY_TIMEOUT:{title:'Monday ne repond pas',vulgarized:'Monday ne répond pas — vérifie ta connexion internet.',causes:['Connexion internet coupée ou instable','Panne temporaire des serveurs Monday'],steps:['Vérifie ta connexion internet','Clique sur Réessayer dans quelques secondes','La mise à jour Monday peut être ignorée — le backup SSD est sécurisé'],actions:['retry','continue_without_monday']},
  MONDAY_UPDATE_FAILED:{title:'Mise a jour Monday echouee',vulgarized:"Le statut du projet n'a pas pu être mis à jour dans Monday.",causes:['Problème réseau au moment de la mise à jour','Droits insuffisants sur cet item Monday'],steps:['Mets à jour manuellement le statut dans Monday : 3 - BACKUPÉ',"Le backup est bien effectué — seule la mise à jour Monday a échoué"],actions:['continue_without_monday']},
  GOFILE_UPLOAD_FAILED:{title:'Envoi Gofile echoue',vulgarized:"L'envoi vers Gofile a échoué.",causes:['Connexion internet instable','Serveurs Gofile temporairement indisponibles'],steps:['Clique sur Réessayer','Ou envoie le fichier manuellement depuis le Finder vers gofile.io'],actions:['retry','skip_gofile']},
  GOFILE_TIMEOUT:{title:'Gofile ne repond pas',vulgarized:'Gofile ne répond pas — connexion internet peut-être coupée.',causes:['Connexion internet instable','Panne temporaire de Gofile'],steps:['Vérifie ta connexion internet','Réessaie dans quelques minutes'],actions:['retry','skip_gofile']},
  COPY_ERROR:{title:'Erreur de copie',vulgarized:'Un problème est survenu pendant la copie des fichiers. Vérifiez que vos disques sont bien connectés et ont suffisamment d\'espace.',causes:['Disque source ou destination déconnecté pendant la copie','Espace disque insuffisant sur la destination','Fichier source inaccessible ou corrompu'],steps:['Vérifiez que tous les disques sont bien branchés','Contrôlez l\'espace disponible sur les destinations','Relancez le workflow'],actions:['cancel']},
  NAS_UPLOAD_FAILED:{title:'Échec de l\'envoi NAS',vulgarized:'Le transfert vers le NAS a échoué. Ton backup SSD est sécurisé — seul l\'envoi réseau n\'a pas abouti.',causes:['Le NAS est devenu inaccessible pendant le transfert','La connexion VPN s\'est coupée en cours de route','Le serveur NAS a redémarré'],steps:['Vérifie que le VPN est actif dans FortiClient','Vérifie que le NAS est monté dans le Finder','Relance un workflow complet depuis la configuration'],actions:['cancel']},
  COMPRESSION_FAILED:{title:'Échec de la compression',vulgarized:'HandBrake n\'a pas pu compresser les fichiers vidéo. Ton backup SSD reste intact.',causes:['Un fichier vidéo est dans un format non supporté par HandBrake','HandBrakeCLI a planté de manière inattendue','Espace disque temporaire insuffisant'],steps:['Relance le workflow — si le problème persiste, désactive la compression dans les options','Vérifie que HandBrakeCLI est bien installé (brew install handbrake)','Libère de l\'espace disque si nécessaire'],actions:['cancel']},
  ZIP_FAILED:{title:'Échec de la création d\'archive',vulgarized:'La création du fichier ZIP pour le NAS a échoué. Ton backup SSD reste intact.',causes:['Espace disque temporaire insuffisant','Fichier source inaccessible pendant la compression ZIP','Erreur système lors de l\'écriture'],steps:['Libère de l\'espace sur le disque de démarrage','Relance un workflow complet depuis la configuration'],actions:['cancel']}
};

// ==================== MODALE D'ERREUR UNIVERSELLE ====================

let _errorModalResolve = null;

function buildErrorActions(actions) {
  const labels = {
    retry: { text: 'Réessayer', cls: 'btn-primary' },
    continue_without_nas: { text: 'Continuer sans NAS', cls: 'btn-secondary' },
    continue_without_monday: { text: 'Continuer sans Monday', cls: 'btn-secondary' },
    cancel: { text: 'Annuler', cls: 'btn-danger' },
    open_settings: { text: 'Ouvrir les Paramètres', cls: 'btn-secondary' },
    skip_file: { text: 'Ignorer ce fichier', cls: 'btn-secondary' },
    skip_compression: { text: 'Désactiver la compression', cls: 'btn-secondary' },
    skip_ssd_studio: { text: 'Ignorer SSD Studio', cls: 'btn-secondary' },
    skip_gofile: { text: 'Ignorer Gofile', cls: 'btn-secondary' },
    go_back: { text: 'Retour', cls: 'btn-secondary' }
  };
  return (actions || []).map(action => {
    const cfg = labels[action] || { text: action, cls: 'btn-secondary' };
    return `<button class="btn ${cfg.cls} error-action-btn" data-action="${action}">${cfg.text}</button>`;
  }).join('');
}

function showErrorModal(errorKey, technicalMessage, customActions) {
  const error = ERROR_MESSAGES[errorKey];
  if (!error) {
    console.warn('[ErrorModal] Clé inconnue:', errorKey);
    return Promise.resolve('cancel');
  }

  document.getElementById('errorModalTitle').textContent = error.title;
  document.getElementById('errorModalVulgarized').textContent = error.vulgarized;
  document.getElementById('errorModalTechnical').textContent = technicalMessage || '';

  const causesList = document.getElementById('errorModalCauses');
  causesList.innerHTML = error.causes.map(c => `<li>${c}</li>`).join('');

  const stepsList = document.getElementById('errorModalSteps');
  stepsList.innerHTML = error.steps.map(s => `<li>${s}</li>`).join('');

  const actionsContainer = document.getElementById('errorModalActions');
  const actions = customActions || error.actions;
  actionsContainer.innerHTML = buildErrorActions(actions);

  // Fermer l'accordéon
  const accordionContent = document.getElementById('errorAccordionContent');
  const accordionToggle = document.getElementById('errorAccordionToggle');
  if (accordionContent) accordionContent.style.display = 'none';
  if (accordionToggle) {
    accordionToggle.textContent = '> En savoir plus';
    accordionToggle.classList.remove('open');
  }

  const modal = document.getElementById('errorModal');
  modal.style.display = 'flex';
  modal.classList.add('show');

  window.electronAPI.sendErrorReportMail({
    toEmail: state.selectedProfile?.email,
    errorTitle: error.title || 'Erreur inconnue',
    errorTechnical: technicalMessage || '',
    errorVulgarized: error.vulgarized || '',
    context: errorKey || ''
  });

  return new Promise(resolve => {
    _errorModalResolve = resolve;
    actionsContainer.querySelectorAll('.error-action-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        closeErrorModal();
        if (action === 'open_settings') {
          switchView('settings');
        }
        resolve(action);
      }, { once: true });
    });
  });
}

function showGofileWarningModal(errorLog) {
  return new Promise((resolve) => {
    const modal = document.getElementById('gofileWarningModal');
    const logEl = document.getElementById('gofileWarningLog');
    const logBlock = document.getElementById('gofileWarningLogBlock');
    const toggleBtn = document.getElementById('gofileWarningToggleLog');
    const closeBtn = document.getElementById('gofileWarningCloseBtn');
    const closeX = document.getElementById('gofileWarningCloseX');

    if (logEl) logEl.textContent = errorLog || 'Erreur inconnue';
    if (logBlock) logBlock.style.display = 'none';
    if (toggleBtn) toggleBtn.textContent = 'Voir le log';

    if (toggleBtn) {
      toggleBtn.onclick = () => {
        const visible = logBlock.style.display !== 'none';
        logBlock.style.display = visible ? 'none' : 'block';
        toggleBtn.textContent = visible ? 'Voir le log' : 'Masquer le log';
      };
    }

    const close = () => {
      modal.classList.remove('show');
      resolve();
    };

    if (closeBtn) closeBtn.onclick = close;
    if (closeX) closeX.onclick = close;

    modal.classList.add('show');
  });
}

function closeErrorModal() {
  const modal = document.getElementById('errorModal');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.remove('show');
  }
  _errorModalResolve = null;
}

function toggleErrorAccordion() {
  const content = document.getElementById('errorAccordionContent');
  const toggle = document.getElementById('errorAccordionToggle');
  if (!content || !toggle) return;
  const isOpen = content.style.display !== 'none';
  content.style.display = isOpen ? 'none' : 'block';
  toggle.textContent = isOpen ? '> En savoir plus' : 'v En savoir plus';
  toggle.classList.toggle('open', !isOpen);
}

// Bind accordion toggle
document.addEventListener('DOMContentLoaded', () => {
  const accToggle = document.getElementById('errorAccordionToggle');
  if (accToggle) accToggle.addEventListener('click', toggleErrorAccordion);
});

// ==================== INDICATEUR NAS (HEADER) ====================

let _nasPollingInterval = null;

function setNASDotColor(color) {
  const dot = document.getElementById('nasIndicatorDot');
  if (!dot) return;
  dot.className = 'nas-dot nas-dot-' + color;
}

async function updateNASIndicator() {
  if (!window.electronAPI || !window.electronAPI.getNASStatus) return;
  try {
    const status = await window.electronAPI.getNASStatus();
    const dot = document.getElementById('nasIndicatorDot');
    const label = document.getElementById('nasIndicatorLabel');
    const indicator = document.getElementById('nasIndicator');
    if (!dot || !label) return;

    dot.className = 'nas-dot';
    switch (status.status) {
      case 'connected':
        dot.classList.add('nas-dot-green');
        label.textContent = 'NAS';
        if (indicator) indicator.title = status.label || 'NAS monté et accessible';
        break;
      case 'warning':
        dot.classList.add('nas-dot-yellow');
        label.textContent = 'NAS';
        if (indicator) indicator.title = status.label || 'NAS instable';
        break;
      case 'disconnected':
        dot.classList.add('nas-dot-red');
        label.textContent = 'NAS';
        if (indicator) indicator.title = status.label || 'NAS inaccessible';
        break;
      default:
        dot.classList.add('nas-dot-grey');
        label.textContent = 'NAS';
        if (indicator) indicator.title = 'NAS désactivé dans les Paramètres';
        break;
    }
  } catch (e) {
    console.warn('[NAS Indicator] Erreur polling:', e);
  }
}

function startNASPolling() {
  stopNASPolling();
  updateNASIndicator();
  _nasPollingInterval = setInterval(updateNASIndicator, 30000);
}

function stopNASPolling() {
  if (_nasPollingInterval) {
    clearInterval(_nasPollingInterval);
    _nasPollingInterval = null;
  }
}

// Démarrer le polling NAS au chargement + clic sur indicateur → Paramètres
document.addEventListener('DOMContentLoaded', () => {
  startNASPolling();
  const nasInd = document.getElementById('nasIndicator');
  if (nasInd) {
    nasInd.addEventListener('click', () => {
      if (state.selectedProfile) {
        switchView('settings');
      }
    });
  }
});

// ==================== VÉRIFICATION PRÉ-WORKFLOW NAS ====================

async function preWorkflowNASCheck(requiredBytes) {
  if (!window.electronAPI || !window.electronAPI.nasFullDiagnostic) return { ok: true };
  try {
    const diag = await window.electronAPI.nasFullDiagnostic(requiredBytes || 0);
    if (diag.errorKey) {
      const technicalMsg = diag.space
        ? `Espace dispo : ${formatBytes(diag.space.available)} / Requis : ${formatBytes(requiredBytes)}`
        : (diag.path || 'Chemin NAS non configuré');
      const action = await showErrorModal(diag.errorKey, technicalMsg);
      return { ok: action === 'retry', action, diag };
    }
    return { ok: true, diag };
  } catch (e) {
    return { ok: true };
  }
}
