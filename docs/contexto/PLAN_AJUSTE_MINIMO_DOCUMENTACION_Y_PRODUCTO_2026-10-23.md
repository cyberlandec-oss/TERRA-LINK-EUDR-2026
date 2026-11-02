# Terra Link — Plan de ajuste mínimo de documentación y producto
Fecha: 23 de octubre de 2026
Estado: propuesta concreta de aplicación sobre el repositorio vigente mediante Claude Code

## 1. Decisión y alcance

Se recomienda mantener la plataforma existente y ajustar únicamente las brechas demostradas de navegación, alcance propio, aportación documental y explicación de los resultados.

La aclaración del propietario es coherente con textos originales ya disponibles: Terra Link prepara y gestiona evidencia para debida diligencia; no se atribuye una certificación automática de autenticidad ni de conformidad jurídica.

No corresponde eliminar el motor de riesgo, las revisiones humanas, la evidencia vinculada o los controles de preparación del expediente. Esos elementos también están expresamente contemplados en la documentación raíz.

Este documento no modifica el repositorio del equipo Windows. Es un plan de cambios para que Claude lo aplique sobre sus versiones actuales, conservando el código estable y su historia.

## 2. Línea base que debe conservarse

Estado tomado del informe del propietario, pendiente de contraste local antes de editar:
- Web/API: SHA funcional 5f77b72, validado y desplegado según el cierre de A-04.
- A-04: “Mi ubicación” implementada, con demostración web y posición simulada.
- Móvil: corrección posterior de accesibilidad en 056d298; APK A04-mi-ubicacion-3df0ca8d identificado en su .sha256. Su evidencia de compilación/emulador es distinta de la validación completa de 5f77b72.
- Resultados de A-04: 3725bad.
- APK 6107e478: sustituido por el defecto de accesibilidad reportado.
- Esquema reportado: 0065; confirmar el valor real de /version.
- AGENTS.md permanece fuera de commits. Mantener volúmenes existentes y datos.
- Android físico continúa pospuesto. No activar satélite real ni integraciones externas por esta actualización.
- El fallo de expo-doctor sigue declarado; no presentar el comando completo como aprobado.

No reconstruir A-04 ni actualizar dependencias móviles por el mero hecho de revisar documentos.

## 3. Fuentes contrastadas y qué permiten afirmar

### Documentación original disponible

| Fuente | Pasaje contrastado | Consecuencia para el ajuste |
|---|---|---|
| DOCUMENTACIÓN TÉCNICA MAESTRA.md | §§30–32: documento, evidencia y enlaces a productor/parcela | Reutilizar gestión documental y relaciones; no crear otra carpeta o motor paralelo |
| Misma fuente | §§33–38: riesgo explicable, revisión y mitigación | Conservar evaluación y revisión; precisar su autoría y alcance |
| Misma fuente | §41: resultado externo no es verdad legal automática | Mantener procedencia y límites del análisis satelital |
| Misma fuente | §42: requisitos y documentos de legalidad que puedan evolucionar | Mantener configuración versionada; evitar codificar una lista universal de leyes/documentos |
| Misma fuente | §44: paquete de evidencia, sin declaración automática de cumplimiento | Separar preparación de información, conclusión humana y presentación externa |
| Misma fuente | §85: IA asistente, sin decisión final automática de conformidad | No convertir extracción ni clasificación en certificación |
| PLATAFORMA — ARQUITECTURA MAESTRA 2026.md | Módulo 07, documentos y evidencia | Documento relacionado con entidad, fuente, versiones y riesgo; no una carpeta sin contexto |
| Misma fuente | Módulo 10, DDS/EUDR | Se define como sistema de preparación y gestión de evidencia; responsabilidad en el sujeto obligado |
| workflows reales de la cadena de cacao.md | §6, PRODUCER | Mi finca: parcelas, entregas, documentos y pendientes propios; experiencia sencilla |
| UX_UI.md | §7.13, §17, §18.3, §24.3; UI-22 y UX-D08 | Portal propio condicionado a vínculo; documento/evidencia/revisión separados; recorrido vertical real |
| docs/03_REQUISITOS.md, copia inicial | RF-18, RF-19, RF-27 y RF-36 | Carga privada/versionada, evidencia, web por permisos y orientación jurídica con fuente/versionado |
| docs/18_BACKLOG.md, copia inicial | P0-018, P0-019, P0-027 y P1-005 | Identificar la brecha de una historia existente antes de crear otra ampliación |
| docs/13_RIESGO_LEGALIDAD_Y_DD.md, copia inicial | Dimensiones separadas, Legalidad Ecuador, Paquete | No equiparar archivo, revisión, riesgo y readiness |

