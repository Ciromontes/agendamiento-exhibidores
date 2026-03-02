import type { NextConfig } from "next";

const SUPABASE_HOST = "https://hffjoeeahqcpphgndkfc.supabase.co";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Impide que el browser adivine el Content-Type (test 8)
          { key: "X-Content-Type-Options", value: "nosniff" },

          // Impide que la app sea embebida en un iframe (clickjacking)
          { key: "X-Frame-Options", value: "DENY" },

          // Habilita el filtro XSS del browser (legacy, pero útil)
          { key: "X-XSS-Protection", value: "1; mode=block" },

          // Fuerza HTTPS durante 2 años
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },

          // No informar la URL completa al navegar a otros sitios
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

          // Restringe de dónde puede cargar recursos el browser
          // connect-src: solo permite llamadas a Supabase y al propio origen
          // img-src: permite data: para avatares/iconos inline si se agregan
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",   // Next.js requiere unsafe-inline para hydration
              "style-src 'self' 'unsafe-inline'",    // Tailwind requiere unsafe-inline
              `connect-src 'self' ${SUPABASE_HOST} wss://*.supabase.co`,
              "img-src 'self' data: blob:",
              "font-src 'self'",
              "frame-ancestors 'none'",              // refuerzo del X-Frame-Options
            ].join("; "),
          },

          // Limita el acceso a APIs del browser (cámara, micrófono, etc.)
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
