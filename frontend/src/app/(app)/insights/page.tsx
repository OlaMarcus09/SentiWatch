'use client';
/* eslint-disable @typescript-eslint/no-explicit-any -- provider metadata varies by source. */

import { useState } from 'react';
import { useDashboard } from '@/components/providers/DashboardProvider';
import SentimentChart from '@/components/SentimentChart';
import CategoryHeatmap from '@/components/CategoryHeatmap';
import MentionFeed from '@/components/dashboard/MentionFeed';
import CompetitorComparisonMatrix from '@/components/dashboard/CompetitorComparisonMatrix';
import Card from '@/components/ui/Card';

type SentimentFilter = 'all' | 'positive' | 'neutral' | 'negative';

const filters: { label: string; value: SentimentFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Positive', value: 'positive' },
  { label: 'Neutral', value: 'neutral' },
  { label: 'Negative', value: 'negative' },
];

export default function InsightsPage() {
  const {
    positive,
    neutral,
    unanalyzed,
    negative,
    categoryBreakdown,
    mentions,
    competitorsData,
    currentEntity,
    finalRiskScore,
  } = useDashboard();

  const [sentimentFilter, setSentimentFilter] = useState<SentimentFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  const filteredMentions = mentions.filter((m: any) => {
    const label = m.sentiment_results?.[0]?.label || 'neutral';
    const category = m.sentiment_results?.[0]?.category || 'general';

    if (sentimentFilter !== 'all' && label !== sentimentFilter) return false;
    if (categoryFilter && category !== categoryFilter) return false;
    return true;
  });

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card hover={false}>
          <h3 className="text-sm font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-4">
            Sentiment Breakdown
          </h3>
          <SentimentChart positive={positive} neutral={neutral} negative={negative} />
          {unanalyzed > 0 && (
            <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
              {unanalyzed} mention{unanalyzed === 1 ? '' : 's'} still awaiting sentiment analysis.
            </p>
          )}
        </Card>
        <Card hover={false}>
          <h3 className="text-sm font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-4">
            Category Breakdown
          </h3>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 -mt-3 mb-3">
            Click a category to filter the mention feed below
          </p>
          <CategoryHeatmap
            breakdown={categoryBreakdown}
            activeCategory={categoryFilter}
            onCategoryClick={setCategoryFilter}
          />
        </Card>
      </div>

      {/* Sentiment filter pills */}
      <div className="flex items-center gap-2 mt-6 mb-2 flex-wrap" role="group" aria-label="Filter mentions by sentiment">
        {filters.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setSentimentFilter(f.value)}
            aria-pressed={sentimentFilter === f.value}
            className={`px-3 py-1.5 text-xs font-semibold rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              sentimentFilter === f.value
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            {f.label}
          </button>
        ))}
        {categoryFilter && (
          <button
            type="button"
            onClick={() => setCategoryFilter(null)}
            className="px-3 py-1.5 text-xs font-semibold rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
          >
            {categoryFilter.replace(/_/g, ' ')} &times;
          </button>
        )}
      </div>

      <MentionFeed mentions={filteredMentions} />

      {/* Competitor Intelligence */}
      {competitorsData.length > 0 && currentEntity && (
        <div className="mt-6">
          <CompetitorComparisonMatrix
            primaryEntity={currentEntity}
            primaryRiskScore={finalRiskScore}
            competitors={competitorsData}
          />
        </div>
      )}
    </>
  );
}