Las copias consultadas de docs/03, 07, 09, 13, 18 y 24 pertenecen al paquete inicial de octubre. Sirven para rastrear intención, no para reemplazar el estado vigente del repositorio. No trasladar sus estados iniciales ni rutas propuestas como si fueran el código actual.

### Contexto operativo adicional

El ZIP Resumenes_EUDR_10_PDF_Markdown.zip aporta diez síntesis y referencias de lectura, no los diez PDF íntegros. Complementa la explicación de trazabilidad y evidencia en Ecuador.

Priorizar las guías de trazabilidad, debida diligencia, productores y legalidad laboral para formularios y recorridos. Los ejemplos documentales son contextuales: no se transforman en obligaciones uniformes para todos los agricultores.

Las recomendaciones de producto ya incluidas en esos resúmenes no son citas normativas. Toda regla jurídica específica necesita su fuente original vigente antes de publicarse como obligación.

## 4. Qué significa “ajuste mínimo”

Clasificar cada hallazgo antes de editar:

| Clase | Ejemplo | Cambio permitido |
|---|---|---|
| Texto desactualizado | “Pendiente de implementación” cuando el recorrido funciona | Corregir texto y su evidencia |
| Configuración pendiente | Productor sin vínculo con su cuenta | Mostrar qué falta y quién puede resolverlo; no dar acceso implícito |
| Navegación incompleta | API funcional, pero no existe acceso desde Mi finca | Conectar la pantalla reutilizando servicios y componentes |
| Brecha funcional original | No se pueden consultar entregas propias previstas en UX | Completar la historia original con alcance propio y pruebas |
| Atribución ambigua | “Validado” sin explicar por quién ni qué se comprobó | Precisar el texto y distinguir resultado técnico de revisión humana |
| Cambio de contrato necesario | El API no expresa el alcance propio requerido | Añadir solo el contrato/permiso acotado imprescindible |
| Regla de negocio realmente distinta | Cambiar quién concluye o qué permite despachar | No introducirla como corrección de textos; documentar la decisión específica |

Primero intentar resolver con configuración, componentes, relaciones y endpoints existentes. Crear una migración solo si se demuestra que el modelo vigente no representa el dato o alcance necesario.

No cambiar framework, proveedor de autenticación, ledger, estados globales o diseño de toda la aplicación.

## 5. Modelo jurídico/documental que debe quedar explícito

### A. Biblioteca de orientación
Normas y guías con procedencia, fecha, versión y alcance conocido. Explican qué aspectos se podrían documentar.

No prueban la situación de una parcela. Mantenerlas disponibles como consulta, sin convertir la lectura de normas en paso obligatorio para subir un archivo.

### B. Evidencia aportada por el actor
Soporte relacionado con productor, parcela, entrega, lote u operación según el modelo actual.

Reutilizar los metadatos existentes: tipo, entidad, origen declarado, autor de carga, fecha, versión y emisión/vencimiento cuando correspondan. No inventar vencimiento si el documento no lo tiene.

PDF, JPG y demás formatos se admiten conforme al contrato y controles instalados. Conservar originales y versiones según el tratamiento vigente de cada clase. Mantener la regla específica de limpieza de metadatos de FIELD_PHOTO; no extenderla indiscriminadamente a documentos legales firmados.

