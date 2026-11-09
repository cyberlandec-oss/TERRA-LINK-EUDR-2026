# Terra Link — Contexto funcional EUDR para cacao en Ecuador
## Lectura del paquete aportado y traducción a recorridos de producto

Fecha: 22 de octubre de 2026
Estado: análisis funcional para contrastar con el repositorio; no es una modificación del código ni una aprobación regulatoria.

## 1. Qué se recibió y qué se analizó

El archivo Resumenes_EUDR_10_PDF_Markdown.zip contiene un índice y diez síntesis analíticas con mapas de lectura por página. Se revisaron las síntesis de los diez documentos y referencias de páginas relevantes para trazabilidad, evidencia, roles, legalidad y debida diligencia.

No contiene los diez PDF íntegros. Los extractos están abreviados y varias páginas gráficas no tienen texto extraído. Por tanto, las páginas que se indican a continuación remiten al PDF original: no son una transcripción comprobada de esos PDF.

El índice del paquete advierte que las publicaciones pertenecen a años distintos y no fueron armonizadas normativamente. La explicación operativa de una guía no sustituye la comprobación de una regla legal vigente.

Los apartados llamados “Implicaciones para Terra Link” de los resúmenes son propuestas de diseño ya incluidas en el paquete; no deben citarse como obligaciones textuales de las publicaciones.

Este análisis no comprueba el estado del repositorio de Claude Code. Las funciones reportadas anteriormente deben verificarse allí antes de declararlas completas.

## 2. Propósito del producto aclarado por el propietario

Terra Link permite a los actores de la cadena ecuatoriana registrar el origen del cacao, conservar trazabilidad, aportar evidencia, analizar riesgos y gestionar información para la debida diligencia.

La plataforma:
- Identifica productor, parcela, entrega, lote, proceso y destino.
- Conserva las relaciones entre esos registros y los responsables de cada operación.
- Recibe documentos aportados, mantiene versiones y permite su consulta según permisos.
- Produce resultados técnicos identificados por su fuente, método y versión.
- Registra observaciones, revisiones, decisiones y medidas de personas responsables.
- Facilita expedientes e intercambio autorizado de información.

La plataforma no se atribuye la autenticidad jurídica de un documento ni una certificación oficial de la finca, del lote o de conformidad EUDR.

Esta delimitación tampoco convierte la debida diligencia en una carpeta de archivos: debe poder reconstruirse qué información se consideró, qué faltaba, qué riesgos se identificaron y qué medidas se tomaron. La orientación oficial de la Comisión distingue recopilación, evaluación y mitigación; la responsabilidad corresponde a la entidad obligada. [UE-1]

## 3. Fuentes del paquete y utilidad para el producto

Los números de página siguientes son los que emplean los mapas de lectura del paquete.

| Código | Archivo del paquete | Utilidad | Referencias prioritarias |
|---|---|---|---|
| B01 | 01_Metodologia_simulacros_SDD.md | Preparar una demostración integral y documentar brechas; separar simulacro de certificación | PDF pp. 3–8; escenarios ficticios pp. 9–11 |
| B02 | 02_Evaluacion_riesgos_cacao_Ecuador.md | Contexto nacional de tenencia, trabajo, ambiente, mezcla y otros riesgos; no es un resultado individual de cada finca | Síntesis, principios 1–4; mapa de metodología y resultados pp. 8–12; tierras pp. 13–38 |
| B03 | 03_Folleto_EUDR_comercializacion.md | Explicar la colaboración entre proveedores y compradores, trazabilidad, evidencia y límites de las certificaciones | PDF pp. 6–7, 9–15 |
| B04 | 04_Guia_implementacion_trazabilidad.md | Diseñar procesos, responsables, registros, CTE/KDE, productos, proveedores y formularios utilizables | PDF pp. 8–15 y glosario/variables p. 18 |
| B05 | 05_Guia_capacitacion_exportadores.md | Preparación de información del producto y origen, evaluación, riesgos y documentación de exportación | PDF pp. 19–25 y 35–36 |
| B06 | 06_Guia_capacitacion_intermediarios.md | Preservar origen e información al comprar, recibir, agrupar y transferir producto; riesgo de mezcla | PDF pp. 23–31, 39–40 y 43 |
| B07 | 07_Guia_practica_debida_diligencia.md | Organización del SDD: políticas, información, riesgo, respuesta, seguimiento e informes | PDF pp. 18–34; descargo p. 2 |
| B08 | 08_Guia_capacitacion_productores.md | Georreferenciación, documentación y necesidades de productores y asociaciones; preguntas adaptadas a su realidad | PDF pp. 23–31, 34, 39–41 y 58–61 |
| B09 | 09_Legalidad_laboral_agroproductiva.md | Diferenciar agricultor familiar, autónomo, organización y empleador; evidencia laboral pertinente | PDF pp. 4–6 y 10–12 |
| B10 | 10_Cacao_responsabilidad_SDD.md | Contexto de colaboración y fortalecimiento de capacidades | Síntesis; consultar PDF original para sus páginas principalmente gráficas |

