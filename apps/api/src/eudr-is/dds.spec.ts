import { DDS_ENDPOINTS, ddsVersionFor, getDdsByInternalReferenceEnvelope, getDdsEnvelope, interpretOverview, interpretSubmit, producerGeoJson, sendGetByInternalReference, sendSubmitDds, submitDdsEnvelope, validateDdsInput, type DdsInput } from './dds';
import type { SoapTransport } from './echo';

const CRED = { username: 'usuario-sintetico', authenticationKey: 'clave-sintetica-9', clientId: 'cliente-sintetico' };
const UUID = '071874bd-8c62-4cac-8eb6-b2fbe003410c';
const base = (): DdsInput => ({
  operator_role: 'OPERATOR', activity_type: 'IMPORT', country_of_activity: 'BE', border_cross_country: 'BE', internal_reference: 'ENSAYO-DD-2026-00006',
  commodity: { hs_heading: '1801', description: 'Cacao en grano (ENSAYO)', net_weight_kg: '450', species_scientific_name: 'Theobroma cacao', species_common_name: 'Cacao' },
  producers: [{ country: 'EC', name: 'Productor ficticio', geometry: { type: 'Polygon', coordinates: [[[-80.16, -0.848], [-80.159, -0.848], [-80.159, -0.847], [-80.16, -0.847], [-80.16, -0.848]]] } }],
  geolocation_confidential: false,
});
const fault = (detail: string, str = 'x') => `<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body><S:Fault><faultcode>S:Server</faultcode><faultstring>${str}</faultstring><detail>${detail}</detail></S:Fault></S:Body></S:Envelope>`;

