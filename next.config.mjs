/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb",
    },
    // Keep @sentry/node (and its OpenTelemetry tree) out of the webpack bundle;
    // it's server-only, loaded lazily at runtime when SENTRY_DSN is set.
    serverComponentsExternalPackages: ["@sentry/node"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Webcam capture is a first-party feature; everything else is denied.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
