# syntax=docker/dockerfile:1
# Étape 1 : récupère MediaPipe et les modèles de pose (~45 Mo) dans vendor/.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY scripts ./scripts
RUN node scripts/fetch-vendor.mjs

# Étape 2 : image finale, uniquement les fichiers servis + le serveur (sans dépendance npm).
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DATA_DIR=/data/users
COPY --from=build /app/vendor ./vendor
COPY package.json server.mjs index.html manifest.webmanifest sw.js ./
COPY css ./css
COPY js ./js
COPY icons ./icons
# /data : seul dossier inscriptible (profils synchronisés dans /data/users, diagnostics optionnels dans /data/diag).
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
CMD ["node", "server.mjs"]
