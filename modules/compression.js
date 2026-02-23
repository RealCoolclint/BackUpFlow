const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const archiver = require('archiver');
const ProgressTracker = require('./progress-tracker');

/**
 * Module de compression et archivage
 */
class CompressionManager {
  constructor(handbrakePath) {
    this.handbrakePath = handbrakePath;
    this.defaultPreset = 'Fast 1080p30';
  }

  /**
   * Compresse une vidéo avec HandBrake CLI avec progression détaillée
   */
  async compressVideo(inputPath, outputPath, preset = null, onProgress = null) {
    if (!this.handbrakePath) {
      throw new Error('HandBrake CLI non trouvé');
    }
    
    const presetToUse = preset || this.defaultPreset;
    const outputDir = path.dirname(outputPath);
    await fs.ensureDir(outputDir);
    
    // Obtenir la taille du fichier source pour estimer l'ETA
    const inputStats = await fs.stat(inputPath);
    const inputSize = inputStats.size;
    const tracker = new ProgressTracker(inputSize);
    
    // Throttling pour les mises à jour (500ms)
    // IMPORTANT: On garde TOUJOURS la dernière valeur de progress pour garantir la continuité
    let lastUpdateTime = 0;
    const UPDATE_INTERVAL = 500; // 500ms
    let pendingUpdate = null;
    let updateTimer = null;
    
    // Fonction pour envoyer les mises à jour avec throttling (500ms)
    // Garantit que la progression est toujours mise à jour de manière continue
    const sendUpdate = (updateData) => {
      // IMPORTANT: Toujours fusionner les données, mais TOUJOURS garder le progress le plus récent
      // Les nouvelles données écrasent les anciennes, SAUF si progress est plus récent
      if (pendingUpdate) {
        // Fusionner intelligemment: garder la valeur de progress la plus récente
        if (updateData.progress !== undefined) {
          pendingUpdate.progress = updateData.progress; // Toujours prendre le dernier progress
        }
        // Fusionner toutes les autres données
        pendingUpdate = { 
          ...pendingUpdate, 
          ...updateData,
          progress: updateData.progress !== undefined ? updateData.progress : pendingUpdate.progress
        };
      } else {
        pendingUpdate = { ...updateData };
      }
      
      const now = Date.now();
      const timeSinceLastUpdate = now - lastUpdateTime;
      
      if (timeSinceLastUpdate >= UPDATE_INTERVAL || lastUpdateTime === 0) {
        // Envoyer immédiatement si intervalle atteint ou première mise à jour
        if (onProgress && pendingUpdate) {
          try {
            // DEBUG OPTION 1: Logger le progress avant envoi via callback
            console.log(`[HandBrake Progress] CALLING onProgress with:`, {
              progress: pendingUpdate.progress,
              status: pendingUpdate.status,
              file: pendingUpdate.file,
              fps: pendingUpdate.fps,
              avgFps: pendingUpdate.avgFps,
              eta: pendingUpdate.eta
            });
            onProgress(pendingUpdate);
            console.log(`[HandBrake Progress] onProgress callback completed`);
          } catch (error) {
            console.error('[HandBrake Progress] Erreur dans onProgress:', error);
          }
        }
        pendingUpdate = null;
        lastUpdateTime = now;
        
        // Annuler le timer s'il existe
        if (updateTimer) {
          clearTimeout(updateTimer);
          updateTimer = null;
        }
      } else {
        // Programmer l'envoi si pas de timer en cours
        if (!updateTimer) {
          const delay = UPDATE_INTERVAL - timeSinceLastUpdate;
          console.log(`[HandBrake Progress] Throttling: scheduling update in ${delay}ms`);
          updateTimer = setTimeout(() => {
            if (onProgress && pendingUpdate) {
              try {
                // DEBUG OPTION 1: Logger le progress avant envoi via callback (throttled)
                console.log(`[HandBrake Progress] CALLING onProgress (throttled) with:`, {
                  progress: pendingUpdate.progress,
                  status: pendingUpdate.status,
                  file: pendingUpdate.file,
                  fps: pendingUpdate.fps,
                  avgFps: pendingUpdate.avgFps,
                  eta: pendingUpdate.eta
                });
                onProgress(pendingUpdate);
                console.log(`[HandBrake Progress] onProgress callback (throttled) completed`);
              } catch (error) {
                console.error('[HandBrake Progress] Erreur dans onProgress (throttled):', error);
              }
            }
            pendingUpdate = null;
            lastUpdateTime = Date.now();
            updateTimer = null;
          }, delay);
        }
      }
    };
    
    // Utiliser spawn au lieu de exec pour un meilleur contrôle sur les streams en temps réel
    // HandBrake envoie la progression sur stderr principalement
    const args = [
      '-i', inputPath,
      '-o', outputPath,
      '--preset', presetToUse
    ];
    
    return new Promise((resolve, reject) => {
      const handbrakeProcess = spawn(this.handbrakePath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false
      });
      let errorOutput = '';
      const startTime = Date.now();
      
      // Buffer pour accumuler les données multi-lignes
      let stdoutBuffer = '';
      let stderrBuffer = '';
      
      // Traitement en temps réel des streams
      // Configurer les encodages UTF-8 pour un traitement immédiat
      handbrakeProcess.stdout.setEncoding('utf8');
      handbrakeProcess.stderr.setEncoding('utf8');
      
      // DEBUG: Stocker toutes les lignes pour analyse
      const allLines = [];
      
      // Fonction pour traiter immédiatement une ligne complète avec toutes les infos HandBrake
      const processHandBrakeLine = (line, isStderr = false) => {
        const trimmedLine = line.trim();
        if (!trimmedLine) return;
        
        // DEBUG OPTION 2: Logger TOUTES les lignes reçues pour voir le format réel
        allLines.push({ line: trimmedLine, source: isStderr ? 'stderr' : 'stdout', timestamp: new Date().toISOString() });
        
        // IGNORER les lignes de log qui ne sont pas des lignes de progression
        // Exemples à ignorer: "[14:58:38] sync: first pts audio 0x1 is 0"
        // On cherche UNIQUEMENT les lignes qui contiennent "Encoding: task" avec un pourcentage
        // et idéalement aussi des infos de FPS et ETA
        
        // Parser UNIQUEMENT les lignes de progression HandBrakeCLI
        // Format typique: "Encoding: task 1 of 1, 0.10 % (4.77 fps, avg 5.60 fps, ETA 20h20m31s)"
        // OU: "Encoding: task 1 of 1, 45.67 % (25.43 fps, avg 24.89 fps, ETA 00h15m23s)"
        // Regex: doit contenir "Encoding:" ET "task" ET un pourcentage ET idéalement "fps"
        // On vérifie d'abord si c'est bien une ligne de progression (contient "Encoding: task")
        const isProgressLine = /Encoding:\s*task/.test(trimmedLine);
        
        if (!isProgressLine) {
          // Ignorer les autres lignes (logs, infos, etc.) - réduire les logs pour performance
          // console.log(`[HandBrake DEBUG] Ignoring non-progress line: ${trimmedLine.substring(0, 50)}`);
          return;
        }
        
        // Maintenant on parse la ligne de progression complète
        // Format: "Encoding: task X of Y, Z.ZZ % (FPS fps, avg AVG_FPS fps, ETA ETA_STRING)"
        const progressMatch = line.match(/Encoding:\s*task\s+(\d+)\s+of\s+(\d+),\s*(\d+\.\d+)\s*%/);
        
        console.log(`[HandBrake DEBUG] Progress match result:`, progressMatch ? `Found! task ${progressMatch[1]}/${progressMatch[2]}, ${progressMatch[3]}%` : 'NO MATCH');
        
        if (!progressMatch || !onProgress) {
          console.log(`[HandBrake DEBUG] No match or no onProgress callback`);
          return; // Si pas de match de progression, ignorer
        }
        
        const taskNumber = parseInt(progressMatch[1]);
        const taskTotal = parseInt(progressMatch[2]);
        const progressPercent = parseFloat(progressMatch[3]);
        
        console.log(`[HandBrake DEBUG] Parsed values - taskNumber: ${taskNumber}, taskTotal: ${taskTotal}, progressPercent: ${progressPercent}%`);
        
        // IMPORTANT: S'assurer que progressPercent est valide (entre 0 et 100)
        if (isNaN(progressPercent) || progressPercent < 0 || progressPercent > 100) {
          console.warn(`[HandBrake] Progress invalide: ${progressPercent}%`);
          return; // Ignorer les valeurs invalides
        }
        
        // Extraire toutes les infos disponibles avec des regex améliorées
        // FPS actuel: format "(4.77 fps)" ou "(25.43 fps)"
        const fpsMatch = line.match(/\((\d+\.\d+)\s+fps/);
        const currentFps = fpsMatch ? parseFloat(fpsMatch[1]) : null;
        
        // FPS moyen: format "avg 5.60 fps" ou "avg 24.89 fps"
        const avgFpsMatch = line.match(/avg\s+(\d+\.\d+)\s+fps/);
        const avgFps = avgFpsMatch ? parseFloat(avgFpsMatch[1]) : null;
        
        // ETA: format "ETA 20h20m31s" ou "ETA 00h15m23s" ou "ETA 15m23s" ou "ETA 23s"
        const etaMatch = line.match(/ETA\s+((\d+)h)?((\d+)m)?((\d+)s)?/);
        let handbrakeETA = null;
        let etaFormatted = null;
        if (etaMatch) {
          const hours = etaMatch[2] ? parseInt(etaMatch[2]) : 0;
          const minutes = etaMatch[4] ? parseInt(etaMatch[4]) : 0;
          const seconds = etaMatch[6] ? parseInt(etaMatch[6]) : 0;
          handbrakeETA = hours * 3600 + minutes * 60 + seconds;
          // Formater l'ETA comme dans HandBrake (00h15m23s)
          if (hours > 0) {
            etaFormatted = `${hours.toString().padStart(2, '0')}h${minutes.toString().padStart(2, '0')}m${seconds.toString().padStart(2, '0')}s`;
          } else if (minutes > 0) {
            etaFormatted = `${minutes.toString().padStart(2, '0')}m${seconds.toString().padStart(2, '0')}s`;
          } else {
            etaFormatted = `${seconds.toString().padStart(2, '0')}s`;
          }
        }
        
        // Mettre à jour le tracker
        const processed = (progressPercent / 100) * inputSize;
        tracker.update(processed);
        const info = tracker.getProgressInfo();
        
        // Préparer les données de mise à jour
        const updateData = {
          file: path.basename(inputPath),
          progress: progressPercent, // Pourcentage EXACT de HandBrakeCLI (0.10, 0.20, etc.)
          status: 'compressing',
          taskNumber: taskNumber,
          taskTotal: taskTotal,
          processed: info.processedFormatted,
          total: info.totalFormatted,
          speed: info.speedFormatted,
          eta: etaFormatted || (handbrakeETA ? this.formatTime(handbrakeETA) : info.etaFormatted),
          elapsed: info.elapsedFormatted,
          fps: currentFps ? currentFps.toFixed(2) : null, // FPS actuel depuis HandBrake
          avgFps: avgFps ? avgFps.toFixed(2) : null, // FPS moyen depuis HandBrake
          handbrakeLine: line.trim(), // Ligne complète pour debug
          taskInfo: `task ${taskNumber} of ${taskTotal}`
        };
        
        // DEBUG OPTION 1: Logger les données avant envoi
        console.log(`[HandBrake DEBUG] Sending update with progress: ${updateData.progress}%`, {
          file: updateData.file,
          progress: updateData.progress,
          fps: updateData.fps,
          avgFps: updateData.avgFps,
          eta: updateData.eta,
          handbrakeLine: updateData.handbrakeLine
        });
        
        // Envoyer avec throttling (500ms)
        sendUpdate(updateData);
      };
      
      // Traitement stdout - HandBrake peut envoyer des infos ici aussi
      handbrakeProcess.stdout.on('data', (chunk) => {
        stdoutBuffer += chunk;
        
        // CRITICAL FIX: HandBrake utilise \r (retour chariot) pour écraser les lignes précédentes
        // Il faut split par \r ET \n pour capturer toutes les lignes de progression
        // D'abord split par \n, puis par \r dans chaque partie
        let lines = [];
        const newlineParts = stdoutBuffer.split('\n');
        stdoutBuffer = newlineParts.pop() || '';
        
        for (const part of newlineParts) {
          // Split également par \r pour capturer les lignes écrasées
          const crParts = part.split('\r');
          lines.push(...crParts);
        }
        
        // Traiter aussi les \r dans le buffer restant
        const remainingCrParts = stdoutBuffer.split('\r');
        if (remainingCrParts.length > 1) {
          lines.push(...remainingCrParts.slice(0, -1));
          stdoutBuffer = remainingCrParts[remainingCrParts.length - 1];
        }
        
        for (const line of lines) {
          if (line.trim()) {
            processHandBrakeLine(line, false);
          }
        }
      });
      
      // Traitement stderr - HandBrake envoie principalement la progression ici
      handbrakeProcess.stderr.on('data', (chunk) => {
        errorOutput += chunk;
        stderrBuffer += chunk;
        
        // CRITICAL FIX: HandBrake utilise \r (retour chariot) pour écraser les lignes précédentes
        // Il faut split par \r ET \n pour capturer toutes les lignes de progression
        // D'abord split par \n, puis par \r dans chaque partie
        let lines = [];
        const newlineParts = stderrBuffer.split('\n');
        stderrBuffer = newlineParts.pop() || '';
        
        for (const part of newlineParts) {
          // Split également par \r pour capturer les lignes écrasées
          const crParts = part.split('\r');
          lines.push(...crParts);
        }
        
        // Traiter aussi les \r dans le buffer restant
        const remainingCrParts = stderrBuffer.split('\r');
        if (remainingCrParts.length > 1) {
          lines.push(...remainingCrParts.slice(0, -1));
          stderrBuffer = remainingCrParts[remainingCrParts.length - 1];
        }
        
        for (const line of lines) {
          if (line.trim()) {
            processHandBrakeLine(line, true);
          }
        }
      });
      
      // Traiter les dernières données des buffers avant la fin
      handbrakeProcess.on('close', async (code) => {
        // Traiter les dernières lignes incomplètes
        // Utiliser la même logique que processHandBrakeLine pour filtrer les vraies lignes de progression
        const processFinalLine = (line) => {
          if (!line.trim()) return;
          
          // Vérifier que c'est bien une ligne de progression (comme dans processHandBrakeLine)
          const isProgressLine = /Encoding:\s*task/.test(line);
          if (!isProgressLine) return;
          
          const progressMatch = line.match(/Encoding:\s*task\s+(\d+)\s+of\s+(\d+),\s*(\d+\.\d+)\s*%/);
          if (progressMatch && onProgress) {
            const progressPercent = parseFloat(progressMatch[3]);
            if (!isNaN(progressPercent) && progressPercent >= 0 && progressPercent <= 100) {
              // Extraire aussi FPS et ETA si présents
              const fpsMatch = line.match(/\((\d+\.\d+)\s+fps/);
              const avgFpsMatch = line.match(/avg\s+(\d+\.\d+)\s+fps/);
              const etaMatch = line.match(/ETA\s+((\d+)h)?((\d+)m)?((\d+)s)?/);
              
              let etaFormatted = null;
              if (etaMatch) {
                const hours = etaMatch[2] ? parseInt(etaMatch[2]) : 0;
                const minutes = etaMatch[4] ? parseInt(etaMatch[4]) : 0;
                const seconds = etaMatch[6] ? parseInt(etaMatch[6]) : 0;
                if (hours > 0) {
                  etaFormatted = `${hours.toString().padStart(2, '0')}h${minutes.toString().padStart(2, '0')}m${seconds.toString().padStart(2, '0')}s`;
                } else if (minutes > 0) {
                  etaFormatted = `${minutes.toString().padStart(2, '0')}m${seconds.toString().padStart(2, '0')}s`;
                } else {
                  etaFormatted = `${seconds.toString().padStart(2, '0')}s`;
                }
              }
              
              const info = tracker.getProgressInfo();
              onProgress({
                file: path.basename(inputPath),
                progress: progressPercent,
                status: 'compressing',
                fps: fpsMatch ? parseFloat(fpsMatch[1]).toFixed(2) : null,
                avgFps: avgFpsMatch ? parseFloat(avgFpsMatch[1]).toFixed(2) : null,
                eta: etaFormatted || info.etaFormatted,
                elapsed: info.elapsedFormatted,
                handbrakeLine: line.trim()
              });
            }
          }
        };
        
        if (stdoutBuffer.trim()) {
          const lines = stdoutBuffer.split('\n');
          for (const line of lines) {
            processFinalLine(line);
          }
        }
        if (stderrBuffer.trim()) {
          const lines = stderrBuffer.split('\n');
          for (const line of lines) {
            processFinalLine(line);
          }
        }
        
        // DEBUG OPTION 2: Logger toutes les lignes capturées
        console.log(`[HandBrake DEBUG] Process finished with code ${code}`);
        console.log(`[HandBrake DEBUG] Total lines captured: ${allLines.length}`);
        console.log(`[HandBrake DEBUG] Progress lines found:`, allLines.filter(l => /Encoding:\s*task/.test(l.line)).length);
        if (allLines.length > 0) {
          console.log(`[HandBrake DEBUG] First 10 lines:`, allLines.slice(0, 10).map(l => `${l.source}: ${l.line.substring(0, 100)}`));
        }
        
        // Envoyer toute mise à jour en attente avant de terminer
        if (updateTimer) {
          clearTimeout(updateTimer);
          updateTimer = null;
        }
        if (pendingUpdate && onProgress) {
          try {
            console.log(`[HandBrake Progress] Sending final pending update:`, pendingUpdate);
            onProgress(pendingUpdate);
          } catch (error) {
            console.error('Erreur dans onProgress (pending):', error);
          }
        }
        
        if (code === 0) {
          // Mise à jour finale à 100%
          tracker.update(inputSize);
          if (onProgress) {
            const info = tracker.getProgressInfo();
            try {
              console.log(`[HandBrake Progress] Sending final 100% update`);
              onProgress({
                file: path.basename(inputPath),
                progress: 100,
                status: 'completed',
                elapsed: info.elapsedFormatted
              });
            } catch (error) {
              console.error('Erreur dans onProgress callback (final):', error);
            }
          }
          resolve({ success: true, outputPath });
        } else {
          reject(new Error(`HandBrake a terminé avec le code ${code}: ${errorOutput.substring(0, 500)}`));
        }
      });
      
      handbrakeProcess.on('error', (error) => {
        reject(new Error(`Erreur lors du lancement de HandBrake: ${error.message}`));
      });
    });
  }

  /**
   * Compresse plusieurs vidéos
   */
  async compressVideos(videoFiles, outputDir, preset = null, onProgress = null) {
    const results = [];
    
    for (const videoFile of videoFiles) {
      if (!videoFile.type || videoFile.type !== 'video') {
        // Copier les fichiers non-vidéo directement
        const fileName = path.basename(videoFile.path);
        const destPath = path.join(outputDir, fileName);
        await fs.copy(videoFile.path, destPath);
        results.push({ original: videoFile, compressed: destPath, skipped: true });
        continue;
      }
      
      const fileName = path.basename(videoFile.path);
      const ext = path.extname(fileName);
      const nameWithoutExt = path.basename(fileName, ext);
      const outputPath = path.join(outputDir, `${nameWithoutExt}_compressed.mp4`);
      
      try {
        await this.compressVideo(videoFile.path, outputPath, preset, (progress) => {
          if (onProgress) {
            onProgress({
              file: fileName,
              ...progress
            });
          }
        });
        
        results.push({ original: videoFile, compressed: outputPath, success: true });
      } catch (error) {
        results.push({ original: videoFile, error: error.message, success: false });
      }
    }
    
    return results;
  }

  /**
   * Crée un fichier ZIP à partir d'un dossier avec progression détaillée
   */
  async createZip(sourceDir, zipPath, onProgress = null) {
    // Calculer la taille totale à archiver
    let totalSize = 0;
    const calculateSize = async (dir) => {
      const items = await fs.readdir(dir);
      for (const item of items) {
        const itemPath = path.join(dir, item);
        const stats = await fs.stat(itemPath);
        if (stats.isDirectory()) {
          await calculateSize(itemPath);
        } else {
          totalSize += stats.size;
        }
      }
    };
    await calculateSize(sourceDir);
    
    const tracker = new ProgressTracker(totalSize);
    
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', {
        zlib: { level: 9 } // Compression maximale
      });
      