## 4. Qué debe poder hacer el usuario

La siguiente matriz traduce las fuentes a comportamiento funcional. Los códigos CTX son identificadores de este análisis, no nuevos RF ni historias adoptadas automáticamente.

Las capacidades que coincidan con requisitos originales se completan dentro de ese alcance. Una ampliación nueva se identifica como tal; una guía no amplía silenciosamente el backlog.

| ID | Recorrido funcional | Resultado visible y comprobable | Base documental |
|---|---|---|---|
| CTX-01 | Productor: Mi finca | Acceder a parcelas, entregas y documentos propios según el alcance aprobado; explicar un vínculo ausente sin confundirlo con función no implementada | B08; B04; UX-D08 citado por el propietario |
| CTX-02 | Captura geográfica | Ubicación del dispositivo, precisión y procedencia; punto o polígono revisable antes de confirmar; historial geométrico | B07 pp. 11–12 y 25; B08 pp. 24 y 41; mejora “Mi ubicación” autorizada |
| CTX-03 | Entrega y recepción | Relacionar proveedor/productor, origen, fecha o período conocido, producto, cantidad, unidad, receptor y soportes | B04 pp. 11–14; B06 p. 24; B07 pp. 24–25 |
| CTX-04 | Procesos y lotes | Conservar entradas, salidas, mezclas, transformaciones, mermas declaradas y linaje hasta las parcelas; no inventar procedencia | B04 pp. 9–14; B07 p. 30; B06 p. 30 |
| CTX-05 | Aportación documental | Desde la entidad correspondiente: orientar, cargar, clasificar, vincular, consultar y aportar nueva versión de un soporte autorizado | B03 p. 13; B05 p. 36; B07 pp. 25–26 y 29; B08 p. 39 |
| CTX-06 | Legalidad contextual | Explicar qué aspecto se documenta, para qué actor y con qué fuente; distinguir información aportada, faltantes y observaciones humanas | B02 principios 1–2; B07 p. 29; B09 pp. 4–6 y 11–12 |
| CTX-07 | Análisis de deforestación | Asociar el análisis a la versión geométrica, fuente y fecha; mostrar hallazgos, cobertura y limitaciones reales | B07 pp. 27–28; B02 principio 3 |
| CTX-08 | Evaluación de riesgos | Separar contexto nacional, alerta, evidencia de la entidad y evaluación específica; dejar explícito lo no evaluado | B02, síntesis y metodología; B07 pp. 26–30 |
| CTX-09 | Mitigación | Crear acciones con responsable, plazo cuando corresponda, soportes de ejecución y seguimiento de eficacia | B07 pp. 31–33 |
| CTX-10 | Intercambio autorizado | Compartir información pertinente con destinatarios autorizados, sin acceso transversal a datos personales ni otros tenants | B03 pp. 11–12; B07 pp. 25–26 y 34 |
| CTX-11 | Expediente y reporte | Reunir origen, cantidades, geometrías, documentos, evaluaciones, medidas e historial; declarar faltantes y alcance del reporte | B07 pp. 24–34; B05 pp. 20–21; B01 pp. 7–8 |
| CTX-12 | Responsabilidad y correcciones | Identificar quién aportó, corrigió, revisó o decidió y qué versión utilizó; navegación funcional por rol | B04 pp. 7 y 10–14; B07 pp. 19–23 |

Una política organizacional, un mecanismo de reclamaciones, formación o revisiones periódicas aparecen también en B07. Primero hay que buscar su correspondencia con la documentación raíz. Este análisis no impone crear automáticamente módulos nuevos de formación, nómina, certificación o gestión jurídica.

