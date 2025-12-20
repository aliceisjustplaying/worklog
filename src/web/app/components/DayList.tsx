import React from 'react';
import { Link } from 'react-router-dom';
import { Calendar, ChevronRight, Layers, Clock } from 'lucide-react';
import { useDays } from '../hooks/useWorklog';
import type { DayListItem } from '../../../types';

// Get ISO week number
function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

// Get week start date for display
function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday start
  return new Date(d.setDate(diff));
}

interface GroupedDays {
  month: string;
  monthKey: string;
  weeks: {
    weekKey: string;
    weekLabel: string;
    days: DayListItem[];
  }[];
}

function groupDaysByMonthAndWeek(days: DayListItem[]): GroupedDays[] {
  const today = new Date();
  const thisWeek = getWeekNumber(today);
  const thisYear = today.getFullYear();
  const thisMonth = today.getMonth();

  const grouped = new Map<string, Map<string, DayListItem[]>>();

  for (const day of days) {
    const date = new Date(day.date + 'T12:00:00'); // Noon to avoid timezone issues
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const weekNum = getWeekNumber(date);
    const weekKey = `${date.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;

    if (!grouped.has(monthKey)) {
      grouped.set(monthKey, new Map());
    }
    const monthMap = grouped.get(monthKey)!;
    if (!monthMap.has(weekKey)) {
      monthMap.set(weekKey, []);
    }
    monthMap.get(weekKey)!.push(day);
  }

  const result: GroupedDays[] = [];

  for (const [monthKey, weekMap] of grouped) {
    const [year, month] = monthKey.split('-').map(Number);
    const monthDate = new Date(year, month - 1, 1);
    const isCurrentMonth = year === thisYear && month - 1 === thisMonth;
    const monthLabel = isCurrentMonth
      ? 'This Month'
      : monthDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

    const weeks: GroupedDays['weeks'] = [];

    for (const [weekKey, weekDays] of weekMap) {
      const [weekYear, weekStr] = weekKey.split('-W');
      const weekNum = parseInt(weekStr);
      const isCurrentWeek = parseInt(weekYear) === thisYear && weekNum === thisWeek;
      const isLastWeek = parseInt(weekYear) === thisYear && weekNum === thisWeek - 1;

      let weekLabel: string;
      if (isCurrentWeek) {
        weekLabel = 'This Week';
      } else if (isLastWeek) {
        weekLabel = 'Last Week';
      } else {
        const firstDay = weekDays[weekDays.length - 1]; // Last in sorted order = earliest
        const weekStart = getWeekStart(new Date(firstDay.date + 'T12:00:00'));
        weekLabel = `Week of ${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
      }

      weeks.push({ weekKey, weekLabel, days: weekDays });
    }

    result.push({ month: monthLabel, monthKey, weeks });
  }

  return result;
}

function DayCard({ day }: { day: DayListItem }) {
  const date = new Date(day.date + 'T12:00:00');
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const isToday = day.date === today.toISOString().split('T')[0];
  const isYesterday = day.date === yesterday.toISOString().split('T')[0];

  let dateLabel: string;
  if (isToday) {
    dateLabel = 'Today';
  } else if (isYesterday) {
    dateLabel = 'Yesterday';
  } else {
    dateLabel = date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
  }

  return (
    <Link to={`/day/${day.date}`} className="block group">
      <div className="bg-white rounded-lg p-3 border border-gray-200 shadow-sm hover:shadow-md hover:border-blue-200 transition-all flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-md transition-colors ${
            isToday
              ? 'bg-blue-600 text-white'
              : 'bg-blue-50 text-blue-600 group-hover:bg-blue-600 group-hover:text-white'
          }`}>
            <Calendar size={18} />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-800">{dateLabel}</h3>
            <div className="flex items-center gap-3 text-xs text-slate-500">
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
  );
}

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

  const grouped = groupDaysByMonthAndWeek(days);

  return (
    <div className="max-w-3xl mx-auto">
      <h2 className="text-xl font-bold text-slate-800 mb-4">Session History</h2>
      <div className="space-y-6">
        {grouped.map((monthGroup) => (
          <div key={monthGroup.monthKey}>
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3 px-1">
              {monthGroup.month}
            </h3>
            <div className="space-y-4">
              {monthGroup.weeks.map((weekGroup) => (
                <div key={weekGroup.weekKey}>
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <div className="h-px bg-slate-200 flex-1" />
                    <span className="text-xs text-slate-400 font-medium">{weekGroup.weekLabel}</span>
                    <div className="h-px bg-slate-200 flex-1" />
                  </div>
                  <div className="grid gap-2">
                    {weekGroup.days.map((day) => (
                      <DayCard key={day.date} day={day} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
