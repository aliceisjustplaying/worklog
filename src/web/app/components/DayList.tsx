import React from 'react';
import { Link } from 'react-router-dom';
import { Calendar, ChevronRight, Layers, Clock } from 'lucide-react';
import { useDays } from '../hooks/useWorklog';

export default function DayList() {
  const { days, loading, error } = useDays();

  if (loading) return <div className="text-center py-20 text-slate-400">Loading your history...</div>;
  if (error) return <div className="text-center py-20 text-red-500">Error: {error}</div>;

  if (days.length === 0) {
    return (
      <div className="text-center py-20">
        <Calendar size={48} className="mx-auto text-slate-300 mb-4" />
        <h2 className="text-xl font-semibold text-slate-600 mb-2">No sessions yet</h2>
        <p className="text-slate-400">Run <code className="bg-slate-100 px-2 py-1 rounded">bun cli process</code> to process your Claude Code sessions.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h2 className="text-2xl font-bold text-slate-800 mb-6">Session History</h2>
      <div className="grid gap-4">
        {days.map((day) => (
          <Link
            key={day.date}
            to={`/day/${day.date}`}
            className="block group"
          >
            <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm hover:shadow-md hover:border-blue-200 transition-all flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="bg-blue-50 text-blue-600 p-3 rounded-lg group-hover:bg-blue-600 group-hover:text-white transition-colors">
                  <Calendar size={24} />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-800">
                    {new Date(day.date).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                  </h3>
                  <div className="flex items-center gap-4 mt-1 text-sm text-slate-500">
                    <div className="flex items-center gap-1.5">
                      <Layers size={14} />
                      <span>{day.projectCount} Projects</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock size={14} />
                      <span>{day.sessionCount} Sessions</span>
                    </div>
                  </div>
                </div>
              </div>

              <ChevronRight className="text-gray-300 group-hover:text-blue-500 transition-colors" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
