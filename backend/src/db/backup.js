import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SqliteDatabase } from './database.js';
import { loadConfig } from '../config/env.js';
import { logger } from '../utils/logger.js';

export function verifySqliteFileIntegrity(filePath, { requireCoreTables = false } = {}) {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`SQLite file not found: ${absPath}`);
  }
  const stat = fs.statSync(absPath);
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`SQLite file is empty or not a regular file: ${absPath}`);
  }

  const checkDb = new DatabaseSync(absPath);
  try {
    const integrity = checkDb.prepare('PRAGMA integrity_check;').get();
    if (integrity?.integrity_check !== 'ok') {
      throw new Error(`SQLite file failed integrity_check: ${JSON.stringify(integrity)}`);
    }
    if (requireCoreTables) {
      const tables = checkDb
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('schema_migrations', 'system_users')"
        )
        .all();
      if (!Array.isArray(tables) || tables.length < 2) {
        throw new Error(
          `Backup file "${absPath}" does not contain required LCI-SFM schema tables (schema_migrations, system_users)`
        );
      }
    }
  } finally {
    checkDb.close();
  }
}

export function createDatabaseBackup(sourceDbPath, targetBackupPath) {
  const absSource = path.resolve(sourceDbPath);
  if (!fs.existsSync(absSource)) {
    throw new Error(`Source SQLite database not found: ${absSource}`);
  }
  const sourceStat = fs.statSync(absSource);
  if (!sourceStat.isFile() || sourceStat.size === 0) {
    throw new Error(`Source SQLite database is empty or invalid: ${absSource}`);
  }

  const db = new SqliteDatabase(absSource);
  let out;
  try {
    out = db.backupTo(targetBackupPath);
  } finally {
    db.close();
  }

  verifySqliteFileIntegrity(out);
  fs.chmodSync(out, 0o600);
  logger.info('SQLite database backup completed and verified', {
    sourceDbPath: absSource,
    backupPath: out
  });
  return out;
}

export function restoreDatabaseBackup(backupFilePath, targetDbPath, options = {}) {
  const absBackup = path.resolve(backupFilePath);
  const absTarget = path.resolve(targetDbPath);

  if (absBackup === absTarget) {
    throw new Error('Backup path and target database path must be distinct');
  }

  if (!fs.existsSync(absBackup)) {
    throw new Error(`Backup file not found: ${absBackup}`);
  }

  // Verify integrity and core schema of backup file before overwriting target
  verifySqliteFileIntegrity(absBackup, {
    requireCoreTables: options.requireCoreTables ?? false
  });

  if (options.refuseIfActiveWal && (fs.existsSync(`${absTarget}-wal`) || fs.existsSync(`${absTarget}-shm`))) {
    throw new Error(
      `Refusing to overwrite target database "${absTarget}" while active WAL/SHM files exist. Stop the backend service or checkpoint/close the database first.`
    );
  }

  fs.mkdirSync(path.dirname(absTarget), { recursive: true });
  if (fs.existsSync(absTarget)) {
    const preRestoreCopy = `${absTarget}.pre-restore-${Date.now()}.bak`;
    fs.copyFileSync(absTarget, preRestoreCopy);
    fs.chmodSync(preRestoreCopy, 0o600);
  }
  // Remove stale WAL/SHM files if present
  for (const suffix of ['-wal', '-shm']) {
    if (fs.existsSync(`${absTarget}${suffix}`)) {
      fs.unlinkSync(`${absTarget}${suffix}`);
    }
  }

  fs.copyFileSync(absBackup, absTarget);
  fs.chmodSync(absTarget, 0o600);
  verifySqliteFileIntegrity(absTarget);

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