### C. Comprobaciones técnicas
Formato, tamaño, escaneo, integridad, acceso, vínculos y coherencia de datos. Expresar el resultado concreto.

“Escaneo sin detecciones” no significa documento auténtico. El hash identifica una versión y detecta cambios; no certifica su contenido.

### D. Revisión y decisión humanas
Mostrar persona responsable, fecha, objeto revisado, motivo y soportes. Mantener el acto y sus condiciones existentes.

“Revisado por una persona” no equivale a certificación emitida por Terra Link. La revisión de un perfil global y la revisión de documentos de una finca son objetos distintos.

### E. Expediente
Diferenciar recopilación, evaluación, medidas, conclusión, preparación y presentación externa. No hacer que cargar un archivo marque automáticamente un requisito como MET.

No relajar READY, despacho o salida de traspasos mediante un cambio de etiqueta. Tampoco bloquear de forma general la carga, consulta o vinculación documental por faltar una revisión global.

Si el código ya cumple esta separación, bastará ajustar la presentación y documentación. No reimplementar mecanismos existentes.

## 6. Cambios de UX concretos

### Mi finca

Comprobar y completar con el rol PRODUCER vinculado:
- Mis parcelas, con enlaces a ficha y captura autorizada.
- Mis entregas, con el alcance de lectura/acciones definido originalmente.
- Mis documentos y soportes vinculados autorizados.
- Pendientes accionables basados en hechos del dominio.
- Acceso a “Mi ubicación” donde ya corresponde por A-04.

No inventar métricas ni tareas para llenar la portada. Usar los datos existentes.

Una cuenta sin vínculo muestra “Tu cuenta todavía no está vinculada a un productor” y el procedimiento vigente para resolverlo. Una función ausente no se disfraza como problema de configuración.

### Documentos desde contexto

El usuario debe poder entrar por la parcela/productor/operación y:
1. Identificar el aspecto que quiere documentar.
2. Ver una orientación breve y ejemplos pertinentes.
3. Seleccionar y cargar un archivo autorizado.
4. Consultar el resultado de procesamiento y su relación.
5. Aportar otra versión o atender observaciones según sus permisos.

Utilizar acciones y estados reales del backend. No crear una simulación de revisión solo en la web.

### Lenguaje de interfaz

Ejemplos propuestos, a adaptar al contrato actual:

| Evitar como afirmación del sistema | Redacción precisa |
|---|---|
| Documento auténtico por carga correcta | Archivo recibido; controles técnicos completados |
| Parcela legal por existir un soporte | Documentación aportada; revisión y alcance identificados |
| Cumple EUDR por score o carpeta completa | Resultado técnico o estado de preparación concreto |
| Validado, sin más información | Qué se comprobó, quién lo comprobó y cuándo |
| Función pendiente para tu rol, si solo falta vínculo | Configuración de cuenta pendiente |
| Todos los documentos son obligatorios | Documentación correspondiente al caso y fuente de la orientación |

No sustituir un estado por otro semánticamente distinto. Mapear la etiqueta al código real y conservar estados históricos.

## 7. Mapa de actualización documental

Verificar los nombres y secciones vigentes antes de editar. La tabla prescribe el mínimo contenido afectado; no obliga a modificar todos los archivos.

