import { buildPackage, evaluateRequirements, readinessOf, sha256, summary, type DdContent, type GeoConfigContent } from './requirements';

// Configuración de geolocalización SINTÉTICA, revisada, aplicable y con todas las reglas activas: solo para ejercitar el requisito.
const GEO_OK: GeoConfigContent = {
  config_version: '9.9.9', technical_profile: { id: 'EUDR_GEO_V1', version: '1.0.0', current_version: '1.0.0' },
  review: { id: 'r1', decision: 'REVIEWED' }, applicable_to_organization: true, rules: [{ code: 'GEO-TECH-PROFILE', kind: 'GEO_TECH_PROFILE', status: 'ACTIVE' }],
  plots: [{ plot_id: 'p1', plot_version_id: 'pv1', evaluation_id: 'e1', evaluated_profile_version: '1.0.0', status: 'MEETS_PROFILE' }],
};

// FIXTURE SINTÉTICA: todos los requisitos se fuerzan a cumplidos SOLO para probar el generador y los guards.
// No representa un expediente real ni aprobado; los perfiles se rellenan con textos de prueba explícitos.
const SYNTHETIC: DdContent = {
  synthetic_fixture: true,
  subject: { type: 'LOT', id: 'lot-1', code: 'LOT-SINT-1', product: 'Cacao (sintético)', unit: 'KG', origin_status: 'COMPLETE' },
  quantities: { physical: '100.000', reserved: '0', available: '100.000', unit: 'KG', source: 'ledger' },
  origin: { lots: [{ id: 'lot-1', lot_code: 'LOT-SINT-1', origin_status: 'COMPLETE' }], ledger_differences: [] },
  deliveries: [{ id: 'd1', code: 'ENT-SINT-1', row_version: '1', origin_plots: ['P-SINT-1'] }],
  plots: [{ plot_id: 'p1', plot_code: 'P-SINT-1', version_id: 'pv1', version_number: 1, geometry_type: 'POINT', geometry_hash: 'h', validation_status: 'VALID', gis_status: 'VALID', geometry: { type: 'Point', coordinates: [-80, -1] } }],
  quality: [{ reception_id: 'r1', delivery_code: 'ENT-SINT-1', decision: 'RELEASED' }],
  documents: [{ document_id: 'doc1', version_id: 'dv1', title: 'Nota sintética', document_type: 'DELIVERY_SUPPORT', classification: 'OPERATIONAL', version_number: 1, sha256: 'a'.repeat(64), file_name: 'n.pdf', expires_at: null, expired: false, scan: 'CLEAN', used_by: 'DELIVERY_SUPPORT', reference: 'ENT-SINT-1' },
    { document_id: 'doc2', version_id: 'dv2', title: 'Cédula sintética', document_type: 'ID', classification: 'PERSONAL_DATA', version_number: 1, sha256: 'b'.repeat(64), file_name: 'c.pdf', expires_at: null, expired: false, scan: 'CLEAN', used_by: 'MITIGATION_SUPPORT', reference: 'X' }],
  evidence: [],
  // Fixture SINTÉTICA de un futuro que todavía no existe: catálogo adoptado Y aprobado bajo un perfil jurídico
  // (D-07.5). Hoy ninguna versión real lleva `regulatory_profile`, y la prueba de integración lo comprueba.
  risk: { evaluation_id: 'e1', evaluation_number: 1, snapshot_hash: 'c'.repeat(64), rule_set_version: 'SINT', rule_set_approval: 'APPROVED', rule_set_adopted: true, rule_set_regulatory_profile: '9.9.9', technical_result: 'NO_FINDINGS_IN_EVALUATED_RULES', severity: 'LOW', conclusion: 'NEGLIGIBLE', is_current: true, review_process: 'RESOLVED', factors: [{ code: 'X', result: 'NOT_HIT', effect: 'BLOCKING' }] },
  mitigations: [],
  // D-34.A.1: el vínculo se satisface con un ítem de embarque con reserva ACTIVA (fixture sintética).
  shipment_links: [{ shipment_id: 's1', shipment_code: 'EMB-SINT-1', shipment_status: 'DRAFT', item_id: 'i1', reservation_id: 'r1', lot_id: 'l1', quantity: '100', unit: 'KG', location_id: 'loc1' }],
  // Perfil SINTÉTICO completo y revisado: solo así READY puede llegar a evaluarse en esta fixture.
  profiles: { legal_profile: { version: '9.9.9', scope: 'COMPLETE', legal_review_status: 'REVIEWED', pending_matters: [], subjects: [{ plot_id: 'p1', assessed_version: '9.9.9', unresolved: [], not_satisfied: [], stale_evidence: [], foreign_evidence: [] }] }, geolocation_profile: GEO_OK, satellite_provider: 'PROVEEDOR SINTÉTICO DE PRUEBA' },
};
const st = (c: DdContent, code: string) => evaluateRequirements(c).find((r) => r.code === code)?.status;

