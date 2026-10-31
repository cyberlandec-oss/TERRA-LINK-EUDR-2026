# Manual de operación y guion de capacitación (2026-10-15)

**Esto es documentación preparada, no capacitación impartida.** Nadie ha sido formado todavía; el guion de abajo está
escrito para dictarse, no ejecutado. Cubre **solo las funciones que existen hoy**, con sus bloqueos vigentes.

Entorno: desarrollo local. No hay producción, ni despliegue, ni soporte.

## 0. Tres superficies distintas, que no son lo mismo

| Superficie | Qué es | Estado |
| --- | --- | --- |
| **Web** (`localhost:3000`) | La aplicación completa, por rol | **Operativa** para todo lo que describe este manual |
| **Vista móvil simulada** (`localhost:3001`) | La app móvil **servida en un navegador** (Expo web). Sirve para ver pantallas y recorridos | **Vista previa**: no es un teléfono. No hay GPS real, ni cámara real, ni almacenamiento del dispositivo |
| **Android nativo** | La app instalada en un teléfono | **No ensayada en dispositivo físico.** Hay evidencia de **emulador**, que es otra cosa |

Cuando este manual dice «captura de ubicación», en web y en la vista simulada se usa la ubicación del **navegador**.
Eso no es GPS de campo y el sistema lo registra como método distinto.

## 1. Entrar y elegir organización

1. Abrir `http://localhost:3000` → correo y contraseña → **Iniciar sesión**.
2. Arriba a la izquierda, el selector de organización. Quien pertenece a varias, elige.
3. El menú lateral **solo muestra lo que el rol permite**. Si falta una sección, no es un fallo: es el permiso.

**Si algo falla**

| Mensaje | Qué pasa | Qué hacer |
| --- | --- | --- |
| «Credenciales inválidas» | Correo o contraseña | Reintentar; tras varios intentos hay bloqueo temporal por minutos |
| «No tienes permiso…» | El rol no incluye esa acción | Pedir el rol a quien administre la organización |
| «El recurso no está disponible» | El dato es de otra organización | No es un error: no existe para quien lo pide |
| «Sin conexión con el servidor» | La API no responde | Avisar; no reintentar en bucle |

## 2. Por rol: qué hacer, qué esperar, qué hacer si falla

### 2.1 Administrador de organización (ORG_ADMIN)

| Tarea | Pasos | Resultado esperado |
| --- | --- | --- |
| Invitar a alguien | Miembros e invitaciones → Invitar → correo + rol | Enlace de invitación de un solo uso. **El correo no se envía solo**: hay que hacerlo llegar |
| Cambiar roles | Miembros → fila → Roles | Permisos efectivos al instante; queda en la bitácora |
| Dar de baja a un miembro | Miembros → Desactivar | Pierde acceso; su historial se conserva |
| Importar desde Excel | Importar datos → plantilla → previsualizar → confirmar | La previsualización **no modifica nada**; los errores salen por fila |

**Recuperación**: si la previsualización marca errores, corregir el archivo y volver a subir. Confirmar una
importación con errores no es posible; no hay forma de «forzarla».

### 2.2 Técnico de campo (FIELD_TECHNICIAN)

Solo ve **los productores asignados a su membresía**. Que no aparezca un productor no es un fallo.

| Tarea | Pasos | Resultado esperado |
| --- | --- | --- |
| Registrar productor | Productores → Nuevo | Código único en la organización. Si se repite, lo avisa |
| Registrar parcela | Productor → Parcelas → Nueva | Parcela sin ubicación hasta capturarla |
| Capturar ubicación | Parcela → Capturar ubicación | Punto con precisión informada. **Un punto no tiene superficie**: no la invente |
| Capturar polígono | Parcela → Iniciar captura de polígono | Un vértice por esquina; el borrador se guarda en el servidor y se recupera al recargar |
| Importar GeoJSON | Parcela → Importar GeoJSON | Un archivo por parcela, WGS84 lon/lat. Si no cumple, dice el motivo |

**Recuperación**: la captura de polígono **no funciona sin conexión** en la web; si se corta, el borrador queda
guardado y se retoma. Una geometría mal capturada **no se edita**: se crea una versión nueva y la anterior se
conserva.

### 2.3 Operador de recepción (RECEPTION_OPERATOR)

