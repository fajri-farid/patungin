import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // A local CLI deployment must not bundle sandbox data or diagnostic screenshots.
  outputFileTracingExcludes: {
    "/*": [
      "./.env*",
      "./.patungin-*",
      "./.patungin-*/**/*",
      "./output/**/*",
      "./.playwright-cli/**/*",
      "./.git/**/*",
      "./.vercel/**/*",
      "./.firebase/**/*",
      "./service-account*.json",
      "./*firebase-adminsdk*.json",
      "./*.pem",
      "./*.key",
      "./*.p12",
      "./*.pfx",
    ],
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "no-referrer" },
        {
          key: "Permissions-Policy",
          value: "camera=(self), microphone=(), geolocation=()",
        },
        // Compatible with Next inline hydration and Firebase Google sign-in.
        // A nonce-based script policy requires a separate rendering migration.
        {
          key: "Content-Security-Policy",
          value: "base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'",
        },
        ...(process.env.NODE_ENV === "production" ? [
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ] : []),
      ],
    }];
  },
  // Matikan cacheComponents agar route sensitif (sesi auth, kuota, dan share link)
  // selalu dievaluasi per-request tanpa risiko cache lintas pengguna.
  cacheComponents: false,
  reactCompiler: true,
  turbopack: {
    rules: {
      // Only the Tailwind entrypoint needs this loader. Applying `as: "*.css"`
      // to .module.css files removes their scoped class exports.
      "globals.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
