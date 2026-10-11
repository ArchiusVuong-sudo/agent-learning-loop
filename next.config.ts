import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The agent SDK spawns a CLI subprocess and libsql ships native code: keep them out of the bundle.
  serverExternalPackages: [
    '@anthropic-ai/claude-agent-sdk',
    '@libsql/client',
    'libsql',
    '@mastra/core',
    '@mastra/evals',
    '@mastra/libsql',
    '@mastra/next',
    '@mastra/observability',
  ],
  poweredByHeader: false,
};

export default nextConfig;
