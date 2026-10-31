// P1-005 — tablas de texto de la pantalla del acto de revisión del perfil jurídico. Español = fuente; la API devuelve CÓDIGOS.

export const REVISION_TABLAS = {
  DECISION: {
    REVIEWED: 'Revisado (favorable)',
    OBJECTED: 'Objetado',
    WITHDRAWN: 'Retirado',
  } as Record<string, string>,
  ESTADO: {
    NONE: 'Sin revisión',
    REVIEWED: 'Revisado (favorable)',
    OBJECTED: 'Objetado',
    WITHDRAWN: 'Retirado',
  } as Record<string, string>,
  ESTADO_PERFIL: { PUBLISHED: 'Publicado', DRAFT: 'Borrador' } as Record<string, string>,
  ALCANCE: { PARTIAL: 'Parcial', COMPLETE: 'Completo' } as Record<string, string>,
  SOPORTE: { PROFILE_SOURCE: 'Fuente del perfil', CITATION: 'Cita' } as Record<string, string>,
  CONSECUENCIA: {
    DRAFT: 'El perfil es un borrador (no publicado).',
    SCOPE_PARTIAL: 'El alcance del perfil es PARCIAL.',
    NO_REVIEW: 'El perfil no tiene ninguna revisión jurídica registrada.',
    REVIEW_OBJECTED: 'La última decisión de revisión es «objetada».',
    REVIEW_WITHDRAWN: 'La última decisión de revisión es «retirada».',
  } as Record<string, string>,
};
