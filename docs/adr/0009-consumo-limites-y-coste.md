# ADR-0009 — Consumo, límites y coste

- **Estado**: **coste adoptado para desarrollo y demostración local (2026-10-20)**: estimación por organización y período explícito en USD con tarifas declaradas, versionadas y con vigencia (migración 0056, `/platform-cost`), reproducible, sin facturación; al superar un límite se **rechaza** con explicación y sin sobrecoste. **Fuera de esta entrega**: fijar una tarifa acordada con un cliente (configuración comercial, no criterio original) y medir consumo en operación real. Anterior: parcialmente adoptado (2026-10-18). **Los límites existen y se publican**; **el coste está abierto**
- **Historia**: P1-015 · **Requisito**: RF-46 (`docs/03:62`) «…/consumo», con la restricción «**decisiones de
  coste**»

## Contexto

El producto **ya aplica límites**: tamaño de archivo, cuota de almacenamiento por organización, tamaño y
complejidad de una geometría, intentos de acceso, duración de la sesión y topes de procesamiento de la
extracción asistida. Estaban en la configuración y en el código, pero **no se podían consultar**: para saber
cuánto pesa el límite había que leer el código.

Lo que **no existe** es un **coste**: ninguna tarifa acordada, ningún proveedor contratado, ninguna unidad de
cobro decidida.

## Lo que se decide aquí (y ya está hecho)

**Los límites vigentes se publican y se comprueban.** `GET /organizations/:orgId/limits` devuelve, por cada
límite: qué limita, su valor y unidad, **de dónde sale** (variable de entorno o constante del código), dónde
se aplica y **qué responde el producto al superarlo**. Si alguien cambia un valor por entorno, la respuesta
muestra el valor cambiado: **no hay una lista escrita a mano que pueda quedar desfasada**.

Junto a ellos se publica el **consumo observado** de la organización —documentos, versiones, bytes
almacenados frente a la cuota, parcelas, entregas y eventos—, medido con consultas reales.

**El consumo no es un coste**, y la respuesta lo dice: sin tarifa no hay importe, y poner uno sería inventarlo.

## Lo que queda abierto

| # | Decisión | Opciones | Efecto |
| --- | --- | --- | --- |
| 1 | **Unidad de cobro** | **(A)** por organización · **(B)** por usuario activo · **(C)** por volumen (toneladas trazadas) · **(D)** por almacenamiento | Cambia a quién le sale caro: (B) castiga a cooperativas con muchos técnicos; (C) a las grandes; (D) a las que suben muchos documentos |
| 2 | **Qué pasa al llegar al límite** | **(A)** rechazar —lo actual— · **(B)** avisar y dejar pasar · **(C)** cobrar el exceso | (A) es predecible y no cobra sorpresas; (C) exige la decisión 1 resuelta |
| 3 | **Si los límites se fijan por organización** | **(A)** iguales para todas —lo actual— · **(B)** por contrato | (B) exige guardarlos como dato, no como configuración, y **versionarlos** |

**Recomendación**: mantener **(A)** en las tres hasta que haya un piloto con usuarios reales. Fijar tarifas sin
consumo observado de verdad sería inventar números, y el consumo del entorno DEMO **no sirve** para eso.

## Consecuencias

- **RF-46 no cierra** por la parte de «coste … comprobado»: no hay coste que comprobar, y el requisito lo pide.
  Su condición exacta es resolver la decisión 1 y tener consumo real que medir.
- Lo que sí queda demostrado es la parte de **límites**: existen, se publican con su procedencia y se
  comprueban contra el comportamiento real del producto.
- **No se fija ningún límite nuevo** en esta entrega: publicar no es decidir.
