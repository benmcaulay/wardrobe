/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb",
    },
    // Don't bundle these on the server — they're only ever used in the
    // browser via lib/client/background-removal.ts.
    serverComponentsExternalPackages: ["@imgly/background-removal", "onnxruntime-web"],
  },
  webpack: (config, { isServer }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "onnxruntime-node": false,
    };
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
        os: false,
      };
      // onnxruntime-web's exports field picks its Node build under the
      // "node" condition. Set an explicit browser-leaning list so the
      // browser bundle wins (must include "import"/"require" for the rest
      // of our deps that gate on those).
      config.resolve.conditionNames = ["browser", "module", "import", "require", "default"];
      // Treat .mjs as ES modules so import.meta survives Terser.
      config.module.rules.push({
        test: /\.m?js$/,
        type: "javascript/auto",
        resolve: { fullySpecified: false },
      });
    }
    return config;
  },
};

export default nextConfig;
