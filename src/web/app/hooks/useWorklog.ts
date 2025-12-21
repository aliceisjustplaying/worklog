import { useCallback, useEffect, useState } from 'react';

interface DayListItem {
  date: string;
  projectCount: number;
  sessionCount: number;
  bragSummary?: string;
}

interface SessionDetail {
  sessionId: string;
  startTime: string;
  endTime: string;
  shortSummary: string;
  accomplishments: string[];
  filesChanged: string[];
  toolsUsed: string[];
}

interface ProjectDetail {
  name: string;
  path: string;
  sessions: SessionDetail[];
}

interface DayDetail {
  date: string;
  bragSummary?: string;
  projects: ProjectDetail[];
  stats: {
    totalSessions: number;
    totalTokens: number;
  };
}

interface Stats {
  totalSessions: number;
  totalDays: number;
  totalProjects: number;
}

export function useDays() {
  const [days, setDays] = useState<DayListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDays = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/days');
      if (!res.ok) throw new Error('Failed to fetch days');
      const data: unknown = await res.json();
      setDays(data as DayListItem[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDays();
  }, [fetchDays]);

  return { days, loading, error, refetch: fetchDays };
}

export function useDayDetail(date: string | undefined) {
  const [day, setDay] = useState<DayDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (date === undefined) return;
    const fetchDay = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/days/${date}`);
        if (!res.ok) throw new Error('Failed to fetch day details');
        const data: unknown = await res.json();
        setDay(data as DayDetail);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };
    void fetchDay();
  }, [date]);

  return { day, loading, error };
}

export function useStats() {
  const [stats, setStats] = useState<Stats | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/stats');
      if (res.ok) {
        const data: unknown = await res.json();
        setStats(data as Stats);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);
  return { stats, refetch: fetchStats };
}

export function useRefresh() {
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await fetch('/api/refresh', { method: 'POST' });
    } finally {
      setRefreshing(false);
    }
  };

  return { refresh, refreshing };
}
