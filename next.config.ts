import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