| Tarea | Pasos | Resultado esperado |
| --- | --- | --- |
| Registrar entrega | Entregas → Nueva → productor, producto, cantidad declarada, parcela de origen | La entrega queda registrada con su origen |
| Confirmar recepción | Entrega → Recibir → centro, fecha, pesaje | **Declarado y recibido se conservan por separado**: 500 declarados con 480 recibidos son dos datos, no un error |
| Tomar muestra | En la recepción, añadir muestra | La calidad queda **«Pendiente de evaluación»** |
| **Cerrar la entrega** | Entrega → «Cerrar la entrega» → motivo si hay diferencia | La entrega pasa a **«Cerrada y justificada»** |

**Cómo funciona el cierre** (**D-33**, regla provisional del MVP local desde el 2026-10-15):

- El cierre es **explícito**. Recibir no cierra nada: una entrega sigue abierta hasta que alguien la cierra.
- **Toda** diferencia exige **motivo**, falte o sobre material. Lo que la regla pide es **explicarla**, no evitarla:
  se puede cerrar con diferencia.
- Cerrar **con diferencia** necesita permiso de corrección de entregas, no solo el de confirmar recepciones:
  afirmar una pérdida no es rutina de mostrador. Quien solo recibe verá el cierre **denegado y explicado**.
- **Sin diferencia** no se pide motivo: cerrar es rutina.
- Una entrega cerrada **no admite recepciones nuevas y no se reabre**. Si llega más material, es **otra entrega**.
- Cerrar **no ajusta** lo declarado: 500 declarados y 480 recibidos siguen siendo dos cifras conservadas.
- Si una corrección admitida cambia la diferencia después del cierre, la entrega **sigue cerrada**, el motivo
  anterior **se conserva** y se **añade** uno nuevo. Ningún motivo se reemplaza jamás.

**Lo que aún no hay**: **tolerancias** ni límites de aceptación. El sistema no decide si una diferencia es
aceptable; registra quién la explicó y cómo. Y **nadie que reciba cacao de verdad ha usado todavía este cierre**:
está probado con datos sintéticos.

### 2.4 Operador de calidad (QUALITY_OPERATOR)

| Tarea | Pasos | Resultado esperado |
| --- | --- | --- |
| Registrar resultado | Recepción → muestra → Resultado | Mediciones con parámetro, valor y unidad |
| Liberar o rechazar | Resultado → decisión | «Calidad liberada **por decisión humana**». **No es liberación jurídica** y así lo dice la pantalla |

**Recuperación**: una decisión de calidad no se borra; se corrige con un registro nuevo que referencia al anterior.

### 2.5 Responsable de trazabilidad (TRACEABILITY_MANAGER)

| Tarea | Pasos | Resultado esperado |
| --- | --- | --- |
| Formar lote | Lotes → Nuevo → recepciones | El lote hereda el origen. Si algún insumo no lo declara, queda **«Origen incompleto»** y no se mezcla con origen conocido |
| Fermentación | Procesos → Nuevo (FERMENTATION) → iniciar con insumos → cerrar con salidas y merma | Conservación: lo consumido = lo producido + la merma documentada |
| Secado | Procesos → Nuevo (DRYING) → iniciar con insumos → cerrar con salidas, merma **y humedad** | Conservación igual que en fermentación, más la medición de humedad |
| Traslados y mermas | Inventario → movimiento | El saldo sale del ledger, que es la única fuente |

**Cómo se cierra un secado** (**D-32**, regla provisional del MVP local desde el 2026-10-15):

- La humedad final es una **medición**, en **`%BH`** (porcentaje en base húmeda), con **método** y **responsable**.
  Es **obligatoria para cerrar**: sin ella el formulario no deja enviar y el servidor tampoco lo acepta.
- Se conservan hasta **seis decimales**. Si se escribe más precisión, **se rechaza con su motivo**: no se redondea
  al guardar. En pantalla se presenta con un decimal, y el valor registrado se muestra al lado.
- El tope de **100** es **estructural** (un porcentaje no pasa de 100), **no** un criterio de calidad.
- La humedad **no convierte masas**: el balance sigue siendo en kg. Lo consumido = lo producido + la merma.

**Lo que aún no hay**: **límites de aceptación**. El sistema **no decide si una humedad es buena**; registra la
medición, quién la tomó y con qué método. Tampoco hay **unidades de peso adicionales**: hoy solo kg. Y **ningún
operador real ha medido un secado con esto**: está probado con datos sintéticos.