describe('P1-005 LEGAL_PROFILE: el catálogo es necesario, nunca suficiente', () => {
  /** Sujeto RESUELTO, para aislar lo que se prueba en cada caso. */
  const resuelto = { plot_id: 'p1', assessed_version: 'V', unresolved: [], not_satisfied: [], stale_evidence: [], foreign_evidence: [] };
  const perfil = (over: Record<string, unknown> = {}) => ({
    version: 'V', scope: 'COMPLETE' as const, legal_review_status: 'REVIEWED' as const, pending_matters: [] as string[],
    subjects: [resuelto], ...over,
  });
  const con = (lp: DdContent['profiles']['legal_profile']) => ({ ...SYNTHETIC, profiles: { ...SYNTHETIC.profiles, legal_profile: lp } });
  const detalle = (c: DdContent) => evaluateRequirements(c).find((r) => r.code === 'LEGAL_PROFILE')!.detail;

  it('sin perfil adoptado: NO EVALUABLE, y no se presume nada', () => {
    expect(st(con(null), 'LEGAL_PROFILE')).toBe('NOT_EVALUABLE');
    expect(readinessOf(evaluateRequirements(con(null)))).toBe('BLOCKED');
  });

  it('perfil PARCIAL: PENDIENTE, aunque el sujeto esté resuelto', () => {
    const c = con(perfil({ scope: 'PARTIAL', pending_matters: ['LABOUR'] }));
    expect(st(c, 'LEGAL_PROFILE')).toBe('PENDING');
    expect(detalle(c)).toMatch(/PARCIAL/);
    expect(readinessOf(evaluateRequirements(c))).not.toBe('READY');
  });

  it('perfil COMPLETO sin revisión jurídica: PENDIENTE, aunque el sujeto esté resuelto', () => {
    const c = con(perfil({ legal_review_status: 'PENDING' }));
    expect(st(c, 'LEGAL_PROFILE')).toBe('PENDING');
    expect(detalle(c)).toMatch(/sin revisión jurídica/);
  });

  // ————— Lo que el catálogo NO demuestra: que ESTE sujeto cumpla —————

  it('COMPLETO y REVISADO, pero el sujeto SIN EVALUAR: no cumple', () => {
    const c = con(perfil({ subjects: [{ ...resuelto, assessed_version: null }] }));
    expect(st(c, 'LEGAL_PROFILE')).toBe('PENDING');
    expect(detalle(c)).toMatch(/sin evaluación legal/);
    expect(detalle(c)).toMatch(/no acredita por sí solo/);
  });

  it('COMPLETO y REVISADO, pero con obligaciones DESCONOCIDAS o pendientes: no cumple', () => {
    const c = con(perfil({ subjects: [{ ...resuelto, unresolved: ['EC-USO-ECOSISTEMAS-FRAGILES'] }] }));
    expect(st(c, 'LEGAL_PROFILE')).toBe('PENDING');
    expect(detalle(c)).toMatch(/obligaciones sin resolver/);
    expect(readinessOf(evaluateRequirements(c))).not.toBe('READY');
  });

  it('COMPLETO y REVISADO, con evidencia SUSTITUIDA por una versión posterior: no cumple', () => {
    const c = con(perfil({ subjects: [{ ...resuelto, stale_evidence: ['EC-TENENCIA-ADJUDICACION'] }] }));
    expect(st(c, 'LEGAL_PROFILE')).toBe('PENDING');
    expect(detalle(c)).toMatch(/SUSTITUIDA/);
  });

  it('COMPLETO y REVISADO, con evidencia de OTRO sujeto: no cumple', () => {
    const c = con(perfil({ subjects: [{ ...resuelto, foreign_evidence: ['EC-TENENCIA-ADJUDICACION'] }] }));
    expect(st(c, 'LEGAL_PROFILE')).toBe('PENDING');
    expect(detalle(c)).toMatch(/OTRO sujeto/);
  });

  it('COMPLETO y REVISADO, pero el sujeto se evaluó con OTRA versión del perfil: no cumple', () => {
    const c = con(perfil({ subjects: [{ ...resuelto, assessed_version: 'V-ANTERIOR' }] }));
    expect(st(c, 'LEGAL_PROFILE')).toBe('PENDING');
    expect(detalle(c)).toMatch(/otra versión del perfil/);
  });

  it('una obligación declarada NO SATISFECHA es INVÁLIDA, no «pendiente»', () => {
    const c = con(perfil({ subjects: [{ ...resuelto, not_satisfied: ['EC-FUNCION-SOCIAL'] }] }));
    expect(st(c, 'LEGAL_PROFILE')).toBe('INVALID');
    expect(readinessOf(evaluateRequirements(c))).toBe('BLOCKED');
  });

  it('sin parcelas de origen no se presume nada: NO EVALUABLE', () => {
    expect(st(con(perfil({ subjects: [] })), 'LEGAL_PROFILE')).toBe('NOT_EVALUABLE');
  });

  it('CONTROL POSITIVO (fixture SINTÉTICA, no una aprobación jurídica real): catálogo revisado + sujeto resuelto → MET', () => {
    // Esta combinación HOY NO EXISTE en el producto: el perfil sembrado es parcial y sin revisión jurídica.
    // Sirve para probar que el requisito puede cumplirse, no para afirmar que se cumple.
    const c = con(perfil());
    expect(st(c, 'LEGAL_PROFILE')).toBe('MET');
    expect(detalle(c)).toMatch(/evidencia vigente del propio sujeto/);
  });
});

