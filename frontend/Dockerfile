FROM node:22-slim AS build

ARG VITE_API_BASE_URL=/api
ARG VITE_API_BEARER_TOKEN=
ARG NPM_CONFIG_REGISTRY=https://registry.npmjs.org/
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_API_BEARER_TOKEN=${VITE_API_BEARER_TOKEN}
ENV NPM_CONFIG_REGISTRY=${NPM_CONFIG_REGISTRY}
ENV NPM_CONFIG_REPLACE_REGISTRY_HOST=always

WORKDIR /app/frontend

RUN npm install -g npm@11.16.0

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY frontend ./
COPY scripts /app/scripts
RUN npm run build

FROM nginx:1.27-alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80
