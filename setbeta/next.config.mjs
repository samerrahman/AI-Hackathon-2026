/** @type {import('next').NextConfig} */
const nextConfig = {
  // No ESLint setup in this spike; don't let a missing linter block the build.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
