import { PLATFORM_PERMISSIONS, ROLE_PERMISSIONS, assignableRoles, canGrantRole, permissionsForRoles } from './catalog';

describe('catálogo RBAC', () => {
  it('cubre los 11 roles de organización documentados y ninguno más', () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual(
      [
        'AUDITOR', 'BUYER', 'EUDR_MANAGER', 'EXPORT_MANAGER', 'FIELD_TECHNICIAN', 'MANAGER',
        'ORG_ADMIN', 'PRODUCER', 'QUALITY_OPERATOR', 'RECEPTION_OPERATOR', 'TRACEABILITY_MANAGER',
      ].sort(),
    );
  });

  it('ningún rol de organización concede permisos de plataforma', () => {
    const platform = new Set<string>(PLATFORM_PERMISSIONS.SUPER_ADMIN);
    for (const perms of Object.values(ROLE_PERMISSIONS)) {
      expect(perms.filter((p) => platform.has(p))).toEqual([]);
    }
  });

  it('solo ORG_ADMIN puede actualizar la organización', () => {
    const holders = Object.entries(ROLE_PERMISSIONS)
      .filter(([, p]) => p.includes('organization:update'))
      .map(([r]) => r);
    expect(holders).toEqual(['ORG_ADMIN']);
  });

  it('une permisos de varios roles sin duplicados y desconoce roles no catalogados', () => {
    expect(permissionsForRoles(['TRACEABILITY_MANAGER', 'AUDITOR', 'INVENTED'])).toEqual(['analytics:read', 'audit:export', 'audit:read', 'dd:read', 'delivery:read', 'document:read', 'economics:read', 'evidence:read', 'location:read', 'lot:create', 'lot:read', 'lot:release_input', 'mitigation:contribute', 'mitigation:read', 'organization:read', 'plot:evaluate_gis', 'plot:read', 'plot:read_geometry', 'process:close', 'process:manage', 'producer:read', 'product:read', 'report:export', 'report:read', 'risk:read', 'satellite:read', 'shipment:read', 'stock:move', 'stock:read', 'traceability:read_catalog', 'transfer:accept', 'transfer:dispatch', 'transfer:offer', 'transfer:read', 'transfer:receive', 'transfer:resolve']);
  });

  it('anti-escalamiento: solo se conceden roles cuyos permisos posee el actor', () => {
    const admin = permissionsForRoles(['ORG_ADMIN']);
    const manager = permissionsForRoles(['MANAGER']);
    expect(canGrantRole(admin, 'ORG_ADMIN')).toBe(true);
    expect(canGrantRole(admin, 'FIELD_TECHNICIAN')).toBe(true);
    expect(canGrantRole(manager, 'FIELD_TECHNICIAN')).toBe(false); // sin membership:assign
    expect(canGrantRole(admin, 'SUPER_ADMIN')).toBe(false);
    expect(canGrantRole(admin, 'INVENTED')).toBe(false);
    expect(assignableRoles(admin)).toContain('ORG_ADMIN');
    expect(assignableRoles(manager)).toEqual([]);
  });

  it('productor: el técnico solo trabaja con asignados; AUDITOR lee sin identidad', () => {
    const tech = permissionsForRoles(['FIELD_TECHNICIAN']);
    expect(tech).toEqual(expect.arrayContaining(['producer:read_assigned', 'producer:update_assigned', 'producer:create']));
    expect(tech).not.toContain('producer:read');
    expect(tech).not.toContain('producer:archive');
    const auditor = permissionsForRoles(['AUDITOR']);
    expect(auditor).toContain('producer:read');
    expect(auditor).not.toContain('producer:read_identity');
    expect(permissionsForRoles(['BUYER']).filter((p) => p.startsWith('producer:'))).toEqual([]);
    // A-01: el productor solo tiene permisos de alcance PROPIO (y solo rige con el vínculo explícito); nada amplio ni asignado.
    expect(permissionsForRoles(['PRODUCER']).filter((p) => p.startsWith('producer:'))).toEqual(['producer:read_own']);
  });

  it('parcela: el técnico solo opera parcelas de productores asignados; comprador y productor sin acceso', () => {
    const tech = permissionsForRoles(['FIELD_TECHNICIAN']);
    expect(tech).toEqual(expect.arrayContaining(['plot:read_assigned', 'plot:create_assigned', 'plot:update_assigned']));
    expect(tech.filter((p) => ['plot:read', 'plot:create', 'plot:update', 'plot:archive'].includes(p))).toEqual([]);
    expect(permissionsForRoles(['BUYER', 'RECEPTION_OPERATOR']).filter((p) => p.startsWith('plot:'))).toEqual([]);
    // A-01: el productor opera solo lo propio; no lee ni evalúa geometrías ajenas ni de la organización.
    expect(permissionsForRoles(['PRODUCER']).filter((p) => p.startsWith('plot:')).sort()).toEqual(['plot:create_own', 'plot:read_geometry', 'plot:read_own', 'plot:update_own']);
  });

  it('geometría exacta: clasificación separada de la lectura de parcela; AUDITOR lee parcelas sin coordenadas', () => {
    expect(permissionsForRoles(['AUDITOR'])).toContain('plot:read');
    expect(permissionsForRoles(['AUDITOR'])).not.toContain('plot:read_geometry');
    for (const r of ['ORG_ADMIN', 'MANAGER', 'FIELD_TECHNICIAN', 'TRACEABILITY_MANAGER', 'EUDR_MANAGER']) {
      expect(permissionsForRoles([r])).toContain('plot:read_geometry');
    }
  });

  /**
   * S1 §49 lista `Package` entre las entidades con referencia pública. En esta implementación el paquete de
   * debida diligencia **se genera desde la instantánea**, y su huella depende además del *perfil de redacción*
   * de quien exporta (`geometry`, `personal_documents`). Mientras **todos** los roles que pueden exportar
   * tengan el MISMO perfil, un paquete queda identificado por su instantánea —que sí tiene referencia— y no
   * hace falta un identificador nuevo.
   *
   * Si alguien añade un rol que pueda exportar con un perfil más estrecho, dos paquetes de la misma
   * instantánea tendrían huellas distintas y **la identidad del paquete dejaría de ser la instantánea**. Esta
   * prueba existe para que eso no pase inadvertido.
   */
  it('la identidad del PAQUETE sigue siendo la instantánea: todos los exportadores comparten perfil de redacción', () => {
    const exportadores = Object.entries(ROLE_PERMISSIONS).filter(([, p]) => p.includes('dd:export_package'));
    expect(exportadores.length).toBeGreaterThan(0);
    const perfiles = new Set(exportadores.map(([, p]) =>
      `${p.includes('plot:read_geometry')}|${p.includes('producer:read_identity')}`));
    expect(perfiles.size).toBe(1);
    // Y es el perfil completo: nadie exporta hoy una versión redactada.
    expect([...perfiles][0]).toBe('true|true');
  });
});

