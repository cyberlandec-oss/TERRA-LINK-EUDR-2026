# Evidencia — GEOLOCATION_PROFILE, implementación pendiente I1–I4 (2026-10-21)

**Qué es.** Evidencia de la implementación de I1–I4 como parte del **requisito original** `GEOLOCATION_PROFILE` (P0-022, fila 14 de la matriz), con la solución de transición adoptada por el propietario: un **panel de consulta
«Evaluación geográfica técnica actual», separado de la instantánea**. **No cumple el requisito**: `GEOLOCATION_PROFILE` sigue `NOT_EVALUABLE`; **D-05.B y la revisión de las fuentes permanecen pendientes**. Fuera del conteo 42/60 y 30/44.
Material de revisión de D-05.B: `docs/decisiones/D-05B-FICHA-REVISION-2026-10-21.md` (§12 resume I1–I4).

| | |
| --- | --- |
| SHA validado y desplegado (I1–I4) | **`ea495a6`** (sin migración; esquema `0058` sin cambio). `/version` → `commit=ea495a6` |
| Validación **APROBADA** (1.ª y única ejecución sobre ese SHA) | `validation-results/2026-10-21T17-23-04-398Z` — **91 suites / 996 pruebas**, E2E **109** (registro `validate-APROBADA.log`) |
| Demostración en el despliegue | `e2e/review/i14-demostracion.mjs` **5/5**, de **solo lectura**; `validation-results/i14-demostracion-2026-10-21/` |
| Respaldo | **No se aplica**: no hay migración ni estado persistente nuevo, y la demostración no escribió (conteos de evaluaciones, eventos, auditoría, instantáneas, exportaciones y versiones de parcela iguales antes y después: `4 672 2864 13 0 44`). El respaldo vigente sigue siendo `_respaldos/2026-10-21-a03-traspaso-0058` |

## 1. Qué hace cada pieza
| Pieza | Resultado |
| --- | --- |
| **I1 · panel** | `GET …/dd-cases/{id}/geo-evaluation` (`apps/api/src/dd/geo-panel.ts`) + `apps/web/lib/geo-eval-panel.tsx`. Por parcela autorizada: versión geométrica, perfil y versión, veredicto, fecha de evaluación, **vigencia** (vigente / obsoleta / sin evaluación), explicación y siguiente acción. Rotulado como **consulta actual**, no contenido de la instantánea ni conclusión regulatoria. **Reutiliza** las evaluaciones de `EUDR_GEO_V1`; **no recalcula** ni escribe (verificado: sin filas, eventos, auditoría ni instantáneas nuevas al consultar) |
| **Instantáneas** | No se modifican: el panel **no entra** en `DdContent`, su hash ni sus secciones. Mismo hash y misma frescura antes y después de consultar (9 instantáneas DEMO, y en pruebas). Los mecanismos existentes siguen detectando cambios materiales: cambiar la geometría de una parcela **sí** desactualiza la instantánea (probado) y el panel marca esa evaluación como obsoleta. Si el resultado debe entrar al contenido formal, será con contrato versionado y transición explícita |
| **I2 · guarda** | Con **todas** las parcelas en `MEETS_PROFILE`: `GEOLOCATION_PROFILE` = `NOT_EVALUABLE`, readiness no es `READY`, **aprobar** y **exportar el paquete** se rechazan (`READINESS_NOT_MET`, con `GEOLOCATION_PROFILE` entre los requisitos que faltan) y no se crea ninguna exportación. Además, 2 pruebas unitarias fijan que el veredicto técnico no cambia el requisito |
| **I3 · pendientes** | Distingue **sin evaluación** (nunca evaluada o sin versión geométrica), **obsoleta** (por cambio de geometría o por versión nueva del perfil) y **resultado no evaluable**, en recuentos, lista y detalle. **Permisos**: el detalle (explicación y superficie) exige `plot:read_geometry`; recuentos y estado, el alcance del expediente (`dd:read`); el enlace a la parcela, `plot:read` |
| **I4 · `organizations.country`** | Documentado como **ambiguo** en `docs/06` («Semántica de `organizations.country`»): lo fija la plataforma al crear la organización (rótulo «País», `EC` precargado), **no se puede modificar** y **ninguna regla lo lee**. No se usa como país de producción, de establecimiento ni de aplicabilidad |