describe('DDS de EUDR-IS: contratos por entorno', () => {
  it('ACCEPTANCE publica V3 y V4; PRODUCTION solo V3 (se usa la más reciente de cada entorno)', () => {
    expect(Object.keys(DDS_ENDPOINTS.ACCEPTANCE).sort()).toEqual(['V3', 'V4']);
    expect(Object.keys(DDS_ENDPOINTS.PRODUCTION)).toEqual(['V3']);
    expect(ddsVersionFor('ACCEPTANCE')).toBe('V4');
    expect(ddsVersionFor('PRODUCTION')).toBe('V3');
    expect(DDS_ENDPOINTS.PRODUCTION.V3).toMatch(/^https:\/\/eudr\.webcloud\.ec\.europa\.eu\//);
    expect(DDS_ENDPOINTS.ACCEPTANCE.V4).toMatch(/^https:\/\/acceptance\.eudr\./);
  });
});

describe('DDS de EUDR-IS: mensaje submitDds', () => {
  it('V4 y V3 usan sus espacios de nombres y la misma estructura; la clave nunca viaja en el cuerpo ni en claro', () => {
    const v4 = submitDdsEnvelope('V4', CRED, base());
    const v3 = submitDdsEnvelope('V3', CRED, base());
    expect(v4).toContain('xmlns:dds="http://ec.europa.eu/tracesnt/certificate/eudr/due-diligence-statement/v4"');
    expect(v4).toContain('xmlns:eudrCommon="http://ec.europa.eu/tracesnt/certificate/eudr/common/v4"');
    expect(v3).toContain('due-diligence-statement/v3');
    expect(v3).toContain('eudr/common/v3');
    for (const x of [v4, v3]) {
      expect(x).toContain('xmlns:base="http://ec.europa.eu/sanco/tracesnt/base/v4"'); // la cabecera base no cambia entre versiones
      expect(x).not.toContain(CRED.authenticationKey);
      expect(x).toMatch(/<dds:operatorRole>OPERATOR<\/dds:operatorRole>/);
      expect(x).toMatch(/<dds:internalReferenceNumber>ENSAYO-DD-2026-00006<\/dds:internalReferenceNumber>/);
      expect(x).toMatch(/<dds:hsHeading>1801<\/dds:hsHeading>/);
      expect(x).toMatch(/<eudrCommon:netWeight>450<\/eudrCommon:netWeight>/);
      expect(x).toMatch(/<dds:geoLocationConfidential>false<\/dds:geoLocationConfidential>/);
    }
  });

  it('la geometría va como GeoJSON Tipo I en Base64 sin saltos, con 6 decimales y longitud antes que latitud', () => {
    const x = submitDdsEnvelope('V4', CRED, base());
    const b64 = /<dds:geometryGeojson>([^<]+)<\/dds:geometryGeojson>/.exec(x)![1];
    expect(b64).not.toMatch(/\s/);
    const gj = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    expect(gj.type).toBe('FeatureCollection');
    expect(gj.features[0].properties).toMatchObject({ ProducerCountry: 'EC', ProducerName: 'Productor ficticio' });
    expect(gj.features[0].geometry.coordinates[0][0]).toEqual([-80.16, -0.848]);
    expect(producerGeoJson(base().producers[0])).toContain('[-80.160000,-0.848000]'); // el texto conserva 6 decimales
  });

  it('geolocalización confidencial: V4 omite la geometría; V3 no lo admite (la exige)', () => {
    const conf = { ...base(), geolocation_confidential: true };
    expect(submitDdsEnvelope('V4', CRED, conf)).not.toContain('geometryGeojson');
    expect(validateDdsInput(conf, 'V4')).toEqual([]);
    expect(validateDdsInput(conf, 'V3').map((p) => p.field)).toContain('geolocation_confidential');
  });

  it('la validación nombra el campo y no completa lo desconocido', () => {
    expect(validateDdsInput(base(), 'V4')).toEqual([]);
    const mal: DdsInput = { ...base(), internal_reference: 'x'.repeat(51), commodity: { hs_heading: '18', description: 'x'.repeat(151), net_weight_kg: '0' }, producers: [{ country: 'desconocido', geometry: { type: 'Point', coordinates: [-80.1, -0.8] }, area_ha: 9 }] };
    const campos = validateDdsInput(mal, 'V4').map((p) => p.field);
    expect(campos).toEqual(expect.arrayContaining(['internal_reference', 'commodity.description', 'commodity.net_weight_kg', 'producers[0].country', 'producers[0].geometry']));
    expect(validateDdsInput({ ...base(), commodity: { ...base().commodity, hs_heading: 'cacao' } }, 'V4').map((p) => p.field)).toContain('commodity.hs_heading');
    expect(validateDdsInput({ ...base(), producers: [] }, 'V4').map((p) => p.field)).toContain('producers');
    expect(validateDdsInput({ ...base(), operator_role: 'REPRESENTATIVE_OPERATOR' }, 'V4').map((p) => p.field)).toContain('represented_operator');
  });

  it('un representante identifica al operador representado; los valores se escapan', () => {
    const x = submitDdsEnvelope('V4', CRED, { ...base(), operator_role: 'REPRESENTATIVE_OPERATOR', represented_operator: { name: 'Importadora <&> S.A.' }, comment: 'a "b"' });
    expect(x).toContain('<eudrCommon:operatorName>Importadora &lt;&amp;&gt; S.A.</eudrCommon:operatorName>');
    expect(x).toContain('&quot;b&quot;');
  });

  it('las consultas por UUID y por referencia interna usan sus elementos', () => {
    expect(getDdsEnvelope('V4', CRED, UUID)).toContain(`<dds:GetDdsRequest><dds:uuidList>${UUID}</dds:uuidList></dds:GetDdsRequest>`);
    expect(getDdsByInternalReferenceEnvelope('V3', CRED, 'REF-1')).toContain('<dds:internalReference>REF-1</dds:internalReference>');
  });
});

describe('DDS de EUDR-IS: interpretar la respuesta de submitDds', () => {
  it('aceptada: el UUID del sistema', () => {
    const ok = `<S:Envelope xmlns:S="x"><S:Body><ns5:SubmitDdsResponse xmlns:ns5="y"><ns5:uuid>${UUID.toUpperCase()}</ns5:uuid></ns5:SubmitDdsResponse></S:Body></S:Envelope>`;
    expect(interpretSubmit(200, ok)).toEqual({ kind: 'ACCEPTED', uuid: UUID, httpStatus: 200 });
  });
  it('rechazo de negocio: procesada y rechazada, con sus errores (campo y mensaje) y sin reenvío automático', () => {
    const r = interpretSubmit(500, fault('<ns5:BusinessRulesValidationException xmlns:ns5="y"><Error><ID>E1</ID><Message>HS no valido</Message><Field>hsHeading</Field></Error></ns5:BusinessRulesValidationException>'));
    expect(r).toMatchObject({ kind: 'REJECTED', errors: [{ id: 'E1', field: 'hsHeading', message: 'HS no valido' }] });
  });
  it('credenciales o permiso: NO procesada', () => {
    expect(interpretSubmit(401, '')).toMatchObject({ kind: 'NOT_PROCESSED', reason: 'AUTH_FAILED' });
    expect(interpretSubmit(500, fault('<ns5:PermissionDeniedException xmlns:ns5="y"/>'))).toMatchObject({ kind: 'NOT_PROCESSED', reason: 'PERMISSION_DENIED' });
    expect(interpretSubmit(500, fault('', 'Authentication failed: UsernameToken'))).toMatchObject({ kind: 'NOT_PROCESSED', reason: 'AUTH_FAILED' });
  });
  it('INCIERTA (nunca se reenvía sola): fallo interno sin detalle, 5xx, 200 ilegible, UUID inválido', () => {
    expect(interpretSubmit(500, fault('', 'InternalSystemException'))).toMatchObject({ kind: 'UNCERTAIN' });
    expect(interpretSubmit(502, '<html>Bad gateway</html>')).toMatchObject({ kind: 'UNCERTAIN' });
    expect(interpretSubmit(200, '<S:Envelope><S:Body/></S:Envelope>')).toMatchObject({ kind: 'UNCERTAIN' });
    expect(interpretSubmit(200, '<ns5:uuid>no-es-un-uuid</ns5:uuid>')).toMatchObject({ kind: 'UNCERTAIN' });
  });
  it('el envío con transporte que falla es INCIERTO y llama una sola vez', async () => {
    const t = jest.fn(async () => { throw new Error('ECONNRESET'); }) as unknown as SoapTransport;
    expect(await sendSubmitDds('ACCEPTANCE', 'V4', CRED, base(), t)).toMatchObject({ kind: 'UNCERTAIN', httpStatus: null });
    expect(t).toHaveBeenCalledTimes(1);
  });
  it('PRODUCTION no tiene V4: no se envía', async () => {
    const t = jest.fn() as unknown as SoapTransport;
    await expect(sendSubmitDds('PRODUCTION', 'V4', CRED, base(), t)).rejects.toThrow('DDS_VERSION_NOT_PUBLISHED_FOR_ENVIRONMENT');
    expect(t).not.toHaveBeenCalled();
  });
});

describe('DDS de EUDR-IS: interpretar las consultas', () => {
  const ov = `<S:Envelope xmlns:S="x"><S:Body><ns5:GetDdsResponse xmlns:ns5="y"><ns5:ddsOverviewList><ns5:uuid>${UUID}</ns5:uuid><ns5:internalReferenceNumber>ENSAYO-DD-2026-00006</ns5:internalReferenceNumber><ns5:referenceNumber>26ECABCDEF1234</ns5:referenceNumber><ns5:verificationNumber>VERIF123</ns5:verificationNumber><ns5:status>AVAILABLE</ns5:status><ns5:version>1</ns5:version></ns5:ddsOverviewList></ns5:GetDdsResponse></S:Body></S:Envelope>`;
  it('encontrada: estado, referencia y verificación tal cual los entrega el sistema', () => {
    expect(interpretOverview(200, ov)).toMatchObject({ kind: 'FOUND', items: [{ uuid: UUID, internalReference: 'ENSAYO-DD-2026-00006', referenceNumber: '26ECABCDEF1234', verificationNumber: 'VERIF123', status: 'AVAILABLE', version: 1 }] });
  });
  it('no encontrada es un resultado distinto de incierta', () => {
    expect(interpretOverview(500, fault('<ns5:NotFoundException xmlns:ns5="y"/>'))).toEqual({ kind: 'NOT_FOUND', httpStatus: 500 });
    expect(interpretOverview(502, '<html/>')).toMatchObject({ kind: 'UNCERTAIN' });
  });
  it('la consulta por referencia interna sin respuesta es INCIERTA, no «no encontrada»', async () => {
    const t = jest.fn(async () => { throw new Error('timeout'); }) as unknown as SoapTransport;
    expect(await sendGetByInternalReference('ACCEPTANCE', 'V4', CRED, 'REF', t)).toMatchObject({ kind: 'UNCERTAIN' });
  });
});
