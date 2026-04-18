export const CREATION_PASSWORDS = (process.env.CREATION_PASSWORD || '')
  .split(',')
  .map(p => p.trim())
  .filter(Boolean);

export const MAX_SESSIONS_PER_IP = parseInt(process.env.MAX_SESSIONS_PER_IP || '5', 10);
export const MAX_TOTAL_SESSIONS = parseInt(process.env.MAX_TOTAL_SESSIONS || '100', 10);
