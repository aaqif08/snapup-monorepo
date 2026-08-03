/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // `@snapup/ui` ships TypeScript/JSX source rather than a built bundle, so Next has to
  // compile it the same way it compiles this app's own `src`.
  transpilePackages: ['@snapup/ui'],
};

module.exports = nextConfig;
