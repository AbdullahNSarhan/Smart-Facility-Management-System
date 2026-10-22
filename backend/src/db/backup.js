import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SqliteDatabase } from './database.js';
import { loadConfig } from '../config/env.js';
import { logger } from '../utils/logger.js';

export function createDatabaseBackup(sourceDbPath, targetBackupPath) {
  const db = new SqliteDatabase(sourceDbPath);
  try {
    const out = db.backupTo(targetBackupPath);
    logger.info('SQLite database backup completed', { sourceDbPath, backupPath: out });
    return out;
  } finally {
    db.close();
  }
}

export function restoreDatabaseBackup(backupFilePath, targetDbPath) {
  const absBackup = path.resolve(backupFilePath);
  const absTarget = path.resolve(targetDbPath);

  if (!fs.existsSync(absBackup)) {
    throw new Error(`Backup file not found: ${absBackup}`);
  }

  // Verify integrity of backup file before overwriting target
  const checkDb = new DatabaseSync(absBackup);
  try {
    const integrity = checkDb.prepare('PRAGMA integrity_check;').get();
    if (integrity?.integrity_check !== 'ok') {
      throw new Error(`Backup file failed SQLite integrity_check: ${JSON.stringify(integrity)}`);
    }
  } finally {
    checkDb.close();
  }

  fs.mkdirSync(path.dirname(absTarget), { recursive: true });
  if (fs.existsSync(absTarget)) {
    const preRestoreCopy = `${absTarget}.pre-restore-${Date.now()}.bak`;
    fs.copyFileSync(absTarget, preRestoreCopy);
  }
  // Remove stale WAL/SHM files if present
  for (const suffix of ['-wal', '-shm']) {
    if (fs.existsSync(`${absTarget}${suffix}`)) {
      fs.unlinkSync(`${absTarget}${suffix}`);
    }
  }

  fs.copyFileSync(absBackup, absTarget);
  logger.info('SQLite database restored from verified backup', {
    backupPath: absBackup,
    targetDbPath: absTarget
  });
  return absTarget;
}

// Allow CLI execution: node backend/src/db/backup.js backup <dest> | restore <src>
if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const cmd = process.argv[2];
  const argPath = process.argv[3];
  if (cmd === 'backup') {
    const dest = argPath || path.resolve(process.cwd(), 'data', `lci_sfm_backup_${Date.now()}.db`);
    createDatabaseBackup(config.sqlitePath, dest);
  } else if (cmd === 'restore') {
    if (!argPath) {
      console.error('Usage: node backend/src/db/backup.js restore <backup_file_path>');
      process.exit(1);
    }
    restoreDatabaseBackup(argPath, config.sqlitePath);
  } else {
    console.error('Usage: node backend/src/db/backup.js [backup <dest_path> | restore <src_path>]');
    process.exit(1);
  }
}
