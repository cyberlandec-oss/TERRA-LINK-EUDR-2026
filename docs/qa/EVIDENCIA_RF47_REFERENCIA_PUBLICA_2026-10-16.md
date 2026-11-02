# Evidencia — RF-47 referencia pública por entidad (2026-10-16)

Contrato: `docs/decisiones/RF-47-REFERENCIA-PUBLICA.md`. Historia: **P1-002**, que **sigue abierta**.

| | |
| --- | --- |
| Commit del código | **`d8bb9c9`** |
| Validación | `2026-10-17T02-27-21-999Z` sobre `d8bb9c9` — **APROBADA** |
| Pruebas | **64 suites, 598** unitarias e integración · **72** E2E · 0 fallos |
| Fases | servicios 1 s · typecheck 31,9 s · lint 59,7 s · build 64,9 s · openapi-validado 16,8 s · pruebas 1090,8 s · e2e 266,3 s |
| Respecto de `4cf28d2` | 63→**64** suites y 586→**598** pruebas: la suite nueva y sus 12 casos |
| Migraciones | **44** (`0044_rf47_referencia_publica`) |

## 1. Qué se entregó

Un **registro central** `public_references` —no una columna por tabla— con `reference` como clave primaria, un
disparador de emisión por cada una de las seis tablas, incorporación de los registros existentes dentro de la
propia migración, y la ruta `GET /api/v1/public-references/:reference` con autorización sobre el recurso real.

Dos razones obligaron al registro central, y las dos son del contrato:

1. **Unicidad entre tipos.** Con las seis entidades resolviéndose por la misma ruta, un `UNIQUE` independiente
   por tabla **no** impide que una parcela y un lote reciban el mismo valor: cada restricción mira solo su tabla.
2. **La instantánea no se toca.** Escribir la referencia dentro de `dd_snapshots.content` habría cambiado su
   `content_hash`. Guardada fuera, el contenido histórico, el manifiesto y el hash quedan intactos.

## 2. Las doce pruebas de integración

`apps/api/test/public-references.int-spec.ts`, contra PostgreSQL real, todas **aprobadas**: emisión automática y
opaca para los seis tipos; unicidad efectiva **entre tipos y entre organizaciones**, con la restricción ejercida
de verdad (insertar la misma referencia para otro tipo falla, y una entidad no recibe una segunda);
inmutabilidad (`UPDATE` y `DELETE` rechazados por `append-only`); incorporación **idempotente** de registros
existentes; concurrencia (8 altas simultáneas → una referencia cada una, todas distintas); estabilidad tras
corregir un productor y versionar una geometría; permanencia de la referencia de la instantánea anterior cuando
llega otra; contenido, manifiesto y hash intactos; respuestas indistinguibles; alcance asignado respetado; rol
retirado que deja de resolver; y sin autenticación, nada.

## 3. Verificación en el DESPLIEGUE

Contenedores reconstruidos sobre `d8bb9c9` (`api` y `worker`). Nueve comprobaciones, **todas aprobadas**:

| Comprobación | Resultado |
| --- | --- |
| La ruta la sirve el código nuevo | `200`, `entity_type: PRODUCER` |
| Dueño autorizado resuelve su productor y su lote | `200` / `200` (`LOT`) |
| **Recurso de otra organización**, desde una cuenta cuya única membresía es otra organización | `404 NOT_FOUND` |
| Referencia inexistente | `404 NOT_FOUND` |
| `EXPORT_MANAGER` sin `producer:read` | `404 NOT_FOUND` |
| Rol `PRODUCER` (sin permisos) | `404 NOT_FOUND` |
| Sin autenticación | `401` |
| Ajena e inexistente indistinguibles | mismo estado, mismo código y **mismo mensaje** |

