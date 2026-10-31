# Web Terra Link (Next.js, salida standalone). Contexto de build: raíz del repositorio.
#   docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=http://localhost:4000 -t terra-link-web .
# NEXT_PUBLIC_API_URL es pública (se incrusta en el JS del navegador); no es un secreto.
FROM node:24-bookworm-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY e2e/package.json e2e/
RUN npm ci --workspace apps/web --include-workspace-root=false --no-audit --no-fund

FROM deps AS build
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_MAPS_URL=http://localhost:8090
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_MAPS_URL=$NEXT_PUBLIC_MAPS_URL NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
COPY apps/web apps/web
RUN npm run build --workspace apps/web

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
# public/maplibre/: worker del mapa (A-01), copiado del paquete en el prebuild y servido por esta misma web (sin CDN)
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
