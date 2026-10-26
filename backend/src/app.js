import http from 'node:http';
import express from 'express';
import { loadConfig } from './config/env.js';
import { SqliteDatabase } from './db/database.js';
import { SqliteRepository } from './repositories/sqliteRepository.js';
import {
  requestContextMiddleware,
  securityHeadersMiddleware,
  errorHandlerMiddleware
} from './middleware/security.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { WsGateway } from './websocket/wsServer.js';
import { MqttService } from './mqtt/mqttClient.js';
import { CommandCoordinator } from './services/commandCoordinator.js';
import { createApiRouter } from './routes/apiRoutes.js';
import { FacilityManagement } from './services/facilityManagement.js';
import { createManagementRouter } from './routes/managementRoutes.js';

/**
 * Factory creating a self-contained LCI-SFM backend instance
 * (Express app, HTTP server, SQLite database, WebSocket gateway, MQTT service, CommandCoordinator).
 */
export function createBackendContext(configOverrides = {}) {
  const config = loadConfig(configOverrides);

  const db = new SqliteDatabase(config.sqlitePath);
  db.runMigrations();
  db.bootstrapAdminIfNeeded({
    username: config.bootstrapAdminUsername,
    password: config.bootstrapAdminPassword,
    isProd: config.isProd
  });

  const repo = new SqliteRepository(db);
  const authMiddleware = createAuthMiddleware(repo, config);
  const wsGateway = new WsGateway({
    authMiddleware,
    requireWsAuth: configOverrides.requireWsAuth ?? true
  });

  const commandCoordinator = new CommandCoordinator({
    repo,
    mqttService: null,
    wsGateway,
    config
  });

  const mqttService = new MqttService({
    config,
    repo,
    wsGateway,
    commandCoordinator,
    dnsLookup: configOverrides.dnsLookup,
    mqttConnect: configOverrides.mqttConnect
  });

  commandCoordinator.setMqttService(mqttService);

  const management = new FacilityManagement({ db, repo, config, mqttService });
  mqttService.management = management;

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(requestContextMiddleware);
  app.use(securityHeadersMiddleware(config));
  app.use(express.json({ limit: '64kb' }));

  const apiRouter = createApiRouter({
    config,
    db,
    repo,
    authMiddleware,
    mqttService,
    wsGateway,
    commandCoordinator
  });

  app.use('/api/v1', createManagementRouter({ management, authMiddleware, db, snapshotFetch: configOverrides.snapshotFetch }));
  app.use('/api', apiRouter);
  app.use(errorHandlerMiddleware);

  const httpServer = http.createServer(app);
  wsGateway.attachToServer(httpServer);

  async function start() {
    mqttService.connect();
    await new Promise((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(config.port, config.host, () => {
        httpServer.removeListener('error', reject);
        resolve();
      });
    });
    return httpServer.address();
  }

  async function stop() {
    commandCoordinator.shutdown();
    wsGateway.closeAll();
    await mqttService.close();
    await new Promise((resolve) => {
      if (!httpServer.listening) return resolve();
      if (typeof httpServer.closeAllConnections === 'function') {
        httpServer.closeAllConnections();
      }
      httpServer.close(() => resolve());
    });
    db.close();
  }

  return {
    management,
    config,
    db,
    repo,
    authMiddleware,
    wsGateway,
    mqttService,
    commandCoordinator,
    app,
    httpServer,
    start,
    stop
  };
}
