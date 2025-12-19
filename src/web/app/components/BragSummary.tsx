import React, { useState } from 'react';
import { Copy, Check, Sparkles } from 'lucide-react';

interface Props {
  summary: string;
}

export default function BragSummary({ summary }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!summary) return null;

  return (
    <div className="relative group rounded-2xl p-6 mb-8 bg-gradient-to-br from-indigo-50 to-blue-50 border border-indigo-100 shadow-sm">
      <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={handleCopy}
          className="p-2 rounded-lg bg-white/80 hover:bg-white text-indigo-600 shadow-sm transition-all"
          title="Copy to clipboard"
        >
          {copied ? <Check size={18} /> : <Copy size={18} />}
        </button>
      </div>

      <div className="flex items-start gap-3">
        <div className="mt-1 p-1.5 bg-indigo-100 text-indigo-600 rounded-md">
          <Sparkles size={20} />
        </div>
        <div className="prose prose-blue max-w-none">
          <h3 className="text-sm font-semibold text-indigo-900 uppercase tracking-wider mb-2">Daily Summary</h3>
          <p className="text-slate-700 leading-relaxed whitespace-pre-wrap">{summary}</p>
        </div>
      </div>
    </div>
  );
}
