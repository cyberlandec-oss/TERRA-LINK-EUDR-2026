import { ROLE_PERMISSIONS, type Permission } from '../authz/catalog';

// Cómo se resuelve cada requisito del expediente: qué falta, quién puede aportarlo con los roles existentes, desde qué pantalla y de qué naturaleza es la
// intervención. Es GUÍA de la vista (no entra en el contenido ni en el hash de la instantánea, no concede nada y el servidor sigue siendo la autoridad):
// los roles se calculan del catálogo vigente, de modo que no pueden desfasarse de los permisos reales.
//
// Naturaleza (`kind`):
//   · DATA     — falta completar información o un soporte que alguien de la organización puede aportar;
//   · ACTION   — falta ejecutar una acción con un rol concreto (reevaluar, verificar, reservar…);
//   · DECISION — requiere una decisión humana con responsabilidad (revisión, conclusión) o del propietario del producto;
//   · EXTERNAL — depende de un tercero (proveedor, revisión jurídica) o de una función aún no disponible: Terra Link no puede resolverlo por sí solo.
export type Pantalla = 'LOT' | 'LOT_RISK' | 'DELIVERIES' | 'MITIGATIONS' | 'SHIPMENTS' | 'GEO_CONFIG' | 'LEGAL_PROFILE' | 'PLOTS' | 'INVENTORY';
export type NaturalezaResolucion = 'DATA' | 'ACTION' | 'DECISION' | 'EXTERNAL';

interface Regla { action: string; permission: Permission | null; screen: Pantalla; kind: NaturalezaResolucion; limit?: string }

const REGLAS: Record<string, Regla> = {
  SUBJECT_QUANTITY: { action: 'Revisar el lote y su saldo físico en el libro de inventario.', permission: 'lot:read', screen: 'LOT', kind: 'DATA' },
  QUANTITIES_CONSISTENT: { action: 'Conciliar el libro de inventario con un ajuste auditado; no se edita un saldo.', permission: 'stock:move', screen: 'INVENTORY', kind: 'ACTION' },
  ORIGIN_DECLARED: { action: 'Una entrega ya registrada no admite añadir parcelas después: el origen incompleto sigue incompleto y no se inventa. Si el origen real se conoce, se registra una entrega nueva con su parcela.', permission: 'delivery:create', screen: 'DELIVERIES', kind: 'DATA', limit: 'No existe hoy una corrección de origen sobre una entrega registrada; es una decisión de diseño (D-39), no un olvido.' },
  GEOMETRY_TECHNICAL: { action: 'Registrar la geometría o la superficie declarada de la parcela y ejecutar su evaluación técnica.', permission: 'plot:evaluate_gis', screen: 'PLOTS', kind: 'DATA' },
  GEOLOCATION_PROFILE: { action: 'Adoptar una configuración de geolocalización con revisión vigente; adoptarla no la revisa ni la declara aplicable.', permission: 'risk:approve_rules', screen: 'GEO_CONFIG', kind: 'EXTERNAL', limit: 'La revisión de la configuración la registra la plataforma; sin ella no se aplica.' },
  DEFORESTATION_ANALYSIS: { action: 'Encargar el análisis satelital de cada versión de parcela de origen con un proveedor seleccionado.', permission: 'satellite:request', screen: 'PLOTS', kind: 'EXTERNAL', limit: 'No hay proveedor seleccionado (decisión del propietario D-09 parte B).' },
  QUALITY_DECIDED: { action: 'Registrar la muestra y la decisión humana de calidad de la recepción.', permission: 'quality:decide', screen: 'DELIVERIES', kind: 'DECISION' },
  DELIVERY_SUPPORTS: { action: 'Subir el soporte de la entrega (nota, guía) como documento y vincularlo a la entrega.', permission: 'delivery:create', screen: 'DELIVERIES', kind: 'DATA' },
  LEGAL_PROFILE: { action: 'Adoptar un perfil jurídico con revisión jurídica registrada.', permission: 'risk:approve_rules', screen: 'LEGAL_PROFILE', kind: 'EXTERNAL', limit: 'Exige revisión jurídica externa; Terra Link no la sustituye.' },
  RISK_EVALUATION_CURRENT: { action: 'Reevaluar el riesgo del lote (crea una versión nueva; la anterior se conserva).', permission: 'risk:evaluate', screen: 'LOT_RISK', kind: 'ACTION' },
  RISK_NO_BLOCKING_FINDINGS: { action: 'Atender el hallazgo bloqueante con una mitigación verificada y reevaluar.', permission: 'mitigation:contribute', screen: 'LOT_RISK', kind: 'ACTION' },
  RISK_REVIEW_RESOLVED: { action: 'Iniciar y resolver la revisión humana de la evaluación.', permission: 'risk:review', screen: 'LOT_RISK', kind: 'DECISION' },
  RISK_CATALOG_APPROVED: { action: 'Depende de un perfil jurídico aprobado; las reglas técnicas por sí solas no permiten afirmar preparación regulatoria.', permission: 'risk:approve_rules', screen: 'LEGAL_PROFILE', kind: 'EXTERNAL', limit: 'Decisión del propietario del producto y revisión jurídica (D-07.5).' },
  REGULATORY_CONCLUSION: { action: 'Registrar la conclusión humana vigente sobre la evaluación, con perfil y revisión autorizados.', permission: 'risk:conclude', screen: 'LOT_RISK', kind: 'DECISION' },
  MITIGATIONS_VERIFIED: { action: 'Aportar el soporte de la acción de mitigación y que OTRA persona la verifique.', permission: 'mitigation:verify', screen: 'MITIGATIONS', kind: 'ACTION' },
  SHIPMENT_LINK: { action: 'Añadir el lote a un embarque y reservar la cantidad.', permission: 'shipment:manage', screen: 'SHIPMENTS', kind: 'ACTION', limit: 'Un lote de origen incompleto no se despacha como origen conocido.' },
};

export interface Resolucion { action: string; roles: string[]; permission: Permission | null; screen: Pantalla; kind: NaturalezaResolucion; limit: string | null }

/** Guía de resolución de un requisito, con los roles que HOY tienen el permiso (ordenados). `null` si el código no tiene guía. */
export function resolucionDe(code: string): Resolucion | null {
  const r = REGLAS[code];
  if (!r) return null;
  const roles = r.permission ? Object.entries(ROLE_PERMISSIONS).filter(([, p]) => p.includes(r.permission!)).map(([rol]) => rol).sort() : [];
  return { action: r.action, roles, permission: r.permission, screen: r.screen, kind: r.kind, limit: r.limit ?? null };
}

export const CODIGOS_CON_RESOLUCION = Object.keys(REGLAS);