      let hasError = false;
      
      output.on('close', () => {
        if (hasError) return;
        
        tracker.update(totalSize);
        
        // Vérifier que le ZIP est valide
        const finalSize = archive.pointer();
        if (finalSize === 0) {
          hasError = true;
          reject(new Error('Le fichier ZIP créé est vide'));
          return;
        }
        
        if (onProgress) {
          const info = tracker.getProgressInfo();
          onProgress({
            progress: 100,
            status: 'completed',
            processed: info.processedFormatted,
            total: info.totalFormatted,
            elapsed: info.elapsedFormatted
          });
        }
        resolve({
          success: true,
          zipPath,
          size: finalSize
        });
      });
      
      output.on('error', (err) => {
        hasError = true;
        reject(err);
      });
      
      archive.on('error', (err) => {
        hasError = true;
        reject(err);
      });
      
      if (onProgress) {
        archive.on('progress', (progress) => {
          const processed = progress.fs.processedBytes || 0;
          tracker.update(processed);
          
          const info = tracker.getProgressInfo();
          onProgress({
            progress: info.progress,
            entriesProcessed: progress.entries.processed,
            entriesTotal: progress.entries.total,
            processed: info.processedFormatted,
            total: info.totalFormatted,
            speed: info.speedFormatted,
            eta: info.etaFormatted,
            elapsed: info.elapsedFormatted
          });
        });
      }
      
