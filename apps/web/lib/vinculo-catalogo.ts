// D-07.5(b), opción b-1 — tablas de texto de la pantalla de vinculación del catálogo de riesgo con un perfil jurídico.
// Español = fuente. La API devuelve CÓDIGOS; el texto que se muestra sale de estas tablas (y de su traducción), no del servidor.

export const VINCULO_TABLAS = {
  RAZON: {
    DRAFT: 'El perfil es un borrador (no publicado).',
    SCOPE_PARTIAL: 'El alcance del perfil es PARCIAL.',
    NO_REVIEW: 'El perfil no tiene ninguna revisión jurídica registrada.',
    REVIEW_OBJECTED: 'La última decisión de revisión es «objetada».',
    REVIEW_WITHDRAWN: 'La última decisión de revisión es «retirada».',
    PROFILE_MISSING: 'El perfil referenciado ya no figura.',
  } as Record<string, string>,
  ESTADO_PERFIL: { PUBLISHED: 'Publicado', DRAFT: 'Borrador' } as Record<string, string>,
  ALCANCE: { PARTIAL: 'Parcial', COMPLETE: 'Completo' } as Record<string, string>,
  DECISION: { REVIEWED: 'Revisado', OBJECTED: 'Objetado', WITHDRAWN: 'Retirado' } as Record<string, string>,
  APROBACION: { APPROVED: 'Aprobado técnicamente', NOT_APPROVED: 'Sin aprobación técnica' } as Record<string, string>,
  VIGENCIA: { CURRENT: 'Vigente', NO_LONGER_VALID: 'Ya no vigente' } as Record<string, string>,
};
