import { WebSocketServer, WebSocket } from 'ws';
import { logger } from '../utils/logger.js';

const MAX_BUFFERED_BYTES = 256 * 1024; // 256 KB backpressure threshold per client

export class WsGateway {
  constructor({ authMiddleware, requireWsAuth = true }) {
    this.authMiddleware = authMiddleware;
    this.requireWsAuth = requireWsAuth;

    this.telemetryWss = new WebSocketServer({ noServer: true });
    this.mfaWss = new WebSocketServer({ noServer: true });

    // Map<WebSocket, { channel, sessionId, userId, username, role, connectedAt }>
    this.clients = new Map();

    this._setupServer(this.telemetryWss, 'telemetry');
    this._setupServer(this.mfaWss, 'mfa');
  }

  _setupServer(wss, channel) {
    wss.on('connection', (ws, req, session) => {
      const meta = {
        channel,
        sessionId: session?.sessionId || null,
        userId: session?.user?.id || null,
        username: session?.user?.username || 'anonymous',
        role: session?.user?.role || 'Viewer',
        connectedAt: Date.now()
      };
      this.clients.set(ws, meta);

      ws.on('close', () => {
        this.clients.delete(ws);
      });

      ws.on('error', (err) => {
        logger.warn('WebSocket client error', {
          channel,
          username: meta.username,
          error: err?.message
        });
        this.clients.delete(ws);
      });
    });
  }

  attachToServer(httpServer) {
    httpServer.on('upgrade', (req, socket, head) => {
      let pathname = '/';
      try {
        const parsed = new URL(req.url || '/', 'http://localhost');
        pathname = parsed.pathname;
      } catch {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }

      if (pathname !== '/ws/telemetry' && pathname !== '/ws/mfa') {
        // Ignore non-LCI WebSocket paths (e.g., Vite dev HMR if any)
        return;
      }

      const session = this.authMiddleware.authenticateWsUpgrade(req);
      if (this.requireWsAuth && !session) {
        socket.write(
          'HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'
        );
        socket.destroy();
        return;
      }

      const targetWss = pathname === '/ws/telemetry' ? this.telemetryWss : this.mfaWss;
      targetWss.handleUpgrade(req, socket, head, (ws) => {
        targetWss.emit('connection', ws, req, session);
      });
    });
  }

  broadcastTelemetry(payload) {
    return this._broadcastToChannel('telemetry', payload);
  }

  broadcastMfa(payload) {
    return this._broadcastToChannel('mfa', payload);
  }

  _broadcastToChannel(channel, payload) {
    const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
    let sentCount = 0;

    for (const [ws, meta] of this.clients.entries()) {
      if (meta.channel !== channel) continue;
      if (ws.readyState !== WebSocket.OPEN) {
        this.clients.delete(ws);
        continue;
      }
      if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
        logger.warn('Dropping slow WebSocket client due to backpressure threshold', {
          channel,
          username: meta.username,
          bufferedAmount: ws.bufferedAmount
        });
        ws.close(1008, 'Backpressure limit exceeded');
        this.clients.delete(ws);
        continue;
      }
      ws.send(serialized);
      sentCount += 1;
    }
    return sentCount;
  }

  disconnectSession(sessionId) {
    if (!sessionId) return 0;
    let closed = 0;
    for (const [ws, meta] of this.clients.entries()) {
      if (meta.sessionId === sessionId) {
        ws.close(4001, 'Session revoked or logged out');
        this.clients.delete(ws);
        closed += 1;
      }
    }
    return closed;
  }

  disconnectUser(userId) {
    if (userId === undefined || userId === null) return 0;
    let closed = 0;
    for (const [ws, meta] of this.clients.entries()) {
      if (meta.userId === Number(userId)) {
        ws.close(4002, 'User credentials or role updated');
        this.clients.delete(ws);
        closed += 1;
      }
    }
    return closed;
  }

  getStats() {
    let telemetryClients = 0;
    let mfaClients = 0;
    for (const meta of this.clients.values()) {
      if (meta.channel === 'telemetry') telemetryClients += 1;
      if (meta.channel === 'mfa') mfaClients += 1;
    }
    return {
      totalClients: this.clients.size,
      telemetryClients,
      mfaClients
    };
  }

  closeAll() {
    for (const [ws] of this.clients.entries()) {
      try {
        ws.terminate();
      } catch {
        // ignore
      }
    }
    this.clients.clear();
    try {
      this.telemetryWss.close();
      this.mfaWss.close();
    } catch {
      // ignore
    }
  }
}