## 5. Cómo debe funcionar la parte jurídica/documental

### 5.1 Tres contenidos distintos

| Contenido | Para qué sirve | Qué no demuestra |
|---|---|---|
| Normas, publicaciones y guías | Orientar sobre aspectos y documentación potencialmente pertinentes | Que un agricultor concreto cumple lo descrito |
| Soportes aportados por el actor | Documentar una situación, operación, relación o gestión de la entidad | Que el archivo sea auténtico o suficiente por el solo hecho de estar cargado |
| Revisión o decisión humana registrada | Atribuir a una persona una observación, valoración o conclusión con sus soportes | Una certificación independiente emitida por Terra Link |

Los PDF normativos pueden permanecer como biblioteca de consulta. No deben ocupar el lugar del recorrido para subir y gestionar documentos de las parcelas, productores y operaciones.

Una revisión de una configuración global y una revisión de la evidencia de una parcela son objetos distintos. La primera no debe convertirse en impedimento general para que los usuarios aporten información.

### 5.2 Recorrido esperado

1. La persona abre la parcela, productor u operación a la que tiene acceso.
2. Ve qué aspecto se quiere documentar y una explicación sencilla de su finalidad.
3. Puede consultar ejemplos de soportes pertinentes, con fuente y fecha de la guía.
4. Carga un PDF, JPG u otro formato admitido, mediante los controles existentes.
5. El sistema conserva el soporte, su versión y la relación con la entidad, además de quién lo aportó y cuándo.
6. Quien tenga autorización consulta el archivo y puede registrar observaciones o solicitar información adicional.
7. Los faltantes se muestran como tareas o información pendiente; la carga no se presenta como autenticación ni aprobación jurídica.
8. Una decisión posterior identifica a su responsable y conserva el pasado.

Los nombres de estados de interfaz deben mapearse al contrato existente. “Documento aportado”, “Pendiente de revisión” o “Con observaciones” son ejemplos de redacción, no una orden de crear otro catálogo de estados.

### 5.3 Ejemplos de familias documentales

Ejemplos orientativos derivados de los temas de B02, B03, B07, B08 y B09; no son una lista obligatoria uniforme ni verifican la vigencia o aplicabilidad de cada documento.

| Aspecto | Ejemplos de información o soportes que el actor podría aportar | Contexto que debe aclararse |
|---|---|---|
| Tenencia o derecho de uso | Título, contrato, autorización, adjudicación u otro soporte que la persona declare pertinente | Titularidad, forma de uso y relación con la parcela; no exigir ser propietario como única posibilidad |
| Actividad y operaciones | Registros del actor, comprobantes de compra/venta, entrega o traslado y otros soportes de la operación | Tipo de actor y operación; vínculos con cantidades y lotes |
| Trabajo y aspectos sociales | Información del tipo de trabajo y soportes laborales que correspondan | No equiparar trabajo familiar, socio, autónomo y trabajador dependiente |
| Ambiente | Permisos, gestiones o evidencias ambientales pertinentes al caso | Actividad, localización, alcance y regla aplicable; no universalizar un permiso |
| Derechos de terceros | Acuerdos, comunicaciones, actas u otros soportes relacionados con una situación declarada | Titulares, comunidades, conflicto y alcance real del documento |
| Deforestación | Geometrías, resultados de análisis, informes y observaciones de campo | Fuente, fecha, método, cobertura y versión geométrica; una foto aislada no basta para reconstruir un cambio de cobertura |

No exigir datos personales innecesarios ni ampliar la descarga de documentos de identidad por comodidad. Mantener el tratamiento vigente de FIELD_PHOTO y su alcance propio.

### 5.4 Controles que sí corresponden al software

- Acceso por rol, organización, titularidad y asignación.
- Archivo admitido, tamaño, análisis antivirus y conservación segura.
- Integridad y versiones: el hash sirve para detectar cambios; no autentica jurídicamente el contenido.
- Coherencia técnica de referencias, cantidades, unidades y geometrías conforme a los contratos adoptados.
- Identificación de campos o soportes faltantes sin inventar datos.
- Atribución explícita de la revisión humana.

No retirar estos controles bajo el argumento de que Terra Link no certifica.

## 6. Aplicabilidad y actores: formularios que se adapten a Ecuador

