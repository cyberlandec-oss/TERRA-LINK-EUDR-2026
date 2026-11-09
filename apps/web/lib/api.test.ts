import { describe, expect, it } from 'vitest';
import { ApiError, can, invitationLink, recoveryHint, tokenFromHash } from './api';

describe('cliente web', () => {
  it('muestra acciones solo con el permiso efectivo devuelto por la API, no por nombre de rol', () => {
    expect(can({ permissions: ['organization:read', 'organization:update'] }, 'organization:update')).toBe(true);
    expect(can({ permissions: ['organization:read'] }, 'organization:update')).toBe(false);
    expect(can({}, 'organization:read')).toBe(false);
  });

  it('ofrece recuperación específica para suspensión y conflicto de versión', () => {
    const err = (code: string) => new ApiError(409, { code, message: 'x', request_id: 'req-1' });
    expect(recoveryHint(err('ORGANIZATION_SUSPENDED'))).toMatch(/consultar/);
    expect(recoveryHint(err('VERSION_CONFLICT'))).toMatch(/Recarga/);
    expect(recoveryHint(err('OTRO'))).toContain('req-1');
  });

  it('el enlace lleva el token en el fragmento y se lee de vuelta solo si tiene formato válido', () => {
    const token = 'a'.repeat(43);
    const link = invitationLink('http://localhost:3000', token);
    expect(link).toBe(`http://localhost:3000/invitacion#token=${token}`);
    expect(tokenFromHash(new URL(link).hash)).toBe(token);
    expect(tokenFromHash('#token=corto')).toBeNull();
    expect(tokenFromHash('')).toBeNull();
  });
});
