const { Resend } = require('resend');

class MailerManager {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.resend = apiKey ? new Resend(apiKey) : null;
    this.from = 'BackUpFlow <onboarding@resend.dev>';
    this.adminEmail = 'mpavloff@letudiant.fr';
  }

  setApiKey(apiKey) {
    this.apiKey = apiKey;
    this.resend = apiKey ? new Resend(apiKey) : null;
  }

  isConfigured() {
    return !!this.resend;
  }

  async sendWorkflowSuccess({ toEmail, toName, projectName, gofileLink }) {
    if (!this.isConfigured() || !toEmail) return;
    await this.resend.emails.send({
      from: this.from,
      to: toEmail,
      subject: `Backup terminé — ${projectName}`,
      html: `
        <h2>Backup terminé avec succès</h2>
        <p>Bonjour ${toName},</p>
        <p>Le backup du projet <strong>${projectName}</strong> s'est terminé avec succès.</p>
        ${gofileLink ? `<p>Lien Gofile : <a href="${gofileLink}">${gofileLink}</a></p>` : ''}
        <p style="color:#888;font-size:0.85em;">BackUpFlow Studio — L'Étudiant</p>
      `
    });
  }

  async sendWorkflowStopped({ toEmail, toName, projectName }) {
    if (!this.isConfigured() || !toEmail) return;
    await this.resend.emails.send({
      from: this.from,
      to: toEmail,
      subject: `Backup interrompu — ${projectName}`,
      html: `
        <h2>Backup interrompu</h2>
        <p>Bonjour ${toName},</p>
        <p>Le backup du projet <strong>${projectName}</strong> a été interrompu manuellement.</p>
        <p style="color:#888;font-size:0.85em;">BackUpFlow Studio — L'Étudiant</p>
      `
    });
  }

  async sendErrorReport({ errorTitle, errorTechnical, errorVulgarized, context }) {
    if (!this.isConfigured()) return;
    await this.resend.emails.send({
      from: this.from,
      to: this.adminEmail,
      subject: `[BackUpFlow] Erreur — ${errorTitle}`,
      html: `
        <h2>Erreur majeure détectée</h2>
        <p><strong>Contexte :</strong> ${context || 'Non précisé'}</p>
        <hr>
        <p><strong>Explication :</strong> ${errorVulgarized || '—'}</p>
        <p><strong>Erreur technique :</strong></p>
        <pre style="background:#f1f5f9;padding:12px;border-radius:6px;font-size:0.85em;">${errorTechnical || '—'}</pre>
        <p style="color:#888;font-size:0.85em;">BackUpFlow Studio — L'Étudiant</p>
      `
    });
  }

  async sendBatchSummaryMail({ toEmail, toName, projects }) {
    if (!this.isConfigured() || !toEmail) return { success: false, error: 'Non configuré' };
    try {
      const projectLines = projects.map(p => {
        const status = p.status === 'partial' ? 'Partiel (NAS échoué)' : 'Complet';
        const gofile = p.gofileLink
          ? `<br><a href="${p.gofileLink}" style="color:#2563eb;">Lien Gofile</a>`
          : '';
        return `<li style="margin-bottom:12px;"><strong>${p.projectName}</strong> — ${status}${gofile}</li>`;
      }).join('');

      const html = `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
          <h2 style="color:#1e293b;">Batch terminé</h2>
          <p>Bonjour ${toName},</p>
          <p>${projects.length} projet(s) traité(s) avec succès :</p>
          <ul style="padding-left:20px;">${projectLines}</ul>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
          <p style="color:#94a3b8;font-size:12px;">BackUpFlow Studio — L'Étudiant</p>
        </div>`;

      const { data, error } = await this.resend.emails.send({
        from: this.from,
        to: toEmail,
        subject: `Batch terminé — ${projects.length} projet(s)`,
        html
      });

      if (error) return { success: false, error: error.message };
      return { success: true, id: data?.id };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

module.exports = MailerManager;