B09 enfatiza que las situaciones laborales y organizativas son diferentes. B08 separa preguntas para productores y asociaciones. B02 describe múltiples riesgos y requisitos posibles por contexto.

Derivación de diseño: preguntar los hechos necesarios y reutilizar los existentes para orientar la información solicitada. Por ejemplo, no presentar idéntico bloque laboral obligatorio a una finca de trabajo familiar y a una empresa que declara trabajadores contratados.

El usuario puede aportar hechos y documentos. La aplicación no debe deducir una categoría jurídica definitiva del nombre de un rol, del tipo descriptivo de organización o de una única respuesta.

“No aplica” y “No lo sé” tienen significados distintos:
- No lo sé conserva un vacío de información.
- No aplica debe conservar el motivo y responsable cuando forme parte de una revisión formal.
- Ninguna respuesta equivale automáticamente a una conclusión favorable.

La revisión de contenidos jurídicos puede ser necesaria para afirmar obligaciones concretas; no hace falta esperar esa revisión para construir el mecanismo de orientación, carga, consulta y seguimiento.

## 7. Roles existentes y responsabilidades operativas

Esta tabla expresa recorridos a comprobar, no asignaciones nuevas de permisos. El catálogo y la documentación raíz vigentes determinan el alcance efectivo.

| Rol o grupo existente | Recorrido a comprobar |
|---|---|
| PRODUCER | Mi finca, parcelas propias vinculadas, geolocalización y soportes propios autorizados; entregas según el alcance original |
| FIELD_TECHNICIAN | Captura y asistencia en productores/parcelas asignados, ubicación, geometría y evidencias según permisos |
| RECEPTION_OPERATOR | Recepción, proveedor/origen, cantidades, pesaje y soportes de entrega correspondientes |
| QUALITY_OPERATOR | Resultados y decisiones de calidad, con su autoría y referencias |
| TRACEABILITY_MANAGER | Linaje, lotes, procesos, conciliación y detección de faltantes de trazabilidad |
| EUDR_MANAGER | Organización de evidencia, evaluación, medidas y conclusión humana según los controles vigentes |
| EXPORT_MANAGER | Preparación del embarque y sus soportes; bloqueos y referencias reales, sin presentación externa ficticia |
| ORG_ADMIN / MANAGER | Gestión y supervisión dentro del alcance ya definido para cada uno; no equiparar sus permisos |
| AUDITOR | Reconstrucción y consulta autorizada, sin escrituras ni acceso implícito a identidades |
| BUYER | Información expresamente compartida y proyección autorizada, no acceso general al tenant |
| SUPER_ADMIN | Administración de plataforma y configuraciones globales conforme a permisos específicos; no certificación del contenido por ser administrador |

Un mismo rol de aplicación no determina quién es operador, comerciante o representante a efectos jurídicos.

Si una cuenta no tiene vínculo cuenta–productor, mostrar esa configuración pendiente y el canal para resolverla. Si la función no existe, registrar una brecha de implementación. No usar el mismo aviso para ambas situaciones.

## 8. Geolocalización, satélite y trazabilidad

- La parcela es el origen espacial; el lote de inventario agrupa producto. Mantener la relación sin atribuir una única geometría a todo lote si procede de varias parcelas.
- “Mi ubicación” centra la vista y ofrece una lectura; usarla como punto o vértice requiere una acción explícita. Dibujar después de centrarse sigue siendo captura manual.
- Mantener la precisión y procedencia por lectura/vértice conforme al contrato vigente.
- Conservar versiones geométricas, borradores y revisión previa.
- Un análisis de deforestación debe identificar qué geometría y fuente utilizó; un cambio de parcela no puede heredar silenciosamente la vigencia del análisis.
- Distinguir cartografía base para orientarse de la información utilizada para analizar cambio de bosque.
- No transformar “sin alertas” o cobertura insuficiente en ausencia probada de deforestación.
- Las clasificaciones del estudio nacional B02 orientan prioridades; no se copian como veredicto de cada productor.
- Mantener el satélite sintético rotulado y separado de evidencia real. Estas guías no autorizan enviar coordenadas a un proveedor externo.

Fechas de siembra, producción, captura geométrica y cambio de cobertura representan hechos diferentes. No usarlas como equivalentes.

## 9. Criterios para no volver a cerrar funciones incompletas

Una función no queda acreditada solo porque exista un endpoint, una migración, un permiso o una prueba aislada.