| Documento | Ajuste puntual | Cuándo tocarlo |
|---|---|---|
| CLAUDE.md | Referencia breve al alcance y al plan; respetar protocolo de ciclos | Al adoptar este ajuste, sin sustituir instrucciones existentes |
| docs/00_INDICE.md | Enlazar una nota de ajuste y las fuentes si se incorporan | Solo si hay nuevos documentos que localizar |
| Documento de alcance/visión existente | Reafirmar preparación y gestión de evidencia, con responsabilidad humana | Solo si su redacción vigente induce otra función |
| UX_UI.md y especificación web responsable | Mi finca, carga contextual y vocabulario; A-04 ya cerrada se conserva | Para resolver las brechas confirmadas |
| docs/03_REQUISITOS.md | Precisar RF-18/19/27/36 sin cambiar sus IDs | Si falta esta distinción o el criterio es ambiguo |
| docs/07_RBAC_Y_GOBERNANZA.md | Operaciones propias realmente habilitadas y sus límites | Si cambia o se precisa el contrato de acceso |
| docs/12, seguridad/privacidad equivalente | Protección y tratamiento de soportes afectados | Solo si existe un cambio material en esa materia |
| docs/13_RIESGO_LEGALIDAD_Y_DD.md | Biblioteca, soporte, validación técnica y revisión humana; conservar dimensiones | Para eliminar ambigüedad y delimitar bloqueos reales |
| docs/18_BACKLOG.md | Subtareas de brecha bajo historias originales correspondientes | Tras comprobar qué falta realmente |
| Plan de desarrollo/roadmap vigente | Secuencia corta de estas entregas | Actualizar el plan existente; no crear otro roadmap paralelo |
| docs/22_DECISIONES_Y_PENDIENTES.md | Registrar la aclaración del propietario y separar pendientes externos de desarrollo | Sin volver a pedir decisiones ya adoptadas |
| docs/23_ESTADO_DESARROLLO.md | Estado técnico comprobado, aceptación y siguiente tarea | Al abrir/cerrar una entrega real |
| docs/24_TRAZABILIDAD_REQUISITOS.md | Fuente → requisito → pantalla/API → prueba/evidencia | Para cada ajuste realizado |
| docs/06 y docs/09_CONTRATOS_API.md | Datos, permisos, requests/responses nuevos o modificados | Solo si cambia el modelo o contrato; no por textos |
| docs/20 y evidencia QA | Comandos y verificaciones realmente ejecutadas | Cuando cambie procedimiento o haya resultados nuevos |
| Continuidad vigente | Baseline, unidad activa y siguiente acción | Evitar varios documentos que se proclamen vigentes |
| sources/manifiesto | Procedencia de los documentos añadidos; distinguir PDF de resumen | Si el material se incorpora al repositorio |

No sobrescribir fuentes originales. Mantener la aclaración y su fecha en una enmienda breve; corregir el texto operativo vigente y conservar el histórico cuando sea necesario.

No llamar automáticamente “decisión regulatoria” a la definición del propósito comercial del software.

## 8. Backlog de ajuste propuesto

Son tareas propuestas que se deben insertar bajo los IDs existentes. No asignar nuevos RF ni números de ampliación sin revisar el registro real.

### AJ-01 — Aclaración semántica y trazabilidad
Tipo: documentación/configuración de textos.
Base: fuente original §§30–32, 41–44, 85; arquitectura módulos 07/10; RF-18/19/36.
Resultado: queda inequívoco qué orienta, qué aporta el usuario y qué revisa una persona.
Cierre: referencias correctas, sin obligación universal inventada y sin estados de dominio modificados por documentación.
No requiere validación funcional completa si solo cambia documentación.

### AJ-02 — Mi finca operativa
Tipo: completar recorrido original.
Base: workflow §6; UX §7.13/UI-22/UX-D08; RF-03/06/18/27 y lo que corresponda a entregas.
Resultado: el productor vinculado usa los registros propios previstos, con navegación y recuperación.
Cierre: lectura propia, accesos denegados a otros titulares/tenants y caso sin vínculo. Integrar A-04, no reconstruirla.

### AJ-03 — Aportación documental contextual
Tipo: integración de módulos existentes y contrato mínimo si hace falta.
Base: RF-18/19/36; P0-018/019/027 y P1-005; UX §17.
Resultado: cargar/consultar/versionar/vincular soportes desde las entidades autorizadas, con orientación comprensible.
Cierre: recorrido autorizado completo; archivos rechazados con motivo; sin filtraciones de identidad ni adopciones/revisiones automáticas.

AJ-02 y AJ-03 pueden formar una sola entrega vertical si comparten el mismo recorrido y el tamaño sigue siendo revisable. Si se separan, conservar resultados de cada candidato.

