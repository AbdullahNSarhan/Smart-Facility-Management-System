import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { createBackendContext } from './app.js';
import { logger } from './utils/logger.js';

async function main() {
  const ctx = createBackendContext();
  const { app, httpServer, config, mqttService } = ctx;

  // Serve frontend static assets or Vite middleware when running in unified console mode
  const distPath = path.resolve(process.cwd(), 'dist');
  const rootIndexHtml = path.resolve(process.cwd(), 'index.html');
  const serveFrontend = (process.env.SERVE_FRONTEND ?? 'true') !== 'false';

  if (serveFrontend) {
    if (config.nodeEnv !== 'production' && fs.existsSync(rootIndexHtml)) {
      try {
        const { createServer: createViteServer } = await import('vite');
        const vite = await createViteServer({
          server: { middlewareMode: true, hmr: false },
          appType: 'spa'
        });
        app.use(vite.middlewares);
        logger.info('Mounted Vite development middleware for same-origin frontend console');
      } catch (err) {
        logger.warn('Vite dev middleware unavailable; falling back to compiled dist/ or explicit static frontend files', {
          error: err?.message
        });
        if (fs.existsSync(distPath)) {
          app.use(express.static(distPath));
        } else {
          const allowedRootFiles = new Map([
            ['/', path.join(process.cwd(), 'index.html')],
            ['/index.html', path.join(process.cwd(), 'index.html')],
            ['/styles.css', path.join(process.cwd(), 'styles.css')],
            ['/app.js', path.join(process.cwd(), 'app.js')]
          ]);
          app.use('/public', express.static(path.join(process.cwd(), 'public')));
          app.get(['/', '/index.html', '/styles.css', '/app.js'], (req, res, next) => {
            const target = allowedRootFiles.get(req.path);
            if (target && fs.existsSync(target)) return res.sendFile(target);
            return next();
          });
        }
      }
    } else if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
        res.sendFile(path.join(distPath, 'index.html'));
      });
      logger.info('Serving compiled frontend assets from dist/', { distPath });
    }
  }

  mqttService.connect();

  httpServer.listen(config.port, config.host, () => {
    logger.info('LCI-SFM Backend Server listening', {
      host: config.host,
      port: config.port,
      env: config.nodeEnv,
      sqlite_path: config.sqlitePath,
      mqtt_broker: config.mqttBrokerUrl
    });
  });

  const gracefulShutdown = async (signal) => {
    logger.info(`Received ${signal}; initiating graceful shutdown...`);
    try {
      await ctx.stop();
      logger.info('Graceful shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error('Error during graceful shutdown', { error: err?.message });
      process.exit(1);
    }
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('Fatal startup error in LCI-SFM backend', { error: err?.message || String(err) });
  process.exit(1);
});
