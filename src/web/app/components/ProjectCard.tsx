import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Folder } from 'lucide-react';
import SessionItem from './SessionItem';

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
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 bg-gray-50/50 hover:bg-gray-50 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-blue-100 text-blue-600 rounded">
            <Folder size={16} />
          </div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-slate-800">{project.name}</h3>
            {isNew && (
              <span className="px-1.5 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded">NEW</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 text-slate-500">
          <span className="text-xs font-medium">{project.sessions.length} sessions</span>
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3">
          <div className="mt-2 ml-1">
            {project.sessions.map((session) => (
              <SessionItem key={session.sessionId} session={session} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