describe('P0-022 guards por requisito', () => {
  it('fixture sintética con todo cumplido → READY (solo prueba el cálculo)', () => {
    const reqs = evaluateRequirements(SYNTHETIC);
    expect(reqs.every((r) => r.status === 'MET')).toBe(true);
    expect(readinessOf(reqs)).toBe('READY');
  });

  it('un solo requisito no cumplido bloquea aunque el porcentaje sea alto', () => {
    const c = { ...SYNTHETIC, risk: { ...SYNTHETIC.risk!, rule_set_regulatory_profile: null } };
    const reqs = evaluateRequirements(c);
    expect(summary(reqs).percent_met).toBeGreaterThanOrEqual(90);
    expect(readinessOf(reqs)).toBe('BLOCKED');
  });

  it('lo desconocido es NO EVALUABLE, nunca falso ni favorable', () => {
    expect(st({ ...SYNTHETIC, profiles: { ...SYNTHETIC.profiles, legal_profile: null } }, 'LEGAL_PROFILE')).toBe('NOT_EVALUABLE');
    expect(st({ ...SYNTHETIC, risk: { ...SYNTHETIC.risk!, conclusion: 'UNDETERMINED' } }, 'REGULATORY_CONCLUSION')).toBe('NOT_EVALUABLE');
    expect(st({ ...SYNTHETIC, quantities: { ...SYNTHETIC.quantities, physical: 'desconocido' } }, 'SUBJECT_QUANTITY')).toBe('NOT_EVALUABLE');
    expect(st({ ...SYNTHETIC, deliveries: [] }, 'ORIGIN_DECLARED')).toBe('NOT_EVALUABLE');
    expect(st({ ...SYNTHETIC, risk: { ...SYNTHETIC.risk!, factors: [{ code: 'Y', result: 'NOT_EVALUABLE', effect: 'BLOCKING' }] } }, 'RISK_NO_BLOCKING_FINDINGS')).toBe('NOT_EVALUABLE');
  });

  it('publicar un catálogo globalmente NO cumple el requisito: hacen falta adopción y perfil jurídico', () => {
    // El estado real de hoy: 1.0.0 publicado y APROBADO globalmente, pero sin adoptar y sin perfil jurídico.
    const publicado = { ...SYNTHETIC.risk!, rule_set_approval: 'APPROVED', rule_set_adopted: false, rule_set_regulatory_profile: null };
    expect(st({ ...SYNTHETIC, risk: publicado }, 'RISK_CATALOG_APPROVED')).toBe('NOT_EVALUABLE');
    expect(evaluateRequirements({ ...SYNTHETIC, risk: publicado }).find((r) => r.code === 'RISK_CATALOG_APPROVED')!.detail).toMatch(/NO las ha adoptado/);
    // Adoptado pero sin perfil jurídico: sigue sin cumplirse, y el motivo lo dice sin culpar a la adopción.
    const adoptado = { ...publicado, rule_set_adopted: true };
    expect(st({ ...SYNTHETIC, risk: adoptado }, 'RISK_CATALOG_APPROVED')).toBe('NOT_EVALUABLE');
    expect(evaluateRequirements({ ...SYNTHETIC, risk: adoptado }).find((r) => r.code === 'RISK_CATALOG_APPROVED')!.detail).toMatch(/decisión TÉCNICA de producto.*D-07\.5/s);
    // Y el expediente entero queda BLOCKED: aprobar el catálogo técnico no abre READY por la puerta de atrás.
    expect(readinessOf(evaluateRequirements({ ...SYNTHETIC, risk: adoptado }))).toBe('BLOCKED');
  });

  it('sin evaluación de riesgo, sus requisitos siguen listados (pendiente / no evaluable), nunca omitidos', () => {
    const reqs = evaluateRequirements({ ...SYNTHETIC, risk: null });
    expect(reqs.map((r) => r.code)).toEqual(evaluateRequirements(SYNTHETIC).map((r) => r.code));
    expect(st({ ...SYNTHETIC, risk: null }, 'RISK_CATALOG_APPROVED')).toBe('NOT_EVALUABLE');
    expect(st({ ...SYNTHETIC, risk: null }, 'REGULATORY_CONCLUSION')).toBe('NOT_EVALUABLE');
    expect(readinessOf(reqs)).toBe('BLOCKED');
  });

  it('distingue pendiente e inválido: calidad pendiente, origen incompleto, soporte vencido, hallazgo bloqueante', () => {
    expect(st({ ...SYNTHETIC, quality: [{ ...SYNTHETIC.quality[0], decision: 'PENDING' }] }, 'QUALITY_DECIDED')).toBe('PENDING');
    expect(st({ ...SYNTHETIC, quality: [{ ...SYNTHETIC.quality[0], decision: 'REJECTED' }] }, 'QUALITY_DECIDED')).toBe('INVALID');
    expect(st({ ...SYNTHETIC, origin: { ...SYNTHETIC.origin, lots: [{ id: 'l', lot_code: 'L', origin_status: 'INCOMPLETE' }] } }, 'ORIGIN_DECLARED')).toBe('PENDING');
    expect(st({ ...SYNTHETIC, documents: [{ ...SYNTHETIC.documents[0], expired: true }] }, 'DELIVERY_SUPPORTS')).toBe('INVALID');
    expect(st({ ...SYNTHETIC, documents: [] }, 'DELIVERY_SUPPORTS')).toBe('PENDING');
    expect(st({ ...SYNTHETIC, risk: { ...SYNTHETIC.risk!, factors: [{ code: 'DATA_MISSING_ORIGIN', result: 'HIT', effect: 'BLOCKING' }] } }, 'RISK_NO_BLOCKING_FINDINGS')).toBe('INVALID');
    expect(st({ ...SYNTHETIC, quantities: { ...SYNTHETIC.quantities, physical: '0' } }, 'SUBJECT_QUANTITY')).toBe('INVALID');
  });

  it('mitigaciones verificadas no equivalen a aprobación: sin catálogo aprobado sigue bloqueado', () => {
    const c: DdContent = { ...SYNTHETIC, mitigations: [{ id: 'm', factor_code: 'DATA_MISSING_ORIGIN', status: 'VERIFIED', row_version: '3', decision: 'VERIFIED' }], risk: { ...SYNTHETIC.risk!, rule_set_regulatory_profile: null, conclusion: 'UNDETERMINED' } };
    expect(st(c, 'MITIGATIONS_VERIFIED')).toBe('MET');
    expect(readinessOf(evaluateRequirements(c))).toBe('BLOCKED');
    expect(st({ ...c, mitigations: [{ ...c.mitigations[0], status: 'SUBMITTED' }] }, 'MITIGATIONS_VERIFIED')).toBe('PENDING');
  });
});

