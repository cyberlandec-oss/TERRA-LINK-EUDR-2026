# Recorrido del expediente con origen completo: hasta dónde llega con los datos vigentes (2026-10-30)

Lectura sobre el despliegue `161b7f5` con cuentas DEMO vigentes. **No se creó ni se modificó ningún registro** (sin soportes, evaluaciones, revisiones, instantáneas, cuentas, claves, seed ni respaldos). Candidato natural: **DD-2026-00003** (LOT-2026-00007, ENT-2026-00005, parcela CAD-1028225001, productor DEMO-RV-001): origen completo, geometría técnica, calidad y embarque cumplidos.

| Paso | Estado | Qué lo detiene | Naturaleza |
| --- | --- | --- | --- |
| Soportes de la entrega | **Detenido** | ENT-2026-00005 no tiene soporte. El único documento `DELIVERY_SUPPORT` de DEMO-RV-001 es la guía sintética de **ENT-2026-00001**; vincularla a otra entrega la haría pasar por soporte de una mercancía que no ampara. Terra Link no certifica la autenticidad del documento, pero vincularlo sin fundamento no es una decisión fundada | Información real del productor o acopio |
| Geometría | Cumplida | — | — |
| Análisis satelital | Detenido | Adaptador y ensayo real con geometría artificial ya demostrados; falta el uso **autorizado sobre estas parcelas** y las condiciones para que el resultado satisfaga `DEFORESTATION_ANALYSIS` (D-09 parte B) | Decisión del propietario |
| Configuración de geolocalización | Detenido | Falta adoptarla con revisión vigente (`GEOLOCATION_PROFILE`) | Configuración + revisión competente |
| Riesgo: reevaluar | Disponible | Evaluación desactualizada; la acción existe, pero reevaluar antes de completar soporte y análisis solo repetiría un resultado incompleto | Operativa |
| Riesgo: revisión | Disponible tras reevaluar | Exige decisión humana fundada; no se inicia para completar el recorrido | Operativa + decisión |
| Mitigación `DOCUMENT_EXPIRED` | Detenido | Necesita un documento vigente real y verificación por **otra** persona | Información real + persona distinta |
| Perfil jurídico / catálogo / conclusión | Detenido | Perfil jurídico con revisión competente (D-07.5/D-37); no se aprueban perfiles ficticios | Externa |
| Paquete DD y acceso del destinatario | **Ya demostrado** con la instantánea vigente y la concesión (A-08/A-09, 7/7); no cambia con lo anterior | — | — |

## Conclusión
El primer bloqueo real de DD-2026-00003 es **el soporte de ENT-2026-00005**, que debe aportar quien tenga el documento. Desde ahí, el orden es: soporte → (autorización de análisis y configuración revisada) → reevaluar → revisión → mitigación con documento vigente y segunda persona → paquete (`READY`) → concesión. Hasta que existan esos aportes, el recorrido completo no se puede demostrar sin inventar datos; no se simuló.

DD-2026-00001 permanece como caso bloqueado por origen incompleto (prueba negativa, D-39 mantenida). Nada de esto es una presentación de DDS ni acredita conformidad EUDR.
