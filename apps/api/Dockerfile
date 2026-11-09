# API Terra Link (NestJS). Contexto de build: raíz del repositorio (usa el lockfile del monorepo).
#   docker build -f apps/api/Dockerfile -t terra-link-api .
# Sin secretos en la imagen: DATABASE_URL, REDIS_URL, JWT_SECRET, etc. se inyectan al ejecutar.
FROM node:24-bookworm-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY e2e/package.json e2e/
RUN npm ci --workspace apps/api --include-workspace-root=false --no-audit --no-fund

FROM deps AS build
COPY apps/api apps/api
RUN npm run build --workspace apps/api

FROM node:24-bookworm-slim AS prod-deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY e2e/package.json e2e/
RUN npm ci --workspace apps/api --include-workspace-root=false --omit=dev --no-audit --no-fund

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
# RNF-13: revisión de código INYECTADA en el artefacto. No es una etiqueta escrita a mano que pueda quedar
# desactualizada: `scripts/desplegar.mjs` la calcula con `git rev-parse` en el momento de construir, y el
# recorrido de revisión comprueba que `/version` coincide con el candidato desplegado. Un SHA no es un secreto.
ARG APP_COMMIT=""
ENV APP_COMMIT=$APP_COMMIT
# Se conserva la estructura del workspace: npm puede dejar dependencias en apps/api/node_modules.
COPY --from=prod-deps --chown=node:node /repo /repo
COPY --from=build --chown=node:node /repo/apps/api/dist /repo/apps/api/dist
WORKDIR /repo/apps/api
USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
