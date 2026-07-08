/**
 * Приглушує ЛИШЕ ExperimentalWarning від node:sqlite (модуль стабільний для нашого
 * використання — DatabaseSync/prepared statements/BLOB). Імпортувати ПЕРШИМ у index.ts.
 */
const original = process.emitWarning.bind(process);
(process as any).emitWarning = (warning: any, ...args: any[]) => {
  const msg = typeof warning === 'string' ? warning : warning?.message ?? '';
  if (msg.includes('SQLite is an experimental')) return;
  return (original as any)(warning, ...args);
};
