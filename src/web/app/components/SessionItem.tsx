import React from 'react';
import { Clock, FileCode, Wrench } from 'lucide-react';

interface SessionDetail {
  sessionId: string;
  startTime: string;
  endTime: string;
  shortSummary: string;
  accomplishments: string[];
  filesChanged: string[];
  toolsUsed: string[];
}

interface Props {
  session: SessionDetail;
}

export default function SessionItem({ session }: Props) {
  const start = new Date(session.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const end = new Date(session.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const duration = Math.round((new Date(session.endTime).getTime() - new Date(session.startTime).getTime()) / 60000);

  return (
    <div className="pl-4 border-l-2 border-gray-100 pb-3 last:pb-0 relative">
      <div className="absolute -left-[5px] top-0 w-2 h-2 rounded-full bg-blue-300" />

      <div className="flex items-center gap-2 mb-1">
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <Clock size={12} />
          <span>{start} - {end}</span>
          <span className="px-1 py-0.5 rounded bg-gray-100 text-xs text-gray-600">{duration}m</span>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-100 p-3 shadow-sm">
        <p className="text-slate-800 font-medium text-sm mb-2">{session.shortSummary}</p>

        {session.accomplishments.length > 0 && (
          <ul className="space-y-1 mb-2">
            {session.accomplishments.map((acc, i) => (
              <li key={i} className="flex items-start gap-1.5 text-slate-600 text-xs">
                <span className="mt-1 w-1 h-1 rounded-full bg-blue-400 shrink-0" />
                <span>{acc}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap gap-3 mt-2 pt-2 border-t border-gray-50">
          {session.filesChanged.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                <FileCode size={12} /> Files
              </span>
              <div className="flex flex-wrap gap-1.5">
                {session.filesChanged.slice(0, 5).map((f, i) => (
                  <span key={i} className="text-xs px-2 py-1 bg-slate-50 text-slate-600 rounded border border-slate-100 font-mono">
                    {f.split('/').pop()}
                  </span>
                ))}
                {session.filesChanged.length > 5 && (
                  <span className="text-xs px-2 py-1 text-slate-400">+{session.filesChanged.length - 5} more</span>
                )}
              </div>
            </div>
          )}

          {session.toolsUsed.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                <Wrench size={12} /> Tools
              </span>
              <div className="flex flex-wrap gap-1.5">
                {session.toolsUsed.map((t, i) => (
                  <span key={i} className="text-xs px-2 py-1 bg-orange-50 text-orange-700 rounded border border-orange-100">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
