// Non-secret, local setup preferences. Collection starts only after a fresh user chooses services.
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export const SETUP_PROVIDER_IDS = ['claude', 'cursor', 'openai', 'antigravity', 'muse', 'gemini'];

function validate(value) {
  if (!value || !Array.isArray(value.selectedProviders) || typeof value.completed !== 'boolean'
      || value.selectedProviders.length > SETUP_PROVIDER_IDS.length
      || value.selectedProviders.some((id) => !SETUP_PROVIDER_IDS.includes(id))
      || (value.completed && !value.selectedProviders.length)) {
    throw Object.assign(new Error('Choose at least one supported service before finishing setup.'), { status: 400, expose: true });
  }
  return { version: 1, selectedProviders: SETUP_PROVIDER_IDS.filter((id) => value.selectedProviders.includes(id)), completed: value.completed };
}

function persist(config, value) {
  const temp = `${config.setupPath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    renameSync(temp, config.setupPath);
  } finally { rmSync(temp, { force: true }); }
  return value;
}

export function loadSetup(config) {
  if (existsSync(config.setupPath)) {
    try {
      const saved = JSON.parse(readFileSync(config.setupPath, 'utf8'));
      if (saved.version !== 1) throw new Error('unsupported setup version');
      return validate(saved);
    }
    catch { return { version: 1, selectedProviders: [], completed: false }; } // damaged settings must not widen collection
  }
  // Existing users keep their readers and are not forced through first-run setup after an upgrade.
  const legacy = existsSync(config.dbPath) || existsSync(config.headless.profileDir);
  return persist(config, { version: 1, selectedProviders: legacy ? [...SETUP_PROVIDER_IDS] : [], completed: legacy });
}

export function updateSetup(config, value) {
  const next = validate(value);
  persist(config, next);
  config.setup = next;
  return next;
}

export function providerEnabled(config, id) {
  return !config.headless.disabled.includes(id) && (!config.setup || config.setup.selectedProviders.includes(id));
}
