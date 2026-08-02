/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: new URL("../..", import.meta.url).pathname,
  async rewrites() {
    const gateway = (process.env.BOTBOND_GATEWAY_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
    return [{ source: "/gateway/:path*", destination: `${gateway}/:path*` }];
  },
};
export default nextConfig;
