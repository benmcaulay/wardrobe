// s3rver ships no type declarations; it's a dev-only S3-compatible server used
// by scripts/verify-s3.ts. A minimal ambient declaration keeps tsc happy.
declare module "s3rver" {
  interface S3rverOptions {
    port?: number;
    address?: string;
    silent?: boolean;
    directory?: string;
  }
  export default class S3rver {
    constructor(options?: S3rverOptions);
    run(): Promise<unknown>;
    close(): Promise<void>;
  }
}
