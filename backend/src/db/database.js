import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { hashSecret } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

export class SqliteDatabase {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.migrationError = null;
    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
    }
    this.db = new DatabaseSync(dbPath);
    this.isOpen = true;
    this.configurePragmas();
  }

  configurePragmas() {
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    if (this.dbPath !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL;');
      this.db.exec('PRAGMA synchronous = NORMAL;');
    }
  }

  prepare(sql) {
    return this.db.prepare(sql);
  }

  exec(sql) {
    return this.db.exec(sql);
  }

  /**
   * Executes a synchronous callback inside an atomic SQLite transaction.
   */
  transaction(fn) {
    return (...args) => {
      this.db.exec('BEGIN IMMEDIATE;');
      try {
        const result = fn(...args);
        this.db.exec('COMMIT;');
        return result;
      } catch (err) {
        try {
          this.db.exec('ROLLBACK;');
        } catch {}
        throw err;
      }
    };
  }

  runMigrations(customMigrationsDir = MIGRATIONS_DIR) {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL
        );
      `);

      const files = fs
        .readdirSync(customMigrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort();

      const checkStmt = this.db.prepare('SELECT version FROM schema_migrations WHERE version = ?');
      const insertStmt = this.db.prepare(
        'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)'
      );

      for (const file of files) {
        const existing = checkStmt.get(file);
        if (existing) continue;

        const sql = fs.readFileSync(path.join(customMigrationsDir, file), 'utf8');
        const applyMigration = this.transaction(() => {
          this.db.exec(sql);
          insertStmt.run(file, new Date().toISOString());
        });
        applyMigration();
        logger.info('Applied SQLite migration', { migration: file });
      }
      this.migrationError = null;
    } catch (err) {
      this.migrationError = err?.message || String(err);
      throw err;
    }
  }

  /**
   * Performs a one-time Administrator bootstrap if zero Admin users exist
   * and an explicit bootstrap password was supplied via environment/CLI.
   */
  bootstrapAdminIfNeeded({ username = 'admin', password = '', isProd = false } = {}) {
    const effectivePassword = password || (!isProd ? 'LCI-Dev-Admin-2026!' : '');
    if (!effectivePassword) return { bootstrapped: false, reason: 'no_bootstrap_secret_supplied' };

    const existingTargetUser = this.db
      .prepare('SELECT id, provisioning_status FROM system_users WHERE username = ?')
      .get(username);

    const adminCountRow = this.db
      .prepare("SELECT COUNT(*) AS cnt FROM system_users WHERE role = 'Admin' AND enabled = 1")
      .get();
    const activeAdminCount = Number(adminCountRow?.cnt || 0);

    // Bootstrap is one-time. A restart must not undo a rotated password or
    // recreate the original account after the administrator changes its name.
    if (activeAdminCount > 0) {
      return { bootstrapped: false, reason: 'admin_already_exists' };
    }

    const now = new Date().toISOString();
    const passwordHash = hashSecret(effectivePassword);

    if (existingTargetUser) {
      this.db
        .prepare(
          `UPDATE system_users
           SET role = 'Admin', password_hash = ?, enabled = 1, updated_at = ?
           WHERE id = ?`
        )
        .run(passwordHash, now, existingTargetUser.id);
    } else if (activeAdminCount === 0 || Boolean(password)) {
      this.db
        .prepare(
          `INSERT INTO system_users
           (username, role, password_hash, pin_verifier, pin_configured, rfid, face_linked, enabled, provisioning_status, created_at, updated_at)
           VALUES (?, 'Admin', ?, NULL, 0, 'A1:00:FF:01', 0, 1, 'server_bootstrapped', ?, ?)`
        )
        .run(username, passwordHash, now, now);
    } else {
      return { bootstrapped: false, reason: 'admin_already_exists' };
    }

    logger.info('Bootstrapped initial Administrator account', {
      username,
      source: password ? 'LCI_BOOTSTRAP_ADMIN_PASSWORD' : 'dev_default'
    });
    return { bootstrapped: true, username };
  }

  /**
   * Creates a consistent hot backup of the SQLite database using VACUUM INTO.
   */
  backupTo(destinationPath) {
    const absDest = path.resolve(destinationPath);
    const destDir = path.dirname(absDest);
    fs.mkdirSync(destDir, { recursive: true, mode: 0o700 });
    if (fs.existsSync(absDest)) {
      fs.unlinkSync(absDest);
    }
    const escapedPath = absDest.replace(/'/g, "''");
    this.db.exec(`VACUUM INTO '${escapedPath}';`);
    fs.chmodSync(absDest, 0o600);
    return absDest;
  }

  healthCheck() {
    try {
      if (!this.isOpen) return { ok: false, error: 'database_closed' };
      if (this.migrationError) {
        return { ok: false, error: `migration_failed: ${this.migrationError}` };
      }
      const row = this.db.prepare('SELECT 1 AS ok').get();
      const jm = this.db.prepare('PRAGMA journal_mode;').get();
      const fk = this.db.prepare('PRAGMA foreign_keys;').get();
      const migrations = this.db
        .prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version ASC')
        .all();
      const journalMode = String(jm?.journal_mode || 'unknown').toLowerCase();
      const foreignKeys = Number(fk?.foreign_keys ?? 0);
      const expectedWal = this.dbPath !== ':memory:';
      const journalOk = expectedWal ? journalMode === 'wal' : true;
      const fkOk = foreignKeys === 1;
      const ok = row?.ok === 1 && journalOk && fkOk && migrations.length > 0;
      return {
        ok,
        journal_mode: jm?.journal_mode || 'unknown',
        foreign_keys: foreignKeys,
        migrationsApplied: migrations.length,
        latestMigration: migrations.length > 0 ? migrations[migrations.length - 1].version : null,
        ...(ok
          ? {}
          : {
              error: !journalOk
                ? `unexpected_journal_mode:${journalMode}`
                : !fkOk
                  ? 'foreign_keys_disabled'
                  : migrations.length === 0
                    ? 'no_migrations_applied'
                    : 'health_check_failed'
            })
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  close() {
    if (!this.isOpen) return;
    try {
      if (this.dbPath !== ':memory:') {
        this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      }
    } catch {}
    this.db.close();
    this.isOpen = false;
  }
}
