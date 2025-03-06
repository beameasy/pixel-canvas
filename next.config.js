/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'imagedelivery.net',
        pathname: '/**',
      },
    ],
    domains: [
      'i.imgur.com',
      'avatars.githubusercontent.com',
      'pbs.twimg.com',
      'cdn.stamp.fyi',
      'ipfs.io',
      'cloudflare-ipfs.com',
      'gateway.pinata.cloud',
      // Add other common domains you've seen
    ],
    unoptimized: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        net: false,
        tls: false,
        dns: false,
      };
    }
    return config;
  },
  experimental: {
    turbo: {
      enabled: true
    }
  },
}

module.exports = nextConfig 