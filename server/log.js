export function log(level, ...args) {
  const ts = new Date().toISOString();
  console.log(`${ts} [${level}]`, ...args);
}

export const info  = (...a) => log('INFO ', ...a);
export const warn  = (...a) => log('WARN ', ...a);
export const error = (...a) => log('ERROR', ...a);
