# LCI-SFM Node.js backend container.
# Install only backend dependencies; do not require a root package-lock.json.
FROM node:24-alpine

WORKDIR /app

RUN mkdir -p /app/data && chown -R node:node /app

COPY backend/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts && npm cache clean --force

COPY backend ./backend

RUN chown -R node:node /app
USER node

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV SQLITE_DB_PATH=/app/data/lci_sfm.db
ENV SERVE_FRONTEND=false

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=4s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health/live').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "backend/src/server.js"]