      archive.pipe(output);
      archive.directory(sourceDir, false);
      
      // Finaliser l'archive et attendre que tous les fichiers soient écrits
      archive.finalize().catch((err) => {
        hasError = true;
        reject(err);
      });
    });
  }

  /**
   * Pipeline complet: compression + création du dossier + ZIP
   * @param {string} projectName - Nom du projet
   * @param {Array} files - Fichiers à traiter
   * @param {string} tempDir - Dossier temporaire
   * @param {string} preset - Prését HandBrake
   * @param {Function} onProgress - Callback de progression
   * @param {string} audioBackupPath - Chemin optionnel vers un fichier audio .wav à ajouter
   */
  async createProjectArchive(projectName, files, tempDir, preset = null, onProgress = null, audioBackupPath = null, checkAborted = null) {
    // Créer le dossier temporaire du projet
    const projectTempDir = path.join(tempDir, projectName);
    await fs.remove(projectTempDir);
    await fs.ensureDir(projectTempDir);
    
    // Séparer les vidéos et autres fichiers
    const videoFiles = files.filter(f => f.type === 'video');
    const otherFiles = files.filter(f => f.type !== 'video');
    
    // Copier les fichiers non-vidéo
    for (const file of otherFiles) {
      if (checkAborted) checkAborted();
      const fileName = path.basename(file.path);
      await fs.copy(file.path, path.join(projectTempDir, fileName));
    }
    
    if (onProgress) {
      onProgress({ step: 'copying_non_video', progress: 50 });
    }
    
    // Renommer les vidéos compressées avec le nom du projet
    // Modifier compressVideos pour accepter un projectName
    const compressionResults = await this.compressVideosWithProjectName(
      videoFiles,
      projectTempDir,
      projectName,
      preset,
      (progress) => {
        if (onProgress) {
          onProgress({
            step: 'compressing',
            ...progress
          });
        }
      }
    );
    
    // Créer le ZIP avec le nom du projet
    const zipPath = path.join(tempDir, `${projectName}.zip`);
    
    if (onProgress) {
      onProgress({ step: 'creating_zip_nas', progress: 0, message: 'Création du ZIP pour le NAS...' });
    }
    
    const zipResult = await this.createZip(projectTempDir, zipPath, (progress) => {
      if (onProgress) {
        onProgress({
          step: 'creating_zip_nas',
          progress: progress.progress || (progress.bytesTotal > 0 
            ? (progress.bytesProcessed / progress.bytesTotal) * 100 
            : 0),
          message: `Création du ZIP NAS... ${Math.round(progress.progress || 0)}%`,
          processed: progress.processed,
          total: progress.total,
          speed: progress.speed,
          eta: progress.eta,
          elapsed: progress.elapsed
        });
      }
    });
    
    return {
      projectDir: projectTempDir,
      zipPath: zipResult.zipPath,
      zipSize: zipResult.size,
      compressionResults
    };
  }

  /**
   * Compresse plusieurs vidéos et les renomme avec le nom du projet
   * Ajoute un suffixe numérique (1, 2, etc.) pour différencier les fichiers multiples
   */
  async compressVideosWithProjectName(videoFiles, outputDir, projectName, preset = null, onProgress = null) {
    const results = [];
    
    // Filtrer uniquement les vidéos pour la numérotation
    const actualVideoFiles = videoFiles.filter(f => {
      const ext = path.extname(f.path).toLowerCase();
      return (ext === '.mp4' || f.type === 'video') && f.type === 'video';
    });
    
    let videoIndex = 0;
    
    for (const videoFile of videoFiles) {
      if (!videoFile.type || videoFile.type !== 'video') {
        // Copier les fichiers non-vidéo directement
        const fileName = path.basename(videoFile.path);
        const destPath = path.join(outputDir, fileName);
        await fs.copy(videoFile.path, destPath);
        results.push({ original: videoFile, compressed: destPath, skipped: true });
        continue;
      }
      
      // Pour les vidéos .mp4, utiliser le nom du projet avec suffixe numérique
      const ext = path.extname(videoFile.path).toLowerCase();
      let outputFileName;
      
      if (ext === '.mp4') {
        // Utiliser le nom du projet avec suffixe numérique pour les .mp4
        outputFileName = `${projectName}_${videoIndex + 1}.mp4`;
      } else {
        // Pour les autres formats, garder le nom original + _compressed
        const originalName = path.basename(videoFile.path, ext);
        outputFileName = `${originalName}_compressed.mp4`;
      }
      
      const outputPath = path.join(outputDir, outputFileName);
      videoIndex++;
      
      try {
        await this.compressVideo(videoFile.path, outputPath, preset, (progress) => {
          if (onProgress) {
            onProgress({
              file: path.basename(videoFile.path),
              ...progress
            });
          }
        });
        
        results.push({ original: videoFile, compressed: outputPath, success: true });
      } catch (error) {
        results.push({ original: videoFile, error: error.message, success: false });
      }
    }
    
    return results;
  }

  /**
   * Formate un temps en secondes vers un format lisible
   */
  formatTime(seconds) {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    if (mins < 60) return `${mins}m ${secs}s`;
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hours}h ${remainingMins}m`;
  }
}

module.exports = CompressionManager;

