'use client';

import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, ROLE_LABELS, api, session, type Me, type Organization } from './api';
import { Loading, ErrorPanel, StatusBadge } from './ui';
import { LanguageSwitcher, useI18n } from './i18n';

// Workspace (docs/UX_UI.md §6): persona + organización activa + permisos efectivos + estado de la
// organización. Los roles de distintas organizaciones nunca se mezclan. Los permisos se vuelven a leer
// en cada navegación, de modo que una revocación se refleja sin nuevo login (la API sigue decidiendo).

interface OrgPermissions {
  organization_id: string;
  organization_status: 'ACTIVE' | 'SUSPENDED';
  roles: string[];
  permissions: string[];
}

interface PermissionsResponse {
  platform_permissions: string[];
  organizations: OrgPermissions[];
}

export interface Workspace {
  me: Me;
  myOrgs: Organization[];
  allOrgs: Organization[] | null; // solo administración de plataforma
  platformPermissions: string[];
  activeOrg: Organization | null;
  activePerms: OrgPermissions | null;
  can: (permission: string) => boolean;
  isPlatformAdmin: boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<Workspace | null>(null);

export function useWorkspace(): Workspace {
  const ws = useContext(Ctx);
  if (!ws) throw new Error('useWorkspace fuera de WorkspaceProvider');
  return ws;
}

interface NavItem { href: string; label: string; match: (p: string) => boolean }

function navFor(ws: Workspace, orgId: string | null, t: (es: string) => string): Array<{ title: string; items: NavItem[] }> {
  const groups: Array<{ title: string; items: NavItem[] }> = [];
  if (orgId) {
    const base = `/organizaciones/${orgId}`;
    const inicio: NavItem[] = [];
    if (ws.can('organization:read') || ws.isPlatformAdmin) {
      inicio.push({ href: base, label: t('Resumen de la organización'), match: (p) => p === base });
    } else {
      inicio.push({ href: base, label: t('Mi espacio'), match: (p) => p === base });
    }
    // A-05 (UI-22): «Mi finca» para quien trabaja con alcance PROPIO (sin ver productores de otras personas). El alcance lo decide el servidor.
    if (ws.can('producer:read_own') && !ws.can('producer:read') && !ws.can('producer:read_assigned')) inicio.push({ href: `${base}/mi-finca`, label: t('Mi finca'), match: (p) => p.startsWith(`${base}/mi-finca`) });
    // P1-004: la puesta en marcha la ve cualquier miembro (organization:read); el detalle va por alcance
    // y los enlaces a cada módulo siguen dependiendo de su permiso.
    if (ws.can('organization:read')) inicio.push({ href: `${base}/onboarding`, label: t('Puesta en marcha'), match: (p) => p.startsWith(`${base}/onboarding`) });
    groups.push({ title: t('Inicio'), items: inicio });
    const origen: NavItem[] = [];
    if (ws.can('producer:read') || ws.can('producer:read_assigned') || ws.can('producer:read_own')) {
      origen.push({ href: `${base}/productores`, label: t('Productores'), match: (p) => p.startsWith(`${base}/productores`) && !p.endsWith('/coincidencias') });
    }
    if (ws.can('plot:read') || ws.can('plot:read_assigned') || ws.can('plot:read_own')) {
      origen.push({ href: `${base}/parcelas`, label: t('Parcelas'), match: (p) => p.startsWith(`${base}/parcelas`) });
    }
    // A-01: captura guiada de la ubicación de la parcela desde la web, para quien puede modificar parcelas en su alcance.
    if ((ws.can('plot:update') || ws.can('plot:update_assigned') || ws.can('plot:update_own')) && ws.can('plot:read_geometry')) {
      origen.push({ href: `${base}/captura`, label: t('Captura de campo'), match: (p) => p.startsWith(`${base}/captura`) });
    }
    if (ws.can('producer:review_duplicates')) {
      origen.push({ href: `${base}/productores/coincidencias`, label: t('Posibles duplicados'), match: (p) => p.endsWith('/coincidencias') });
    }
    if (origen.length) groups.push({ title: t('Origen'), items: origen });
    // Operación (UX_UI §8): solo módulos conectados a operaciones reales.
    const operacion: NavItem[] = [];
    if (ws.can('delivery:read') || ws.can('delivery:read_assigned')) operacion.push({ href: `${base}/entregas`, label: t('Entregas'), match: (p) => p.startsWith(`${base}/entregas`) && !p.startsWith(`${base}/entregas-eventos`) });
    if (ws.can('lot:read')) operacion.push({ href: `${base}/lotes`, label: t('Lotes'), match: (p) => p.startsWith(`${base}/lotes`) });
    if (ws.can('stock:read')) operacion.push({ href: `${base}/inventario`, label: t('Inventario'), match: (p) => p.startsWith(`${base}/inventario`) });
    if (ws.can('shipment:read')) operacion.push({ href: `${base}/embarques`, label: t('Embarques'), match: (p) => p.startsWith(`${base}/embarques`) });
    // A-03: traspaso de custodia entre organizaciones. Estar en el menú no concede `transfer:*`; la API decide cada acción.
    if (ws.can('transfer:read')) operacion.push({ href: `${base}/traspasos`, label: t('Traspasos'), match: (p) => p.startsWith(`${base}/traspasos`) });
    // Análisis satelital de parcelas que OTRA organización autorizó a la propia (exportadora). Quien captura parcelas lo ve en la ficha de la parcela.
    if (ws.can('satellite:read') && !ws.can('plot:read_own')) operacion.push({ href: `${base}/analisis-autorizados`, label: t('Análisis autorizados'), match: (p) => p.startsWith(`${base}/analisis-autorizados`) });
    if (ws.can('lot:read')) operacion.push({ href: `${base}/procesos`, label: t('Procesos'), match: (p) => p.startsWith(`${base}/procesos`) });
    if (ws.can('product:read')) operacion.push({ href: `${base}/productos`, label: t('Productos'), match: (p) => p.startsWith(`${base}/productos`) });
    if (operacion.length) groups.push({ title: t('Operación'), items: operacion });
    const trazabilidad: NavItem[] = [];
    if (ws.can('traceability:read_catalog')) trazabilidad.push({ href: `${base}/trazabilidad/hitos`, label: t('Hitos (CTE)'), match: (p) => p.startsWith(`${base}/trazabilidad/hitos`) });
    if (ws.can('document:read')) trazabilidad.push({ href: `${base}/legalidad`, label: t('Legalidad y soportes'), match: (p) => p.startsWith(`${base}/legalidad`) });
    if (ws.can('document:read')) trazabilidad.push({ href: `${base}/documentos`, label: t('Documentos'), match: (p) => p.startsWith(`${base}/documentos`) });
    if (ws.can('evidence:read')) trazabilidad.push({ href: `${base}/evidencias`, label: t('Evidencias'), match: (p) => p.startsWith(`${base}/evidencias`) });
    if (ws.can('risk:read')) trazabilidad.push({ href: `${base}/riesgo`, label: t('Riesgo'), match: (p) => p.startsWith(`${base}/riesgo`) });
    if (ws.can('mitigation:read')) trazabilidad.push({ href: `${base}/mitigaciones`, label: t('Mitigaciones'), match: (p) => p.startsWith(`${base}/mitigaciones`) });
    if (ws.can('dd:read')) trazabilidad.push({ href: `${base}/diligencia`, label: t('Debida diligencia'), match: (p) => p.startsWith(`${base}/diligencia`) });
    // P1-009: simulación de preparación. Trabaja sobre el expediente, así que exige leerlo; es solo lectura
    // y no habilita nada.
    if (ws.can('dd:read')) trazabilidad.push({ href: `${base}/simulacion`, label: t('Simulación'), match: (p) => p.startsWith(`${base}/simulacion`) });
    // P1-005: el catálogo de perfiles es un catálogo de sistema, como los hitos CTE. Entrar no acredita nada:
    // el perfil es parcial y su revisión jurídica sigue pendiente.
    if (ws.can('traceability:read_catalog')) trazabilidad.push({ href: `${base}/geolocalizacion`, label: t('Geolocalización: reglas'), match: (p) => p.startsWith(`${base}/geolocalizacion`) });
    // El perfil jurídico es configuración técnica y de revisión: queda en Administración. El trabajo documental del usuario es «Legalidad y soportes».
    // P1-006: intercambio con un registro externo. Solo para quien participa en él; la verificación del
    // canal no está aquí, es de plataforma.
    if (ws.can('exchange:use')) trazabilidad.push({ href: `${base}/intercambio`, label: t('Intercambio'), match: (p) => p.startsWith(`${base}/intercambio`) });
    // P0-030: `report:read` abre la pantalla de indicadores; cada indicador exige además el permiso de su dominio,
    // que aplica la API. Estar en el menú no concede lectura de riesgo, parcelas ni identidad.
    // P1-010: presupuesto de preparación. Importes DECLARADOS por la organización, no tarifas del producto.
    if (ws.can('cost:read')) trazabilidad.push({ href: `${base}/presupuesto`, label: t('Presupuesto'), match: (p) => p.startsWith(`${base}/presupuesto`) });
    // P1-011: histórico temporal y alertas. Derivado de lo ya registrado; leerlo no cambia nada del dominio.
    if (ws.can('plot:read') || ws.can('plot:read_assigned')) trazabilidad.push({ href: `${base}/historico`, label: t('Histórico'), match: (p) => p.startsWith(`${base}/historico`) });
    // P1-014: indicadores comerciales. Permiso propio; cada indicador exige además el de su dominio.
    if (ws.can('analytics:read')) trazabilidad.push({ href: `${base}/indicadores`, label: t('Indicadores'), match: (p) => p.startsWith(`${base}/indicadores`) });
    if (ws.can('report:read')) trazabilidad.push({ href: `${base}/reportes`, label: t('Reportes'), match: (p) => p.startsWith(`${base}/reportes`) });
    // P1-015: límites vigentes y consumo observado. Solo lectura; no fija ningún límite.
    if (ws.can('organization:read')) trazabilidad.push({ href: `${base}/limites`, label: t('Límites y consumo'), match: (p) => p.startsWith(`${base}/limites`) });
    if (ws.can('platform_cost:read')) trazabilidad.push({ href: `${base}/coste`, label: t('Coste de la plataforma'), match: (p) => p.startsWith(`${base}/coste`) });
    if (trazabilidad.length) groups.push({ title: t('Trazabilidad'), items: trazabilidad });
    const admin: NavItem[] = [];
    const onboardingOnly = ws.isPlatformAdmin && !ws.activePerms;
    if (ws.can('membership:read') || onboardingOnly) {
      admin.push({ href: `${base}/miembros`, label: onboardingOnly ? t('Incorporar administrador') : t('Miembros e invitaciones'), match: (p) => p.startsWith(`${base}/miembros`) });
    }
    if (ws.can('membership:assign') || ws.isPlatformAdmin) {
      admin.push({ href: `${base}/acceso-plataforma`, label: t('Acceso de plataforma'), match: (p) => p.startsWith(`${base}/acceso-plataforma`) });
    }
    if (ws.can('traceability:read_catalog')) admin.push({ href: `${base}/perfil-juridico`, label: t('Perfil jurídico (configuración técnica)'), match: (p) => p.startsWith(`${base}/perfil-juridico`) });
    if (ws.can('import:manage')) admin.push({ href: `${base}/importaciones`, label: t('Importar datos (Excel)'), match: (p) => p.startsWith(`${base}/importaciones`) });
    if (ws.can('location:manage')) admin.push({ href: `${base}/centros`, label: t('Centros de acopio'), match: (p) => p.startsWith(`${base}/centros`) });
    // A-02: administración de concesiones externas de lectura. Estar en el menú no concede `grant:manage`; la API decide.
    if (ws.can('grant:manage')) admin.push({ href: `${base}/concesiones`, label: t('Concesiones'), match: (p) => p.startsWith(`${base}/concesiones`) });
    if (ws.can('audit:read')) admin.push({ href: `${base}/auditoria`, label: t('Auditoría'), match: (p) => p.startsWith(`${base}/auditoria`) });
    if (ws.can('events:reprocess')) admin.push({ href: `${base}/entregas-eventos`, label: t('Entregas de eventos'), match: (p) => p.startsWith(`${base}/entregas-eventos`) });
    // P1-008: destinos de integración y resultado de cada entrega. Leerlo exige `integration:read`;
    // configurarlos, `integration:manage`. Estar en el menú no concede ninguno de los dos.
    if (ws.can('integration:read')) admin.push({ href: `${base}/integracion`, label: t('Integración (webhooks)'), match: (p) => p.startsWith(`${base}/integracion`) });
    if (admin.length) groups.push({ title: t('Administración'), items: admin });
  }
  const general: NavItem[] = [{ href: '/organizaciones', label: ws.isPlatformAdmin ? t('Organizaciones (plataforma)') : t('Mis organizaciones'), match: (p) => p === '/organizaciones' }];
  if (ws.isPlatformAdmin) general.push({ href: '/plataforma/geolocalizacion', label: t('Reglas de geolocalización'), match: (p) => p.startsWith('/plataforma/geolocalizacion') });
  if (ws.isPlatformAdmin) general.push({ href: '/plataforma/perfil-juridico', label: t('Revisión de perfiles jurídicos'), match: (p) => p.startsWith('/plataforma/perfil-juridico') });
  if (ws.isPlatformAdmin) general.push({ href: '/plataforma/catalogo-riesgo', label: t('Catálogo de riesgo y perfil jurídico'), match: (p) => p.startsWith('/plataforma/catalogo-riesgo') });
  if (ws.isPlatformAdmin) general.push({ href: '/plataforma/usuarios', label: t('Usuarios de la plataforma'), match: (p) => p.startsWith('/plataforma/usuarios') });
  if (ws.isPlatformAdmin) general.push({ href: '/plataforma/observabilidad', label: t('Observabilidad'), match: (p) => p.startsWith('/plataforma/observabilidad') });
  // Portal del destinatario: la pantalla existe para cualquier cuenta; sin concesión vigente muestra un vacío explicado.
  if (!ws.isPlatformAdmin) general.push({ href: '/compartido', label: t('Compartido conmigo'), match: (p) => p.startsWith('/compartido') });
  general.push({ href: '/cuenta', label: t('Mi cuenta'), match: (p) => p.startsWith('/cuenta') });
  groups.push({ title: ws.isPlatformAdmin ? t('Plataforma') : t('General'), items: general });
  return groups;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ id?: string }>();
  const orgId = params?.id ?? null;
  const [state, setState] = useState<{ me: Me; myOrgs: Organization[]; allOrgs: Organization[] | null; perms: PermissionsResponse } | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    try {
      const [me, perms, myOrgs] = await Promise.all([
        api<Me>('/api/v1/me'),
        api<PermissionsResponse>('/api/v1/me/permissions'),
        api<Organization[]>('/api/v1/organizations'),
      ]);
      const allOrgs = me.platform_role === 'SUPER_ADMIN' ? await api<Organization[]>('/api/v1/organizations?scope=all') : null;
      setState({ me, myOrgs, allOrgs, perms });
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        session.clear();
        router.replace('/');
        return;
      }
      setError(err as ApiError);
    }
  }, [router]);

  // Se recarga al cambiar de ruta: permisos vigentes en cada pantalla.
  useEffect(() => {
    void load();
  }, [load, pathname]);

  const ws = useMemo<Workspace | null>(() => {
    if (!state) return null;
    const activePerms = orgId ? state.perms.organizations.find((o) => o.organization_id === orgId) ?? null : null;
    const activeOrg = orgId ? (state.myOrgs.find((o) => o.id === orgId) ?? state.allOrgs?.find((o) => o.id === orgId) ?? null) : null;
    return {
      me: state.me,
      myOrgs: state.myOrgs,
      allOrgs: state.allOrgs,
      platformPermissions: state.perms.platform_permissions,
      activeOrg,
      activePerms,
      can: (p) => !!activePerms?.permissions.includes(p),
      isPlatformAdmin: state.me.platform_role === 'SUPER_ADMIN',
      refresh: load,
    };
  }, [state, orgId, load]);

  if (error) return <div className="tl-access"><div className="tl-access-card"><ErrorPanel error={error} onRetry={load} /></div></div>;
  if (!ws) return <div className="tl-access"><div className="tl-access-card"><Loading label={t('Cargando tu espacio de trabajo…')} /></div></div>;
  return <Ctx.Provider value={ws}><Shell orgId={orgId}>{children}</Shell></Ctx.Provider>;
}

