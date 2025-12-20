import { useState, useEffect, useCallback } from 'react';
import type { ProjectStatus, ProjectListItem } from '../../../types';

export function useProjects(status?: ProjectStatus) {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    try {
      setLoading(true);
      const url = status ? `/api/projects?status=${status}` : '/api/projects';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch projects');
      setProjects(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  return { projects, loading, error, refetch: fetchProjects };
}

export function useUpdateProjectStatus() {
  const [updating, setUpdating] = useState(false);

  const updateStatus = async (projectPath: string, status: ProjectStatus): Promise<boolean> => {
    setUpdating(true);
    try {
      const res = await fetch('/api/projects/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: projectPath, status }),
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      setUpdating(false);
    }
  };

  return { updateStatus, updating };
}
