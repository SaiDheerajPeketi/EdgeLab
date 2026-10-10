FROM node:22-slim AS build

ARG VITE_API_BASE_URL=/api
ARG VITE_API_BEARER_TOKEN=
ARG VITE_DEPLOYMENT_MODE=production
ARG VITE_BETA_SEATS_TOTAL=500
ARG VITE_BETA_SEATS_TAKEN=0
ARG NPM_CONFIG_REGISTRY=https://registry.npmjs.org/
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_API_BEARER_TOKEN=${VITE_API_BEARER_TOKEN}
ENV VITE_DEPLOYMENT_MODE=${VITE_DEPLOYMENT_MODE}
ENV VITE_BETA_SEATS_TOTAL=${VITE_BETA_SEATS_TOTAL}
ENV VITE_BETA_SEATS_TAKEN=${VITE_BETA_SEATS_TAKEN}
ENV NPM_CONFIG_REGISTRY=${NPM_CONFIG_REGISTRY}
ENV NPM_CONFIG_REPLACE_REGISTRY_HOST=always

WORKDIR /app

COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json
COPY backend/auth/package.json backend/auth/package.json
RUN npm ci --no-audit --no-fund \
    && NODE_ARCH="$(node -p 'process.arch')" \
    && ROLLUP_PACKAGE="@rollup/rollup-linux-${NODE_ARCH}-gnu" \
    && ESBUILD_PACKAGE="@esbuild/linux-${NODE_ARCH}" \
    && ROLLUP_VERSION="$(node -p "require(require.resolve('rollup/package.json', { paths: ['./frontend'] })).optionalDependencies['${ROLLUP_PACKAGE}']")" \
    && ESBUILD_VERSION="$(node -p "require(require.resolve('esbuild/package.json', { paths: ['.'] })).optionalDependencies['${ESBUILD_PACKAGE}']")" \
    && npm install --no-save --ignore-scripts --no-audit --no-fund \
        "${ROLLUP_PACKAGE}@${ROLLUP_VERSION}" \
        "${ESBUILD_PACKAGE}@${ESBUILD_VERSION}"

WORKDIR /app/frontend

COPY frontend ./
COPY scripts /app/scripts
# Source offers capture the same application inputs used by both images.
COPY backend /app/backend
COPY docker /app/docker
COPY LICENSE THIRD_PARTY_NOTICES.md .env.example .dockerignore docker-compose.yml docker-compose.local.yml docker-compose.efficient.yml /app/
# The build verifies the pinned Pine source map and copied source overrides.
RUN npm run build \
    && find dist -type f \( -name '*.css' -o -name '*.html' -o -name '*.js' -o -name '*.json' -o -name '*.svg' \) \
        -exec gzip -9 -k {} \;

FROM nginx:1.30.5-alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80
