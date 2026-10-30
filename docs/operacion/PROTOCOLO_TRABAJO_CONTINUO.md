# Terra Link — Protocolo de trabajo continuo con Claude Code
Versión 1.0 · 22 de octubre de 2026

**Conciliación de autorizaciones (2026-10-29):** mantener el repositorio y la rama vigentes; push autorizado a esa rama con revisión del diff y sin secretos; preservar usuarios y claves; no ejecutar seed ni respaldos/restauraciones rutinarios. Estas precisiones reflejan las instrucciones posteriores del propietario y no cambian criterios funcionales o regulatorios.

## Cómo usar estas instrucciones

Entrega este archivo completo a Claude Code dentro del repositorio real. Es una instrucción de trabajo propuesta para que el propietario la adopte al enviarla. No acredita que se hayan configurado hooks, permisos o procesos en su equipo.

Pídele que integre una referencia breve en el CLAUDE.md existente y mantenga el detalle en docs/operacion/PROTOCOLO_TRABAJO_CONTINUO.md, adaptando la ubicación a la estructura real. No sustituir CLAUDE.md, AGENTS.md ni la documentación raíz. No duplicar un protocolo equivalente que ya exista.

Estas instrucciones organizan la ejecución; no cambian criterios de aceptación, contenido regulatorio ni responsabilidades del producto.

## 1. Objetivo y autorización permanente

Trabaja hasta completar unidades de entrega del backlog original y las ampliaciones expresamente autorizadas. Después de cerrar una unidad, elige la siguiente ejecutable sin solicitar un “continúa”.

Dentro de ese alcance quedan autorizados:
- Leer el repositorio y las fuentes necesarias, implementar, corregir defectos y mantener la documentación responsable.
- Añadir las pruebas necesarias y ejecutar comprobaciones dirigidas y la validación completa cuando corresponda.
- Crear commits locales sin perder cambios existentes; continuar en `fix/next-seguridad-16-4-2`, sin nuevas ramas por rutina.
- Corregir el arnés cuando exista un defecto demostrado, conservando la fuerza de las comprobaciones.
- Aplicar parches de seguridad compatibles de dependencias necesarias, con lockfile y comprobación de compatibilidad.
- Desplegar en el entorno LOCAL conforme al procedimiento vigente, con migraciones autorizadas y protección de datos proporcionada a una intervención concreta; sin respaldos/restauraciones rutinarios.
- Crear datos sintéticos claramente identificados para pruebas; preferir bases desechables y reutilizar fixtures.
- Crear y eliminar únicamente recursos temporales nuevos del propio ensayo, identificados inequívocamente.

No pidas permiso de nuevo para esos pasos. Explica las decisiones rutinarias en el resumen, sin convertirlas en una aprobación pendiente.

Detente solo para la acción dependiente de una decisión que aún no esté autorizada. Continúa con trabajo independiente cuando exista.

## 2. Límites que se conservan

- Mantener los roles canónicos, el aislamiento por organización y el alcance propio/asignado. No repartir permisos nuevos por conveniencia.
- Las capacidades adicionales de captura web de A-01 no dan autoridad regulatoria ni acceso ajeno.
- Conservar las enmiendas específicas ya autorizadas, incluida la excepción exacta de asignación de EUDR_MANAGER/risk:conclude. Verificar el estado actual antes de describirlo.
- Conservar UNDETERMINED en el motor y todas las compuertas vigentes. Ninguna resolución humana omite otros requisitos.
- No registrar revisiones, aprobaciones ni conclusiones reales para obtener una demostración positiva.
- Mantener deshabilitadas las llamadas satelitales reales. Los ensayos locales no autorizan enviar geometrías a terceros.
- Android físico sigue pospuesto hasta el final. Completar el desarrollo y los ensayos locales posibles sin exigir el teléfono.
- AGENTS.md sigue fuera de los commits. No versionar credenciales, .env, respaldos ni artefactos que deban permanecer locales.
- No borrar los volúmenes existentes, ejecutar prune, down -v, resets de datos operativos ni limpiar datos append-only.
- El propietario autoriza hacer push del trabajo propio revisado a `fix/next-seguridad-16-4-2` del remoto comprobado de TERRA-LINK-EUDR-2026. No hacer force-push, fusionar main, desplegar en producción, contratar servicios, aceptar términos ni enviar mensajes sin su autorización específica. Las autorizaciones externas ya otorgadas conservan únicamente su alcance.
- No alterar trabajo ajeno, stashes ni procesos ajenos. No usar reset --hard, clean -fd o equivalentes para obtener un árbol limpio.
- El entorno local debe quedar operativo salvo instrucción explícita distinta.

Una autorización nueva del propietario puede modificar un límite concreto; no reinterpretar las demás restricciones.

