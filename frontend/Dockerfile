FROM node:22-slim AS build

ARG VITE_API_BASE_URL=/api
ARG VITE_API_BEARER_TOKEN=
ARG VITE_DEPLOYMENT_MODE=beta
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

RUN npm install -g npm@11.16.0

COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json
RUN npm ci --no-audit --no-fund \
    && ROLLUP_LINUX_X64_GNU_VERSION="$(node -p 'require("./frontend/node_modules/rollup/package.json").optionalDependencies["@rollup/rollup-linux-x64-gnu"]')" \
    && ESBUILD_LINUX_X64_VERSION="$(node -p 'require("./node_modules/esbuild/package.json").optionalDependencies["@esbuild/linux-x64"]')" \
    && npm install --no-save --ignore-scripts \
        "@rollup/rollup-linux-x64-gnu@${ROLLUP_LINUX_X64_GNU_VERSION}" \
        "@esbuild/linux-x64@${ESBUILD_LINUX_X64_VERSION}"

WORKDIR /app/frontend

COPY frontend ./
COPY scripts /app/scripts
RUN npm run build

FROM nginx:1.27-alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80
