# ==============================================================================
# LCI-SFM Node.js Backend Dockerfile (Node 24 LTS Alpine, Non-Root Execution)
# Uses built-in node:sqlite & crypto.scrypt (zero C++ toolchain bloat)
# ==============================================================================
FROM node:24-alpine

WORKDIR /app

# Create persistent SQLite data directory owned by non-root node user
RUN mkdir -p /app/data && chown -R node:node /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --ignore-scripts && npm cache clean --force

COPY backend ./backend
COPY index.html styles.css app.js ./

RUN chown -R node:node /app
USER node

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV SQLITE_DB_PATH=/app/data/lci_sfm.db
ENV SERVE_FRONTEND=false

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=4s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health/live || exit 1

CMD ["node", "backend/src/server.js"]