## 3. Arranque de sesión: comprobar y continuar

Antes de editar:
1. Identifica repositorio, rama, HEAD, cambios existentes y servicios. No asumir que el informe anterior coincide con el disco.
2. Lee CLAUDE.md, las instrucciones aplicables y el documento vigente de continuidad.
3. Comprueba si ya existe una validación activa: proceso real, SHA, carpeta de resultados y último paso. No lanzar otra en paralelo.
4. Verifica el último cierre y no repitas entregas ya demostradas sin cambios o un defecto nuevo.
5. Elige una unidad ejecutable del backlog. Lee solo sus requisitos originales, aceptación y contratos afectados.

No releer toda la documentación en cada tarea. Amplía las lecturas cuando una dependencia o contradicción concreta lo requiera.

Prioridad:
1. Terminar una entrega autorizada que esté a medias.
2. Resolver defectos que bloquean esa entrega o una vulnerabilidad identificada necesaria para operar.
3. Completar implementación faltante de requisitos originales.
4. Completar ampliaciones ya autorizadas.
5. Preparar un insumo externo solo cuando falte y sea necesario; no volver a redactar los paquetes existentes.

## 4. Una cola y una continuidad

Usa el documento de continuidad existente como punto de entrada único. Añade o enlaza una tabla compacta; no crear un sistema paralelo de gestión.

Por tarea registra:
- Identificador y referencia del criterio original.
- Resultado concreto que debe obtener el usuario.
- Estado, siguiente acción y dependencia si existe.
- Rama y SHA funcional/candidato.
- Verificaciones realizadas y evidencia.
- Condición de cierre técnico y condición de aceptación real, por separado.

Estados de ejecución:
- PENDIENTE: aún no se inicia.
- EN_CURSO: hay una acción ejecutable.
- EN_VALIDACION: candidato congelado y corrida identificada.
- EN_CIERRE: despliegue, demostración, respaldo o documentación pendientes.
- BLOQUEADA_EXTERNAMENTE: falta una respuesta o recurso externo identificado.
- CERRADA_TECNICAMENTE: se completó el alcance técnico verificable.

Estos estados no reemplazan los estados oficiales del backlog. Usa los oficiales al registrar su aceptación.

Al bloquearse una tarea, escribe exactamente qué falta, quién debe aportarlo y qué acción desbloquea. Luego pasa a otra ejecutable. Si no queda ninguna, entrega una única lista priorizada de bloqueos, sin fabricar funcionalidades para mantener actividad.

## 5. Ciclo de entrega

### A. Definir una unidad pequeña y completa
Antes de editar, expresa en pocas líneas el comportamiento que falta, su fuente, componentes afectados y evidencia de cierre.

Agrupa cambios estrechamente relacionados. Evita un ciclo completo por cada texto, selector o detalle de CSS. Tampoco acumules módulos independientes en un candidato difícil de revisar.

### B. Implementar
Reutiliza contratos, servicios, permisos y componentes existentes. Corrige los defectos dentro del alcance sin pedir permiso para cada archivo.

Resuelve opciones técnicas rutinarias con el modelo vigente. Si hay una contradicción de requisitos, registra las fuentes y bloquea solo la decisión afectada.

No inventes condiciones legales, umbrales, nuevas incompatibilidades de roles o excepciones operativas.

### C. Verificar antes de congelar
- Typecheck, lint y pruebas dirigidas a los cambios y sus regresiones.
- En la web: español, inglés cuando el alcance lo exige, teclado, estados vacíos/errores y 390 px. Revisar capturas cuando haya cambios visuales.
- Si se añade o modifica un E2E, ejecutar el conjunto E2E completo antes de congelar cuando comparta datos globales o pueda afectar otras suites.
- Usar correos, códigos y versiones sintéticas propios del spec. Las aserciones no deben depender de que todo el catálogo global esté vacío.
- Preparar el guion de demostración antes del candidato final.
- Regenerar OpenAPI cuando cambie el contrato.
- Revisar diff y archivos que entrarán al commit. No usar git add indiscriminadamente.

No añadir pruebas que solo repliquen la implementación. No disminuir aserciones, omitir pruebas o ampliar timeouts para esconder un fallo.

### D. Congelar y validar
Confirma el candidato y registra el SHA exacto y el estado del árbol.

Ejecuta npm run validate una sola vez para ese candidato cuando corresponda al cambio. Mientras corre:
- No editar archivos del árbol validado, incluidos guiones y documentación.
- No hacer instalaciones, builds ni pruebas paralelas que compartan bases, buckets o puertos con esa corrida.
- Guardar logs y notas temporales fuera del repositorio o en destinos ignorados ya previstos por el procedimiento.
- Comprobar progreso por las etapas y los registros de pruebas, no solo porque exista el proceso.
- Esperar el resultado final del validador; la salida del lanzador no es el veredicto.