Mientras el proceso está abierto, el material queda **reservado** —no se pierde— y el proceso puede cancelarse.

### 2.6 Responsable EUDR (EUDR_MANAGER)

| Tarea | Pasos | Resultado esperado |
| --- | --- | --- |
| Evaluar riesgo | Riesgo → lote → Evaluar | Resultado **técnico** por regla, con su explicación y su límite. **Severidad `NOT_ASSESSED` y conclusión `UNDETERMINED` por diseño** |
| Crear mitigación | Riesgo → factor → Mitigar | Solo sobre causas accionables; las que dependen de una decisión ajena se rechazan a propósito |
| Verificar mitigación | Mitigación → Verificar | **Quien ejecutó no verifica**: hacen falta dos personas |
| Expediente | Debida diligencia → crear → capturar instantánea | Lista de requisitos con su estado real |
| Análisis satelital | Parcela → Análisis satelital | Hoy: «adaptador en desarrollo». **No se puede encargar** |

**Bloqueos vigentes**: la severidad exige **adoptar** el catálogo `1.0.0` en tu organización (publicarlo no basta);
la **conclusión** sigue bloqueada por **D-07.5 y D-07.6**; `READY` del expediente exige seis requisitos que hoy no
son evaluables (ver §3); llamadas satelitales reales (**D-09 parte B**).

### 2.7 Responsable de exportación (EXPORT_MANAGER)

| Tarea | Pasos | Resultado esperado |
| --- | --- | --- |
| Registrar comprador | Embarques → Compradores → Nuevo | Comprador **declarado**, sin verificación externa |
| Preparar embarque | Embarques → Nuevo → ítems por lote | Cantidades en KG desde el centro de salida |
| Reservar | Embarque → Reservar | Reserva en el ledger. **Reservar no reduce la existencia**: la compromete |
| Revisar preflight | Embarque → Preflight | Lista de comprobaciones con su estado |
| Despachar | Embarque → Despachar | **Bloqueado hoy** |

**Bloqueo vigente**: el despacho exige paquete DD aprobado y vigente, evidencia y la compuerta `SHIPMENT_DISPATCH`,
cuya condición depende de **D-34**.

### 2.8 Auditor (AUDITOR)

Solo lectura. Ve productores **sin coordenadas exactas**, la bitácora y los reportes, y puede exportar.
No encarga análisis, no evalúa, no decide.

### 2.9 Roles sin experiencia propia todavía

**PRODUCER** y **BUYER** existen como roles pero **sin permisos asignados**: sus pantallas están pendientes
(UX-D08/UX-D09, y las concesiones entre organizaciones son P1-001). No incluirlos en una capacitación.

## 3. Los bloqueos, explicados para quien opera

Ninguno es una avería. Son decisiones que faltan, y el sistema prefiere detenerse a inventar.

| Lo que no se puede hacer | Por qué | Quién lo desbloquea |
| --- | --- | --- |
| Obtener **severidad** de riesgo | Desde el 2026-10-15 hay un catálogo técnico publicado (`1.0.0`, con cinco severidades), pero **ninguna organización lo ha adoptado**: **publicar no es adoptar**, y sin adopción toda evaluación sale «sin clasificar» con su motivo | El administrador de **tu** organización, adoptando `1.0.0` (D-07.1). No se adopta solo ni se activa en otras organizaciones |
| Obtener **conclusión regulatoria** | No hay perfil jurídico ni revisor autorizado definidos | **D-07.5 y D-07.6** |
| Llegar a `READY` en el expediente | Seis requisitos no evaluables: perfil de geolocalización (**D-05.B**: el perfil **técnico** ya existe y no basta), análisis de deforestación (**D-09 parte B**), perfil jurídico (**P1-005**), catálogo de riesgo **aprobado bajo perfil jurídico** y conclusión regulatoria (**D-07.5 y D-07.6**: adoptar el catálogo técnico **no** cumple este requisito), vínculo con embarque (**D-34**/P0-029) | Las cinco decisiones citadas |
| Despachar un embarque | Preflight y compuerta `SHIPMENT_DISPATCH` | **D-34** |
| Encargar un análisis satelital real | El adaptador existe, su uso real no está autorizado | **D-09 parte B** |

