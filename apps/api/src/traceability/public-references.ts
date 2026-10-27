import { Controller, Get, Inject, Injectable, Param, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { AuthUser } from '../auth/auth';
import { AuthorizationService, type TenantContext } from '../authz/authorization.service';
import type { Permission } from '../authz/catalog';
import { notFound } from '../common/errors';
import { APP_CONFIG } from '../config';
import { DB } from '../db/database';
import { enlaceDeReferencia, qrSvg } from './reference-qr';
import type { Database, PublicReferenceEntity } from '../db/schema';

// RF-47 — Resolución de una referencia pública. Contrato: `docs/decisiones/RF-47-REFERENCIA-PUBLICA.md`.
//
// **Conocer una referencia no concede acceso.** Este resolver exige autenticación y, además, autorización
// sobre el recurso real: membresía activa en la organización dueña y el permiso de lectura del dominio, con el
// mismo alcance asignado que aplica el resto del producto. No crea permisos nuevos.
//
// **Respuesta indistinguible**: referencia inexistente, recurso de otra organización y recurso fuera de
// alcance devuelven **lo mismo**. Si se distinguieran, la referencia sería un oráculo de existencia: probando
// valores se confirmaría cuáles son válidos (D-47.5).
//
// RF-33 (2026-10-17) añade la **representación visual** de la referencia —el QR— y el recorrido para
// obtenerla, copiarla y abrirla hasta el recurso. **Se apoya en este mismo resolver y en su autorización**: el
// QR se emite a quien ya puede leer el recurso, y escanearlo no concede nada.
//
// Lo que sigue FUERA: las **vistas por audiencia** de RF-33/P1-002. Esa parte depende de **P1-001 (Buyer
// Portal)** y del contrato de concesiones (ADR-0002), que definen quién es la audiencia externa y qué
// proyección le corresponde. Sin eso no hay audiencia que servir, y **no se inventa una**.

/** Permiso de dominio por tipo, y si admite el alcance «asignado» que usa el resto del producto. */
const ACCESO: Record<PublicReferenceEntity, { amplio: Permission; asignado?: Permission }> = {
  PRODUCER: { amplio: 'producer:read', asignado: 'producer:read_assigned' },
  PLOT: { amplio: 'plot:read', asignado: 'plot:read_assigned' },
  DELIVERY: { amplio: 'delivery:read', asignado: 'delivery:read_assigned' },
  LOT: { amplio: 'lot:read' },
  SHIPMENT: { amplio: 'shipment:read' },
  DD_SNAPSHOT: { amplio: 'dd:read' },
};

/**
 * RF-47 — Referencia pública de una entidad, para **adjuntarla a su lectura autorizada**.
 *
 * Entregar la referencia a quien YA puede leer el recurso **no es publicarla por audiencias**: no crea acceso,
 * no define proyecciones por destinatario y no emite ningún QR. Eso último es RF-33. Sin esto, la única forma
 * de obtener una referencia sería consultar la base, que no es una vía aceptable para la revisión ni para un
 * cliente.
 *
 * No toca el contenido de ninguna entidad: la referencia vive en su propio registro, así que adjuntarla a una
 * respuesta **no altera el contenido, el manifiesto ni el hash** de una instantánea.
 */
export async function referenciaDe(db: Kysely<Database> | Transaction<Database>, org: string, tipo: PublicReferenceEntity, id: string): Promise<string | null> {
  const r = await sql<{ reference: string }>`
    SELECT reference FROM public_references WHERE organization_id = ${org} AND entity_type = ${tipo} AND entity_id = ${id}`.execute(db);
  return r.rows[0]?.reference ?? null;
}

/** Varias de un tipo, para listados: devuelve `{ [entity_id]: reference }`. */
export async function referenciasDe(db: Kysely<Database> | Transaction<Database>, org: string, tipo: PublicReferenceEntity, ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const r = await sql<{ entity_id: string; reference: string }>`
    SELECT entity_id, reference FROM public_references
    WHERE organization_id = ${org} AND entity_type = ${tipo} AND entity_id = ANY(${ids})`.execute(db);
  return Object.fromEntries(r.rows.map((x) => [x.entity_id, x.reference]));
}

/**
 * `audience` dice **por qué** se resolvió, y con eso la interfaz sabe adónde llevar:
 *   · `MEMBER`  — es miembro de la organización: va a la pantalla interna del recurso;
 *   · `GRANTEE` — no es miembro, pero tiene una **concesión vigente sobre ESE recurso**: va a la vista
 *     compartida, que es la única proyección que le corresponde.
 * No hay una tercera: sin membresía y sin concesión, la respuesta es la opaca de siempre.
 */
export type Audiencia = 'MEMBER' | 'GRANTEE';

interface Resuelta {
  reference: string; entity_type: PublicReferenceEntity; organization_id: string; id: string; code: string;
  audience: Audiencia;
  /** Solo para `GRANTEE`: la concesión por la que se resolvió, para abrir su vista. */
  grant_id?: string;
}

@Injectable()
export class PublicReferencesService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly authz: AuthorizationService,
    @Inject(APP_CONFIG) private readonly config: { webOrigin: string },
  ) {}

  /** Una sola respuesta para todo lo que no se puede entregar: no revela si la referencia existe. */
  private get opaca() {
    return notFound('No hay ningún recurso a tu alcance con esa referencia.');
  }

  /**
   * RF-33 — QR de la referencia, para quien **ya** puede leer el recurso. Reutiliza `resolve()` entero: si no
   * está autorizado, recibe la MISMA respuesta opaca que al resolver, no un QR.
   */
  async qr(user: AuthUser, reference: string): Promise<{ svg: string; link: string; resuelta: Resuelta }> {
    const resuelta = await this.resolve(user, reference);
    const link = enlaceDeReferencia(this.config.webOrigin, resuelta.reference);
    return { svg: qrSvg(link), link, resuelta };
  }

  async resolve(user: AuthUser, reference: string): Promise<Resuelta> {
    const ref = await this.db.selectFrom('public_references').selectAll().where('reference', '=', reference).executeTakeFirst();
    if (!ref) throw this.opaca;

    // Tenant desde el registro, nunca desde la petición: la referencia no elige organización.
    const ctx = await this.authz.tenantContext(user, ref.organization_id);
    if (!ctx) {
      // Sin membresía todavía puede haber **concesión vigente sobre este recurso**. Si no la hay, la respuesta
      // es la misma opaca: quien no tiene nada no distingue «no existe» de «no es para ti».
      const grant = await this.porConcesion(user, { entity_type: ref.entity_type, entity_id: ref.entity_id });
      if (!grant) throw this.opaca;
      const compartida = await this.entidad(ref.entity_type, ref.entity_id, ref.organization_id);
      if (!compartida) throw this.opaca;
      return { reference: ref.reference, entity_type: ref.entity_type, organization_id: ref.organization_id,
        id: compartida.id, code: compartida.code, audience: 'GRANTEE', grant_id: grant };
    }

    const fila = await this.entidad(ref.entity_type, ref.entity_id, ref.organization_id);
    if (!fila) throw this.opaca; // la entidad ya no está, o no es de esa organización
    if (!this.autorizado(ctx, ref.entity_type, fila.assignee)) throw this.opaca;

    return { reference: ref.reference, entity_type: ref.entity_type, organization_id: ref.organization_id, id: fila.id, code: fila.code, audience: 'MEMBER' };
  }

  /**
   * P1-001/P1-002 — Audiencia EXTERNA: el destinatario de una **concesión vigente sobre ese mismo recurso**.
   *
   * No exige membresía, que es justamente el punto: una concesión es acceso **sin pertenecer**. Y no amplía
   * nada: exige que la concesión sea de **ese recurso exacto**, que esté **viva** (ni vencida ni revocada),
   * que tenga **lectura** concedida y que la cuenta siga activa. Al vencer o revocarse, deja de resolver.
   *
   * El rol BUYER por sí solo **no** concede nada: lo que habilita es la concesión, no el rol.
   */
  private async porConcesion(user: AuthUser, ref: { entity_type: PublicReferenceEntity; entity_id: string }): Promise<string | null> {
    // Solo los tipos que una concesión puede cubrir; para el resto no hay nada que mirar.
    if (!['LOT', 'SHIPMENT', 'DD_SNAPSHOT'].includes(ref.entity_type)) return null;
    const g = await sql<{ id: string }>`
      SELECT g.id FROM access_grants g
      JOIN users u ON u.id = g.grantee_user_id AND u.status = 'ACTIVE'
      WHERE g.grantee_user_id = ${user.id}
        AND g.resource_type = ${ref.entity_type} AND g.resource_id = ${ref.entity_id}
        AND g.can_read AND g.revoked_at IS NULL AND g.expires_at > now()
      ORDER BY g.expires_at DESC LIMIT 1`.execute(this.db);
    return g.rows[0]?.id ?? null;
  }

  private autorizado(ctx: TenantContext, tipo: PublicReferenceEntity, assignee: string | null): boolean {
    const { amplio, asignado } = ACCESO[tipo];
    if (ctx.permissions.includes(amplio)) return true;
    // Mismo predicado que el resto del producto: solo lo asignado a la propia membresía.
    return !!asignado && ctx.permissions.includes(asignado) && assignee !== null && assignee === ctx.membershipId;
  }

  /** Identidad mínima del recurso, filtrada por tenant, más la membresía que gobierna el alcance asignado. */
  private async entidad(tipo: PublicReferenceEntity, id: string, org: string): Promise<{ id: string; code: string; assignee: string | null } | undefined> {
    const q = {
      PRODUCER: sql<{ id: string; code: string; assignee: string | null }>`
        SELECT p.id, p.producer_code AS code, p.assigned_membership_id AS assignee
        FROM producers p WHERE p.id = ${id} AND p.organization_id = ${org}`,
      PLOT: sql<{ id: string; code: string; assignee: string | null }>`
        SELECT pl.id, pl.plot_code AS code, pr.assigned_membership_id AS assignee
        FROM plots pl JOIN producers pr ON pr.id = pl.producer_id
        WHERE pl.id = ${id} AND pl.organization_id = ${org}`,
      DELIVERY: sql<{ id: string; code: string; assignee: string | null }>`
        SELECT d.id, d.delivery_code AS code, pr.assigned_membership_id AS assignee
        FROM deliveries d JOIN producers pr ON pr.id = d.producer_id
        WHERE d.id = ${id} AND d.organization_id = ${org}`,
      LOT: sql<{ id: string; code: string; assignee: string | null }>`
        SELECT l.id, l.lot_code AS code, NULL::uuid AS assignee
        FROM lots l WHERE l.id = ${id} AND l.organization_id = ${org}`,
      SHIPMENT: sql<{ id: string; code: string; assignee: string | null }>`
        SELECT s.id, s.shipment_code AS code, NULL::uuid AS assignee
        FROM shipments s WHERE s.id = ${id} AND s.organization_id = ${org}`,
      // La instantánea se identifica por su expediente y su número: ni el contenido ni el hash se tocan.
      DD_SNAPSHOT: sql<{ id: string; code: string; assignee: string | null }>`
        SELECT sn.id, c.case_number || '#' || sn.snapshot_number AS code, NULL::uuid AS assignee
        FROM dd_snapshots sn JOIN dd_cases c ON c.id = sn.case_id
        WHERE sn.id = ${id} AND sn.organization_id = ${org}`,
    }[tipo];
    return (await q.execute(this.db)).rows[0];
  }
}