Los cambios solo documentales no requieren automáticamente una validación funcional completa. Los cambios en pruebas se verifican según el alcance y las reglas del repositorio; no se atribuye al producto un resultado que el arnés no llegó a comprobar.

### E. Desplegar y demostrar
Con veredicto aprobado, despliega automáticamente el SHA validado en LOCAL y comprueba /version, esquema y salud.

Si aparece +sucio, identifica la causa sin borrar ni esconder cambios ajenos. Obtén un despliegue atribuible con el procedimiento existente; no declares que coincide con el SHA mientras no lo haga.

Demuestra el comportamiento relevante y los permisos negativos. Distingue:
- Entorno desplegado.
- Ensayo aislado con datos sintéticos.
- Servicio o compuerta sustituida en el arnés.
- Estado preparado con SQL.

Ningún fixture acredita una transición real que no se ejecutó.

Si un guion falla, comprueba si es el guion o el producto. Una corrección exclusiva del guion permite repetir la demostración sobre el mismo despliegue; no exige por sí sola otra validación funcional.

### F. Protección de datos y reutilización de evidencia
No ejecutar respaldos ni restauraciones por rutina para cambios documentales, despliegues o migraciones aditivas. Reutilizar las evidencias existentes. Si una intervención concreta autorizada puede perder o transformar datos existentes, identificar su alcance y la protección necesaria antes de ejecutarla; seguir entonces el procedimiento vigente que corresponda.

Captura la comparación del origen en un punto coherente. Verifica únicamente los elementos realmente contrastados: conteos, restricciones, objetos, descifrado sin valores, invariantes y recuperación según corresponda.

Una restauración que no llegó a la comprobación no acredita esa comprobación. Conserva los fallos y repite con una corrección diagnosticada.

Elimina solo los recursos temporales creados por este ensayo, una vez identificados. No tocar los volúmenes anteriores.

### G. Cerrar y seguir
Actualiza una vez las fuentes responsables y la continuidad con resultados reales. No modificar todos los documentos por rutina.

Separa el commit funcional del commit de resultados cuando sea el procedimiento del proyecto. No repetir la validación funcional por añadir evidencia o continuidad.

Resume qué cambió, SHA validado/desplegado, resultado, límites y siguiente acción. Después comienza la siguiente unidad ejecutable sin esperar confirmación.

## 6. Ciclo de diagnóstico: sin repeticiones a ciegas

Toda corrida fallida sigue siendo fallida y se conserva.

Ante un fallo:
1. Identifica el primer error causal y separa los derivados.
2. Clasifica lo demostrado: producto, prueba, preparación, configuración o causa todavía desconocida.
3. Reproduce con la comprobación más pequeña que permita investigar.
4. Corrige y verifica las regresiones cercanas.
5. Si cambió código o arnés, confirma candidato nuevo antes de otra validación completa.

Repetir sobre el mismo SHA solo está justificado si se identificó y corrigió una condición externa concreta sin cambiar el candidato. Que una suite pase aislada o que un build posterior pase no demuestra por sí solo esa causa.

No “consumir” avisos de seguridad con builds sucesivos ni silenciar controles para obtener verde. Investigar el paquete y corregir la dependencia cuando corresponda.

Presupuesto recomendado por tarea: hasta tres rondas de corrección diagnosticadas. Si reaparece el mismo síntoma dos veces sin nueva evidencia, no lanzar otra validación completa: investigar el bloqueo. Al agotar ese presupuesto, checkpoint y siguiente tarea independiente. Si no existe, informar el bloqueo concreto.

Durante una corrida lenta, comparar progreso y tiempos con las referencias disponibles. La falta de actividad inicia inspección, no un kill automático ni otra corrida en paralelo.

Timeouts y commits lentos son observaciones. Suspensión, reloj, disco o contención son hipótesis hasta disponer de evidencia suficiente.

synchronous_commit=off se limita al arnés desechable *_test según el contrato vigente. Las comprobaciones de durabilidad/recuperación deben usar durable:true o el mecanismo operativo documentado.

## 7. Cuándo preguntar

Pregunta solo si falta una respuesta imprescindible para:
- Cambiar una función o criterio original, añadir alcance no autorizado o redistribuir responsabilidades.
- Registrar una aprobación/conclusión real o adoptar contenido regulatorio.
- Enviar datos reales a terceros, obtener/custodiar credenciales nuevas, aceptar términos o asumir costes.
- Ejecutar acciones destructivas, publicar, desplegar en producción o cambiar infraestructura fuera del alcance.
- Resolver una actualización mayor incompatible cuyo impacto exceda el mantenimiento autorizado.
- Resolver instrucciones realmente contradictorias que no se aclaren con las fuentes disponibles.