describe('P0-022 generador del paquete', () => {
  const input = (content: DdContent, kind: 'INTERNAL_REVIEW' | 'DD_PACKAGE' = 'DD_PACKAGE') => {
    const reqs = evaluateRequirements(content);
    return { kind, dd_case: { id: 'c', case_number: 'DD-SINT-1', scope_note: 'sintético', organization: 'Org sintética' },
      snapshot: { id: 's', number: 1, captured_at: '2026-01-01T00:00:00Z', captured_by: 'Persona sintética', content_hash: sha256(content), readiness: readinessOf(reqs), approved_by: null }, content, requirements: reqs, manifest: {} };
  };

  it('determinista; marca la fixture como sintética; nunca presenta DDS', () => {
    const a = buildPackage(input(SYNTHETIC), { geometry: true, personal_documents: true });
    const b = buildPackage(input(SYNTHETIC), { geometry: true, personal_documents: true });
    expect(a.hash).toBe(b.hash);
    expect(a.pkg.synthetic_fixture).toMatch(/FIXTURE SINTÉTICA/);
    expect(a.pkg.submission.status).toBe('NOT_SUBMITTED');
    expect(a.body).toMatch(/no es presentar una DDS/);
    expect(a.redactions).toEqual([]);
  });

  it('separa artefactos y declara pendientes: archivos no incluidos y campos del perfil destino', () => {
    const r = buildPackage(input(SYNTHETIC), { geometry: true, personal_documents: true });
    expect(r.pkg.artifact).toEqual({ kind: 'DD_PACKAGE', source: 'snapshot', is_final_package: true, is_official_submission: false });
    expect(r.pkg.pending.map((x) => x.code)).toEqual(['ATTACHMENT_FILES_NOT_INCLUDED', 'DESTINATION_PROFILE_FIELDS']);
    expect(r.pkg.attachments.included).toBe(false);
    const d = buildPackage(input(SYNTHETIC, 'INTERNAL_REVIEW'), { geometry: false, personal_documents: true });
    expect(d.pkg.artifact.is_final_package).toBe(false);
    expect(d.pkg.completeness).toMatch(/INCOMPLETO/);
  });

  it('redacción por alcance y clasificación en todo el paquete (geometrías y adjuntos)', () => {
    const r = buildPackage(input(SYNTHETIC, 'INTERNAL_REVIEW'), { geometry: false, personal_documents: false });
    expect(r.body).not.toMatch(/-80/);
    expect(r.body).not.toMatch(/Cédula sintética|c\.pdf/);
    expect(r.body).toMatch(/b{64}/); // el hash del adjunto se conserva
    expect(r.redactions).toEqual(['plot:P-SINT-1:geometry', 'document_version:dv2:metadata']);
    expect(r.pkg.label).toMatch(/BORRADOR INTERNO/);
    expect(r.hash).not.toBe(buildPackage(input(SYNTHETIC, 'INTERNAL_REVIEW'), { geometry: true, personal_documents: true }).hash);
  });
});

