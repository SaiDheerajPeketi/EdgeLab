FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json
COPY backend/auth/package.json backend/auth/package.json
RUN npm ci --omit=dev --no-audit --no-fund \
    && mkdir -p /var/lib/edgelab-auth \
    && chown node:node /var/lib/edgelab-auth
COPY backend/auth backend/auth
ENV NODE_ENV=production EDGELAB_AUTH_HOST=0.0.0.0 EDGELAB_AUTH_PORT=3002 BETTER_AUTH_DATABASE_PATH=/var/lib/edgelab-auth/auth.db \
    BETTER_AUTH_DATABASE_URL= BETTER_AUTH_DATABASE_SCHEMA=edgelab_auth \
    BETTER_AUTH_DATABASE_POOL_MAX=5 BETTER_AUTH_DATABASE_TIMEOUT_MS=10000 \
    BETTER_AUTH_DATABASE_MIGRATION_TIMEOUT_MS=60000
USER node
EXPOSE 3002
CMD ["node", "backend/auth/server.mjs"]