Antes de preguntar, completa el trabajo independiente, presenta el resultado o alternativa concreta y formula una pregunta puntual. No pedir una aprobación genérica del proyecto ni volver a plantear decisiones ya adoptadas.

No pedir permiso para corregir un selector, una ruta, una traducción, un defecto demostrado o una expectativa de prueba desactualizada cuando se preserva el criterio original.

## 8. Comunicaciones y continuidad de sesión

Da actualizaciones breves cuando haya un cambio de etapa, hallazgo o bloqueo. En validaciones largas informa progreso verificable con una frecuencia razonable para la sesión; no llenar el chat con mensajes de “sigo esperando”.

Formato de actualización:
- Tarea y resultado que se persigue.
- Estado actual con evidencia.
- Próxima acción automática.
- Solo si existe: decisión concreta que requiere al propietario.

No terminar el turno entre pasos ejecutables con “¿quieres que continúe?”. Si la herramienta devuelve una tarea en segundo plano, usa su mecanismo de monitorización para obtener el resultado y continuar dentro de la sesión cuando sea posible.

No prometer actividad autónoma cuando la aplicación haya cerrado, falten recursos o se haya alcanzado un límite de ejecución. Antes de una interrupción, guarda un checkpoint: proceso/corrida, SHA, último paso, archivos pendientes y siguiente acción. Al reanudar, verifica el proceso real antes de relanzar.

## 9. Configuración opcional de Claude Code

El prompt define el flujo, pero no elimina los permisos de la herramienta ni mantiene el equipo encendido.

Primero usa estas instrucciones en la sesión activa. Para persistirlas, integra la referencia en CLAUDE.md sin reemplazarlo.

Si se configura automatización adicional en Claude Code:
- Comprobar la versión instalada y la documentación oficial correspondiente.
- Usar permisos específicos para comandos de desarrollo ya autorizados y destinos del proyecto. Evitar permitir indiscriminadamente shell, Docker o toda escritura.
- Respetar denegaciones y políticas del entorno; no usar la automatización para eludirlas.
- Un hook Stop puede recordar que falta un paso ejecutable. Debe permitir finalizar cuando el trabajo esté cerrado, exista un bloqueo externo o el usuario interrumpa.
- El hook no debe ejecutar la validación completa, editar archivos, desplegar ni relanzarse indefinidamente.
- Si se implementa, mantener un contador y un máximo de tres continuaciones por turno como valor inicial, con salida segura ante error. No reiniciar ese contador en cada invocación.
- Antes de habilitarlo, probar los casos: tarea pendiente ejecutable, tarea cerrada, bloqueada, validación activa, contador agotado y fallo del hook.
- Un proceso de validación activo se monitoriza; el hook no crea otra corrida.
- Una incompatibilidad del hook no bloquea el desarrollo: continúa con el protocolo por instrucciones.
- No instalar plugins de loops ni crear servicios persistentes por defecto.

No se adjunta JSON de hooks porque debe adaptarse a la versión y configuración reales del equipo.

## 10. Progreso verificable

Separar siempre:
1. Implementación técnica.
2. Validación y demostración local.
3. Aceptación original del requisito.
4. Activación y operación real.

El último corte reportado por el propietario es 42/60 requisitos originales aceptados (70,0 %) y MVP 30/44 (68,2 %). Verificar el corte vigente en el repositorio antes de reutilizarlo. No equivale al porcentaje de código construido.

Las ampliaciones se contabilizan aparte. No convertir una demostración sintética en aceptación externa ni inventar un porcentaje técnico sin un inventario que lo sostenga.

## Mensaje inicial sugerido

Adopta este protocolo de trabajo continuo para el alcance ya autorizado de Terra Link. Comprueba primero el estado real del repositorio y cualquier validación activa. Integra la referencia en CLAUDE.md sin sustituirlo ni incluir AGENTS.md en commits. Termina la entrega en curso y continúa con la siguiente tarea ejecutable del backlog original. Implementa, comprueba, valida cuando corresponda, despliega en local, demuestra, respalda y documenta sin pedirme “continúa” entre etapas. Si una tarea depende de una decisión externa, deja el bloqueo concreto y avanza con otra independiente. Respeta los límites del protocolo y evita repeticiones sin diagnóstico.

## Referencias de la herramienta

Consultadas el 22 de octubre de 2026:
- Hooks de Claude Code: https://code.claude.com/docs/en/hooks
- Permisos de Claude Code: https://code.claude.com/docs/en/permissions

Estas referencias describen capacidades de Claude Code. El flujo específico, sus límites y sus presupuestos de reintento son recomendaciones de este protocolo, no requisitos impuestos por Anthropic.

