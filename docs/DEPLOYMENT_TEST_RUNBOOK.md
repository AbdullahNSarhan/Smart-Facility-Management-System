# Deployment Validation and Test-Server Runbook

This guide separates automated release checks from the checks that must be run on the real test host. A green GitHub Actions run is evidence that the current source passed the workflow on an ephemeral Linux runner; it is not proof that the project server has been updated.

## What GitHub Actions validates

The `deployment-validation.yml` workflow runs for pull requests to `main` and pushes to `main`. It checks:

- Git executable modes for `install.sh` and `update.sh`, Bash syntax, required deployment files, and that local secret files are not tracked.
- Frontend dependency installation, lint, backend automated tests, and production frontend build.
- A fresh, isolated Docker Compose deployment using generated test-only credentials.
- Backend/SQLite readiness, frontend HTTP response, initial Admin login, and SQLite backup integrity.
- A deliberately broken candidate that must fail before deployment, followed by a valid candidate update against a temporary local Git remote. The valid update must create a verified backup, publish the tested frontend build, and leave services healthy.

The workflow uses a dedicated Compose project name and a throwaway runner. It is not intended to point at a persistent host, and its temporary credentials must never be reused.

## Test-server checklist after merging

Run these commands on the **test server**, not the main server:

```bash
cd /opt/lci-sfm
git status --short
git ls-files -s -- install.sh update.sh
docker compose ps
curl -fsS http://127.0.0.1/api/health/live
curl -fsS http://127.0.0.1/api/health/ready
```

The two script entries should show Git mode `100755`. The working-tree check should be empty before an update. The readiness JSON should report `ok: true` and SQLite should report `ok: true`.

Then run the guarded updater:

```bash
sudo /opt/lci-sfm/update.sh
```

If the test server is already at the exact remote commit, the updater intentionally exits without rebuilding or restarting anything. After merging a new commit, it acquires the shared lock (`/var/lock/lci-sfm-deploy.lock`), tests that candidate in a temporary worktree (`npm ci`, `npm --prefix backend ci`, `npm run lint`, `npm test`, `npm --prefix backend test`, `npm run build`), verifies Compose configuration, creates and checks a SQLite backup, backs up the existing `dist/` directory, fast-forwards the checkout, publishes the tested `dist/` build, redeploys, and checks readiness (`ok: true`, `status: "ready"`, `sqlite.ok: true`, `mqtt.connected: true`, `mqtt.subscriptions_ready: true`) and the dashboard URL.

After a successful update, manually log in to the dashboard and confirm that expected test data is present. If your test setup includes MQTT devices, check broker authentication and actual device telemetry separately; a healthy SQLite/API endpoint is not proof that physical devices are connected.

## If an update reports an error

First capture the complete updater output and inspect:

```bash
cd /opt/lci-sfm
docker compose ps
docker compose logs --tail=150 backend mqtt-service frontend_dashboard
ls -lah backups/
```

Do **not** run `docker compose down -v`, `git clean`, or an unreviewed `git reset --hard`. These can remove persistent data or local files. The updater prints the backup path when it has created one. Preserve that file and run an SQLite integrity check before relying on it.

If a failure happens after the candidate commit was merged or after the new `dist/` bundle was published, `update.sh`'s recovery trap automatically restores the full previous `dist/` directory backup, rewinds the Git checkout to the previous commit (`PREV_COMMIT`) when HEAD is still at the candidate commit and the working tree has no local edits, and attempts to re-bring up the previous container definitions (`docker compose up -d --build`). The live SQLite database is not automatically overwritten during rollback because new migrations may have executed; the verified pre-update backup (`backups/lci_sfm_pre_update_*.db`) is preserved on disk so operators can inspect and restore it explicitly if needed.

## Before using the main server

Do not promote a release merely because the dashboard opens. Confirm that:

- The pull request's required workflow completed successfully on the exact merge commit.
- The test server's update completed and its backup is verified.
- Login, role boundaries, SQLite persistence after a container restart, and MQTT behavior are checked.
- The backup is copied to protected storage outside the server.
- The main server's own `.env`, Mosquitto password file, bind addresses, and firewall rules are reviewed independently.

The main server must have its own credentials and configuration. Never copy CI credentials or commit host-specific secret files to GitHub.