## 2. Pruebas
- **Integración** (`apps/api/test/dd-geo-panel.int-spec.ts`, PostgreSQL real, 4): estados (ausente, obsoleta por geometría, obsoleta por perfil, no evaluable y los tres veredictos), pendientes, que consultar no escribe; permisos y aislamiento (auditor sin detalle, técnico 403, otra organización 404); instantáneas intactas y su desactualización por el mecanismo existente; guarda con todas en `MEETS_PROFILE`.
- **Unitarias** (`src/dd/requirements.spec.ts`, 2) y **web** (`i18n.test.ts`: textos del panel y de la API traducidos).
- **E2E** (`e2e/tests/panel-geografico.spec.ts`, 5): español, hash de la instantánea, permisos, inglés, teclado y 390 px.
- **Demostración desplegada** (5/5): recuentos coherentes en los 12 expedientes DEMO sin escribir nada; panel en pantalla; instantáneas sin cambio y `GEOLOCATION_PROFILE` `NOT_EVALUABLE` en las 9; permisos (admin 200, auditor 200 con detalle restringido, técnico 403, otra organización 404/404); inglés, teclado y 390 px. **Límite:** el DEMO tiene pocas parcelas evaluadas (el expediente más grande tiene 1 sin evaluación), por lo que los estados ausente/obsoleto/no evaluable y la guarda completa se demuestran en integración y E2E aislado, no en el despliegue.

## 3. Aclaración de alcance de A-01 y corrección del Gerente (misma fecha)
El propietario aclaró que A-01 añade capacidades concretas a los roles canónicos sin facultades sobre otros módulos (`docs/07`, «Aclaración de alcance del propietario»). El contraste del catálogo efectivo (`1859aa0` frente a `4913dd3`) halló **un permiso fuera de alcance**: `producer:link_self` concedido al **Gerente**. Se retira del Gerente (cambio funcional de autorización, **candidato propio**). **Resultado de ese candidato:** ver el apartado 4.

## 4. Corrección del Gerente: validación y demostración PROPIAS (registradas por separado de I1–I4)
| | |
| --- | --- |
| SHA validado y desplegado | **`1de15c0`** (cambio de autorización en `catalog.ts` + pruebas + documentación; sin migración). `/version` → `commit=1de15c0`, esquema `0058` |
| Validación **APROBADA** (única ejecución sobre ese SHA) | `validation-results/2026-10-21T18-00-11-041Z` — **91 suites / 1000 pruebas**, E2E **109** (registro `validate-APROBADA.log`). Las 4 pruebas de más respecto de `ea495a6` son las del catálogo |
| Demostración en el despliegue | `e2e/review/gerente-vinculo-demostracion.mjs` **6/6**; `validation-results/gerente-vinculo-2026-10-21/` |
| Respaldo | **No se aplica**: ni migración ni estado persistente nuevo; la demostración no escribió (vínculos y versiones `LINK_SELF` sin cambio). Solo una solicitud denegada puede dejar un registro de auditoría de denegación |

Qué se demostró (DEMO sintético; Gerente = `supervisor.cooperativa`, administración = `admin.cooperativa`, Productor = `productor.cooperativa`):
1. El Gerente **no tiene** `producer:link_self` y **conserva** `producer:read/create/update` y `plot:read/create/update`.
2. **Solicitud directa** del Gerente `PUT …/producers/{id}/self-membership` → **403 `PERMISSION_DENIED`**, sin efecto.
3. **Control positivo:** la administración, con la misma solicitud, **atraviesa la autorización** y la detiene una regla de negocio (**422 `MEMBERSHIP_WITHOUT_PRODUCER_ROLE`**) **antes de escribir**. Se usó esta vía a propósito para no crear ni alterar vínculos en el DEMO; el éxito real de **vincular y desvincular** lo prueban las suites `a01-alcance-propio` («VINCULAR es explícito…», «DESVINCULAR corta el acceso propio…») dentro de la validación aprobada de este SHA.
4. El Productor no puede vincular (403) y conserva su alcance propio (lista sus parcelas, 200).
5. En pantalla: el control de vincular **no aparece** para el Gerente y **sí** para la administración (`can_link_self` falso/verdadero).
6. **Ningún vínculo existente se eliminó ni modificó.** Aviso de alcance de la prueba: el DEMO **no tenía vínculos** (0 antes y después), así que esta comprobación es de **no efecto**, no de conservación de vínculos preexistentes; la conservación al desvincular/vincular la cubren las suites.
**Límite:** las capacidades de **escritura** del Gerente (crear/actualizar productores y parcelas) se acreditan por su catálogo de permisos y las suites existentes; la demostración no creó datos en el DEMO.

## 5. Qué NO queda demostrado ni cambiado
`GEOLOCATION_PROFILE` sigue `NOT_EVALUABLE` (`profiles.geolocation_profile: null`); la definición de «satisfecho» (D1), los campos de categoría/tamaño/HS/país/período (D2) y la compuerta de A-03 (D3) esperan al revisor. `READY` sigue sin alcanzarse. Android, producción y conformidad EUDR siguen en sus gates propios.
