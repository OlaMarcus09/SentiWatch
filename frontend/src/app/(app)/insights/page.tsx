'use client';

import { useState } from 'react';
import { useDashboard } from '@/components/providers/DashboardProvider';
import SentimentChart from '@/components/SentimentChart';
import CategoryHeatmap from '@/components/CategoryHeatmap';
import MentionFeed from '@/components/dashboard/MentionFeed';
import Card from '@/components/ui/Card';

type SentimentFilter = 'all' | 'positive' | 'neutral' | 'negative';

const filters: { label: string; value: SentimentFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Positive', value: 'positive' },
  { label: 'Neutral', value: 'neutral' },
  { label: 'Negative', value: 'negative' },
];

export default function InsightsPage() {
  const { positive, neutral, negative, categoryBreakdown, mentions } = useDashboard();
  const [filter, setFilter] = useState<SentimentFilter>('all');

  const filteredMentions =
    filter === 'all'
      ? mentions
      : mentions.filter(
          (m: any) => (m.sentiment_results?.[0]?.label || 'neutral') === filter
        );

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card hover={false}>
          <h3 className="text-sm font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-4">
            Sentiment Breakdown
          </h3>
          <SentimentChart positive={positive} neutral={neutral} negative={negative} />
        </Card>
        <Card hover={false}>
          <h3 className="text-sm font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-4">
            Category Breakdown
          </h3>
          <CategoryHeatmap breakdown={categoryBreakdown} />
        </Card>
      </div>

      {/* Sentiment filter pills */}
      <div className="flex items-center gap-2 mt-6 mb-2" role="group" aria-label="Filter mentions by sentiment">
        {filters.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            aria-pressed={filter === f.value}
            className={`px-3 py-1.5 text-xs font-semibold rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              filter === f.value
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <MentionFeed mentions={filteredMentions} />
    </>
  );
}
