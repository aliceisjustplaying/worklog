import React, { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useDayDetail } from '../hooks/useWorklog';
import BragSummary from './BragSummary';
import ProjectCard from './ProjectCard';

// Parse brag summary to extract isNew flags by project name
function parseNewProjects(bragSummary: string | undefined): Set<string> {
  if (!bragSummary) return new Set();
  try {
    const parsed = JSON.parse(bragSummary);
    if (parsed.projects && Array.isArray(parsed.projects)) {
      return new Set(
        parsed.projects
          .filter((p: { isNew?: boolean }) => p.isNew)
          .map((p: { name: string }) => p.name)
      );
    }
  } catch {}
  return new Set();
}

export default function DayView() {
  const { date } = useParams<{ date: string }>();
  const { day, loading, error } = useDayDetail(date);

  const newProjects = useMemo(
    () => parseNewProjects(day?.bragSummary),
    [day?.bragSummary]
  );

  if (loading) return <div className="text-center py-20 text-slate-400">Loading day details...</div>;
  if (error || !day) return <div className="text-center py-20 text-red-500">Error: {error || 'Day not found'}</div>;

  const formattedDate = new Date(day.date).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  return (
    <div>
      <div className="mb-4">
        <Link to="/" className="inline-flex items-center text-sm text-slate-500 hover:text-blue-600 mb-2 transition-colors">
          <ArrowLeft size={16} className="mr-1" />
          Back
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">{formattedDate}</h1>
      </div>

      {day.bragSummary && <BragSummary summary={day.bragSummary} />}

      <div className="space-y-3">
        {day.projects.map((project) => (
          <ProjectCard key={project.path} project={project} isNew={newProjects.has(project.name)} />
        ))}
      </div>
    </div>
  );
}
