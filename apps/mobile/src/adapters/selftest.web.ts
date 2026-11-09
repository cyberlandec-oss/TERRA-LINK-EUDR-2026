// Vista previa web: la autoprueba de seguridad (SQLCipher, archivo cifrado, temporales) solo tiene sentido en el
// dispositivo. Aquí se informa «no aplica» en lugar de simular resultados.
export interface SelfTestCase { id: string; ok: boolean; detail: string }

export async function runSelfTest(): Promise<{ environment: string; ok: boolean; cases: SelfTestCase[] }> {
  return {
    environment: 'WEB_PREVIEW_SYNTHETIC',
    ok: false,
    cases: [{ id: 'no_aplica_en_web', ok: false, detail: 'La vista previa web no tiene SQLCipher ni almacenamiento del dispositivo: ejecuta la autoprueba en el build Android.' }],
  };
}
