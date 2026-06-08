FROM node:22-slim AS build

ARG VITE_API_BASE_URL=/api
ARG VITE_API_BEARER_TOKEN=
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_API_BEARER_TOKEN=${VITE_API_BEARER_TOKEN}

WORKDIR /app

COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json
RUN npm ci

COPY frontend /app/frontend
RUN npm --prefix frontend run build

FROM nginx:1.27-alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80
