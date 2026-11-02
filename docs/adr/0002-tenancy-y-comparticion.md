# ADR-0002 — Tenancy y compartición

Estado: **PARCIALMENTE ADOPTADO** · propuesto 2026-10-09 · actualizado **2026-10-17**.

## Contexto

S1 exige multi-organización desde inicio; S2/S3 proponen red de datos conservando control de cada organización. Usuarios/actores de cadena no son todos tenants independientes.

## Decisión propuesta

Base compartida con organization_id obligatorio en entidades operativas, autorización de aplicación por acción/recurso, integridad relacional por tenant y membresías explícitas. Incorporar RLS como defensa adicional si el runtime/pool/worker permiten contexto seguro probado; no asumir que existe. Compartición mediante grants tipados, campos/vigencia/revocación y no joins implícitos por identidad.

## Qué quedó ADOPTADO y EJECUTADO (2026-10-17)

Lo de abajo **ya no es propuesta**: está implementado y demostrado. Se registra cláusula por cláusula para no
dar por ratificado nada que no lo esté.

| Cláusula | Estado | Dónde se ejecutó y cómo se demostró |
| --- | --- | --- |
| `organization_id` obligatorio en entidades operativas | **ADOPTADA** | Esquema desde las primeras migraciones |
| **Autorización de aplicación por acción y recurso** | **ADOPTADA** | `AuthorizationService`; matriz QA-02 en `qa02-jobs-objetos.int-spec.ts` |
| **Integridad relacional por tenant** (claves compuestas, no solo filtros) | **ADOPTADA** | FK compuestas `(organization_id, id)` en entidades operativas |
| **Membresías explícitas** | **ADOPTADA** | `memberships` + `tenantContext()` |
| **Compartición mediante grants tipados** | **ADOPTADA** | `access_grants` con `resource_type`/`resource_id` (**P0-003**) |
| **…con vigencia** | **ADOPTADA** | `expires_at` obligatorio y futuro; **vencimiento probado con el reloj del servidor** |
| **…con revocación** | **ADOPTADA** | `revoked_at`; revocar corta resolución, vista, descarga y portal (**P1-001**) |
| **Sin joins implícitos por identidad** | **ADOPTADA** | La concesión es de **un recurso**; conocer un identificador no abre nada |
| Validación QA-02 en consultas, listas, links, jobs, exports y objetos | **ADOPTADA** | `qa02-jobs-objetos.int-spec.ts`, `access-grants.int-spec.ts` (19), `portal-comprador.mjs` |

**Lo que la entrega de P1-001/P1-002 añadió sobre esto**: el acceso del destinatario **sin membresía** a través
de la referencia pública, con la misma revalidación de vigencia y revocación.

## Lo que sigue siendo PROPUESTA

| Cláusula | Por qué sigue abierta |
| --- | --- |
| **«campos» compartidos configurables** | La concesión comparte **un recurso con una proyección fija**, no una selección de campos por concesión. Nadie ha decidido si hace falta esa granularidad |
| **RLS como defensa adicional** | **No implementada.** El propio ADR condiciona: «si el runtime/pool/worker permiten contexto seguro probado; no asumir que existe». No se ha probado ese contexto, así que **no se adopta por extensión** |
| **Base por tenant** (alternativa) | **Descartada en la práctica**, no por decisión escrita |

**No se ratifica por extensión**: que la compartición por grants funcione **no** convierte en adoptada la
cláusula de RLS ni la de campos configurables.

## Alternativas y consecuencias

Base por tenant ofrece aislamiento fuerte pero mayor coste operacional; filtros solo de UI son insuficientes. Filtros de aplicación sin FK/defensa de DB admiten vínculos cruzados si un caso de uso falla. RLS necesita fijar/relimpiar contexto de conexión y no confiar en superusuarios que la evaden. La elección final debe documentar controles reales y pruebas.

## Validación

QA-02 en consultas/listas/links/jobs/exports/objetos y payloads; incluye sesión/worker/cache, memberships/grants y administrador. No aceptar hasta identificar esquema real y estrategia de integridad aplicada.

**Estado de la validación (2026-10-17)**: QA-02 ejecutada sobre consultas, listas, links, jobs, exports,
objetos, membresías y concesiones, con control autorizado en cada denegación. **Lo que no se ha validado es la
RLS**, porque no existe.
