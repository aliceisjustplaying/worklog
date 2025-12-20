#!/usr/bin/env bun
/**
 * Development server - runs API + Vite with hot reload
 * Usage: bun run scripts/dev.ts
 */

import { spawn } from 'bun';

console.log('Starting development servers...\n');

// Start API server
const api = spawn({
  cmd: ['bun', 'run', 'src/cli/index.ts', 'serve'],
  stdout: 'inherit',
  stderr: 'inherit',
  env: { ...process.env, FORCE_COLOR: '1' },
});

// Give API a moment to start
await Bun.sleep(500);

// Start Vite dev server
const vite = spawn({
  cmd: ['bunx', 'vite', '--host'],
  stdout: 'inherit',
  stderr: 'inherit',
  env: { ...process.env, FORCE_COLOR: '1' },
});

console.log('\n📡 API server: http://localhost:3456');
console.log('🔥 Dev server: http://localhost:5173 (use this one)\n');

// Handle cleanup
process.on('SIGINT', () => {
  api.kill();
  vite.kill();
  process.exit(0);
});

process.on('SIGTERM', () => {
  api.kill();
  vite.kill();
  process.exit(0);
});

// Wait for both
await Promise.all([api.exited, vite.exited]);