describe('GEOLOCATION_PROFILE: el resultado técnico no lo cumple (D-05.B y la definición de «satisfecho» pendientes)', () => {
  it('con la fixture sintética en la que todo lo demás se cumple, sin la condición regulatoria revisada GEOLOCATION_PROFILE no es MET y READY no se alcanza', () => {
    const sinCondicion: DdContent = { ...SYNTHETIC, profiles: { ...SYNTHETIC.profiles, geolocation_profile: null } };
    expect(st(sinCondicion, 'GEOLOCATION_PROFILE')).toBe('NOT_EVALUABLE');
    expect(readinessOf(evaluateRequirements(sinCondicion))).not.toBe('READY');
  });
  it('el dictamen técnico por parcela (TL_GIS_TECH válido, EUDR_GEO_V1 que cumple) no entra en el contenido que evalúa el requisito', () => {
    const conVeredicto = { ...SYNTHETIC, profiles: { ...SYNTHETIC.profiles, geolocation_profile: null }, plots: SYNTHETIC.plots.map((p) => ({ ...p, gis_status: 'VALID', geo_profile: 'MEETS_PROFILE' })) } as unknown as DdContent;
    expect(st(conVeredicto, 'GEOLOCATION_PROFILE')).toBe('NOT_EVALUABLE');
    // Y añadir ese campo cambiaría el hash del contenido: por eso el veredicto vive en un panel de consulta aparte y no en la instantánea.
    expect(sha256(conVeredicto)).not.toBe(sha256({ ...SYNTHETIC, profiles: { ...SYNTHETIC.profiles, geolocation_profile: null } }));
  });
});