### AJ-04 — Avisos y accesos de roles afectados
Tipo: corrección de brechas comprobadas.
Base: RF-27, UX de cada rol y catálogo efectivo.
Resultado: no existen avisos falsos ni acciones anunciadas sin implementación en los recorridos intervenidos.
Cierre: texto, permisos y acciones coinciden con comportamiento real.
No abrir una reescritura general de todas las pantallas.

Pendientes externos, pilotos y Android conservan su registro separado y sus criterios. No reclasificarlos como completados mediante esta aclaración.

## 9. Pruebas y despliegue proporcionales

Antes del candidato funcional:
- Reutilizar pruebas existentes y añadir únicamente los casos que acrediten la nueva integración.
- Productor propio, otro productor, otra organización y retirada/restablecimiento del vínculo.
- Permisos del técnico, administración y lectores según los recorridos realmente afectados.
- Documento vinculado a su entidad y versión; descarga autorizada y negativa.
- Carga documental permitida sin revisión global, sin modificar automáticamente estados regulatorios.
- Conservar riesgos, observaciones y decisiones anteriores; cambiar un texto no debe disparar reevaluaciones o invalidaciones innecesarias.
- Español/inglés cuando corresponda, teclado y 390 px.
- A-04 mantiene su funcionamiento en los componentes reutilizados.

Preparar la demostración antes de congelar. Validar un SHA final con el árbol intacto y desplegar ese mismo SHA.

La corrección móvil 056d298 no se debe presentar como cubierta por la validación de otro commit: conservar su evidencia diferenciada.

Si no hay migración ni nuevo estado persistente relevante, no repetir un respaldo por rutina. Si se requiere, seguir el procedimiento y restauración aislada vigentes.

Un cambio documental posterior no obliga a otra corrida funcional completa.

## 10. Criterio de fin y control de alcance

Se completa este ajuste cuando:
- La interfaz permite el trabajo documental y propio que exige la raíz.
- Los textos describen el resultado verdadero sin atribuir certificación automática.
- La autorización efectiva conserva los límites.
- Cada cambio tiene fuente y evidencia.
- Los bloqueos externos siguen identificados sin impedir tareas independientes.
- No se alteraron cierres ni porcentajes por editar criterios o etiquetas.

La cobertura reportada 42/60 y MVP 30/44 no se actualiza sin contrastar cada criterio de aceptación vigente. Tampoco sirve para declarar que todos los recorridos están terminados.

Ningún hallazgo de este documento se presenta como defecto confirmado del código actual antes de comprobarlo localmente.

## 11. Mensaje de ejecución para Claude Code

Adopta este plan como instrucción de ajuste mínimo del alcance autorizado. Comprueba el estado real y cualquier validación activa. Conserva el cierre A-04 y sus SHAs/evidencias diferenciadas.

Contrasta los pasajes originales aquí referidos con las versiones actuales del repositorio. No reemplaces archivos actuales con copias iniciales. Actualiza solo las secciones afectadas y conserva IDs, decisiones e historia.

Prioriza Mi finca y la aportación documental contextual. Reutiliza el backend, los permisos y los componentes existentes. Cambia el contrato o la base únicamente si una brecha comprobada lo exige.

La sección jurídica orienta y registra soportes y decisiones humanas. No atribuyas a Terra Link autenticidad certificada ni elimines sus controles técnicos, revisión o compuertas.

No vuelvas a pedir autorización para esta aclaración de producto o para completar los recorridos originales. Una decisión jurídica real o un cambio operativo distinto sí se mantiene separado.

Trabaja por entregas mediante el protocolo continuo. Entrega el primer cambio funcional completo, no solo otra propuesta o inventario. Al cerrar, informa exactamente qué se modificó, qué se conservó y qué falta por una dependencia real.

No actualizar dependencias, borrar C:\\tlb, publicar en GitHub, activar satélite real ni realizar el ensayo físico como parte incidental de esta tarea.

