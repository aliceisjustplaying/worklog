import React from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Activity, Calendar, Folder } from 'lucide-react';
import { useStats, useRefresh } from '../hooks/useWorklog';

export default function Layout({ children }: { children: React.ReactNode }) {
  const { stats, refetch: refetchStats } = useStats();
  const { refresh, refreshing } = useRefresh();

  const handleRefresh = () => {
    void refresh()
      .then(() => {
        void refetchStats();
        window.location.reload();
      })
      .catch((err: unknown) => {
        console.error('Refresh failed:', err);
      });
  };

  return (
    <div className="min-h-screen bg-gray-50 text-slate-900 font-sans">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10 bg-opacity-90 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 group">
            <div className="bg-blue-600 p-1.5 rounded-lg text-white group-hover:bg-blue-700 transition-colors">
              <Calendar size={20} />
            </div>
            <span className="font-bold text-xl tracking-tight text-slate-800">WorkLog</span>
          </Link>

          <div className="flex items-center gap-6">
            <Link
              to="/projects"
              className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-blue-600 transition-colors"
            >
              <Folder size={16} />
              <span className="hidden sm:inline">Projects</span>
            </Link>

            {stats !== null && (
              <div className="hidden sm:flex gap-4 text-sm text-slate-500">
                <div className="flex items-center gap-1.5">
                  <Activity size={16} className="text-blue-500" />
                  <span className="font-medium text-slate-700">{String(stats.totalSessions)}</span> sessions
                </div>
                <div className="flex items-center gap-1.5">
                  <Calendar size={16} className="text-blue-500" />
                  <span className="font-medium text-slate-700">{String(stats.totalDays)}</span> days
                </div>
              </div>
            )}

            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className={`p-2 rounded-full hover:bg-gray-100 text-slate-500 transition-all ${
                refreshing ? 'animate-spin text-blue-600 bg-blue-50' : ''
              }`}
              title="Refresh Data"
            >
              <RefreshCw size={20} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        {children}
      </main>
    </div>
  );
}
