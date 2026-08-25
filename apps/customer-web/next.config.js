/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // `@snapup/ui` ships TypeScript/JSX source rather than a built bundle, so Next has to
  // compile it the same way it compiles this app's own `src`.
  transpilePackages: ['@snapup/ui'],

  // PGlite ships a WASM build of Postgres plus its own filesystem shim. Bundling that
  // through webpack rewrites the asset paths it resolves at runtime, so it is loaded as a
  // real Node dependency instead. Harmless when the app is pointed at hosted Postgres —
  // the package is then never imported at all.
  serverExternalPackages: ['@electric-sql/pglite'],
};

module.exports = nextConfig;
