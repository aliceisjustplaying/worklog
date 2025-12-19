import React, { useMemo } from 'react';
import { Folder, FileCode } from 'lucide-react';

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

interface Props {
  project: ProjectDetail;
  isNew?: boolean;
}

export default function ProjectCard({ project, isNew }: Props) {
  const aggregated = useMemo(() => {
    const allAccomplishments: string[] = [];
    const allFiles = new Set<string>();

    for (const session of project.sessions) {
      allAccomplishments.push(...session.accomplishments);
      session.filesChanged.forEach((f) => allFiles.add(f));
    }

    // Dedupe accomplishments (rough - exact match only)
    const uniqueAccomplishments = [...new Set(allAccomplishments)];

    return {
      accomplishments: uniqueAccomplishments,
      files: [...allFiles],
    };
  }, [project.sessions]);

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden p-3">
      <div className="flex items-center gap-2 mb-2">
        <div className="p-1.5 bg-blue-100 text-blue-600 rounded">
          <Folder size={16} />
        </div>
        <h3 className="text-sm font-bold text-slate-800">{project.name}</h3>
        {isNew && (
          <span className="px-1.5 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded">NEW</span>
        )}
      </div>

      {aggregated.accomplishments.length > 0 && (
        <ul className="space-y-1 mb-3">
          {aggregated.accomplishments.map((acc, i) => (
            <li key={i} className="flex items-start gap-1.5 text-slate-600 text-sm">
              <span className="mt-1.5 w-1 h-1 rounded-full bg-blue-400 shrink-0" />
              <span>{acc}</span>
            </li>
          ))}
        </ul>
      )}

      {aggregated.files.length > 0 && (
        <div className="pt-2 border-t border-gray-100">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1 mb-1.5">
            <FileCode size={12} /> Files
          </span>
          <div className="flex flex-wrap gap-1.5">
            {aggregated.files.slice(0, 8).map((f, i) => (
              <span key={i} className="text-xs px-2 py-1 bg-slate-50 text-slate-600 rounded border border-slate-100 font-mono">
                {f.split('/').pop()}
              </span>
            ))}
            {aggregated.files.length > 8 && (
              <span className="text-xs px-2 py-1 text-slate-400">+{aggregated.files.length - 8} more</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
