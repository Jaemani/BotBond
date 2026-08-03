/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  ...(process.env.VERCEL === "1" ? {} : {
    output: "standalone",
    outputFileTracingRoot: new URL("../..", import.meta.url).pathname,
  }),
};
export default nextConfig;