function Shell({ orgId, children }: { orgId: string | null; children: ReactNode }) {
  const { t } = useI18n();
  const ws = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const groups = navFor(ws, orgId, t);
  const switchable = ws.isPlatformAdmin ? ws.allOrgs ?? [] : ws.myOrgs;

  useEffect(() => setMenuOpen(false), [pathname]);

  // Cierra ESTA sesión en el servidor (las demás de la cuenta siguen) y, si se entró por el proveedor federado,
  // cierra también la sesión allí. Si el servidor no responde, la sesión local se descarta igualmente.
  async function cerrarSesion() {
    let destino: string | null = null;
    try {
      const r = await api<{ sso_end_session_url: string | null }>('/api/v1/auth/logout', { method: 'POST' });
      destino = r.sso_end_session_url;
    } catch { /* sin conexión o sesión ya vencida */ }
    session.clear();
    if (destino) window.location.assign(destino); else router.replace('/');
  }
  // Escape cierra el panel de navegación en móvil (UX_UI §23.1).
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  return (
    <div className="tl-app" data-menu={menuOpen ? 'open' : 'closed'}>
      <a className="skip-link" href="#contenido">{t('Saltar al contenido')}</a>
      <aside className="tl-sidebar" aria-label={t('Navegación principal')}>
        {/* Identificación textual: no hay activos oficiales del logotipo en el proyecto (UX-D01). */}
        <button type="button" className="secondary inline tl-menu-close" onClick={() => setMenuOpen(false)}>{t('Cerrar menú')}</button>
        <Link href="/organizaciones" className="tl-brand">TERRA LINK<small>{t('Trazabilidad de cacao')}</small></Link>
        <nav className="tl-nav">
          {groups.map((g) => (
            <div key={g.title}>
              <p className="tl-nav-title">{g.title}</p>
              <ul className="tl-nav-group">
                {g.items.map((it) => (
                  <li key={it.href}><Link href={it.href} aria-current={it.match(pathname) ? 'page' : undefined}>{it.label}</Link></li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      <div className="tl-main">
        <header className="tl-header">
          <button type="button" className="secondary inline tl-menu-toggle" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? t('Cerrar menú') : t('Menú')}
          </button>
          <div className="tl-header-org">
            {switchable.length > 0 && (
              <>
                <label htmlFor="org-switch" className="visually-hidden">{t('Organización activa')}</label>
                <select
                  id="org-switch"
                  value={orgId ?? ''}
                  onChange={(e) => router.push(e.target.value ? `/organizaciones/${e.target.value}` : '/organizaciones')}
                >
                  <option value="">{ws.isPlatformAdmin ? t('Plataforma (sin organización)') : t('Elige una organización…')}</option>
                  {switchable.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </>
            )}
            {ws.activeOrg && (
              <StatusBadge tone={ws.activeOrg.status === 'ACTIVE' ? 'valid' : 'blocked'}>
                {ws.activeOrg.status === 'ACTIVE' ? t('Activa') : t('Suspendida')}
              </StatusBadge>
            )}
          </div>
          <div className="tl-header-user">
            <span className="muted" data-testid="contexto-usuario">
              {ws.me.email}
              {ws.isPlatformAdmin && ` · ${t('Administración de plataforma')}`}
              {ws.activePerms && ` · ${ws.activePerms.roles.map((r) => t(ROLE_LABELS[r] ?? r)).join(', ')}`}
            </span>
            <LanguageSwitcher />
            <button type="button" className="secondary inline" onClick={() => { void cerrarSesion(); }}>
              {t('Cerrar sesión')}
            </button>
          </div>
        </header>
        <main id="contenido" className="tl-content" tabIndex={-1}>
          {/* Organización de la URL sin membresía activa (ni administración de plataforma): respuesta segura única, sin
              revelar si existe; evita páginas en blanco y no carga datos (UX_UI §6.3, §9.2; P0-027). */}
          {orgId && !ws.activeOrg
            ? <ErrorPanel error={new ApiError(404, { code: 'NOT_FOUND', message: t('El recurso no existe o no está disponible para ti.'), request_id: null })} />
            : children}
        </main>
      </div>
    </div>
  );
}
