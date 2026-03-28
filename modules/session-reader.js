const fs = require('fs');
const path = require('path');
const os = require('os');

const SESSION_PATH = path.join(
  os.homedir(),
  'Library', 'Application Support',
  'tranquility-suite', 'session.json'
);
const SESSION_MAX_AGE_HOURS = 8;

async function readLauncherSession() {
  try {
    if (!fs.existsSync(SESSION_PATH)) {
      return { connected: false, reason: 'no_file' };
    }
    const raw = fs.readFileSync(SESSION_PATH, 'utf-8');
    const session = JSON.parse(raw);
    const writtenAt = new Date(session.writtenAt);
    const ageHours = (Date.now() - writtenAt.getTime()) / (1000 * 60 * 60);
    if (ageHours > SESSION_MAX_AGE_HOURS) {
      return { connected: false, reason: 'expired' };
    }
    return {
      connected: true,
      profileId: session.profileId,
      profileName: session.profileName,
      profileRole: session.profileRole || 'user',
      profileAvatar: session.profileAvatar || null,
      launcherVersion: session.launcherVersion,
      apiKeys: session.apiKeys || {}
    };
  } catch (e) {
    return { connected: false, reason: 'read_error' };
  }
}

module.exports = { readLauncherSession };
