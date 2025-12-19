import React, { useState, useMemo } from 'react';
import { Copy, Check, Sparkles } from 'lucide-react';

interface Props {
  summary: string;
}

interface DailySummary {
  projects: { name: string; summary: string }[];
}

function parseSummary(summary: string): DailySummary | null {
  try {
    const parsed = JSON.parse(summary);
    if (parsed.projects && Array.isArray(parsed.projects)) {
      return parsed as DailySummary;
    }
  } catch {
    // Not JSON, return null
  }
  return null;
}

export default function BragSummary({ summary }: Props) {
  const [copied, setCopied] = useState(false);

  const parsed = useMemo(() => parseSummary(summary), [summary]);

  const handleCopy = () => {
    // Copy as readable text
    const text = parsed
      ? parsed.projects.map(p => `${p.name}: ${p.summary}`).join('\n')
      : summary;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!summary) return null;

  return (
    <div className="relative group rounded-lg p-4 mb-4 bg-gradient-to-br from-indigo-50 to-blue-50 border border-indigo-100 shadow-sm">
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={handleCopy}
          className="p-1.5 rounded bg-white/80 hover:bg-white text-indigo-600 shadow-sm transition-all"
          title="Copy to clipboard"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>

      <div className="flex items-start gap-2">
        <div className="p-1 bg-indigo-100 text-indigo-600 rounded shrink-0">
          <Sparkles size={16} />
        </div>
        <div className="min-w-0">
          <h3 className="text-xs font-semibold text-indigo-900 uppercase tracking-wider mb-2">Daily Summary</h3>
          {parsed ? (
            <ul className="space-y-1.5">
              {parsed.projects.map((project, i) => (
                <li key={i} className="text-sm">
                  <span className="font-semibold text-slate-800">{project.name}:</span>{' '}
                  <span className="text-slate-600">{project.summary}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-slate-700 text-sm leading-relaxed">{summary}</p>
          )}
        </div>
      </div>
    </div>
  );
}
