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
    //
    // onnxruntime-node is here for the same reason but is genuinely used
    // server-side, by the Mode B face gate in lib/face/. A dynamic import() is
    // not enough on its own — webpack still statically resolves the request and
    // chokes on the .node binary, reached via
    // camera-roll-scan action → kick-drain → worker → runner → face/gate.
    serverComponentsExternalPackages: [
      "@sentry/node",
      "@huggingface/transformers",
      "onnxruntime-node",
    ],
  },
  webpack: (config, { isServer, webpack }) => {
    /*
     * Don't re-minify vendor bundles that ship pre-minified as ESM.
     *
     * `@huggingface/transformers` imports `onnxruntime-web/webgpu`, which emits
     * `ort.webgpu.bundle.min.<hash>.mjs` into static/media. Next's Terser
     * plugin sets `terserOptions.module = true` for `.mjs` — but only on its
     * worker path. The swcMinify path (the 14.x default) calls swc.minify()
     * without forwarding that flag, so the file is parsed as a *script*, and
     * `import.meta` inside it is a syntax error. The whole production build
     * fails with "'import.meta' cannot be used outside of module code".
     *
     * The plugin skips any asset already flagged `minimized`, and these are
     * genuinely already minified — the flag is accurate, not a dodge. Marking
     * them keeps swcMinify on for everything we actually author.
     *
     * Revisit when Next forwards `module` to swc.minify, or when the WebGPU
     * entry stops being imported at all (lib/wear/encoder.ts pins the wasm
     * backend, so nothing here needs it).
     */
    config.plugins.push({
      apply(compiler) {
        compiler.hooks.compilation.tap("MarkPreMinifiedVendorEsm", (compilation) => {
          compilation.hooks.processAssets.tap(
            {
              name: "MarkPreMinifiedVendorEsm",
              stage: webpack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE - 1,
            },
            (assets) => {
              for (const name of Object.keys(assets)) {
                // The content hash is injected before the extension, so the
                // emitted name is `…bundle.min.<hash>.mjs`, not `….min.mjs`.
                if (/\.min\.[^/]*\.mjs$/i.test(name)) {
                  compilation.updateAsset(name, (source) => source, { minimized: true });
                }
              }
            },
          );
        });
      },
    });

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
