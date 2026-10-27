# ADR-0001 — Stack y repositorio

Estado: **ADOPTADO PARA DESARROLLO** (2026-10-09; el usuario delegó la decisión: «resuelve y documenta el stack usando las fuentes de este proyecto»). Falta la ratificación del responsable técnico.

## Corrección de la versión anterior

La primera auditoría del 2026-10-09 inspeccionó por error otro proyecto (`cyberlandec-oss/cacao`: commit `96d748e`, estructura `refactor/`, FastAPI/React/Expo, 71 migraciones, CI bloqueado, tareas Y-DEV-01/RREV-07). **Todo eso es ajeno a Terra Link 2025** y no se usa como antecedente ni evidencia. Esta versión reemplaza la anterior.

## Contexto

- Repositorio: `https://github.com/cyberlandec-oss/TERRA-LINK-2025.git` (privado). Estaba vacío el 2026-10-09 (`gh repo view` → `isEmpty: true`).
- Carpeta local: solo el paquete documental. No había código ni `.git`.
- La fuente S1 (docs/04) propone un monolito modular: NestJS (TypeScript), Next.js, React Native/Expo + SQLite, PostgreSQL/PostGIS, BullMQ/Redis, S3 compatible y MapLibre. El antecedente FastAPI/React no tiene código en este repositorio, así que no aplica.

## Decisión

| Componente | Elección | Versión fijada (lockfile) | Motivo |
| --- | --- | --- | --- |
| Repositorio | Monorepo npm workspaces (`apps/api`, `apps/web`; `apps/mobile` en su historia) | npm 11, Node ≥22.9 (`--env-file-if-exists`; probado con 24.12) | Contratos y tipos compartidos; un CI |
| API | NestJS 11 + Express | 11.x | S1. NestJS 12 se publica como ESM (`"type": "module"` en `@nestjs/core@12.1.2`): es una restricción del **arnés** (salida CommonJS + ts-jest), no un defecto del paquete. Migrar a NestJS 12 exige un arnés ESM; decisión aparte |
| Acceso a datos | Kysely 0.28 + `pg` (SQL explícito, migraciones TS versionadas) | 0.28.17 | PostGIS y FKs compuestas por tenant requieren SQL explícito. Kysely 0.28.17 publica build dual (`exports['.'].require → dist/cjs`); 0.29.6 solo expone ESM (sin condición `require`). Mismo motivo de arnés |
| Base | PostgreSQL 16 + PostGIS 3.4 (`postgis/postgis:16-3.4`) | — | S1 |
| Web | Next.js 16 (App Router) + React 19 | 16.4 / 19.3 | S1 |
| Móvil | React Native/Expo + SQLite | se fija en P0-023 | S1; no se crea hasta su historia |
| Cola / estado compartido | Redis 7.4 (`ioredis` 5): ya usado por el límite de intentos de login; BullMQ cuando exista el primer job | — | S1 |
| Objetos | S3 compatible; local VersityGW `v1.8.0` | — | Reproducido el 2026-10-09: `docker pull minio/minio:latest` → «pull access denied» (control `redis:7.4-alpine` sí resuelve). Fuentes secundarias indican que MinIO dejó de publicar la imagen comunitaria en Docker Hub (oct. 2025); no se encontró comunicado oficial vigente. Alternativas: `quay.io/minio/minio` (congelada), Chainguard |
| Auth | Local email/contraseña argon2id + JWT HS256 de corta vida | — | ADR-0005 (OIDC pendiente) |
| Pruebas | Jest 30 + ts-jest (API, integración con PostgreSQL y Redis reales); Vitest (web); Playwright 1.64 + Chromium (E2E, `e2e/`) | — | |
| Validación | **Local**: `npm run validate` (scripts/validate-local.mjs). Workflow de Actions inactivo como referencia en `infra/ci/github-actions-ci.yml` | — | Etapa de desarrollo local; mismas comprobaciones en el equipo |
| TypeScript | 5.9.3 | — | `ts-jest@29.4.14` declara `peerDependencies.typescript: ">=4.3 <7"` (verificado con `npm view`) |

Estructura: módulos por dominio en `apps/api/src/<módulo>` (dominio, caso de uso, persistencia y API). Las migraciones viven en `apps/api/src/db/migrations` y se registran explícitamente en `database.ts`.

## Alternativas

FastAPI/React: sin código ni equipo verificado aquí; rompe la fuente S1 sin beneficio comprobado. Prisma/TypeORM: peor soporte de PostGIS y de FKs compuestas. Migrar a NestJS 12/Kysely 0.29 en ESM: viable más adelante con un arnés ESM (Vitest + SWC); hoy no aporta valor.

## Consecuencias

Las reglas `.claude/rules/` apuntan a `apps/api/**`, `apps/web/**` y `apps/mobile/**`. Los comandos verificados están en docs/20. Los Dockerfiles y el CI siguen pendientes (TECH-001 restante).
