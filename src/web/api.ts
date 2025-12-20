import { getDays, getDayDetail, getStats, getProjects, updateProjectStatus } from '../core/db';
import { processCommand } from '../cli/process';
import type { ProjectStatus } from '../types';

type ApiHandler = (req: Request, url: URL) => Promise<Response>;

const routes: Record<string, ApiHandler> = {
  'GET /api/days': handleGetDays,
  'GET /api/days/:date': handleGetDayDetail,
  'GET /api/days/:date/brag': handleGetDayBrag,
  'GET /api/stats': handleGetStats,
  'POST /api/refresh': handleRefresh,
  'GET /api/projects': handleGetProjects,
  'PATCH /api/projects/status': handleUpdateProjectStatus,
};

export async function handleApiRequest(
  req: Request,
  url: URL
): Promise<Response> {
  const method = req.method;
  const path = url.pathname;

  // Match routes
  for (const [route, handler] of Object.entries(routes)) {
    const [routeMethod, routePath] = route.split(' ');
    if (method !== routeMethod) continue;

    const params = matchPath(routePath, path);
    if (params !== null) {
      try {
        // Attach params to URL for handler access
        (url as any).params = params;
        return await handler(req, url);
      } catch (error) {
        console.error('API error:', error);
        return jsonResponse({ error: 'Internal server error' }, 500);
      }
    }
  }

  return jsonResponse({ error: 'Not found' }, 404);
}

function matchPath(
  pattern: string,
  path: string
): Record<string, string> | null {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');

  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};

  for (let i = 0; i < patternParts.length; i++) {
    const patternPart = patternParts[i];
    const pathPart = pathParts[i];

    if (patternPart.startsWith(':')) {
      params[patternPart.slice(1)] = pathPart;
    } else if (patternPart !== pathPart) {
      return null;
    }
  }

  return params;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// Handlers

async function handleGetDays(req: Request, url: URL): Promise<Response> {
  const limitParam = url.searchParams.get('limit');
  const days = limitParam ? getDays(parseInt(limitParam)) : getDays();
  return jsonResponse(days);
}

async function handleGetDayDetail(req: Request, url: URL): Promise<Response> {
  const params = (url as any).params as Record<string, string>;
  const date = params.date;

  const detail = getDayDetail(date);
  if (!detail) {
    return jsonResponse({ error: 'Day not found' }, 404);
  }

  return jsonResponse(detail);
}

async function handleGetDayBrag(req: Request, url: URL): Promise<Response> {
  const params = (url as any).params as Record<string, string>;
  const date = params.date;

  const detail = getDayDetail(date);
  if (!detail) {
    return jsonResponse({ error: 'Day not found' }, 404);
  }

  return jsonResponse({
    date,
    bragSummary: detail.bragSummary || 'No summary available',
    projectCount: detail.projects.length,
    sessionCount: detail.stats.totalSessions,
  });
}

async function handleGetStats(req: Request, url: URL): Promise<Response> {
  const stats = getStats();
  return jsonResponse(stats);
}

async function handleRefresh(req: Request, url: URL): Promise<Response> {
  // Run processing in background
  const startTime = Date.now();

  try {
    const result = await processCommand({
      force: false,
      verbose: false,
    });

    return jsonResponse({
      success: true,
      sessionsProcessed: result.sessionsProcessed,
      errors: result.errors,
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    return jsonResponse(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
}

async function handleGetProjects(req: Request, url: URL): Promise<Response> {
  const status = url.searchParams.get('status') as ProjectStatus | null;
  const projects = getProjects(status || undefined);
  return jsonResponse(projects);
}

async function handleUpdateProjectStatus(req: Request, url: URL): Promise<Response> {
  const body = await req.json() as { path: string; status: ProjectStatus };

  if (!body.path || !body.status) {
    return jsonResponse({ error: 'Missing path or status' }, 400);
  }

  const validStatuses: ProjectStatus[] = ['shipped', 'in_progress', 'abandoned', 'one_off', 'experiment'];
  if (!validStatuses.includes(body.status)) {
    return jsonResponse({ error: 'Invalid status' }, 400);
  }

  const updated = updateProjectStatus(body.path, body.status);
  if (!updated) {
    return jsonResponse({ error: 'Project not found' }, 404);
  }

  return jsonResponse({ success: true });
}
