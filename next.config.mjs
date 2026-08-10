/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb",
    },
    // Keep @sentry/node (and its OpenTelemetry tree) out of the webpack bundle;
    // it's server-only, loaded lazily at runtime when SENTRY_DSN is set.
    // @huggingface/transformers resolves to its *node* build during SSR, which
    // pulls onnxruntime-node's native .node binary into the server bundle and
    // fails the parse. It is only ever used in the browser worker, so keep it
    // external and let the runtime resolve it if anything server-side ever
    // touches it (nothing does).
    serverComponentsExternalPackages: ["@sentry/node", "@huggingface/transformers"],
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // transformers.js ships Node-only backends alongside the browser ones and
      // imports them unconditionally. Without these aliases webpack tries to
      // bundle onnxruntime-node's native .node binding and sharp into the
      // client chunk, which fails the build outright.
      //
      // The browser path uses onnxruntime-web (WASM/WebGPU) from /public/ort and
      // Canvas for image decoding, so nothing here is actually reachable.
      config.resolve.alias = {
        ...config.resolve.alias,
        "onnxruntime-node$": false,
        sharp$: false,
      };
    }
    return config;
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
