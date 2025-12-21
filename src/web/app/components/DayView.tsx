import { ArrowLeft } from 'lucide-react';
import React, { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useDayDetail } from '../hooks/useWorklog';
import BragSummary from './BragSummary';
import ProjectCard from './ProjectCard';

interface ParsedProject {
  name: string;
  isNew?: boolean;
}

interface ParsedBragSummary {
  projects: ParsedProject[];
}

// Parse brag summary to extract isNew flags by project name
function parseNewProjects(bragSummary: string | undefined): Set<string> {
  if (bragSummary === undefined) return new Set();
  try {
    const parsed = JSON.parse(bragSummary) as unknown;
    if (typeof parsed === 'object' && parsed !== null && 'projects' in parsed && Array.isArray(parsed.projects)) {
      const typedParsed = parsed as ParsedBragSummary;
      const names: string[] = [];
      for (const p of typedParsed.projects) {
        if (p.isNew === true) {
          names.push(p.name);
        }
      }
      return new Set(names);
    }
  } catch {
    // JSON parsing failed, return empty set
  }
  return new Set();
}

export default function DayView() {
  const { date } = useParams<{ date: string }>();
  const { day, loading, error } = useDayDetail(date);

  const newProjects = useMemo(() => parseNewProjects(day?.bragSummary), [day?.bragSummary]);

  if (loading) return <div className="text-center py-20 text-slate-400">Loading day details...</div>;
  if (error !== null) return <div className="text-center py-20 text-red-500">Error: {error}</div>;
  if (day === null) return <div className="text-center py-20 text-red-500">Error: Day not found</div>;

  const formattedDate = new Date(day.date).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div>
      <div className="mb-4">
        <Link
          to="/"
          className="inline-flex items-center text-sm text-slate-500 hover:text-blue-600 mb-2 transition-colors"
        >
          <ArrowLeft size={16} className="mr-1" />
          Back
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">{formattedDate}</h1>
      </div>

      {day.bragSummary !== undefined && day.bragSummary.length > 0 && <BragSummary summary={day.bragSummary} />}

      <div className="space-y-3">
        {day.projects.map((project) => (
          <ProjectCard key={project.path} project={project} isNew={newProjects.has(project.name)} />
        ))}
      </div>
    </div>
  );
}