Para cerrar un recorrido original deben comprobarse:
1. Ruta accesible y navegación visible para el rol correcto.
2. Datos y estados de configuración comprensibles.
3. Acción completa de principio a fin, incluyendo consulta del resultado.
4. Denegaciones de otra organización o de otro titular.
5. Tratamiento de errores sin ocultarlos como “no hay datos”.
6. Historia y atribución de la acción cuando corresponda.
7. Evidencia de verificación con su entorno y SHA.
8. Ausencia de capacidades anunciadas como operativas que no pueden utilizarse.

Para una función solo de consulta no se exige una escritura. Para una dependencia externa, la pantalla explica el bloqueo y permite el trabajo independiente autorizado.

Los estados “aún no implementado”, “sin vínculo”, “sin permiso”, “sin datos”, “servicio externo no configurado” y “pendiente de revisión” no son intercambiables.

## 10. Orden de implementación recomendado para Claude Code

Primero verificar cualquier candidato congelado o validación activa. No editar ese árbol durante la corrida.

1. Terminar la mejora “Mi ubicación” ya autorizada, reutilizando lo existente.
2. Completar Mi finca y su navegación por parcelas, entregas y documentos propios conforme a UX-D08 y demás fuentes originales.
3. Completar la aportación documental desde los registros y separar guías de soporte aportado y revisión.
4. Comprobar las pantallas y acciones de los demás roles contra sus criterios originales, corrigiendo las brechas concretas encontradas.
5. Reconstruir un lote desde el reporte hasta las parcelas y sus soportes, mostrando faltantes y las decisiones humanas.
6. Mantener aparte las activaciones y aceptaciones que realmente dependan de personas, servicios, piloto o teléfono físico.

No reimplementar módulos que ya funcionan. No reclasificar las nuevas ideas de una guía como requisitos originales sin contrastarlas.

## 11. Instrucción de integración para Claude Code

Usa este documento y el paquete de resúmenes como contexto operativo de Ecuador. Conserva las referencias a las publicaciones y sus límites.

Contrasta primero cada necesidad con los requisitos, UX, permisos, backlog y código existentes. Actualiza una única tabla breve de brechas en la continuidad o trazabilidad responsable:
fuente original → función → rol → pantalla/API → estado comprobado → siguiente acción.

Distingue texto desactualizado, integración incompleta, función ausente y configuración de cuenta pendiente. No te detengas al entregar esa tabla: continúa con la primera brecha ejecutable autorizada.

La sección jurídica debe ayudar a aportar y gestionar evidencia pertinente. Mantén las guías como consulta; no presentes a Terra Link como certificadora. No conviertas la falta de revisión de un perfil global en bloqueo general de carga documental, ni conviertas una carga en aprobación del expediente.

Reutiliza los mecanismos existentes de revisión y conclusión como registro de actos humanos identificados. No borres historia ni elimines compuertas de forma indiscriminada.

Completa las entregas con el protocolo adoptado: implementación, comprobaciones, validación cuando corresponda, despliegue local, demostración y respaldo si hay estado persistente relevante.

No cambiar los porcentajes de aceptación original por haber incorporado estas fuentes. No afirmar cobertura de todo el producto sin probar los recorridos de cada rol.

## 12. Fuentes y límites de uso

Base aportada por el propietario:
- Resumenes_EUDR_10_PDF_Markdown.zip.
- Archivos B01–B10 identificados en la tabla del apartado 3.
- Índice 00_INDICE_GENERAL.md, en particular sus advertencias sobre síntesis y versiones.

Contraste oficial general:
- [UE-1] Comisión Europea, “Understand due diligence under the EU Deforestation Regulation”, consultada el 22 de octubre de 2026:
  https://green-forum.ec.europa.eu/nature-and-biodiversity/deforestation-regulation-implementation/understand-due-diligence_en

Los ejemplos de documentos y las decisiones de UX aquí propuestos son traducciones funcionales, no dictámenes de aplicabilidad ni una lista universal de requisitos jurídicos.

Antes de publicar reglas normativas específicas, verificar el pasaje en el PDF original y contrastar la norma oficial vigente. Las fechas antiguas, esquemas pedagógicos y recomendaciones voluntarias no se convierten en controles obligatorios del software por aparecer en una guía.

Este análisis no modifica los archivos originales, el repositorio, roles, permisos, datos ni aprobaciones.

