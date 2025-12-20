import React, { useState } from 'react';
import { Folder, Ship, Construction, Archive, Beaker, Zap, Clock, ChevronDown, Rocket, EyeOff } from 'lucide-react';
import { useProjects, useUpdateProjectStatus } from '../hooks/useProjects';
import type { ProjectStatus, ProjectListItem } from '../../../types';

const STATUS_CONFIG: Record<ProjectStatus, { icon: React.ElementType; color: string; bgColor: string; label: string }> = {
  shipped: { icon: Ship, color: 'text-green-600', bgColor: 'bg-green-50', label: 'Shipped' },
  in_progress: { icon: Construction, color: 'text-blue-600', bgColor: 'bg-blue-50', label: 'In Progress' },
  ready_to_ship: { icon: Rocket, color: 'text-teal-600', bgColor: 'bg-teal-50', label: 'Ready to Ship' },
  abandoned: { icon: Archive, color: 'text-gray-500', bgColor: 'bg-gray-100', label: 'Abandoned' },
  ignore: { icon: EyeOff, color: 'text-slate-400', bgColor: 'bg-slate-100', label: 'Ignore' },
  one_off: { icon: Zap, color: 'text-amber-600', bgColor: 'bg-amber-50', label: 'One-off' },
  experiment: { icon: Beaker, color: 'text-purple-600', bgColor: 'bg-purple-50', label: 'Experiment' },
};

const ALL_STATUSES: ProjectStatus[] = ['shipped', 'in_progress', 'ready_to_ship', 'abandoned', 'ignore', 'one_off', 'experiment'];

function StatusBadge({
  status,
  onClick,
  showDropdown,
  onSelect,
  onClose,
}: {
  status: ProjectStatus;
  onClick: () => void;
  showDropdown: boolean;
  onSelect: (status: ProjectStatus) => void;
  onClose: () => void;
}) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  return (
    <div className="relative">
      <button
        onClick={onClick}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all hover:ring-2 hover:ring-offset-1 hover:ring-gray-300 ${config.bgColor} ${config.color}`}
      >
        <Icon size={14} />
        {config.label}
        <ChevronDown size={12} className="opacity-50" />
      </button>

      {showDropdown && (
        <>
          <div className="fixed inset-0 z-10" onClick={onClose} />
          <div className="absolute right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1 min-w-[140px]">
            {ALL_STATUSES.map((s) => {
              const cfg = STATUS_CONFIG[s];
              const ItemIcon = cfg.icon;
              return (
                <button
                  key={s}
                  onClick={() => onSelect(s)}
                  className={`w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 hover:bg-gray-50 ${
                    s === status ? 'bg-gray-50' : ''
                  }`}
                >
                  <ItemIcon size={14} className={cfg.color} />
                  <span>{cfg.label}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function ProjectRow({ project, onStatusChange }: { project: ProjectListItem; onStatusChange: () => void }) {
  const [showDropdown, setShowDropdown] = useState(false);
  const { updateStatus } = useUpdateProjectStatus();

  const handleStatusSelect = async (newStatus: ProjectStatus) => {
    setShowDropdown(false);
    if (newStatus !== project.status) {
      await updateStatus(project.path, newStatus);
      onStatusChange();
    }
  };

  const isStale = project.status === 'in_progress' && project.daysSinceLastSession > 30;

  return (
    <div className="bg-white rounded-lg p-3 border border-gray-200 shadow-sm flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="p-2 bg-slate-100 text-slate-600 rounded-md flex-shrink-0">
          <Folder size={18} />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-800 truncate">{project.name}</h3>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>{project.totalSessions} sessions</span>
            <span className="text-slate-300">|</span>
            <span className={`flex items-center gap-1 ${isStale ? 'text-amber-600' : ''}`}>
              {isStale && <Clock size={12} />}
              {project.daysSinceLastSession === 0 ? 'Today' : `${project.daysSinceLastSession}d ago`}
            </span>
          </div>
        </div>
      </div>

      <StatusBadge
        status={project.status}
        onClick={() => setShowDropdown(!showDropdown)}
        showDropdown={showDropdown}
        onSelect={handleStatusSelect}
        onClose={() => setShowDropdown(false)}
      />
    </div>
  );
}

type FilterStatus = ProjectStatus | 'all';

export default function ProjectList() {
  const [filter, setFilter] = useState<FilterStatus>('all');
  const { projects: allProjects, loading, error, refetch } = useProjects();

  // Filter locally instead of via API to keep counts in sync
  const projects = filter === 'all'
    ? allProjects
    : allProjects.filter((p) => p.status === filter);

  const counts = ALL_STATUSES.reduce((acc, s) => {
    acc[s] = allProjects.filter((p) => p.status === s).length;
    return acc;
  }, {} as Record<ProjectStatus, number>);

  const staleCount = allProjects.filter(
    (p) => p.status === 'in_progress' && p.daysSinceLastSession > 30
  ).length;

  if (loading && projects.length === 0) {
    return <div className="text-center py-20 text-slate-400">Loading projects...</div>;
  }

  if (error) {
    return <div className="text-center py-20 text-red-500">Error: {error}</div>;
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-slate-800">Projects</h2>
        <span className="text-sm text-slate-500">{allProjects.length} total</span>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-1 mb-4 p-1 bg-gray-100 rounded-lg">
        <FilterTab
          label="All"
          count={allProjects.length}
          isActive={filter === 'all'}
          onClick={() => setFilter('all')}
        />
        {ALL_STATUSES.map((s) => (
          <FilterTab
            key={s}
            label={STATUS_CONFIG[s].label}
            count={counts[s]}
            isActive={filter === s}
            onClick={() => setFilter(s)}
          />
        ))}
      </div>

      {/* Stale projects callout */}
      {staleCount > 0 && filter !== 'shipped' && filter !== 'ready_to_ship' && filter !== 'abandoned' && filter !== 'ignore' && filter !== 'one_off' && filter !== 'experiment' && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          <strong>{staleCount} project{staleCount > 1 ? 's' : ''}</strong> marked "In Progress" but untouched for 30+ days.
        </div>
      )}

      {projects.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          No projects with this status
        </div>
      ) : (
        <div className="space-y-2">
          {projects.map((project) => (
            <ProjectRow key={project.path} project={project} onStatusChange={refetch} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterTab({
  label,
  count,
  isActive,
  onClick,
}: {
  label: string;
  count: number;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-sm rounded-md transition-all ${
        isActive
          ? 'bg-white shadow text-slate-800 font-medium'
          : 'text-slate-600 hover:bg-gray-200'
      }`}
    >
      {label}
      {count > 0 && (
        <span className={`ml-1.5 ${isActive ? 'text-slate-500' : 'text-slate-400'}`}>
          {count}
        </span>
      )}
    </button>
  );
}