describe('RISK_CATALOG_APPROVED: regulatory_profile es una referencia revisada, no una etiqueta', () => {
  const lp = (over: Record<string, unknown> = {}) => ({ ...SYNTHETIC.profiles.legal_profile!, ...over }) as DdContent['profiles']['legal_profile'];
  const con = (ref: string | null, perfil: DdContent['profiles']['legal_profile'] = SYNTHETIC.profiles.legal_profile) =>
    ({ ...SYNTHETIC, risk: { ...SYNTHETIC.risk!, rule_set_regulatory_profile: ref }, profiles: { ...SYNTHETIC.profiles, legal_profile: perfil } }) as DdContent;
  const det = (c: DdContent) => evaluateRequirements(c).find((x) => x.code === 'RISK_CATALOG_APPROVED')!.detail;

  it('control positivo SINTÉTICO: referencia = versión adoptada, completa y revisada → MET', () => {
    expect(st(con('9.9.9'), 'RISK_CATALOG_APPROVED')).toBe('MET');
  });
  it('NULL sigue NOT_EVALUABLE', () => expect(st(con(null), 'RISK_CATALOG_APPROVED')).toBe('NOT_EVALUABLE'));
  it.each(['PERFIL SINTÉTICO DE PRUEBA', 'aprobado', 'true', '1.0', 'v1.0.0', '9.9.9-x'])('una cadena arbitraria («%s») no da MET', (s) => {
    expect(st(con(s), 'RISK_CATALOG_APPROVED')).toBe('PENDING');
    expect(det(con(s))).toMatch(/no es una referencia/);
  });
  it('referencia inexistente / de otra versión que la adoptada: PENDING', () => {
    expect(st(con('8.8.8'), 'RISK_CATALOG_APPROVED')).toBe('PENDING');
    expect(det(con('8.8.8'))).toMatch(/no corresponde a la versión adoptada/);
  });
  it('sin perfil adoptado: PENDING', () => expect(st(con('9.9.9', null), 'RISK_CATALOG_APPROVED')).toBe('PENDING'));
  it('perfil sin revisión, con revisión invalidada, o PARCIAL: PENDING y dice qué falta', () => {
    const sinRev = con('9.9.9', lp({ legal_review_status: 'PENDING' }));
    expect(st(sinRev, 'RISK_CATALOG_APPROVED')).toBe('PENDING');
    expect(det(sinRev)).toMatch(/revisión jurídica vigente/);
    const parcial = con('9.9.9', lp({ scope: 'PARTIAL', pending_matters: ['LABOUR'] }));
    expect(st(parcial, 'RISK_CATALOG_APPROVED')).toBe('PENDING');
    expect(det(parcial)).toMatch(/PARCIAL/);
    expect(readinessOf(evaluateRequirements(parcial))).not.toBe('READY');
  });
});

