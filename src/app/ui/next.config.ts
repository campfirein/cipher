import type { NextConfig } from 'next';
import os from 'os';

// Determine allowed development origins (local network IPs on port 3000)
const interfaces = os.networkInterfaces();
const allowedOrigins: string[] = ['http://localhost:3000'];
Object.values(interfaces).forEach(list =>
	list?.forEach(iface => {
		if (iface.family === 'IPv4' && !iface.internal) {
			allowedOrigins.push(`http://${iface.address}:3000`);
		}
	})
);

const _isDev = process.env.NODE_ENV === 'development';
const isStandalone = process.env.BUILD_STANDALONE === 'true';

const nextConfig: NextConfig = {
	reactStrictMode: true,
	// Use standalone output for production builds
	output: isStandalone ? 'standalone' : undefined,
	// Disable ESLint during build to avoid config issues
	eslint: {
		ignoreDuringBuilds: true,
	},
	// Allow static asset requests from these origins in dev mode
	allowedDevOrigins: allowedOrigins,
	async rewrites() {
		const apiPort = process.env.API_PORT ?? '3001';
		return [
			{
				source: '/api/:path*',
				destination: `http://localhost:${apiPort}/api/:path*`, // Proxy to backend
			},
		];
	},
	// Allow cross-origin requests for Next.js static and HMR assets during dev
	async headers() {
		return [
			{
				source: '/_next/:path*',
				headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }],
			},
		];
	},
};

export default nextConfig;
