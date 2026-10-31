# Guía para probar A-01 a mano desde la web (mapa, captura y fotografías)

Todo con datos **sintéticos** en la organización «ENSAYO A-01 · prueba manual». Las contraseñas **no** están en este documento: se generan al azar y viven solo en
`CREDENCIALES_A01.csv` (raíz del repositorio, ignorado por git). Para crear otra organización de ensayo: `node e2e/review/a01-preparar-prueba-manual.mjs`.

**Requisitos**: perfil `app` levantado (web en `http://localhost:3000`, API en `4000`) y el servicio de mapas con datos (`http://localhost:8090/metadata.json` debe responder;
si no, `node infra/maps/preparar-mapa.mjs`). Usa un navegador con WebGL (Chrome o Edge actuales).

## Cuentas (correo en `CREDENCIALES_A01.csv`)
| Rol | Qué puede hacer |
| --- | --- |
| `PRODUCER` · productor1 | Captura en SUS parcelas (PM-L1, PM-L1B) y ve/descarga sus fotos. No ve PM-L2 |
| `PRODUCER` · productor2 | Lo mismo, solo en PM-L2 |
| `FIELD_TECHNICIAN` | Solo productores asignados (PM-T → parcela PM-LT) |
| `ORG_ADMIN` | Todo el recorrido sobre la organización; vincula productor–usuario |
| `AUDITOR` | Consulta; **sin** «Captura de campo» |
| `BUYER` | Sin acceso a parcelas |

Inicio de sesión: `http://localhost:3000/` → «Iniciar sesión» → «Mis organizaciones» → la organización «ENSAYO A-01 · prueba manual». Menú **ORIGEN → Captura de campo**
(ruta `/organizaciones/<id>/captura`).

## Recorrido 1 · productor1: mapa, revisión y guardado (en español)
1. Entra como productor1. Esperado: «Mi espacio»; en ORIGEN aparece **Captura de campo**.
2. Captura de campo: el productor se elige solo; en «Parcela» solo aparecen **PM-L1** y **PM-L1B** (no PM-L2).
3. Elige PM-L1 → **Escribir o dibujar** → «Un polígono» → **Dibujar en el mapa**. Esperado: mapa real (calles, ríos, relieve de OpenStreetMap), atribución «© OpenStreetMap contributors», y bajo el mapa las coordenadas de la mira.
4. «Ir a longitud» `-80.16`, «Ir a latitud» `-0.85` → **Centrar el mapa aquí**. Acerca con los botones +/− o la rueda; desplaza arrastrando.
5. Pulsa **Fijar vértice en la mira** (o clic en el mapa; o con el mapa enfocado, **Enter**). Mueve el mapa y fija 2 vértices más. Puedes arrastrar un vértice.
6. Esperado: la tabla «Coordenadas a registrar» lista los vértices como `[longitud, latitud]` con el orden rotulado.
7. **Revisar antes de guardar**. Esperado: «Revisión hecha por el servidor (todavía no se guardó nada)», tipo Polígono, superficie calculada, validez técnica, procedencia «Coordenadas ingresadas» (**no** GPS) y precisión «No informada». En «Versiones» de la ficha todavía no hay versión nueva.
8. **Guardar como nueva versión**. Esperado: «Ubicación guardada como versión 1.»
9. Repite con otras coordenadas: ahora pide **Motivo de la corrección**; sin motivo el botón no guarda. Con motivo → versión 2; la 1 se conserva (ficha de la parcela → «Versiones geométricas»).
10. Nada del mapa sale de tu equipo: en las herramientas del navegador (pestaña Red) las solicitudes del mapa van solo a `localhost:8090`.

## Recorrido 2 · productor1: fotografías (contrato D-41)
1. En la misma pantalla, «Adjuntar una evidencia»: elige una **foto JPEG tomada con un móvil** (con EXIF) y un título → **Subir evidencia**.
2. Esperado: «Evidencia recibida…» y «Se quitaron los metadatos de la copia subida; tu archivo original no se modificó.» (tu archivo no cambia).
3. Abre la evidencia (enlace del título) → **Descargar v1**. Esperado: descarga una copia **sin** ubicación ni modelo de dispositivo (puedes comprobarlo con cualquier visor de EXIF) y con otro SHA-256 que tu original. El nombre es neutro (`fotografia.jpg`).
4. Sube un PDF como acta: se guarda como «Evidencia del recorrido». Una foto no se acepta como ese tipo.
5. Cierra sesión y entra como **productor2**: no ve la foto de PM-L1 ni PM-L1 en la lista. (API: `GET …/documents/<id>` → 404.)

## Recorrido 3 · croquis, inglés y 390 px
1. Cambia el idioma en el selector de la barra superior a **English**; repite el recorrido 1: «Field capture» → «Type or draw» → «Draw on the map». Los textos están traducidos; «Coordinate order» visible.
2. Redimensiona la ventana a ~390 px de ancho (o modo móvil del navegador): sin desplazamiento horizontal; el mapa ocupa el ancho.
3. Teclado: Tab hasta el mapa (marco verde de foco) → flechas desplazan, `=`/`-` acercan, **Enter** fija un vértice; Tab al botón «Revisar antes de guardar».

## Recorrido 4 · técnico, recarga y alcance
1. Entra como `FIELD_TECHNICIAN`: en Captura de campo solo ve el productor **PM-T** y su parcela PM-LT.
2. En PM-LT: «Polígono por vértices» → «Iniciar captura de polígono» (permite ubicación del navegador) y añade 2 vértices. **Recarga la página**: el borrador aparece solo y **no se guardó ninguna versión**.
3. «Importar GeoJSON» → sube un `.geojson` → «Analizar archivo» → **recarga**: «Retomar revisión»; tampoco se guarda sola.

## Recorrido 5 · administración: vínculo, pérdida de acceso y satélite de ensayo
1. Como `ORG_ADMIN`: Productores → PM-P1 → sección de vínculo con la cuenta del productor (botón «Desvincular» / «Vincular persona», con motivo obligatorio). Desvincula a productor1: al instante deja de ver PM-L1 y sus fotos; al restablecerlo, vuelve.
2. Satélite: por defecto **no** hay modo ensayo (`SATELLITE_FIXTURE_ENABLED=false`). Para verlo, solo en una prueba: añade `SATELLITE_FIXTURE_ENABLED=true` a `.env`, `docker compose --profile app up -d --no-build api worker`, abre una parcela como administrador (panel «Análisis satelital»: «MODO ENSAYO», escenario elegible) y **al terminar** quítala de `.env` y recrea api y worker. Los resultados son inventados y rotulados «ENSAYO»; no cambian conclusiones, READY ni el despacho.

## Qué NO debe pasar (si ocurre, es un defecto)
- Productor1 ve/modifica PM-L2, o descarga fotos de otra parcela.
- Auditor o comprador capturan, o el auditor ve «Captura de campo».
- El mapa pide algo a un host distinto de web, API (`4000`) y mapas (`8090`).
- «Revisar antes de guardar» crea una versión; una recarga confirma sola un borrador.
- Una coordenada escrita o dibujada aparece como «GPS» o con precisión inventada.

## Si algo falla
- «La cartografía local no está disponible»: el servicio `maps` está apagado o sin datos → `docker compose --profile app up -d maps` y/o `node infra/maps/preparar-mapa.mjs`. Mientras tanto la tabla de coordenadas y el croquis siguen funcionando.
- «Este navegador no puede dibujar el mapa (falta WebGL)»: usa otro navegador/activa la aceleración por hardware.