describe('GEOLOCATION_PROFILE: configuración versionada adoptada, revisada, aplicable y con datos vigentes', () => {
  const con = (g: Partial<GeoConfigContent> | null) => ({ ...SYNTHETIC, profiles: { ...SYNTHETIC.profiles, geolocation_profile: g === null ? null : { ...GEO_OK, ...g } } }) as DdContent;
  const req = (c: DdContent) => evaluateRequirements(c).find((x) => x.code === 'GEOLOCATION_PROFILE')!;
  const plot = (over: Record<string, unknown>) => [{ ...GEO_OK.plots[0], ...over }] as GeoConfigContent['plots'];

  it('CONTROL POSITIVO SINTÉTICO: revisada, aplicable, reglas activas y la parcela con evaluación vigente que cumple → MET (condición técnica, no READY)', () => {
    expect(req(con({})).status).toBe('MET');
    expect(req(con({})).detail).toMatch(/no es una conclusión regulatoria/);
  });
  it('sin configuración adoptada → NOT_EVALUABLE con explicación', () => {
    expect(req(con(null)).status).toBe('NOT_EVALUABLE');
    expect(req(con(null)).detail).toMatch(/no ha adoptado ninguna configuración/);
  });
  it('configuración sin revisión, objetada o retirada → NOT_EVALUABLE; el motivo es concreto', () => {
    expect(req(con({ review: { id: null, decision: null } })).detail).toMatch(/ninguna revisión registrada/);
    expect(req(con({ review: { id: 'r', decision: 'OBJECTED' } })).detail).toMatch(/objetada/);
    expect(req(con({ review: { id: 'r', decision: 'WITHDRAWN' } })).detail).toMatch(/retirada/);
    for (const d of [null, 'OBJECTED', 'WITHDRAWN'] as const) expect(req(con({ review: { id: null, decision: d } })).status).toBe('NOT_EVALUABLE');
  });
  it('revisada pero fuera de alcance (no declarada aplicable a esta organización) → NOT_EVALUABLE: revisada no significa aplicable a todas', () => {
    const r = req(con({ applicable_to_organization: false }));
    expect(r.status).toBe('NOT_EVALUABLE');
    expect(r.detail).toMatch(/NO la declara aplicable/);
  });
  it('perfil técnico distinto del vigente → NOT_EVALUABLE (se necesita una versión nueva de la configuración)', () => {
    const r = req(con({ technical_profile: { id: 'EUDR_GEO_V1', version: '1.0.0', current_version: '2.0.0' } }));
    expect(r.status).toBe('NOT_EVALUABLE');
    expect(r.detail).toMatch(/versión nueva/);
  });
  it('datos: parcela que no cumple → INVALID; evaluación ausente u obsoleta → PENDING; requiere revisión → PENDING; no evaluable → NOT_EVALUABLE; sin parcelas → NOT_EVALUABLE', () => {
    expect(req(con({ plots: plot({ status: 'DOES_NOT_MEET' }) })).status).toBe('INVALID');
    expect(req(con({ plots: plot({ evaluation_id: null, status: null, evaluated_profile_version: null }) })).status).toBe('PENDING');
    expect(req(con({ plots: plot({ plot_version_id: null, evaluation_id: null, status: null, evaluated_profile_version: null }) })).status).toBe('PENDING');
    expect(req(con({ plots: plot({ status: 'REVIEW_REQUIRED' }) })).status).toBe('PENDING');
    expect(req(con({ plots: plot({ status: 'NOT_EVALUABLE' }) })).status).toBe('NOT_EVALUABLE');
    expect(req(con({ plots: [] })).status).toBe('NOT_EVALUABLE');
  });
  it('que la geometría cumpla el formato técnico NO basta: sin configuración válida el resultado técnico no da MET', () => {
    for (const g of [null, { review: { id: null, decision: null } }, { applicable_to_organization: false }] as const) {
      expect(req(con(g as Partial<GeoConfigContent> | null)).status).not.toBe('MET');
    }
  });
  it('reglas CANDIDATAS (período, país) nunca se aplican y impiden MET: PENDING y se listan; no se deduce nada', () => {
    const r = req(con({ rules: [{ code: 'GEO-TECH-PROFILE', kind: 'GEO_TECH_PROFILE', status: 'ACTIVE' }, { code: 'GEO-PRODUCTION-PERIOD', kind: 'PRODUCTION_PERIOD', status: 'CANDIDATE' }] }));
    expect(r.status).toBe('PENDING');
    expect(r.detail).toContain('CANDIDATAS sin resolver (GEO-PRODUCTION-PERIOD)');
    expect(req(con({ rules: [{ code: 'GEO-PRODUCTION-PERIOD', kind: 'PRODUCTION_PERIOD', status: 'CANDIDATE' }] })).status).toBe('NOT_EVALUABLE'); // ninguna regla activa
  });
  it('MET no habilita READY y el hash del contenido cambia con la revisión (obsolescencia de instantáneas)', () => {
    expect(readinessOf(evaluateRequirements({ ...con({}), profiles: { ...con({}).profiles, satellite_provider: null } }))).not.toBe('READY');
    expect(sha256(con({}))).not.toBe(sha256(con({ review: { id: 'r2', decision: 'OBJECTED' } })));
  });
});