**Riesgo, desde el 2026-10-15.** La ficha de un lote puede mostrar ahora una **severidad**, pero solo si tu
organización ha **adoptado** el catálogo `1.0.0` — y hoy ninguna lo ha hecho, así que verás «Sin clasificar» con
el motivo. En Reportes, los lotes **críticos** tienen su propio contador y **no se suman a los altos**; ese
contador es una **extensión de Terra Link**, está rotulado como tal y no viene de la lista de la fuente. Cuando aparezca, léela como lo que es: **severidad de los hallazgos evaluados**, con su
**cobertura** al lado. Si la cobertura dice que la clasificación es **parcial**, lo es: hay reglas que no se
pudieron evaluar o categorías sin ninguna regla. **Una severidad no es una conclusión regulatoria**, y «bajo»
nunca significa «insignificante» en sentido legal.

**En Reportes, «Parcelas que cumplen el perfil técnico de destino»** (antes «Parcelas válidas (GIS)») dice ahora
**contra qué criterio y qué versión** cuenta, y separa cinco situaciones: cumple, no cumple, en revisión, no
evaluable y **sin evaluar**. Las sin evaluar **no cuentan como incumplimiento**: quedan fuera del denominador y se
informan aparte. Si nadie ha evaluado todavía, el indicador dice **«Desconocido»**, que no es cero.

**Lo que cambió con el perfil de destino (2026-10-15).** La ficha de parcela muestra ahora **dos dictámenes**: la
evaluación técnica de siempre y el **perfil técnico de destino**. Pueden **discrepar**, y eso no es un fallo: una
geometría puede ser técnicamente válida y no estar bien formada para el sistema de destino (por ejemplo, si el
polígono tiene un hueco). **Cumplir el perfil no es conformidad EUDR**, y nada de esto se ha probado contra el
sistema real: solo contra su documentación fechada.

**Dos que ya NO están bloqueados** (desde el 2026-10-15): **cerrar un secado** y **cerrar una entrega con
diferencia**. D-32 y D-33 se adoptaron como reglas provisionales del MVP local y ambas operaciones se ejecutan. Ver
§2.3 y §2.5. Que se ejecuten **no** significa que estén validadas en campo ni que haya límites de aceptación: lo
que sigue sin decidirse se dice en cada una de esas secciones.

## 4. Guion de capacitación (para dictar, 2 h)

| Bloque | Minutos | Contenido | Comprobación de que se entendió |
| --- | --- | --- | --- |
| 1. Qué es y qué no es | 10 | Trazabilidad y preparación de debida diligencia. **No** certifica ni presenta nada ante la UE | Que cada quien diga una cosa que el sistema **no** hace |
| 2. Entrar y rol | 10 | Acceso, organización, menú por permiso | Cada quien identifica qué secciones ve y por qué |
| 3. Origen | 25 | Productor → parcela → ubicación o polígono | Registrar un productor y una parcela con geometría |
| 4. Recepción, calidad y cierre | 25 | Entrega → recepción → pesaje → muestra → decisión → **cierre con motivo** | Recibir con diferencia, cerrarla con su motivo y explicar por qué no se reabre |
| 5. Lote y procesos | 25 | Lote → fermentación → **secado con humedad** → merma → inventario | Cerrar una fermentación y un secado, y leer el saldo en el ledger |
| 6. Riesgo y expediente | 20 | Evaluar, leer factores, instantánea | Explicar por qué la conclusión es `UNDETERMINED` |
| 7. Embarque | 15 | Comprador, ítems, reserva, preflight | Reservar y leer por qué el despacho no procede |
| 8. Errores y bloqueos | 10 | §1 y §3 de este manual | Distinguir «no tengo permiso» de «falta una decisión» |

**Material**: datos DEMO sintéticos. **Nunca** usar datos de productores reales en una capacitación.

**Lo que este guion no cubre** porque no existe: captura en Android real, operación sin conexión en dispositivo,
despacho, paquete DD exportado y cualquier presentación ante una autoridad.

## 5. Antes de operar de verdad

1. **Validar con operadores reales** el cierre de entregas y el cierre del secado (D-32/D-33). Están adoptadas
   **para desarrollo** y probadas con datos sintéticos; nadie que reciba cacao o mida humedad las ha usado.
   Pendientes además: **límites de aceptación** de calidad y humedad, y **unidades de peso** distintas de kg.
2. Ensayar en **Android real** si se va a capturar en campo.
3. Tener el respaldo verificado del día (`docs/20` §Respaldo y restauración) **antes** de cargar datos reales.
4. Acordar quién responde cuando algo se bloquea: hoy no hay soporte definido.