describe('A-01: los permisos de captura propia no amplían responsabilidades ajenas a cada rol canónico', () => {
  const OWN = ['producer:read_own', 'plot:read_own', 'plot:create_own', 'plot:update_own', 'document:read_field_photo_own'];
  it('solo el Productor y la administración de la organización tienen alcance propio; ningún otro rol canónico lo recibe', () => {
    for (const rol of ['MANAGER', 'FIELD_TECHNICIAN', 'AUDITOR', 'BUYER', 'RECEPTION_OPERATOR', 'QUALITY_OPERATOR', 'TRACEABILITY_MANAGER', 'EUDR_MANAGER', 'EXPORT_MANAGER']) {
      expect(permissionsForRoles([rol]).filter((p) => OWN.includes(p))).toEqual([]);
    }
    expect(permissionsForRoles(['PRODUCER'])).toEqual(expect.arrayContaining(OWN));
  });
  it('vincular una cuenta a un productor (producer:link_self) es gestión de la organización: solo ORG_ADMIN; ni el Gerente ni el Productor ni el técnico', () => {
    expect(permissionsForRoles(['ORG_ADMIN'])).toContain('producer:link_self');
    for (const rol of ['MANAGER', 'PRODUCER', 'FIELD_TECHNICIAN', 'AUDITOR', 'BUYER', 'EUDR_MANAGER', 'TRACEABILITY_MANAGER']) expect(permissionsForRoles([rol])).not.toContain('producer:link_self');
  });
  it('capturar coordenadas no concede evaluar GIS, encargar satélite, revisar documentos, aprobar evidencias ni ver riesgo al Productor', () => {
    const p = permissionsForRoles(['PRODUCER']);
    expect(p).toContain('satellite:read'); // consulta de sus propias parcelas: el alcance lo pone la parcela
    for (const prohibido of ['plot:evaluate_gis', 'plot:evaluate_gis_assigned', 'satellite:request', 'satellite:authorize', 'document:review', 'evidence:review', 'evidence:approve', 'risk:read', 'risk:evaluate', 'dd:read', 'producer:read_identity', 'producer:read']) expect(p).not.toContain(prohibido);
  });
  it('el Gerente conserva sus permisos de gestión de productores y parcelas (captura cuando le corresponde) sin la vinculación de cuentas', () => {
    const m = permissionsForRoles(['MANAGER']);
    expect(m).toEqual(expect.arrayContaining(['producer:read', 'producer:create', 'producer:update', 'plot:read', 'plot:create', 'plot:update', 'plot:read_geometry']));
  });
});

