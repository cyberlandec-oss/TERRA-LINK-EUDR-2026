/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  poweredByHeader: false,
  // Cabeceras de seguridad básicas. Sin CSP a propósito: exige revisar scripts en línea de Next y los orígenes de mapas, y se evaluará aparte. La geolocalización y la cámara siguen disponibles solo para este origen (captura de campo).
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(self), microphone=()' },
    ] }];
  },
  // Solo la imagen Docker usa salida standalone; `next start` local sigue igual.
  ...(process.env.NEXT_OUTPUT === 'standalone' ? { output: 'standalone' } : {}),
};
