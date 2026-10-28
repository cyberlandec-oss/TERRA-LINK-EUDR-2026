# Terra Link — Especificación UX/UI de plataforma

**Versión:** 1.0 de trabajo  
**Fecha:** 9 de octubre de 2026, Ecuador  
**Proyecto:** TERRA-LINK-2025  
**Mercado inicial:** cadena de cacao de Ecuador  
**Audiencia:** Producto, Diseño, Frontend, Backend, Mobile, GIS y QA  
**Estado:** especificación para implementación y revisión; no constituye una auditoría del código ni una aprobación regulatoria.

El objetivo es convertir la identidad de Terra Link en una experiencia operativa coherente: registrar origen, conectar movimientos, revisar evidencia, explicar riesgos y completar el trabajo pendiente. La interfaz debe ayudar a responder qué ocurrió, quién lo hizo, cuándo, dónde, con qué soporte y qué acción sigue.

**Archivo:** `UX_UI.md`. La denominación solicitada, «UX/UI.md», se expresa con guion bajo porque `/` es un separador de carpetas y no un carácter válido de nombre de archivo en Windows. Ubicación sugerida en el proyecto: `docs/UX_UI.md`; registrar su enlace en el índice y en `CLAUDE.md` al incorporarlo.

## Índice

1. [Fuentes, autoridad y alcance](#1-fuentes-autoridad-y-alcance)
2. [Principios de experiencia](#2-principios-de-experiencia)
3. [Identidad visual y logotipo](#3-identidad-visual-y-logotipo)
4. [Tokens de color y contraste](#4-tokens-de-color-y-contraste)
5. [Tipografía, retícula y movimiento](#5-tipografía-retícula-y-movimiento)
6. [Arquitectura de información y navegación](#6-arquitectura-de-información-y-navegación)
7. [Experiencia de los 12 roles](#7-experiencia-de-los-12-roles)
8. [Catálogo de componentes](#8-catálogo-de-componentes)
9. [Estados, errores y permisos](#9-estados-errores-y-permisos)
10. [Acceso, organizaciones y usuarios](#10-acceso-organizaciones-y-usuarios)
11. [Mi trabajo y centro de operaciones](#11-mi-trabajo-y-centro-de-operaciones)
12. [Productores](#12-productores)
13. [Parcelas, mapas y captura GIS](#13-parcelas-mapas-y-captura-gis)
14. [Entregas, recepción y calidad](#14-entregas-recepción-y-calidad)
15. [Lotes, procesamiento y balance de masa](#15-lotes-procesamiento-y-balance-de-masa)
16. [Explorador de trazabilidad](#16-explorador-de-trazabilidad)
17. [Documentos y centro de evidencias](#17-documentos-y-centro-de-evidencias)
18. [Riesgo, mitigación y debida diligencia](#18-riesgo-mitigación-y-debida-diligencia)
19. [Exportación y portal comprador](#19-exportación-y-portal-comprador)
20. [Auditoría, reportes e importación](#20-auditoría-reportes-e-importación)
21. [Móvil, trabajo offline y sincronización](#21-móvil-trabajo-offline-y-sincronización)
22. [Contenido, localización y privacidad](#22-contenido-localización-y-privacidad)
23. [Accesibilidad y comportamiento adaptable](#23-accesibilidad-y-comportamiento-adaptable)
24. [Contratos de implementación](#24-contratos-de-implementación)
25. [Trazabilidad UX, pantallas y backlog](#25-trazabilidad-ux-pantallas-y-backlog)
26. [Verificación local y criterios de aceptación](#26-verificación-local-y-criterios-de-aceptación)
27. [Secuencia de adopción y decisiones pendientes](#27-secuencia-de-adopción-y-decisiones-pendientes)

## 1. Fuentes, autoridad y alcance

### 1.1 Referencias utilizadas

| ID | Fuente revisada | Aplicación |
|---|---|---|
| M1 | `Terra_Link_Manual_de_Marca_V1.pdf`, 26 páginas, versión de trabajo del 26/09/2026 | Marca, paleta, tipografía, logotipo, iconos, estados, GIS, voz y gobernanza. |
| F1 | `DOCUMENTACIÓN TÉCNICA MAESTRA.md`, v0.1, 05/10/2026 | Dominios, 12 roles, datos, relaciones, offline, riesgo y backlog P0/P1/P2. |
| F2 | `workflows reales de la cadena de cacao.md` | Objetivos por rol, workspaces, Lot Hub, evidencia, trazabilidad y tareas. |
| F3 | `Mapa competitivo EUDR.md` | Orientación estratégica: español primero, simplicidad, primera milla y explicación de riesgos. No se revalidaron sus precios o afirmaciones sobre competidores. |
| C1 | Instrucciones y reportes compartidos en esta conversación | Repositorio exclusivo TERRA-LINK-2025; desarrollo y pruebas locales; límites de SUPER_ADMIN y decisiones pendientes. Los reportes no sustituyen una inspección del código. |
| A1 | [W3C: referencia WCAG 2.2](https://www.w3.org/WAI/WCAG22/quickref/) | Objetivo de accesibilidad y criterios de comprobación. |

M1 define identidad, F1/F2 orientan el dominio y C1 determina el alcance de esta etapa. El contrato vigente del repositorio debe confirmarse antes de implementar cada pantalla. Si una fuente contiene un ejemplo y el backend contiene otra regla aceptada, registrar la diferencia; no cambiar permisos o reglas de negocio desde la UI para hacer coincidir el ejemplo.

### 1.2 Estados de las especificaciones

| Marca documental | Significado |
|---|---|
| **M1** | Norma o recomendación expresamente presente en el manual; conserva el estado de aprobación del manual. |
| **UX-V1** | Decisión de diseño propuesta en este documento. Aplicable como base de revisión, sin atribuir una ratificación previa. |
| **CONTRATO** | Campo, permiso, validación, transición o capacidad que debe obtenerse del backend y documentación vigente. |
| **FUTURO** | Experiencia prevista; no implica que la funcionalidad esté implementada. |

Los valores nuevos de espaciado, breakpoints, colores auxiliares y distribución de pantallas son UX-V1. Los colores corporativos y semánticos proceden de M1. Inter está propuesta por M1; su disponibilidad y licencia deben verificarse antes de distribuirla.

### 1.3 Alcance y entorno

Esta especificación cubre backoffice web y diseño móvil de campo. El portal comprador es una extensión P1 según F1. Sirve para implementar historias progresivamente, no para habilitar todo el menú antes de disponer de datos y operaciones reales.

Se trabaja exclusivamente sobre `D:\PROYECTOS CYBER LAND\TERRA LINK EUDR 2026\TERRA LINK 2025` (antes en `C:\Users\mario\TERRA LINK 2025`) y `cyberlandec-oss/TERRA-LINK-2025`. La base técnica reportada es NestJS/Next.js/React y aplicación móvil Expo planificada; las versiones y rutas concretas se consultan en el repositorio. No importar decisiones, roles, resultados de pruebas o componentes del proyecto `cacao`.

La plataforma se ejecuta y verifica localmente con los servicios del proyecto. GitHub puede conservar el código; GitHub Actions no es una dependencia UX ni una condición de esta especificación. Este documento no modifica por sí solo la definición global de DONE: la decisión de validar esta etapa en local debe reflejarse también en las instrucciones y el backlog del repositorio.

## 2. Principios de experiencia

| ID | Principio | Consecuencia verificable |
|---|---|---|
| UX-01 | Trabajo antes que módulos | La portada muestra acciones relevantes para el usuario y su organización. |
| UX-02 | Origen visible | Desde una entidad se pueden seguir las relaciones autorizadas de origen y destino. |
| UX-03 | Evidencia contextual | Un soporte muestra fuente, fecha, entidad, relación y estado de revisión. |
| UX-04 | Estado explícito | Distinguir vacío, faltante, error, permiso, bloqueo y sincronización. |
| UX-05 | Operación progresiva | Mostrar lo necesario para completar el paso; revelar detalle avanzado bajo demanda. |
| UX-06 | Autoridad del servidor | Botones y navegación reflejan permisos; el backend vuelve a validar cada operación. |
| UX-07 | Historia preservada | Corregir, archivar y revisar sin ocultar el registro previo autorizado. |
| UX-08 | Campo primero | Captura móvil legible, pocos pasos y guardado local confirmado cuando esté implementado. |
| UX-09 | Riesgo explicable | Categoría, factores, fuentes, fecha, evidencia y siguiente acción acompañan al resultado. |
| UX-10 | Afirmaciones precisas | «Validado» especifica qué se validó; no equivale a certificación ni cumplimiento integral. |

La estética será sobria, cálida y técnica: fondo claro, navegación bosque, datos legibles, jerarquía mediante tipografía y espacio, acentos moderados. La fotografía corresponde a acceso o comunicación; las pantallas operativas priorizan información real.

## 3. Identidad visual y logotipo

### 3.1 Activos y uso

M1 presenta el concepto **Territorio Trazable**: territorio hexagonal, franjas productivas, tres nodos y conexión. El lockup lleva únicamente **TERRA LINK**, sin lema. El nombre en texto es **Terra Link**.

La reconstrucción vectorial del manual está pendiente de cotejo contra el arte original. No reconstruir el logo con CSS, iconos o Inter ni presentar una extracción del PDF como archivo maestro aprobado. Consumir las exportaciones oficiales cuando estén disponibles.

| Superficie | Especificación M1 | Aplicación UX-V1 |
|---|---|---|
| Sidebar desktop | Lockup 148–192 px de ancho | Usar 168 px si cabe con zona de reserva. |
| Cabecera móvil | Isotipo 32–40 px | 32 px, nombre accesible «Terra Link». |
| Login | Lockup 220–300 px | 240 px, sin fotografía necesaria para operar. |
| Documentos | Lockup 160–240 px | Activo adecuado al formato y contraste. |
| Favicon | 16, 32 y 48 px | Isotipo simplificado oficial. |
| Apple touch | 180 × 180 px | Fondo y zona segura 20 %. |
| App/PWA | 512 × 512 y 192 × 192 px | Respetar máscaras; preparar solo cuando corresponda. |
| Avatar | 256 × 256 px | Margen 20–25 %. |

Zona de reserva: `0.25 U`, con U igual a la altura total del isotipo. Proporción aproximada del lockup: `2.8 U × U`; separación símbolo/nombre: `0.13 U`. Son referencias del manual, no instrucciones para redibujar el activo.

Conservar proporción, colores y composición. Variantes: color sobre blanco/marfil, inversa sobre bosque y monocroma donde corresponda. No deformar, girar, añadir sombras, cambiar nodos o incorporar sellos de cumplimiento.

### 3.2 Activos requeridos antes de sustituir la marca en código

- SVG oficial de lockup e isotipo: color, inversa y monocroma.
- PNG transparentes derivados a 1x/2x/3x cuando hagan falta.
- Favicon simplificado y máscaras de app revisados.
- Archivo editable maestro, versión, responsable y estado de aprobación.
- Fuente de interfaz y condiciones de distribución verificadas.

Esta entrega define el uso de esos activos; no genera nuevos archivos de logotipo.

## 4. Tokens de color y contraste

### 4.1 Paleta fuente M1

| Token | Color | HEX | Uso |
|---|---|---|---|
| `brand.forest` | Bosque profundo | `#173D35` | Navegación y encabezados de marca. |
| `brand.operation` | Verde operación | `#2B6650` | Acción primaria. |
| `brand.leaf` | Hoja clara | `#B4CF8B` | Acento suave o fondo, no texto pequeño claro. |
| `brand.ivory` | Marfil cálido | `#F5F2E9` | Fondo general. |
| `brand.terracotta` | Cacao terracota | `#C47F54` | Acento decorativo y nodo de transformación. |
| `text.primary` | Tinta | `#172B29` | Texto principal. |
| `status.validated` | Validado | `#28784B` | Validación de un objeto y alcance definidos. |
| `status.review` | Revisión | `#895A15` | Revisión o advertencia. |
| `status.blocked` | Bloqueo | `#A33C38` | Error, bloqueo o acción destructiva. |
| `status.processing` | En proceso | `#285D88` | Proceso o información. |

El verde de marca identifica acciones; el verde semántico identifica un estado. No usar «botón verde» como evidencia de aprobación.

### 4.2 Extensión UX-V1

| Token | HEX | Uso |
|---|---|---|
| `surface.default` | `#FFFFFF` | Tarjetas, formularios y tablas. |
| `text.secondary` | `#52615D` | Metadatos y ayudas legibles. |
| `border.control` | `#7C8982` | Borde necesario para reconocer campos. |
| `border.subtle` | `#DCE3DD` | Separadores decorativos; no único contorno de un control. |
| `surface.subtle` | `#EDF1EC` | Encabezados y agrupación. |
| `status.validated.bg` | `#EDF5EF` | Fondo de badge/mensaje validado. |
| `status.review.bg` | `#FFF4DF` | Fondo de revisión. |
| `status.blocked.bg` | `#FBEFEE` | Fondo de bloqueo. |
| `status.processing.bg` | `#EEF4FA` | Fondo de proceso. |

### 4.3 Contrastes calculados

Relaciones calculadas con luminancia relativa sRGB sobre colores sólidos y opacos. No acreditan accesibilidad de la aplicación completa.

| Texto / fondo | Relación aproximada | Decisión |
|---|---|---|
| Tinta / marfil | 13.27:1 | Apto para texto normal. |
| Texto secundario / marfil | 5.81:1 | Apto para ayudas. |
| Blanco / bosque | 11.96:1 | Apto para navegación. |
| Blanco / verde operación | 6.73:1 | Apto para acción primaria. |
| Validado / fondo validado | 4.88:1 | Apto para badge con texto. |
| Revisión / fondo revisión | 5.44:1 | Apto para badge con texto. |
| Bloqueo / fondo bloqueo | 5.73:1 | Apto para badge con texto. |
| En proceso / fondo proceso | 6.29:1 | Apto para badge con texto. |
| Hoja / marfil | 1.53:1 | No usar como texto ni único indicador. |
| Blanco / terracota | 3.23:1 | No usar como texto normal de botón. |
| Borde de control / blanco | 3.65:1 | Base para contorno perceptible. |

### 4.4 Base técnica sugerida

Fragmento UX-V1 orientativo. Centralizarlo en el sistema de estilos existente; no crear una segunda fuente de tokens.

```css
:root {
  --tl-forest: #173d35;
  --tl-operation: #2b6650;
  --tl-leaf: #b4cf8b;
  --tl-ivory: #f5f2e9;
  --tl-terracotta: #c47f54;
  --tl-text: #172b29;
  --tl-text-secondary: #52615d;
  --tl-surface: #ffffff;
  --tl-surface-subtle: #edf1ec;
  --tl-border-control: #7c8982;
  --tl-border-subtle: #dce3dd;
  --tl-valid: #28784b;
  --tl-valid-bg: #edf5ef;
  --tl-review: #895a15;
  --tl-review-bg: #fff4df;
  --tl-blocked: #a33c38;
  --tl-blocked-bg: #fbefee;
  --tl-process: #285d88;
  --tl-process-bg: #eef4fa;
  --tl-radius-sm: 6px;
  --tl-radius-md: 10px;
  --tl-radius-lg: 14px;
  --tl-font: "Inter", system-ui, "Noto Sans", sans-serif;
}
```

Estados hover/active no se implementan reduciendo opacidad del conjunto. Usar bosque para hover del primario y comprobar foco, active, disabled y selección sobre el fondo real. Foco UX-V1: anillo de 2 px en bosque con separación blanca de 2 px; en sidebar oscuro usar anillo claro.

## 5. Tipografía, retícula y movimiento

### 5.1 Jerarquía

| Nivel | Referencia M1 | Aplicación operativa UX-V1 |
|---|---|---|
| H1 | 40–48 px, Semibold | 28–32 px en páginas operativas; tamaño M1 en acceso/editorial. |
| H2 | 28–32 px | 24–28 px en secciones principales. |
| H3 | 20–24 px | 20–24 px en tarjetas y subsecciones. |
| Cuerpo | 16–18 px | 16 px, línea 1.5. |
| Etiqueta | 12–14 px, Medium | 14 px; 12 px solo en metadatos secundarios legibles. |
| Tabla | No fija densidad | 14–16 px; 16 px en recepción/campo. |
| Cantidad/KPI | No fija tamaño | 28–36 px, cifras tabulares. |

La reducción de títulos operativos es una adaptación UX-V1 para densidad de trabajo, no un valor extraído del manual. No encoger texto para hacer caber columnas. Evitar bloques largos en mayúsculas y párrafos de ancho excesivo; ancho de lectura recomendado 60–75 caracteres.

### 5.2 Retícula y dimensiones UX-V1

| Elemento | Base |
|---|---|
| Espaciado | 4, 8, 12, 16, 24, 32, 48 y 64 px. |
| Página desktop | Margen 24–32 px; contenido máximo 1440 px salvo mapa/tabla. |
| Página móvil | Margen 16 px; no depender de hover. |
| Sidebar | 248 px abierta; modo compacto solo con etiquetas accesibles. |
| Cabecera | Base 64 px; crecer si el texto requiere más espacio. |
| Controles | Altura mínima 44 px, sin recortar al ampliar texto. |
| Campo | Ancho acorde al contenido; formulario principal máximo 760 px. |
| Tarjeta | Padding 16–24 px; radio 10 px. |
| Tabla | Fila base 48 px; autoaltura para contenido multilínea. |
| Modal | 480–640 px habitual; pantalla completa en móvil si el contenido lo requiere. |
| Panel lateral | 400–480 px en escritorio; vista completa en móvil. |

Sombras discretas solo para elevación funcional. No glassmorphism, fondos fotográficos bajo tablas o animaciones decorativas permanentes. Transiciones orientativas de 120–200 ms; respetar reducción de movimiento.

## 6. Arquitectura de información y navegación

### 6.1 Estructura de workspace

El usuario trabaja en un contexto inequívoco: **persona + organización activa + permisos efectivos + estado de la organización**. Una persona con varias membresías cambia de organización; sus roles no se mezclan entre tenants.

| Grupo | Entradas previstas | Regla de visibilidad |
|---|---|---|
| Inicio | Mi trabajo; vista operativa/gerencial | Solo datos y acciones accesibles. |
| Origen | Productores, Parcelas, Mapa | Habilitar cuando exista módulo y permiso. |
| Operación | Productos, Entregas, Recepción, Calidad, Lotes, Inventario, Procesamiento | Ajustar al trabajo y al contrato de cada rol. |
| Control | Trazabilidad, Documentos, Evidencias, Riesgo, Mitigación, Debida diligencia | No convertir consultas en permisos de aprobación. |
| Salida | Embarques/Exportación, Reportes | Según capacidades implementadas. |
| Administración | Organización, Miembros, Invitaciones, Roles, Auditoría, Configuración | Separar administración de tenant y plataforma. |

Los grupos son UX-V1. Evitar duplicar una acción en tres menús; usar accesos contextuales al mismo destino. Un módulo futuro permanece fuera del menú operativo; si Producto decide mostrar roadmap, rotularlo claramente en una superficie separada.

### 6.2 Estructura de página

| Zona | Contenido |
|---|---|
| Sidebar | Marca, navegación permitida, selección actual. |
| Cabecera | Organización, estado relevante, usuario; búsqueda solo en alcance autorizado. |
| Contexto | Breadcrumb y vínculo de regreso conservando filtros. |
| Encabezado | Nombre/código, estado, metadatos mínimos, acción principal. |
| Cuerpo | Resumen y tarea; detalle progresivo mediante secciones/pestañas. |
| Feedback | Errores y bloqueos junto al lugar donde se resuelven. |

No convertir la cabecera en una lista de métricas. Una página tiene una acción primaria contextual. El menú de acciones secundarias lleva nombres explícitos.

### 6.3 Cambio de organización y permisos

Al cambiar organización: resolver borradores, cancelar peticiones anteriores, limpiar selecciones, renovar permisos y separar caché por tenant. No mostrar fugazmente datos del tenant previo. La navegación directa a una entidad ajena recibe el tratamiento seguro del servidor.

Las acciones se actualizan al cambiar permisos, incluso con la misma sesión. No requieren nuevo login para reflejar una revocación. Si una petición resulta denegada, invalidar la vista pertinente y explicar el resultado sin revelar datos protegidos.

## 7. Experiencia de los 12 roles

Los códigos de F1 y F2 son exactamente los siguientes 12. Estas fichas definen experiencia deseada, **no conceden permisos**. La matriz RBAC del repositorio prevalece; cualquier acceso de futuro requiere contrato y pruebas.

### 7.1 Matriz de entrada

| Rol | Pregunta principal | Entrada | Superficie |
|---|---|---|---|
| SUPER_ADMIN | ¿Qué necesita atención en la plataforma? | Administración de plataforma | Web. |
| ORG_ADMIN | ¿Puede operar mi organización? | Configuración y pendientes de organización | Web. |
| MANAGER | ¿Qué está pasando hoy? | Centro de operaciones | Web/tablet. |
| FIELD_TECHNICIAN | ¿Qué debo registrar o revisar en campo? | Mi jornada | Móvil/offline futuro. |
| RECEPTION_OPERATOR | ¿Qué recepción debo registrar? | Recepción | Web/tablet. |
| QUALITY_OPERATOR | ¿Qué muestra o lote debo analizar? | Cola de calidad | Web/tablet. |
| TRACEABILITY_MANAGER | ¿Puedo reconstruir origen y destino? | Explorador de trazabilidad | Web. |
| EUDR_MANAGER | ¿Qué falta para revisar el expediente? | Riesgo y debida diligencia | Web. |
| EXPORT_MANAGER | ¿Qué falta en el embarque? | Preparación de exportación | Web. |
| BUYER | ¿Qué información autorizada respalda este lote? | Portal comprador | Web adaptable, P1. |
| AUDITOR | ¿Qué cambió y con qué soporte? | Explorador de auditoría | Web. |
| PRODUCER | ¿Qué consta sobre mi finca y mis entregas? | Mi finca | Móvil primero, condicionado a alcance. |

### 7.2 SUPER_ADMIN

- **Objetivo/portada:** organizaciones y salud de plataforma con métricas realmente disponibles.
- **Navegación:** organizaciones, configuración de plataforma y diagnóstico autorizados; no backoffice operativo por defecto.
- **Consulta/captura:** datos mínimos de administración e incorporación. No usar búsqueda global para eludir aislamiento.
- **Acciones:** crear/gestionar organizaciones e invitar al administrador solo según contrato vigente.
- **Restricción:** sin membresía, el acceso a operación, miembros o auditoría de tenant permanece bloqueado por D-04. No diseñar «Entrar como usuario» ni elevación tácita.
- **Evidencia:** auditoría de administración de plataforma; una etiqueta «PLATFORM» no autoriza revelar identidad de actores.
- **Alertas:** fallos de servicio o incorporación, sin detalles secretos.
- **Colaboración:** administrador de la organización; elevación futura exige política explícita.
- **Canal:** web online; no operación privilegiada offline.
- **Recuperación:** explicar acceso requerido; no ofrecer bypass ni acciones sin implementación.

### 7.3 ORG_ADMIN

- **Objetivo/portada:** equipo, configuración y pendientes de su organización.
- **Navegación:** organización, miembros, invitaciones, catálogos y módulos operativos autorizados.
- **Consulta/captura:** datos organizativos, asignaciones, roles y configuración admitida.
- **Acciones:** incorporar equipo, cambiar roles permitidos, suspender/reactivar según permisos.
- **Restricción:** no conceder privilegios fuera de los propios ni cambiar los propios roles cuando el contrato lo prohíba.
- **Evidencia:** cambios de configuración y permisos auditados; no aprobación de evidencia por ser administrador.
- **Alertas:** invitaciones pendientes, configuración faltante y recursos bloqueados reales.
- **Colaboración:** responsables de operación y soporte de plataforma.
- **Canal:** web; onboarding progresivo con pasos reanudables cuando exista backend.
- **Recuperación:** conflicto de versión, miembro desactivado y organización suspendida con acciones específicas.

### 7.4 MANAGER

- **Objetivo/portada:** entregas, recepciones, lotes y excepciones de operación.
- **Navegación:** operación y control; ocultar administración si no hay permiso.
- **Consulta/captura:** cantidades, tiempos, responsables y faltantes; captura solo en recursos autorizados.
- **Acciones:** abrir una excepción, revisar la entidad y asignar trabajo si el contrato lo permite.
- **Restricción:** gerencia no implica aprobar riesgo, evidencia o expediente.
- **Evidencia:** consultar soportes vinculados; generar únicamente los derivados de acciones reales.
- **Alertas:** diferencias de peso, pendientes y bloqueos con período y entidad.
- **Colaboración:** recepción, calidad, trazabilidad y debida diligencia.
- **Canal:** web/tablet; lectura adaptable sin recortar métricas.
- **Recuperación:** datos no disponibles se muestran como tales; nunca sustituirlos por cero.

### 7.5 FIELD_TECHNICIAN

- **Objetivo/portada:** visitas o registros asignados y cola de sincronización, cuando existan.
- **Navegación:** productores, parcelas, captura y pendientes pertinentes.
- **Consulta/captura:** identidad autorizada, ubicación, geometría, fotografías y notas del contrato.
- **Acciones:** registrar/editar productor o parcela, capturar GPS y adjuntar soportes según permisos.
- **Restricción:** captura no equivale a validar legalidad o aprobar riesgo; no mostrar reglas jurídicas como tarea de campo.
- **Evidencia:** observaciones, coordenadas y fotos con procedencia y hora; no aprobación automática.
- **Alertas:** GPS sin precisión, geometría pendiente, falta de archivo o conflicto.
- **Colaboración:** productor, coordinador y revisor GIS/evidencia autorizado.
- **Canal:** móvil/offline en P0-023/P0-024; web adaptable como apoyo.
- **Recuperación:** conservar borrador, explicar permisos del dispositivo y resolver cada conflicto sin sobrescritura silenciosa.

### 7.6 RECEPTION_OPERATOR

- **Objetivo/portada:** registrar rápidamente el cacao recibido.
- **Navegación:** nueva recepción, pendientes, entregas y lotes autorizados.
- **Consulta/captura:** proveedor/origen, entrega, producto, cantidad, unidad y observaciones definidas.
- **Acciones:** buscar por código/QR cuando esté disponible, pesar y confirmar la recepción.
- **Restricción:** no inventar origen, parcela o cantidad para completar; no alterar eventos cerrados.
- **Evidencia:** comprobante y registro de recepción según contrato; no revisión legal.
- **Alertas:** origen faltante, cantidad inválida, posible repetición o envío incierto.
- **Colaboración:** técnico, calidad e inventario.
- **Canal:** web/tablet con controles grandes; offline solo si ese flujo se implementa y prueba.
- **Recuperación:** consultar si la operación ya se guardó antes de repetir un envío.

### 7.7 QUALITY_OPERATOR

- **Objetivo/portada:** muestras pendientes y resultados por recepción/lote.
- **Navegación:** calidad y relaciones autorizadas con recepción, procesamiento y lote.
- **Consulta/captura:** muestra, método, fecha, parámetros, unidad y responsable del contrato.
- **Acciones:** registrar resultados y clasificar/revisar/liberar únicamente con permiso y transición válida.
- **Restricción:** un resultado de calidad no acredita riesgo bajo ni conformidad EUDR.
- **Evidencia:** análisis o documento de calidad vinculado a muestra y lote; revisión según facultad específica.
- **Alertas:** dato fuera de regla, muestra incompleta o resultado obsoleto.
- **Colaboración:** recepción, procesamiento y trazabilidad.
- **Canal:** web/tablet; campos numéricos adecuados.
- **Recuperación:** distinguir error de captura y desviación de calidad; permitir corrección trazable cuando corresponda.

### 7.8 TRACEABILITY_MANAGER

- **Objetivo/portada:** recorrer cadena, detectar vínculos faltantes y revisar balance.
- **Navegación:** lotes, trazabilidad, movimientos, eventos y evidencia autorizada.
- **Consulta/captura:** relaciones, cantidades, unidades y referencias; correcciones según contrato.
- **Acciones:** explorar upstream/downstream, abrir origen y gestionar inconsistencias permitidas.
- **Restricción:** no fabricar conexiones ni editar históricos desde el grafo.
- **Evidencia:** relaciones y eventos respaldados; aprobar solo si existe permiso distinto.
- **Alertas:** eslabón faltante, cantidad inconsistente o análisis incompleto.
- **Colaboración:** recepción, inventario, procesamiento y EUDR_MANAGER.
- **Canal:** web; árbol/grafo con alternativa tabular.
- **Recuperación:** un nodo inaccesible no revela información de otro tenant.

### 7.9 EUDR_MANAGER

- **Objetivo/portada:** evaluaciones, mitigaciones y expedientes que requieren acción.
- **Navegación:** riesgo, evidencia, mitigación, verificación y debida diligencia.
- **Consulta/captura:** factores, justificaciones, responsables, decisiones y evidencias del contrato.
- **Acciones:** evaluar, solicitar soporte, verificar o aprobar solo con facultad específica.
- **Restricción:** no saltar etapas ni equiparar «LOW» con riesgo jurídicamente insignificante.
- **Evidencia:** motivos, fuentes y versión de reglas; autoría y revisión diferenciadas.
- **Alertas:** faltantes, documentos vencidos, mitigación pendiente y evaluación obsoleta.
- **Colaboración:** técnicos, trazabilidad, exportación y revisores.
- **Canal:** web online para decisiones del servidor.
- **Recuperación:** explicar cada bloqueo y mantener decisión anterior/historial accesible.

### 7.10 EXPORT_MANAGER

- **Objetivo/portada:** preparación y bloqueos de embarques.
- **Navegación:** embarque, lotes, comprador, documentos y expediente autorizados.
- **Consulta/captura:** destino, producto, cantidades y referencias del contrato.
- **Acciones:** preparar, revisar y generar paquetes; liberar solo con regla y permiso reales.
- **Restricción:** generar un ZIP/PDF no equivale a envío a TRACES ni autorización de despacho.
- **Evidencia:** paquete, versión, hora, autor y entidades incluidas.
- **Alertas:** lote no disponible, diferencia de balance o soporte pendiente.
- **Colaboración:** EUDR_MANAGER, trazabilidad, calidad y comprador.
- **Canal:** web; controles de descarga con autorización.
- **Recuperación:** regeneración versionada o consulta de job; no repetir una publicación incierta sin revisar resultado.

### 7.11 BUYER

- **Objetivo/portada:** información y soportes del lote/embarque compartido.
- **Navegación:** portal propio; no sidebar del backoffice.
- **Consulta/captura:** consulta autorizada; comentarios/solicitudes son FUTURO si no tienen contrato.
- **Acciones:** explorar y descargar solo dentro de una concesión vigente y definida.
- **Restricción:** no acceso público implícito por código, QR, membresía o nombre del rol.
- **Evidencia:** fecha de actualización, alcance compartido y documentos permitidos; sin aprobación operativa.
- **Alertas:** recurso retirado o permiso expirado con mensaje seguro.
- **Colaboración:** responsable de la organización que comparte.
- **Canal:** web adaptable; P1 sujeto al contrato de concesiones entre organizaciones.
- **Recuperación:** solicitar contacto por un canal definido; no mostrar teléfonos o correos personales por defecto.

### 7.12 AUDITOR

- **Objetivo/portada:** reconstruir acciones, versiones y soportes.
- **Navegación:** búsqueda autorizada, entidad, timeline y evidencia.
- **Consulta/captura:** lectura investigativa; observaciones solo si se implementan.
- **Acciones:** filtrar, comparar versiones y exportar según permiso.
- **Restricción:** auditor no es editor de históricos ni administrador global.
- **Evidencia:** procedencia y relación con eventos; no facultad de aprobación inferida.
- **Alertas:** falta de soporte o discontinuidad de historial visible.
- **Colaboración:** responsables del dato y revisores.
- **Canal:** web online; vista imprimible cuando exista.
- **Recuperación:** mostrar límites de la consulta sin afirmar que la historia está completa si no se obtuvo toda.

### 7.13 PRODUCER

- **Objetivo/portada:** «Mi finca»: parcelas, entregas, documentos y pendientes propios. **Implementada (2026-10-23, AJ-02/AJ-03)** en `/organizaciones/{id}/mi-finca`: productor, parcelas con su ubicación, pendientes derivados de lo registrado, «Documentos y soportes» con guía orientativa y «Mis entregas» (solo listado, `delivery:read_own`). Estados distintos: sin permiso, cuenta sin vínculo («Tu cuenta todavía no está vinculada a un productor»), vinculada sin parcelas y error. Vocabulario: «archivo recibido; comprobaciones técnicas completadas», «pendiente de revisión», «revisión humana: aceptada/rechazada por {persona}»; nunca «certificado» ni «validado» sin decir quién, qué y cuándo.
- **Navegación:** pocos destinos, lenguaje claro y móvil primero.
- **Consulta/captura:** sus datos autorizados; captura propia depende del alcance del portal y RBAC.
- **Acciones:** consultar, completar o solicitar corrección cuando el backend lo permita.
- **Restricción:** no asumir que un registro de productor tiene automáticamente cuenta de usuario ni vínculo de identidad.
- **Evidencia:** soportes propios; no aprobar riesgo ni reglas legales.
- **Alertas:** información pendiente y resultado de guardado/sincronización.
- **Colaboración:** técnico y organización asociada.
- **Canal:** móvil; offline condicionado a asignación y política de sesión local.
- **Recuperación:** asistencia comprensible, sin revelar datos de productores vecinos.

## 8. Catálogo de componentes

Todos los componentes comparten tokens y semántica. Los nombres siguientes son propuestas de diseño, no archivos que ya existan.

| Componente | Variantes/estados necesarios | Regla |
|---|---|---|
| `Button` | Primario, secundario, texto, destructivo; default, hover, focus, active, disabled, loading | Nombre verbal; loading evita doble activación y conserva ancho. |
| `IconButton` | Navegación o acción | Nombre accesible; tooltip adicional, no único soporte. |
| `Field` | Texto, email, teléfono, fecha, número, selección | Label persistente, ayuda, obligatorio, error y valor preservado. |
| `Combobox` | Buscar, seleccionado, sin resultados, error | Selección por entidad/código; backend limita opciones al tenant. |
| `StatusBadge` | Neutral, revisión, validado, bloqueo, proceso | Texto e icono; incluir alcance cuando «validado» pueda ser ambiguo. |
| `Alert` | Informativa, advertencia, bloqueo | Qué pasa, consecuencia y siguiente acción disponible. |
| `Toast` | Éxito breve o feedback secundario | No único lugar de un bloqueo, error de campo o resultado crítico. |
| `DataTable` | Carga, datos, vacío, filtrado vacío, error, denegado | Paginación real, orden indicado, acciones autorizadas. |
| `FilterBar` | Aplicado, parcial, sin coincidencias | Filtros visibles, limpiar y volver conservando contexto. |
| `MetricCard` | Valor, carga, no disponible | Nombre, unidad, período, fuente/actualización y destino útil. |
| `EntityHeader` | Lectura/edición/baja/bloqueo | Código, nombre, estado y acciones de la entidad. |
| `Tabs` | Activa, no disponible, denegada | Teclado y selección clara; contenido con carga independiente. |
| `Timeline` | Eventos, correcciones, revisión | Hora del evento y registro si difieren; responsable y evidencia. |
| `Dialog` | Confirmación, formulario breve | Entidad y consecuencia; cancelar seguro; foco controlado. |
| `Drawer` | Resumen contextual | No reemplaza una pantalla de proceso largo. |
| `FileUpload` | Selección, transferencia, escaneo, guardado, rechazo | Cada etapa distinguible; archivo recibido no equivale a aprobado. |
| `EvidenceCard` | Disponible, pendiente, vencida, rechazada, inaccesible | Fuente, fechas, vínculos y estado del contrato. |
| `MapPanel` | Carga, dato, sin capa, error, sin geometría | Leyenda y alternativa tabular. |
| `TraceabilityGraph` | Expandido, colapsado, parcial, error | Nodos autorizados y cantidades/unidades del vínculo. |
| `SyncIndicator` | Local, enviando, sincronizado, fallido, conflicto | Hora y estado reales; enlace a cola. |
| `VersionConflict` | Comparación y resolución | No sobrescribe automáticamente. |
| `PermissionGate` | Acción, sección o link | Facilita presentación; no sustituye autorización en backend. |

### 8.1 Botones e iconos

Primario: fondo verde operación y texto blanco. Secundario: superficie blanca con bosque y borde reconocible. Texto: vínculo/acción de baja prioridad con foco visible. Destructivo: bloqueo y confirmación acorde al impacto. Deshabilitado: motivo cercano si resulta necesario para completar el flujo; no depender de tooltip inaccesible.

M1 exige iconos vectoriales de caja 24 × 24 px y trazo uniforme 1.75–2 px; navegación 20–24 px y junto a texto 16–20 px. Mantener una familia consistente. No incorporar una dependencia nueva sin revisar el proyecto y su licencia.

| Concepto | Semántica de icono UX-V1 |
|---|---|
| Productor | Persona. |
| Parcela | Polígono/territorio. |
| Entrega/recepción | Movimiento de entrada. |
| Lote | Contenedor/producto agrupado. |
| Trazabilidad | Nodos conectados. |
| Procesamiento | Transformación. |
| Documento/evidencia | Archivo y soporte contextual. |
| Riesgo | Advertencia identificable. |
| Auditoría | Historial. |
| Debida diligencia | Expediente/checklist. |
| Exportación | Embarque; diferenciar de «descargar archivo». |
| Sincronización | Transferencia y estado. |

### 8.2 Formularios y tablas

Ordenar por tarea; agrupar identidad, ubicación, operación y soporte. Validar al salir del campo o al enviar, evitando errores prematuros mientras se escribe. En envío inválido, resumen con vínculos a campos y foco al primer problema pertinente. La respuesta de servidor prevalece.

Campos opcionales se identifican; obligatoriedad proviene de contrato. No usar placeholder como etiqueta. Conservar datos tras un error recuperable. Confirmar al salir de un formulario con cambios sin guardar; el autoguardado solo se anuncia si existe persistencia comprobada.

Tablas: columnas esenciales primero, cantidades alineadas y unidad visible. Selección masiva se limita al alcance que el usuario entiende; no decir «todos» si solo están seleccionados los registros de una página. Exportaciones y acciones masivas se autorizan y validan en servidor.

## 9. Estados, errores y permisos

Separar cuatro dimensiones: **ciclo de negocio**, **calidad/validación**, **riesgo** y **persistencia/sincronización**. Un registro puede estar activo, con geometría por revisar, riesgo sin evaluar y una edición pendiente de sincronización al mismo tiempo.

### 9.1 Estados de presentación

| Situación | Texto modelo | Respuesta UI |
|---|---|---|
| Carga inicial | «Cargando productores…» | Skeleton y estado accesible, sin cifras inventadas. |
| Vacío autorizado | «Aún no hay productores registrados.» | Crear si tiene permiso. |
| Filtro sin coincidencias | «No encontramos resultados con estos filtros.» | Limpiar o ajustar. |
| Datos faltantes | «Falta registrar la ubicación.» | Acción permitida para completarla. |
| Solo lectura | «Puedes consultar este registro.» | Explicar edición no disponible cuando sea relevante. |
| Organización suspendida | «La organización está suspendida. Las escrituras están bloqueadas.» | Mantener lectura solo si el contrato lo admite. |
| Operación guardada | «Productor guardado.» | Mostrar resultado confirmado y contexto. |
| Resultado incierto | «No pudimos confirmar si se guardó.» | Consultar estado antes de repetir. |
| Proceso en servidor | «Preparando el paquete…» | Estado de job y resultado persistente. |
| Resultado obsoleto | «Hay una versión más reciente.» | Recargar/reevaluar mediante acción autorizada. |

### 9.2 Respuestas HTTP y recuperación

| Resultado | Tratamiento |
|---|---|
| 400/422 | Identificar campos o referencias inválidas sin revelar recursos ajenos. |
| 401 | Pedir nueva autenticación; proteger borradores conforme a política local. |
| 403 | «No tienes permiso para realizar esta acción.» No convertirlo en «sin registros». |
| 404 | «El recurso no está disponible.» No confirmar existencia en otra organización. |
| 409 | Mostrar conflicto de versión o regla; ofrecer revisión sin pérdida de captura. |
| 413/415 | Explicar límite/formato permitido según contrato de archivos. |
| 429 | Mostrar espera según `Retry-After`; no revelar si una cuenta existe. |
| 503 | Indisponibilidad temporal; reintento controlado, sin confundirlo con credenciales. |
| 500 u otro inesperado | Mensaje seguro y referencia de soporte si existe; sin stack ni secretos. |
| Sin conexión | Distinguir caída de red de 503; indicar si hay guardado local disponible. |

El informe más reciente de acceso describe `LOGIN_TEMPORARILY_UNAVAILABLE` con 503 y `Retry-After: 30` ante indisponibilidad de Redis. Comprobar el contrato real antes de conectarlo. No emitir éxito ni sesión ante un rechazo de servicio.

No cargar datos sensibles para ocultarlos después. Cuando una sección carece de permiso y no revela existencia protegida, puede explicar la restricción; de otro modo se omite o utiliza la respuesta segura del servidor.

## 10. Acceso, organizaciones y usuarios

### 10.1 Login

Layout simple con marca, correo, contraseña, mostrar/ocultar contraseña y «Iniciar sesión». Permitir pegar y usar gestor de contraseñas. No ofrecer recuperación, registro público, OIDC o verificación por correo hasta tener implementación.

Flujo: enviar credenciales → respuesta real → selección de organización si corresponde → workspace permitido. Conservar correo ante error; contraseña se gestiona según política de seguridad. No mostrar organizaciones antes de autenticar.

Los límites de login 5/20/50 en 15 minutos se mantienen como política provisional del proyecto; no son valores que la UI redefine. Traducir el tiempo recibido a una explicación comprensible.

### 10.2 Organización

Listado y ficha: nombre, tipo, ubicación y estado según contrato; acciones de editar/suspender/reactivar autorizadas. Conflicto de edición con versión; suspensión confirma entidad y efectos sobre escrituras. El tipo comercial no concede roles o permisos.

El catálogo D-18 sigue provisional. Las etiquetas visibles están en español; códigos internos provienen del catálogo, no de una enumeración duplicada en frontend.

### 10.3 Miembros, roles e invitaciones

Miembros: nombre autorizado, correo cuando corresponda, roles en esta organización, estado y acciones. Explicar efectos distintos de desactivar una membresía y desactivar una cuenta global. Reactivar no debe prometer restauración de sesiones revocadas.

Invitar: destinatario, roles concedibles y vencimiento del contrato. Mostrar solo roles que el usuario puede otorgar; el backend aplica anti-escalamiento de nuevo. No permitir edición de los propios roles cuando esté prohibida.

D-19 mantiene entrega manual por enlace provisional. El enlace se muestra/copia solo al usuario autorizado; no incluirlo en logs, auditoría, analítica o ejemplos de documentación. Advertencia: «Este enlace permite aceptar la invitación. Compártelo únicamente con la persona invitada.»

La aceptación muestra organización y destinatario según contrato; no deja cambiarlos ni seleccionar otro rol. Token vencido/revocado/reutilizado tiene mensaje recuperable sin fuga de información. Mantener tratamiento por fragmento y limpieza de URL reportados, si están presentes en código. Aceptar no verifica el correo.

### 10.4 Onboarding futuro

Organización → equipo → catálogos/centros disponibles → productores → parcelas → importación → revisión. Mostrar pasos pendientes reales; permitir retomar si hay persistencia. No impedir una operación válida por un checklist de marketing ni crear módulos que no existen para completar el wizard.

## 11. Mi trabajo y centro de operaciones

**Objetivo:** responder «¿qué debo hacer ahora?» con tareas o faltantes observables. No crear un motor de tareas ficticio a partir de tarjetas estáticas.

| Elemento | Contenido |
|---|---|
| Encabezado | Organización, fecha/período y filtro personal/equipo si hay permiso. |
| Prioridad | Bloqueos, vencimientos y acciones; prioridad proviene de regla explicable. |
| Fila de trabajo | Entidad, motivo, responsable, plazo, evidencia requerida y acción. |
| Indicadores | Numerador/denominador, unidad, período y actualización. |
| Actividad | Eventos recientes autorizados; hora y vínculo a entidad. |

Una acción conduce al contexto y vuelve conservando filtros. Completar una tarea actualiza la cola a partir del resultado confirmado. Estados vacíos: «No tienes pendientes en este período», «No hay tareas asignadas» o «No pudimos cargar los pendientes», según corresponda.

Para gerencia: volúmenes y excepciones. Para recepción: entrada rápida. Para campo: jornada y sincronización. Para auditor/comprador: búsqueda/consulta pertinente. No mostrar la misma portada a todos.

## 12. Productores

### 12.1 Listado y búsqueda

Columnas base: código, nombre autorizado, comunidad/ubicación, estado y responsable si el modelo lo incluye. Búsqueda por nombre/código; documento de identidad solo con permiso específico y tratamiento seguro. Filtros y paginación provienen del API.

Acciones: registrar, abrir, editar y baja lógica según permisos. Exportar/importar únicamente al implementar su historia. P0-005 define códigos/uniqueness: no implementar fusión o deduplicación avanzada desde este formulario.

### 12.2 Registro y edición

| Grupo | Campos de F1 que deben contrastarse con contrato |
|---|---|
| Identidad | Código, nombres, apellidos, tipo y número de documento. |
| Contacto | Teléfono, dirección y comunidad. |
| Ubicación administrativa | Provincia, cantón y parroquia. |
| Operación | Estado; técnico/responsable si existe en el modelo. |

La tabla no fija obligatoriedad, longitud o formato. Las reglas de identificación dependen del contrato y del tipo de documento. No convertir ejemplos en validadores jurídicos. Responsable se selecciona entre miembros elegibles de la misma organización.

Flujo: listado → registrar → validación → guardar → detalle. En edición, enviar versión y manejar 409. Tras guardar, nombre/código, hora y resultado real. No exigir foto, correo o coordenadas como obligación inventada.

### 12.3 Ficha e historia

Resumen, parcelas, entregas, documentos/evidencia e historial; producción/riesgo/trazabilidad aparecen al existir y estar autorizados. Cada relación abre una entidad real con contexto conservado.

Baja lógica: identificar productor y consecuencia del contrato, capturar motivo si es exigido y conservar historia. No borrar parcelas/entregas en cascada desde la UI. Desactivación no equivale a desaparición del origen histórico.

## 13. Parcelas, mapas y captura GIS

### 13.1 Ficha

Código/nombre, productor autorizado, cultivo, ubicación, superficie declarada/calculada, estado de geometría, última captura y acciones. Separar «Ubicación capturada», «Geometría válida» y «Análisis revisado».

Mapa y datos se complementan: vista de coordenadas, superficies y fuente también en tabla. La edición de geometría abre una tarea específica; no confundir zoom/selección con modificación.

### 13.2 Mapa principal

Buscar, filtrar, seleccionar parcela, ver leyenda, activar capas disponibles y consultar ficha lateral. Cada capa externa muestra proveedor, dataset/versión cuando exista, fecha, resolución y método. Si la capa falla, mantener los datos propios disponibles y señalar el fallo.

UX-V1: contorno bosque de parcela, relleno tenue y halo de selección. El riesgo se representa como capa separada con símbolo y leyenda; la selección no modifica su significado. Para alertas superpuestas, emplear patrones/contornos identificables y explicar la leyenda.

No publicar coordenadas precisas sin autorización. El mapa solo solicita entidades y teselas acordes a permisos. Un recuento agregado también puede revelar datos; debe provenir de una consulta autorizada.

### 13.3 GPS y polígonos

Pantalla de captura: productor/parcela, conexión, permiso de ubicación, método, hora, precisión reportada y puntos/vértices. Distinguir captura GPS, dibujo manual e importación; no atribuir precisión GPS a un dibujo.

Mostrar unidades y sistema de referencia. La presentación humana etiqueta latitud y longitud; si el contrato usa GeoJSON, explicar su orden longitud/latitud en importación/exportación. El número de decimales no acredita precisión.

Cuando haya precisión por vértice, mostrar muestras sin precisión informada. No describir todo el polígono mediante la mejor muestra o una precisión agregada incompleta. Umbrales, unidades y regla de agregación son CONTRATO.

Captura: iniciar → registrar punto/vértices → revisar → validar localmente si procede → guardar → estado de servidor o cola. Permitir corregir el último punto mediante controles identificables. Geometría inválida conserva la captura para revisión; no ajustar silenciosamente linderos.

### 13.4 Validación y satélite

Presentar cada resultado: problema, ubicación si se conoce, severidad, regla/versión, evidencia y acción. Estados de F1: `VALID`, `WARNING`, `INVALID`, `REVIEW_REQUIRED`; traducciones se vinculan al contrato real.

La fuente inicial describe una regla de área para punto/polígono, pero no resuelve todos los límites. No fijar aquí «4 ha», caso exacto de frontera ni precisión decimal como lógica jurídica. Usar configuración versionada y registrar casos no definidos antes de implementar.

Análisis satelital: solicitado, en cola, en proceso, fallido o disponible según contrato de job. Resultado muestra fecha de análisis y del dataset, fuente y límites. Una alerta de cobertura requiere interpretación; no escribir «deforestación confirmada» por el solo resultado de un proveedor.

## 14. Entregas, recepción y calidad

### 14.1 Entrega

Pasos previstos: identificar origen → producto y cantidad/unidad → fecha/lugar/responsable según contrato → revisión → confirmar. No introducir pasos vacíos para parecer un wizard. Foto o documento solo obligatorios cuando la regla lo establezca.

Mostrar relación productor/parcela y no permitir referencias cruzadas. Si falta origen, marcar faltante real y condición de avance, sin autocompletar con una parcela arbitraria.

### 14.2 Recepción

Atajo «Nueva recepción» y búsqueda por código disponible. Resumen previo a confirmar: origen, entrega, producto, cantidad, unidad y registro de peso pertinente. Tolerancias, peso bruto/tara/neto y liberación son CONTRATO; no inventar campos obligatorios.

Un clic de envío queda protegido contra repetición. Si la conexión se pierde después de enviar, consultar identificador de operación/resultado disponible antes de crear otra recepción. Corrección posterior conserva evento original.

### 14.3 Calidad y procesamiento

Registrar muestra, método y resultados definidos; fecha y responsable. Parámetros y límites provienen de catálogo/reglas. «7.2 % de humedad» no implica automáticamente «aprobado».

Vincular calidad a recepción/lote/proceso. Si se permite liberar/rechazar, mostrar efecto, motivo exigido y rol autorizado. Las unidades se mantienen visibles durante captura, comparación y reporte.

## 15. Lotes, procesamiento y balance de masa

### 15.1 Lot Hub

El lote es un centro de navegación. UX-V1 propone siete agrupaciones para evitar doce pestañas simultáneas; se ajustan a permisos y datos reales.

| Sección | Contenido |
|---|---|
| Resumen | Producto, estado, cantidades, actualización y alertas. |
| Origen y trazabilidad | Productores/parcelas/entregas autorizados y grafo. |
| Operación | Entradas, procesamiento, calidad, inventario, movimientos y salidas. |
| Evidencias | Documentos y relaciones probatorias. |
| Riesgo y debida diligencia | Evaluaciones, mitigaciones y expedientes. |
| Destino | Embarques, cantidades y referencias permitidas. |
| Historial y acceso | Eventos/auditoría y alcance de acceso visible. |

No requerir navegar entre módulos para entender un lote. La ausencia de una sección por permiso se diferencia de un dato faltante cuando hacerlo no revela información protegida.

### 15.2 Procesamiento

Seleccionar entradas elegibles → registrar transformación y datos del contrato → revisar salidas/mermas → confirmar/cerrar. Mostrar disponibilidad actual del servidor; si cambia durante la edición, explicar el conflicto y recalcular con datos nuevos.

Un proceso cerrado se consulta; correcciones o reaperturas requieren operación explícita autorizada, motivo y trazabilidad. No reemplazar historia mediante edición visual directa.

### 15.3 Balance de masa

Presentar entradas, salidas, pérdidas y saldo para un alcance/período definidos. No sumar cantidades de unidades o productos incompatibles sin conversión del contrato. No restar dos veces una salida de procesamiento al consolidar inventario.

Ejemplo didáctico, no dato real: **800 kg de entradas − 750 kg de salida − 50 kg de pérdida = 0 kg de saldo**. El ejemplo de balance numéricamente inconsistente presente en F2 no se utiliza como regla de implementación.

El servidor calcula y valida. Mostrar diferencia, regla, posible causa y acción permitida. Excepciones administrativas solo si tienen contrato; no diseñar «forzar saldo» por el nombre del rol.

## 16. Explorador de trazabilidad

Entrada desde productor, parcela, entrega, lote o embarque. Cambiar entre **Origen**, **Proceso interno** y **Destino**; permitir árbol/grafo y tabla equivalente.

| Elemento | Información mínima autorizada |
|---|---|
| Nodo | Tipo, referencia visible, estado y vínculo de detalle. |
| Relación | Origen/destino, tipo de movimiento, cantidad y unidad cuando aplica. |
| Evidencia | Soporte relacionado y alcance de acceso. |
| Panel de detalle | Evento, responsable permitido, fecha y relaciones. |
| Faltante | Vínculo incompleto explícito, sin inferir una conexión. |

Expandir bajo demanda para grafos grandes; conservar nodo seleccionado. Teclado y tabla deben permitir localizar relaciones sin arrastrar. No usar posición gráfica para inventar orden temporal.

La trazabilidad de mezclas permite reconstruir relaciones y asignaciones registradas; no promete identificar físicamente un grano después de mezclarlo. Los porcentajes y volúmenes se muestran solo con método y datos disponibles.

No incluir nombres de productores, cantidades, códigos o conteos de otro tenant como «nodos ocultos». El contrato determina si puede mostrarse una referencia abstracta a un eslabón no compartido.

## 17. Documentos y centro de evidencias

### 17.1 Distinción

**Documento:** archivo con metadatos. **Evidencia:** soporte relacionado con una entidad, evento o afirmación, cuya fuente y revisión pueden explicarse. Cargar un PDF no valida la afirmación ni convierte el documento en evidencia aprobada.

| Pantalla | Contenido y acción |
|---|---|
| Centro de documentos | Tipo, entidad, fuente, emisión/vencimiento, estado y autor autorizado. |
| Carga | Seleccionar archivo, metadatos, entidad y resultado de cada etapa. |
| Ficha | Vista segura, metadatos, versiones, relaciones y revisión. |
| Centro de evidencias | Afirmación/requisito, soportes, faltantes y decisión. |
| Relación probatoria | Qué respalda, cómo, fuente, vigencia y estado. |

### 17.2 Carga, seguridad y versiones

Transferencia → procesamiento/escaneo si implementado → registro → vinculación → revisión. Cada etapa tiene resultado observable. Formatos y tamaños vienen del contrato; no prometer OCR, antivirus o extracción que no estén funcionando.

Un archivo rechazado muestra motivo seguro y opción permitida. No abrir contenido pendiente de controles requeridos. Descarga y previsualización usan autorización del servidor, no una URL pública persistente. Tokens o enlaces firmados no aparecen en logs de producto.

Subir nueva versión conserva anterior cuando el contrato lo dispone. Evidencia vencida o sustituida no desaparece de una decisión histórica. Revisar/validar/rechazar exige facultad específica, motivo y registro; el autor no se considera automáticamente revisor.

### 17.3 Explicación de una afirmación

Vista propuesta: «Origen de este lote» → relaciones autorizadas → soportes disponibles → faltantes → última revisión. No escribir «Cumplimiento demostrado» si solo se comprobó identidad o geolocalización.

Dato real, ilustración, resultado modelado y evidencia revisada llevan identificación diferenciada. Imágenes generadas nunca se usan como evidencia de productor, parcela o visita.

## 18. Riesgo, mitigación y debida diligencia

### 18.1 Riesgo explicable

Mostrar entidad, categoría, nivel, score si existe, fecha de evaluación, factores, evidencia, versión de reglas y responsable/decisión autorizados. «No evaluado» no es cero ni riesgo bajo.

F1 enumera deforestación, legalidad, mezcla, cadena, credibilidad documental, trazabilidad, elusión, derechos humanos, derechos indígenas y calidad de datos. Conservar códigos del catálogo y traducir etiquetas; no duplicar pesos o umbrales en el cliente.

Separar **nivel de riesgo** (bajo/medio/alto/crítico) de **gestión** (en revisión/mitigación requerida/resuelto), conforme al modelo final. Una revisión resuelta no convierte por sí sola el nivel en bajo.

Una tarjeta responde: resultado → por qué → soporte → qué falta → siguiente acción. No prometer cuánto reducirá el score adjuntar un documento; la reevaluación real determina el efecto.

### 18.2 Mitigación

Caso → acción → responsable → plazo → evidencia → revisión → resultado. Mostrar quién ejecuta y quién verifica cuando el contrato lo distingue. Rechazo conserva soporte y motivo; la corrección abre una nueva entrega/revisión.

Plazos y prioridades deben ser configurados o derivados de regla. Alertas con entidad y acción, sin revelar datos por email/notificación fuera del alcance.

### 18.3 Expediente y paquete

F1 propone estados de expediente: `DRAFT`, `DATA_COLLECTION`, `RISK_ASSESSMENT`, `MITIGATION`, `VERIFICATION`, `READY`, `EXPORTED`, `CLOSED`, `REOPENED`. Son referencia de diseño; usar el enum real y sus transiciones. No trasladar estados de otros proyectos.

| Bloque de expediente | Información |
|---|---|
| Datos | Operador, producto, cantidad, período, país y actores según contrato. |
| Origen | Parcelas y relaciones de trazabilidad. |
| Riesgo | Evaluación y fuentes. |
| Mitigación | Acciones, responsables y revisión. |
| Verificación | Decisiones y soportes. |
| Preparación | Checklist de reglas con faltantes y versión. |
| Paquete | Resultado generado, autor, hora, versión y contenido. |

Cada bloque puede estar completo, incompleto, bloqueado o sin revisar según contrato. Un porcentaje de completitud no equivale a elegibilidad regulatoria. Una transición bloqueada explica reglas incumplidas y enlaces a resolución autorizada.

**«Listo para revisión/generación»**, **«paquete generado»** y **«presentado ante sistema externo»** son hechos diferentes. Mostrar presentación externa únicamente con integración y acuse reales. La preparación de información no constituye una DDS automáticamente presentada.

## 19. Exportación y portal comprador

### 19.1 Embarque/exportación

Ficha prevista: referencia, comprador/destino autorizados, producto, lotes, cantidades, documentos, verificaciones y bloqueos. El checklist usa resultados del servidor, no checks editables para saltar controles.

Generar paquete: confirmar alcance → job si aplica → resultado → descargar versión. Mostrar fallos parciales y no rotular «éxito» si falta un archivo requerido. «Exportar datos» y «despachar embarque» tienen etiquetas e iconos distintos.

### 19.2 Portal comprador, FUTURO/P1

Presentación: lote/embarque → origen compartido → trazabilidad → evidencia → revisión y paquete disponibles. Encabezado con organización que comparte, fecha de actualización y alcance.

Ocultar identificaciones, contactos, coordenadas exactas y documentos no compartidos. Los resúmenes también se autorizan. Antes de implementarlo debe existir contrato de concesión, vigencia, revocación, descarga y auditoría. D-04 no sustituye ese contrato.

QR/referencia pública no equivale a acceso anónimo. Cualquier vista pública se diseña mediante un alcance específico, no reutilizando un endpoint privado sin sesión.

## 20. Auditoría, reportes e importación

### 20.1 Auditoría

Filtros por entidad, acción, actor permitido y período; timeline y comparación de campos. Mostrar qué cambió, cuándo se registró, quién lo hizo y soporte vinculado. La bitácora es de consulta; no ofrecer editar/borrar registros.

Eventos operativos y auditoría son conceptos distintos: los primeros describen hechos de dominio y la segunda registra acciones/cambios. Si ambos aparecen, diferenciar tipo y no duplicar artificialmente el número de actividades.

### 20.2 Reportes

Seleccionar alcance, filtros y formato soportado; previsualizar cuando sea posible; generar y descargar con estado real. Incluir organización, período, unidades, versión/fecha y autor autorizado. Respetar permisos de campos tanto en pantalla como en exportación.

**Vocabulario de estados de un indicador (P0-030).** Un valor ausente no es un cero, y no todas las ausencias son iguales. La pantalla distingue cinco, con texto además de color:

| Estado | En pantalla | Cuándo |
|---|---|---|
| `OK` | El valor | Calculado desde la base. **Un 0 es un cero observado** y se muestra como número, no como aviso. |
| `NO_DENOMINATOR` | «Sin denominador» | El denominador es cero: el cociente no existe. Ni 0 % ni 100 %. |
| `UNKNOWN` | «Desconocido» | El universo se conoce, pero la condición no ha sido evaluada en ningún sujeto. |
| `CRITERION_UNDEFINED` | «Criterio sin definir» | El criterio carece de definición aprobada (p. ej. D-05) y aún no puede evaluarse. |
| `RESTRICTED` | «Sin permiso» | El rol no tiene el permiso de ese dominio; no se muestra valor, conteo ni desglose. |

Junto al estado se publica lo **observado**: los conteos que sí se pueden hacer aunque el indicador principal no sea un número (parcelas sin evaluar, sujetos sin severidad, expedientes bloqueados). Nunca se usan para rellenar el valor principal.

En los reportes por entidad, un sujeto sin evaluar **aparece en la tabla** rotulado como tal; no se omite. Las cantidades se muestran y se totalizan **por unidad**. Una descarga declara si es la instantánea mostrada o un recálculo con nueva fecha.

### 20.3 Importación Excel, P0-026

| Paso | Comportamiento |
|---|---|
| Plantilla | Descargar formato versionado y reglas de campos. |
| Selección | Formato/tamaño permitido; organización activa inequívoca. |
| Mapeo | Columnas y campos con ejemplos de esa carga. |
| Previsualización | Filas, faltantes y referencias; sin guardar todavía. |
| Validación | Errores por fila/columna y advertencias separadas. |
| Confirmación | Indicar modalidad de importación y tratamiento de repetidos. |
| Resultado | Creados, actualizados, omitidos y fallidos; informe descargable autorizado. |

Atomicidad total o importación parcial debe decidirse en backend y explicarse antes de confirmar. No elegir silenciosamente una modalidad. No deduplicar por nombre ni fusionar productores fuera de P0-005/contrato.

Datos faltantes permanecen como desconocidos/faltantes/no validados según modelo. No completar por imaginación para alcanzar 100 %.

## 21. Móvil, trabajo offline y sincronización

Offline es una capacidad de P0-023/P0-024, no una propiedad automática del responsive web. La UI web no anuncia «guardado local» sin almacenamiento y protección implementados.

### 21.1 Navegación móvil UX-V1

Hasta cinco destinos principales pertinentes: jornada/inicio, productores, captura/parcelas, entregas si habilitadas y pendientes. Alinear menú con permisos efectivos; no exhibir módulos administrativos complejos al técnico o productor.

Controles mínimos 44 × 44 px según M1; 48 px recomendados en campo. Formularios por tarea, lectura a luz exterior, valores y unidades grandes. No depender de gestos ocultos, arrastre preciso o conectividad constante.

### 21.2 Preparación y sesión

Antes de salir: sesión autorizada, organización/dispositivo, datos asignados descargados, archivos/capas disponibles y última sincronización. Advertir qué falta y cuánto almacenamiento requiere cuando se conoce.

No prometer login nuevo sin conexión ni acceso indefinido con sesión vencida. La política de sesión local, retención, cifrado y desactivación debe estar definida. Si cambia usuario/tenant, no reutilizar datos del anterior.

### 21.3 Estados de persistencia

| Estado UX | Qué significa | Acción |
|---|---|---|
| Borrador local | Captura no enviada; solo si fue persistida | Continuar/guardar según contrato. |
| Pendiente | Operación en cola local | Consultar cola. |
| Enviando | Transferencia activa | No crear otro envío manual equivalente. |
| Enviado/en validación | Servidor recibió, aún sin aceptación final cuando aplica | Esperar/consultar resultado. |
| Sincronizado | Servidor confirmó aceptación | Ver hora y entidad/version. |
| Fallido | Operación no aceptada o transferencia fallida | Ver motivo y recuperación. |
| Conflicto | Diferencia que requiere decisión | Comparar versiones autorizadas. |
| Bloqueado por acceso | Permiso/sesión/organización cambió | Autenticar/contactar responsable; no borrar captura automáticamente. |

Archivo y registro pueden avanzar por separado: «Registro sincronizado; fotografía pendiente» es válido; «Todo sincronizado» sería incorrecto. Mostrar hora de captura y recepción sin atribuir la misma fecha a ambos hechos.

### 21.4 Resolución de conflictos

Vista con campo/versión local, versión servidor, fechas y acciones permitidas. Si el conflicto afecta geometría o dato crítico, abrir revisión especializada. No aplicar «última escritura gana» silenciosamente.

El benchmark F3 sugiere automatización de conflictos, pero F1 exige revisión explícita. UX-V1 adopta esa preservación: automatizar reintentos y reconocimiento de operaciones idénticas cuando el backend lo soporte, no decisiones que pierdan información.

Cerrar la app y reiniciarla debe conservar la cola conforme a política. Logout/cambio de organización con pendientes explica efectos; eliminación de borradores requiere acción explícita y no revoca la historia ya aceptada por servidor.

### 21.6 Estado implementado en la app Expo (2026-10-28)

Cinco pestañas: Inicio, Captura, **Altas**, Pendientes, Diagnóstico (etiqueta a una línea, ajustable a 80 %). «Altas» muestra solo los formularios que los permisos efectivos permiten (productor, parcela, entrega); sin ninguno, dice que el rol no registra altas y que no falta descargar nada. Un rechazo se presenta con su código y una de dos salidas: *Puedes corregirlo* (campos corregibles + reenviar, el rechazo queda en el historial) o *Requiere una intervención externa* (sin reintento inútil). Estado vacío de productores: se explica que hay que sincronizar. La tarjeta **Mapa** de la captura declara si hay cartografía preparada, si la zona está fuera de ella o si falta; el mapa solo dibuja y no guarda. Los deslizamientos sobre el mapa lo mueven: la página se desplaza por los bordes (mejora pendiente). Evidencia: `docs/qa/EVIDENCIA_MOVIL_ALTAS_MAPA_2026-10-28.md`.

## 22. Contenido, localización y privacidad

### 22.1 Voz

Rigurosa, clara, cercana a la operación y responsable (M1). Mensajes breves con causa y acción. El tono del producto se mantiene consistente; no alternar «tú» y «usted» en la misma superficie. UX-V1 usa «tú» en mensajes operativos y verbos neutros en botones.

| Preferir | Evitar |
|---|---|
| «Revisa el origen y las evidencias del lote.» | «Cumplimiento garantizado». |
| «Geometría validada el [fecha].» | «Parcela certificada» por validación técnica. |
| «Paquete de evidencia generado.» | «DDS presentada» sin acuse externo. |
| «No tienes permiso para editar.» | «Sin datos» frente a 403. |
| «Guardado en este dispositivo; pendiente de sincronización.» | «Guardado» ambiguo sin destino. |
| «El análisis requiere revisión.» | «La IA confirmó la legalidad». |

### 22.2 Formatos UX-V1

Español primero. Localización inicial propuesta `es-EC`, con fecha/zona definidas por organización o usuario. Mostrar fecha legible y zona cuando afecte la interpretación. Almacenar/intercambiar según contrato; el formato de pantalla no modifica timestamps.

Cantidades con unidad explícita; superficies en ha cuando corresponda; humedad en %. Formatear con utilidades de locale y evitar separadores ambiguos durante entrada/importación. Precisión y redondeo son del contrato. Moneda solo en módulos comerciales existentes.

Topónimos, Ñ y tildes se conservan. Códigos/referencias no se traducen. Coordenadas son numéricas con etiquetas y CRS; la interfaz no trunca silenciosamente los datos exportados.

### 22.3 Privacidad

Mostrar solo datos necesarios. Identidad, teléfono, domicilio, documentos legales y geolocalización requieren alcance autorizado. Enmascarado UX no sustituye filtrado de respuesta del servidor.

No incluir datos personales/tokens en URLs de búsqueda, telemetría, capturas de QA o ejemplos. Los datos sintéticos se identifican como demostración. Fotografías reales requieren autorizaciones de uso pertinentes; no folclorizar a productores ni tratarlos como decoración de dashboards.

Notificaciones y telemetría futura no se habilitan por este documento. Deben acordarse canales, consentimiento cuando aplique, destinatarios y retención. Métricas de uso no necesitan contenidos de documentos o números de identidad.

## 23. Accesibilidad y comportamiento adaptable

Objetivo: WCAG 2.2 AA; M1 exige contraste verificable, foco, teclado, etiquetas y zoom 200 %. No afirmar conformidad sin evaluación. Referencia: [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/).

Comprobar texto normal 4.5:1, texto grande 3:1 y contornos/indicadores relevantes 3:1 según criterio aplicable. No depender solo del color. Foco visible y no oculto; orden lógico, nombres accesibles y errores asociados a campos. Admitir teclado, lector de pantalla, ampliación y reflow a 320 CSS px; mapas/tablas pueden requerir distribución bidimensional, con alternativa útil. Evitar autenticación basada en recordar/transcribir cuando admite gestores y pegado. El mínimo táctil de 44 px viene de M1 y es una regla de producto, no el mínimo AA de WCAG 2.2, que es 24 px con excepciones.

### 23.1 Adaptación UX-V1

| Rango orientativo | Comportamiento |
|---|---|
| Menos de 768 px | Una columna, menú en panel, acciones visibles, formularios apilados. |
| 768–1199 px | Sidebar colapsable, dos columnas cuando el contenido lo permita. |
| Desde 1200 px | Sidebar completa, resumen + detalle, mapa/grafo con panel lateral. |

Son breakpoints propuestos y deben ajustarse al contenido, no al modelo de dispositivo. Probar 360, 390, 768, 1280 y 1440 px además del reflow requerido. No eliminar funciones esenciales en móvil; ofrecer otro patrón.

Tablas anchas: desplazamiento contenido o tarjetas que conservan columnas esenciales y acciones. Gráficos/mapas: selección también por lista/búsqueda. Dialog: al abrir, foco apropiado; al cerrar, retorno al disparador; Escape/cancelar cuando proceda. Barra fija no tapa foco ni último campo.

En web usar controles HTML adecuados antes de agregar ARIA. En móvil nativo, emplear las propiedades de accesibilidad de la plataforma y probar lector de pantalla del dispositivo. Toda librería elegida se verifica por comportamiento, no por etiqueta comercial de «accesible».

## 24. Contratos de implementación

### 24.1 Responsabilidades

| Capa | Responsabilidad |
|---|---|
| Backend | Autorización, aislamiento, catálogos, reglas, transiciones, validación final, auditoría y cálculos. |
| Frontend | Presentación, navegación, validación inmediata coherente, formularios, feedback y accesibilidad. |
| Móvil/sync | Persistencia local autorizada, cola, transferencia, resultado y conflictos. |
| Diseño/Producto | Jerarquía, componentes, lenguaje, alcance y revisión de decisiones UX. |
| QA | Casos funcionales/negativos, evidencia local, usabilidad y regresión pertinente. |

### 24.2 Información requerida por una pantalla

Entidades/referencias, organización activa, versión de edición, permisos efectivos, estados diferenciados, validaciones y acciones disponibles. Para procesos asíncronos: referencia de job, estado y resultado. Para datos analíticos: alcance, período, unidad, actualización y método cuando importa.

Este documento no obliga a que cada entidad incluya un campo nuevo `allowed_actions`: usar los contratos existentes o registrar el cambio requerido. Los nombres de endpoint ilustrativos de F1 no acreditan que el API ya exista. Conectar a OpenAPI/controladores reales.

### 24.3 Reglas para desarrollar con Claude Code/VS Code

1. Leer instrucciones, reglas, historia y contrato antes de cambiar una pantalla.
2. Inspeccionar componentes y estilos actuales; reutilizar y consolidar.
3. Relacionar la pantalla con entidad, operación, permiso, validación y evidencia.
4. Implementar una historia vertical; no hacer un dashboard estático como sustituto.
5. Mantener el stack adoptado. No cambiar framework o dependencias por apariencia.
6. Mantener separación de API, web y móvil según estructura real.
7. Proteger tenant en petición, caché, opciones y retorno de navegación.
8. Traducir estados del contrato; no duplicar cálculo de riesgo/balance en cliente.
9. Verificar en local y documentar qué pasó y qué quedó pendiente.
10. No declarar implementación, offline, conformidad o aprobación por la sola existencia de esta especificación.

Las rutas UI deben favorecer enlaces directos y vuelta al contexto; su sintaxis se adapta al router real. Las acciones críticas no se simulan con cambios de estado solo en frontend.

## 25. Trazabilidad UX, pantallas y backlog

La numeración P0 procede de F1; no asignar nuevos IDs sobre historias existentes. Recepción/calidad/procesamiento/exportación deben vincularse al backlog vigente antes de ejecución. `UI-*` identifica pantallas propuestas, no historias terminadas.

| Pantalla | Rol principal orientativo | Historia/base | Entidad/operación | Permiso y contrato que comprobar |
|---|---|---|---|---|
| UI-01 Acceso | Todos los usuarios habilitados | TECH-001/P0-002 | Sesión/login | Autenticación, límites, sesiones y errores reales. |
| UI-02 Organizaciones | SUPER_ADMIN/ORG_ADMIN | P0-001 | Crear/consultar/editar/estado | Matriz de organización; versión; suspensión. |
| UI-03 Equipo/invitaciones | ORG_ADMIN | P0-002/P0-003 | Membresía, invitación y roles | Anti-escalamiento; D-19; concesión de roles. |
| UI-04 Mi trabajo | Roles operativos | F2; backlog por confirmar | Pendientes/acciones | Fuente de cola y alcance personal/equipo. |
| UI-05 Productores | Técnico/admin autorizado | P0-004/P0-005 | Productor/código/historia | `producer:*` según matriz real y operación. |
| UI-06 Parcela | FIELD_TECHNICIAN | P0-006 | Parcela y responsable/origen | Permisos de parcela y referencias de tenant. |
| UI-07 Captura GPS/polígono | FIELD_TECHNICIAN | P0-007/P0-008 | Punto/vértices/geometría | Método, precisión, validación y versión. |
| UI-08 Mapa/GeoJSON | Técnico/trazabilidad | P0-009/P0-010 | Geometría/capas/exportación | Acceso a ubicación, regla y formato. |
| UI-09 Productos | Administración autorizada | P0-011 | Catálogo de producto | Permisos y unidades vigentes. |
| UI-10 Entrega/recepción | Técnico/recepción | P0-012; recepción por confirmar | Entrega y movimiento | Origen, cantidad, repetición y autorización. |
| UI-11 Calidad | QUALITY_OPERATOR | F2; backlog por confirmar | Muestra/análisis | Parámetros, revisión y liberación. |
| UI-12 Lote/operación | Trazabilidad/operación | P0-016/P0-017 | Entradas/salidas/procesamiento | Cantidades, estados, balance y cierre. |
| UI-13 Trazabilidad | TRACEABILITY_MANAGER | P0-013/P0-014/P0-015/P0-016 | CTE/KDE/eventos/relaciones | Contrato de grafo y datos autorizados. |
| UI-14 Documentos/evidencia | Capturador/revisor autorizado | P0-018/P0-019 | Archivo, soporte y vínculo | Carga, descarga, revisión y privacidad. |
| UI-15 Riesgo/mitigación | EUDR_MANAGER | P0-020/P0-021 | Evaluación/acción | Reglas, evidencia, permisos de revisión. |
| UI-16 Debida diligencia | EUDR_MANAGER | P0-022 | Expediente/paquete | Estados, bloqueos, versión y verificación. |
| UI-17 Embarque | EXPORT_MANAGER | F2; backlog por confirmar | Lotes/destino/paquete | Preparación y liberación reales. |
| UI-18 Auditoría | AUDITOR/admin autorizado | P0-025 | Eventos y cambios | Alcance del tenant, campos y exportación. |
| UI-19 Importación | Admin/capturador autorizado | P0-026 | Carga/mapeo/filas | Plantilla, conflictos y atomicidad. |
| UI-20 Móvil/cola | FIELD_TECHNICIAN | P0-023/P0-024 | Local/servidor/operación | Sesión, dispositivo, reintento y conflicto. |
| UI-21 Portal comprador | BUYER | P1 | Recursos compartidos | Concesiones definidas, vigencia y revocación. |
| UI-22 Mi finca | PRODUCER | F2; alcance por confirmar | Identidad vinculada y propios registros | Vínculo cuenta/productor; acceso propio. |

Cada ficha de implementación debe completar: rol, objetivo, entrada, datos capturados/consultados, evidencia generada/revisada, campos del contrato, permiso por acción, API real, salidas, carga/vacío/error/denegación, responsive, offline si aplica y evidencia de aceptación.

## 26. Verificación local y criterios de aceptación

### 26.1 Condiciones para acreditar una pantalla

- [ ] Conectada a operaciones reales de la historia y a datos autorizados.
- [ ] Permisos y referencias protegidos en backend; UI coherente con ellos.
- [ ] Marca, tokens y componentes compartidos; activos con estado conocido.
- [ ] Carga, vacío, filtros vacíos, faltante, error y denegación diferenciados.
- [ ] Errores recuperables preservan captura cuando corresponde.
- [ ] Conflicto de versión no pierde datos ni sobrescribe silenciosamente.
- [ ] Confirmaciones explican entidad y consecuencias.
- [ ] Recorrido adaptable, teclado y lectura asistida verificados según superficie.
- [ ] Cambios y acciones auditados cuando la historia lo exige.
- [ ] Offline probado en almacenamiento/sync real cuando aplica.
- [ ] Documentación y evidencia de ejecución local actualizadas.

Esta lista complementa la definición del repositorio; no da por cumplidos backend, seguridad o decisiones pendientes por un recorrido visual exitoso.

### 26.2 Escenarios de QA

| ID | Escenario | Resultado esperado |
|---|---|---|
| QA-UX-01 | Login normal, credenciales inválidas, límite e indisponibilidad | Mensajes distintos por situación; sin revelar existencia de cuenta ni emitir sesión ante rechazo. |
| QA-UX-02 | Usuario con roles diferentes en A y B | Acciones y datos pertenecen solo al contexto activo. |
| QA-UX-03 | Cambiar roles con la sesión abierta | Navegación y acciones se actualizan; backend rechaza permisos revocados. |
| QA-UX-04 | Tenant ajeno y miembro sin permiso | 404/403 seguros; nunca falso vacío ni metadata ajena. |
| QA-UX-05 | Organización suspendida | Escrituras bloqueadas; lectura conforme a contrato. |
| QA-UX-06 | Alta → búsqueda → detalle → edición → baja de productor | Persistencia real, retorno de contexto e historial conservado. |
| QA-UX-07 | Dos editores sobre una entidad | Conflicto visible y borrador recuperable. |
| QA-UX-08 | Geometría inválida/GPS sin precisión/capa caída | Mensaje específico; captura preservada; no validación ficticia. |
| QA-UX-09 | Envío repetido o conexión perdida tras recepción | Consulta/idempotencia real evita duplicar efecto. |
| QA-UX-10 | Balance inconsistente | Causa y bloqueo reales; no se fuerza por UI. |
| QA-UX-11 | Documento recibido pero no revisado | Estados separados, descarga segura y evidencia no aprobada automáticamente. |
| QA-UX-12 | Riesgo sin evaluar/expediente incompleto | Sin ceros falsos ni afirmación de cumplimiento; bloqueos explicados. |
| QA-UX-13 | Cerrar/reabrir móvil offline; archivo parcialmente enviado | Cola conservada y estado independiente de archivo/registro. |
| QA-UX-14 | Conflicto local/servidor y revocación durante offline | Revisión explícita, rechazo seguro y preservación según política. |
| QA-UX-15 | Teclado, lector, zoom, móvil y reducción de movimiento | Controles operables, foco visible y contenido legible. |
| QA-UX-16 | Importación con errores y repetición | Modalidad explícita; resumen e informe reales; no fusión silenciosa. |
| QA-UX-17 | BUYER con concesión vencida/revocada, cuando exista | Sin acceso residual a datos, archivos o caché protegidos. |

No ejecutar escenarios de módulos inexistentes y contarlos como aprobados. Registrar «no implementado/no ejecutado» y la dependencia.

### 26.3 Evidencia de validación

En local: scripts del repositorio para typecheck/lint/build, pruebas funcionales/de integración pertinentes y navegador real. Usar bases exclusivas de prueba; no destruir datos de desarrollo para recrear un escenario. Conservar los volúmenes actuales y la configuración de puertos vigente, incluido 5440 reportado para PostgreSQL.

Registro mínimo: historia, commit exacto, entorno local, comando/recorrido, resultado, capturas sintéticas cuando aportan evidencia y pendientes. Prueba automatizada confirma comportamiento; revisión visual confirma jerarquía y legibilidad. No acreditar producción ni conformidad regulatoria a partir de ambas.

Mediciones de usabilidad futuras: éxito de tarea, errores, pérdida de borradores, reintentos y tiempo observado por perfil. Establecer línea base con usuarios del piloto antes de inventar un SLA de «alta en 30 segundos».

## 27. Secuencia de adopción y decisiones pendientes

### 27.1 Orden propuesto

1. Incorporar esta especificación al índice/instrucciones del proyecto y registrar alcance local.
2. Inventariar componentes existentes, tokens y activos oficiales; consolidar sin reescritura general.
3. Aplicar shell, acceso, organizaciones, miembros y productor a historias existentes; probar regresiones pertinentes.
4. Continuar parcelas/GIS y captura según backlog y dependencias.
5. Desarrollar entregas, catálogos/eventos, lotes y balance como recorridos completos.
6. Incorporar documentos/evidencia, riesgo, mitigación y debida diligencia cuando los contratos estén disponibles.
7. Implementar móvil/offline/sync con su verificación específica; portal comprador tras contrato P1.

Eventos/outbox de TECH-001 soportan operaciones, pero no acreditan por sí solos CTE/KDE, todas las pantallas de trazabilidad o un motor de tareas. Verificar la infraestructura existente antes de añadir trabajo nuevo.

### 27.2 Registro de decisiones

| ID local | Tema | Estado y tratamiento |
|---|---|---|
| UX-D01 | Fidelidad y activos del logotipo | Pendiente según M1; usar variante vigente sin redibujar. |
| UX-D02 | Inter/licencia | Propuesta M1; fallback de sistema disponible. |
| UX-D03 | Tokens auxiliares, layout y títulos operativos | Propuesta UX-V1 para revisar en pantallas reales. |
| UX-D04 | D-04: elevación de plataforma | No definida; sin bypass, impersonación o acceso global inferido. |
| UX-D05 | D-18: tipos de organización | Provisional; etiquetas/códigos del catálogo; sin permisos derivados. |
| UX-D06 | D-19: identidad, correo e invitaciones | Entrega manual provisional; email no verificado por enlace. |
| UX-D07 | D-20: límites de login | Provisionales; UI usa respuesta/configuración del servidor. |
| UX-D08 | Identidad de PRODUCER | Confirmar vínculo cuenta/productor y alcance antes del portal. |
| UX-D09 | Concesiones BUYER/entre organizaciones | Contrato P1 pendiente; no compartir por inferencia. |
| UX-D10 | Offline, retención, sesión y borradores | Política requerida para P0-023/P0-024; no prometer acceso indefinido. |
| UX-D11 | Reglas GIS y umbrales regulatorios | Configuración versionada; límites no resueltos se registran. |
| UX-D12 | Recepción/calidad/procesamiento/embarque | Vincular a historias y contratos vigentes, sin numeración inventada. |
| UX-D13 | Avisos/notificaciones | Activar solo con fuente, canal y destinatarios definidos. |
| UX-D14 | Cierre local de historias | Instrucción del usuario; reflejarla en la definición global y mantener demás criterios. |

Los IDs UX-D son de este documento y no reemplazan decisiones D-xx/ADR del repositorio. Adoptar valores de desarrollo no ratifica automáticamente políticas de producción.

### 27.3 Control de cambios

Actualizar versión, fecha, fuente afectada, motivo y responsable cuando cambien identidad, permisos, estados, componentes o flujos. Conservar un registro de diferencias; evitar documentos UX paralelos contradictorios.

| Versión | Fecha | Cambio |
|---|---|---|
| 1.0 de trabajo | 09/10/2026 | Especificación inicial basada en M1/F1/F2/F3 y alcance local de TERRA-LINK-2025. |

**Regla de entrega:** la pantalla debe permitir completar una tarea real con datos, autorización, feedback y evidencia coherentes. Una maqueta o un componente visual no acredita el flujo de negocio completo.

### 13.x Mapa de captura de campo (A-01, 2026-10-20)
Mapa enfocable con teclado (flechas desplazan, + y − acercan, Enter fija un vértice en la mira), botón «Fijar vértice en la mira», vértices arrastrables, coordenadas de la mira y del puntero a la vista y tabla de
coordenadas siempre presente; 390 px sin desborde; atribución de OpenStreetMap visible; estado explícito si falta la cartografía. Español e inglés.
