'use client';

interface RootCauseAnalysisProps {
  summary: string;
  causes: any[];
}

export default function RootCauseAnalysis({ summary, causes }: RootCauseAnalysisProps) {
  if (!summary) {
    return (
      <div className="text-slate-400 dark:text-slate-500 text-sm">
        Analyzing root causes...
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-700 dark:text-slate-300">{summary}</p>
      {causes && causes.length > 0 && (
        <div className="space-y-1 mt-2">
          {causes.slice(0, 3).map((cause, idx) => (
            <div key={idx} className="flex items-center gap-2 text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 dark:bg-red-500" />
              <span className="text-slate-600 dark:text-slate-400">
                {cause.category.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}
                : {cause.cause}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}