/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'firebasestorage.googleapis.com' },
      { protocol: 'https', hostname: '*.firebasestorage.app' },
    ],
  },
  // @barkath/shared ships TS source consumed directly by the Next build.
  transpilePackages: ['@barkath/shared'],
};

export default nextConfig;
