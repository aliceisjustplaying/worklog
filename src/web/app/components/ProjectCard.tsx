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
}

export default function ProjectCard({ project }: Props) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden mb-6">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-6 bg-gray-50/50 hover:bg-gray-50 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
            <Folder size={20} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-800">{project.name}</h3>
            <p className="text-xs text-slate-500 font-mono mt-0.5">{project.path}</p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-slate-500">
          <span className="text-sm font-medium">{project.sessions.length} sessions</span>
          {expanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </div>
      </button>

      {expanded && (
        <div className="p-6 pt-2">
          <div className="mt-6 ml-2">
            {project.sessions.map((session) => (
              <SessionItem key={session.sessionId} session={session} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