@ApiTags('Trazabilidad')
@Controller('api/v1/public-references')
export class PublicReferencesController {
  constructor(private readonly service: PublicReferencesService) {}

  @Get(':reference')
  @ApiOperation({
    summary: 'Resolver una referencia pública (RF-47)',
    description:
      'Conocer la referencia NO concede acceso: exige membresía en la organización dueña y el permiso de lectura ' +
      'del dominio, con el mismo alcance asignado que el resto del producto. Una referencia inexistente, un ' +
      'recurso de otra organización y un recurso fuera de alcance devuelven la MISMA respuesta. No publica nada: ' +
      'las audiencias y el QR son RF-33.',
  })
  @ApiOkResponse({ description: 'Identidad mínima del recurso referenciado.' })
  resolve(@Req() req: { user: AuthUser }, @Param('reference') reference: string) {
    return this.service.resolve(req.user, reference);
  }

  @Get(':reference/qr.svg')
  @ApiOperation({
    summary: 'QR de una referencia pública (RF-33)',
    description:
      'Codifica SOLO el enlace de resolución con la referencia opaca: ni identificadores internos, ni nombres, ' +
      'ni datos personales, ni tokens. Exige la MISMA autorización que resolver la referencia, de modo que el ' +
      'QR se entrega a quien ya puede leer el recurso. Escanearlo no concede acceso: al abrirlo hay que ' +
      'autenticarse y tener permiso. No sustituye un DDS ni acredita conformidad.',
  })
  async qr(@Req() req: { user: AuthUser }, @Param('reference') reference: string, @Res({ passthrough: true }) res: Response) {
    // El tipo se fija DESPUÉS de autorizar: una denegación es un error normalizado en JSON, no un SVG. Con la
    // cabecera declarada en el decorador, el 404 salía rotulado como imagen y el cliente no podía leerlo.
    const { svg } = await this.service.qr(req.user, reference);
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return svg;
  }

  @Get(':reference/link')
  @ApiOperation({
    summary: 'Enlace de resolución de una referencia (RF-33)',
    description: 'El mismo enlace que codifica el QR, para copiarlo. Misma autorización que resolver.',
  })
  async link(@Req() req: { user: AuthUser }, @Param('reference') reference: string) {
    const { link, resuelta } = await this.service.qr(req.user, reference);
    return { reference: resuelta.reference, entity_type: resuelta.entity_type, code: resuelta.code, link,
      note: 'Conocer el enlace no concede acceso: al abrirlo se exige sesión y permiso sobre el recurso. No sustituye un DDS.' };
  }
}
