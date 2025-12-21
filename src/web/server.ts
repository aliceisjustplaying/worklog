import { serve } from 'bun';
import { existsSync } from 'fs';
import { join } from 'path';

import { handleApiRequest } from './api';

const PORT = parseInt(process.env.PORT ?? '3456');
const STATIC_DIR = join(import.meta.dir, '../../dist');

export function startServer() {
  console.log(`\n🚀 Starting worklog server on http://localhost:${String(PORT)}\n`);

  serve({
    port: PORT,
    async fetch(req) {
      const url = new URL(req.url);

      // API routes
      if (url.pathname.startsWith('/api/')) {
        return handleApiRequest(req, url);
      }

      // Static files
      return serveStatic(url.pathname);
    },
    error(error) {
      console.error('Server error:', error);
      return new Response('Internal Server Error', { status: 500 });
    },
  });

  console.log('Server running. Press Ctrl+C to stop.\n');
}

function serveStatic(pathname: string): Response {
  // Map pathname to file
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = join(STATIC_DIR, filePath);

  // Check if file exists
  if (existsSync(filePath)) {
    const file = Bun.file(filePath);
    return new Response(file, {
      headers: {
        'Content-Type': getContentType(filePath),
      },
    });
  }

  // SPA fallback - serve index.html for all routes
  const indexPath = join(STATIC_DIR, 'index.html');
  if (existsSync(indexPath)) {
    const file = Bun.file(indexPath);
    return new Response(file, {
      headers: {
        'Content-Type': 'text/html',
      },
    });
  }

  // No static files yet - serve a placeholder
  return new Response(
    `<!DOCTYPE html>
<html>
<head>
  <title>Worklog</title>
  <style>
    body { font-family: system-ui; max-width: 600px; margin: 100px auto; padding: 20px; }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; }
  </style>
</head>
<body>
  <h1>Worklog</h1>
  <p>Frontend not built yet. Run:</p>
  <pre><code>bun run build</code></pre>
  <p>Or for development:</p>
  <pre><code>bun run dev</code></pre>
  <hr>
  <p>API is available at <a href="/api/stats">/api/stats</a></p>
</body>
</html>`,
    {
      headers: { 'Content-Type': 'text/html' },
    },
  );
}

function getContentType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = {
    html: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    json: 'application/json',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
  };
  return types[ext ?? ''] ?? 'application/octet-stream';
}
