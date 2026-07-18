/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Keep server-only native/ORM deps out of the client bundle (Next 14 key).
    serverComponentsExternalPackages: ['@prisma/client', 'ioredis'],
  },
};

export default nextConfig;