**Una precisión sobre el alcance de esta comprobación.** Las 22 referencias de desarrollo pertenecen **todas** a
«DEMO · Cooperativa Río Verde», así que **no existe en desarrollo una referencia de otra organización** que
probar. El primer intento usó un valor inexistente creyéndolo ajeno, lo que hacía el caso **vacuo**; se sustituyó
por el recorrido equivalente y sí concluyente —el mismo recurso consultado desde una cuenta cuya única membresía
es otra organización—, que ejercita exactamente la rama de tenant. El caso de una **referencia ajena existente**
queda cubierto por la suite de integración (organización A contra B), no por la verificación en el despliegue.

## 4. Incorporación en desarrollo

**22 referencias**: 9 productores, 6 parcelas, 3 entregas, 3 lotes, 1 instantánea. Ninguna fila sin referencia en
ninguna de las seis tablas, ninguna referencia repetida, y el `content_hash` de la instantánea sin cambios.

## 5. Retorno: qué está probado y qué no

El ensayo `down`/`up` se hizo sobre una **base desechable**, nunca sobre desarrollo: `down` retiró la tabla, los
**6** disparadores y las **3** funciones, y `up` lo recreó todo.

**Eso demuestra reversibilidad del esquema, no conservación de identificadores.** `up` genera los valores con
`gen_random_bytes`, de modo que un ciclo `down`→`up` **acuña referencias distintas** y cualquier enlace ya
emitido dejaría de resolver. No debe presentarse como recuperación completa.

**El retorno operativo exige preservar o restaurar los mismos valores**, es decir **restaurar desde un respaldo
que ya los contenga**, nunca reconstruir con `up()`.

## 6. Respaldo actualizado

`_respaldos/2026-10-16-post-rf47`, tomado tras aprobar la validación y desplegar, siguiendo QA-16: escrituras
pausadas (`api`, `web`, `worker` detenidos), volcado y objetos del mismo instante, aplicación reanudada después.

| | |
| --- | --- |
| Migraciones | **44** · tablas **108** (las 107 anteriores más `public_references`) |
| Referencias | **22**, desglosadas por tipo en `estado-actual.txt` |
| Clave | **`k2`**, la activa tras D-43. **No expuesta** |
| Integridad | `sha256sum -c SHA256SUMS.txt` → **OK** en los cuatro archivos |
| ACL | `claves.env` con herencia retirada y acceso solo al usuario |

**Por qué hacía falta**: el respaldo anterior (`2026-10-16-post-rotacion-pii`) tiene 43 migraciones y **no
contiene las referencias**. Restaurar desde él después de esta entrega las perdería todas, y la migración las
volvería a generar **con valores distintos**. Ninguno de los respaldos anteriores se borra ni pierde su clave.

## 7. Lo que esta entrega NO hace

- **No cierra RF-33 ni P1-002.** No hay publicación por audiencias, ni QR, ni concesiones externas.
- **No suma historias del MVP**: siguen **24 de 32 (75 %)**. Completar una parte de P1-002 no cierra la historia.
- **No crea permisos.** `BUYER` y `PRODUCER` siguen sin ninguno; `SUPER_ADMIN` sin acceso a datos de
  organización (D-04 pendiente). Verificado en el despliegue.
- **No cambia ninguna API existente** ni los códigos operativos.
- **D-34 sigue sin adoptar**: despacho y `READY` bloqueados, conclusión `UNDETERMINED`, satélite deshabilitado.

## 8. Métricas, tras contrastar en `docs/24`

| Medida | Antes | Ahora |
| --- | ---: | ---: |
| Requisitos identificados, incluida evolución | 25/59 = 42,4 % | **26/59 = 44,1 %** |
| Requisitos del alcance MVP | 25/43 = 58,1 % | **25/43 = 58,1 %** (sin cambio: RF-47 es P1) |
| Historias del MVP cerradas | 24/32 = 75 % | **24/32 = 75 %** (sin cambio) |

El denominador del catálogo completo pasó de 58 a **59** porque RF-47 existe; la cifra de 58 en `docs/24` era
anterior a su alta. Los requisitos **parciales siguen fuera del numerador**.