describe('AJ-02: delivery:read_own es solo del Productor (y de ORG_ADMIN, que debe poder asignar ese rol); es lectura y no concede nada más', () => {
  it('solo PRODUCER y ORG_ADMIN lo tienen; ORG_ADMIN puede seguir asignando PRODUCER (el rol cabe en sus permisos)', () => {
    const con = Object.entries(ROLE_PERMISSIONS).filter(([, p]) => p.includes('delivery:read_own')).map(([r]) => r).sort();
    expect(con).toEqual(['ORG_ADMIN', 'PRODUCER']);
    expect(canGrantRole(permissionsForRoles(['ORG_ADMIN']), 'PRODUCER')).toBe(true);
  });
  it('el Productor no obtiene ninguna otra facultad sobre entregas ni recepciones', () => {
    const p = permissionsForRoles(['PRODUCER']);
    for (const x of ['delivery:read', 'delivery:read_assigned', 'delivery:create', 'delivery:create_assigned', 'delivery:correct', 'reception:confirm', 'reception:correct', 'quality:record', 'quality:decide']) expect(p).not.toContain(x);
  });
});

describe('D-07.6: risk:conclude es del rol responsable EUDR y de ningún otro', () => {
  it('solo EUDR_MANAGER lo tiene; ORG_ADMIN puede ASIGNAR ese rol sin poseer el permiso (separación de funciones)', () => {
    const con = Object.entries(ROLE_PERMISSIONS).filter(([, p]) => p.includes('risk:conclude')).map(([r]) => r);
    expect(con).toEqual(['EUDR_MANAGER']);
    const admin = permissionsForRoles(['ORG_ADMIN']);
    expect(admin).not.toContain('risk:conclude'); // quien administra los accesos no concluye riesgo
    expect(canGrantRole(admin, 'EUDR_MANAGER')).toBe(true); // pero sí puede asignar el rol responsable
    expect(assignableRoles(admin)).toContain('EUDR_MANAGER');
    expect(canGrantRole(permissionsForRoles(['MANAGER']), 'EUDR_MANAGER')).toBe(false); // sin membership:assign
    expect(canGrantRole(permissionsForRoles(['EUDR_MANAGER']), 'EUDR_MANAGER')).toBe(false); // ni el propio responsable reparte el rol
  });

  it('la excepción es EXACTA: el único permiso de un rol que ORG_ADMIN no posee es risk:conclude y solo en EUDR_MANAGER; ningún otro rol ni permiso queda abierto', () => {
    const admin = permissionsForRoles(['ORG_ADMIN']);
    const sinPoseer = Object.fromEntries(Object.entries(ROLE_PERMISSIONS).map(([r, p]) => [r, p.filter((x) => !admin.includes(x))]));
    expect(Object.entries(sinPoseer).filter(([, p]) => p.length).map(([r, p]) => [r, p])).toEqual([['EUDR_MANAGER', ['risk:conclude']]]);
    // Sin la excepción, un rol con CUALQUIER otro permiso ajeno no sería asignable: ningún rol distinto de EUDR_MANAGER cambia respecto de la regla general.
    for (const r of Object.keys(ROLE_PERMISSIONS).filter((x) => x !== 'EUDR_MANAGER')) expect(canGrantRole(admin, r)).toBe(ROLE_PERMISSIONS[r].every((p) => admin.includes(p)));
    // Quien no tiene membership:assign no se beneficia de la excepción, y SUPER_ADMIN no es un rol de organización asignable.
    expect(canGrantRole(admin.filter((p) => p !== 'membership:assign'), 'EUDR_MANAGER')).toBe(false);
    expect(canGrantRole(admin, 'SUPER_ADMIN')).toBe(false);
  });
});
