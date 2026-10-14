FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci
COPY backend backend
COPY frontend frontend
# URL path of the site; baked into the frontend build, must match BASE_PATH of the api and web containers.
ARG BASE_PATH=/tendergo
RUN npm run build -w backend && BASE_PATH="$BASE_PATH" npm run build -w frontend

FROM node:24-slim AS api
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --omit=dev -w backend && npm cache clean --force
COPY --from=build /app/backend/dist backend/dist
COPY backend/drizzle backend/drizzle
WORKDIR /app/backend
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]

FROM caddy:2-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/frontend/dist /srv
