# Cartografía local de Terra Link (A-01)

Mapa base **real** para dibujar parcelas desde la web, servido **desde este mismo despliegue**. Nada de Terra Link (parcelas, coordenadas,
fotografías, identidades) sale hacia el mapa: el navegador solo pide teselas, estilo y tipografías al servicio local `maps`.

| Pieza | Qué es |
| --- | --- |
| Datos | OpenStreetMap, extracto de **Ecuador** de Geofabrik (`ecuador-<AAMMDD>.osm.pbf`), MD5 publicado verificado |
| Teselas | **Planetiler 0.10.2** → un solo archivo **PMTiles** (esquema OpenMapTiles), `tiles/ecuador.pmtiles` |
| Estilo y tipografías | `estilo.json` (este directorio) y `openmaptiles/fonts v2.0` (Noto Sans) copiados al volumen |
| Servicio | `maps` (nginx 1.27, solo lectura, lista de permitidos), puerto `${MAPS_HOST_PORT:-8090}` |
| Cliente | MapLibre GL JS + `pmtiles` en `apps/web/lib/map-capture.tsx`; cualquier URL que no sea del servicio local se **bloquea** |
| Almacenamiento | Volumen Docker `terra-link_map-data` (derivado y regenerable; **no** forma parte del respaldo de la base, pero cada respaldo guarda su `metadata.json`) |

## Preparar o actualizar

```
node infra/maps/preparar-mapa.mjs [--fecha AAMMDD]     # descarga, verifica, genera teselas, copia el estilo y escribe metadata.json
docker compose --profile app up -d maps                 # sirve el volumen
```

Es reproducible: el mismo comando con la misma `--fecha` regenera el mismo extracto. Descarga datos públicos (Geofabrik, GitHub,
Natural Earth y polígonos de agua de OSM que Planetiler trae por su cuenta); no envía nada. Sin datos, `maps` responde 404 y la web
muestra «La cartografía local no está disponible»: la tabla de coordenadas y el croquis sin mapa base siguen funcionando.

## Licencia, atribución y límites

- Datos © **OpenStreetMap contributors**, licencia **ODbL 1.0**; esquema © **OpenMapTiles** (CC-BY 4.0); Planetiler Apache-2.0;
  MapLibre y pmtiles BSD-3-Clause. La atribución se muestra en el propio mapa.
- **Cobertura**: Ecuador continental e insular. **Detalle**: el que tenga OSM; en zonas rurales puede haber pocas vías, edificios
  o cobertura de suelo; el nivel máximo de teselas es 14 (más cerca se amplía sin añadir detalle).
- Es una **referencia visual**: no acredita límites de propiedad, precisión GPS, deforestación ni conformidad. **No** se ajusta
  ningún vértice a elementos del mapa. No es una integración satelital; las llamadas satelitales externas siguen deshabilitadas.
