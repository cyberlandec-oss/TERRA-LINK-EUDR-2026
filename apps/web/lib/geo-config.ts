// GEOLOCATION_PROFILE — tablas de texto de las pantallas de configuración versionada de reglas de geolocalización. Español = fuente; la API devuelve CÓDIGOS.

export const GEO_CONFIG_TABLAS = {
  KIND: {
    GEO_TECH_PROFILE: 'Evaluación vigente del perfil técnico de geolocalización',
    PRODUCTION_PERIOD: 'Período de producción vinculado a cada parcela',
    PRODUCTION_COUNTRY: 'País de producción vinculado a cada parcela',
  } as Record<string, string>,
  REGLA: { ACTIVE: 'Activa (se aplica)', CANDIDATE: 'Candidata (no se aplica)' } as Record<string, string>,
  DECISION: { REVIEWED: 'Revisada (favorable)', OBJECTED: 'Objetada', WITHDRAWN: 'Retirada' } as Record<string, string>,
  ESTADO: { NONE: 'Sin revisión', REVIEWED: 'Revisada (favorable)', OBJECTED: 'Objetada', WITHDRAWN: 'Retirada' } as Record<string, string>,
  SOPORTE: { CONFIG_SOURCE: 'Fuente de la configuración', CITATION: 'Cita' } as Record<string, string>,
  FALTA: {
    TECHNICAL_PROFILE_MISMATCH: 'Se redactó para otra versión del perfil técnico: hace falta una versión nueva de la configuración.',
    NO_REVIEW: 'No tiene ninguna revisión registrada.',
    REVIEW_OBJECTED: 'Su última revisión es «objetada».',
    REVIEW_WITHDRAWN: 'Su última revisión es «retirada».',
    NOT_APPLICABLE_TO_ORGANIZATION: 'La revisión no la declara aplicable a esta organización.',
    CANDIDATE_RULES_PENDING: 'Conserva reglas candidatas sin resolver: no se aplican y el criterio de «satisfecho» no está completo.',
  } as Record<string, string>,
  VIGENCIA: { true: 'Vigente', false: 'Reemplazada' } as Record<string, string>,
};
