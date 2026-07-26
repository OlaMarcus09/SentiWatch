'use client';

import { CATEGORY_COLORS } from '@/lib/constants';

interface CategoryHeatmapProps {
  breakdown: Record<string, number>;
  activeCategory?: string | null;
  onCategoryClick?: (category: string | null) => void;
}

export default function CategoryHeatmap({ breakdown, activeCategory, onCategoryClick }: CategoryHeatmapProps) {
  if (!breakdown || Object.keys(breakdown).length === 0) {
    return (
      <div className="text-center text-slate-400 text-sm py-4">
        No category data available yet.
      </div>
    );
  }

  const sorted = Object.entries(breakdown).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((sum, [, count]) => sum + count, 0);

  return (
    <div className="space-y-2">
      {sorted.map(([category, count]) => {
        const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
        const color = CATEGORY_COLORS[category as keyof typeof CATEGORY_COLORS] || '#6B7280';
        const label = category.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
        const isActive = activeCategory === category;
        const isClickable = !!onCategoryClick;

        return (
          <button
            key={category}
            type="button"
            onClick={() => onCategoryClick?.(isActive ? null : category)}
            disabled={!isClickable}
            className={`w-full flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors text-left ${
              isClickable ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50' : ''
            } ${
              isActive
                ? 'bg-blue-50 dark:bg-blue-900/20 ring-1 ring-blue-300 dark:ring-blue-700'
                : ''
            } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-default`}
          >
            <div className="w-24 text-xs font-medium text-slate-600 dark:text-slate-400 truncate" title={label}>
              {label}
            </div>
            <div className="flex-1 h-2.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${percentage}%`, backgroundColor: color }}
              />
            </div>
            <div className="w-12 text-xs font-mono text-slate-500 dark:text-slate-400 text-right">
              {count}
            </div>
          </button>
        );
      })}
    </div>
  );
}
