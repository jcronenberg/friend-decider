export const CREATION_PASSWORDS = (process.env.CREATION_PASSWORD || '')
  .split(',')
  .map(p => p.trim())
  .filter(Boolean);
