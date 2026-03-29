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
    const expires = (session.expiresAfterHours || 8) * 3600 * 1000;
    if (Date.now() - writtenAt.getTime() > expires) {
      return { connected: false, reason: 'expired' };
    }
    // Support format v2 (profile imbriqué) et v1 (rétrocompat)
    const isV2 = session.version === 2 && session.profile;
    return {
      connected: true,
      profileId: isV2 ? session.profile.id : session.profileId,
      profileName: isV2 ? session.profile.name : session.profileName,
      profileRole: isV2 ? session.profile.role : (session.profileRole || 'user'),
      profileAvatar: isV2 ? session.profile.avatar : (session.profileAvatar || null),
      appSettings: isV2 ? (session.profile.appSettings || {}) : {},
      allProfiles: isV2 ? (session.allProfiles || []) : [],
      launcherVersion: session.launcherVersion,
      apiKeys: session.apiKeys || {}
    };
  } catch (e) {
    return { connected: false, reason: 'read_error' };
  }
}

module.exports = { readLauncherSession };
