'use client';
/* eslint-disable @typescript-eslint/no-explicit-any -- provider metadata varies by source. */

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Database, RefreshCw, ShieldCheck } from 'lucide-react';
import { useDashboard } from '@/components/providers/DashboardProvider';
import SentimentChart from '@/components/SentimentChart';
import CategoryHeatmap from '@/components/CategoryHeatmap';
import MentionFeed from '@/components/dashboard/MentionFeed';
import CompetitorComparisonMatrix from '@/components/dashboard/CompetitorComparisonMatrix';
import Card from '@/components/ui/Card';

type SentimentFilter = 'all' | 'positive' | 'neutral' | 'negative';

interface TrustSummary {
  coverage_status: 'verified' | 'partial' | 'degraded' | 'no_evidence';
  coverage_pct: number;
  counts: { collected: number; analyzed: number; pending: number; rejected: number; inconsistent: number };
  latest_pipeline: { status: string; stage: string; error_message?: string; started_at?: string; finished_at?: string } | null;
  sources: { source: string; collected: number; analyzed: number; pending: number; latest_at: string | null }[];
  truncated: boolean;
}

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
    userToken,
  } = useDashboard();

  const [sentimentFilter, setSentimentFilter] = useState<SentimentFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [trust, setTrust] = useState<TrustSummary | null>(null);
  const [trustLoading, setTrustLoading] = useState(false);

  useEffect(() => {
    if (!currentEntity?.id || !userToken) return;
    let active = true;
    setTrustLoading(true);
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/entities/${currentEntity.id}/trust`, {
      headers: { Authorization: `Bearer ${userToken}` },
    })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Trust summary failed')))
      .then((payload) => { if (active) setTrust(payload); })
      .catch(() => { if (active) setTrust(null); })
      .finally(() => { if (active) setTrustLoading(false); });
    return () => { active = false; };
  }, [currentEntity?.id, userToken, mentions.length]);

  const filteredMentions = mentions.filter((m: any) => {
    const label = m.sentiment_results?.[0]?.label || 'pending';
    const category = m.sentiment_results?.[0]?.category || 'general';

    if (sentimentFilter !== 'all' && label !== sentimentFilter) return false;
    if (categoryFilter && category !== categoryFilter) return false;
    return true;
  });

  return (
    <>
      <Card hover={false} className="p-4 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-blue-600" />
              <h2 className="font-semibold text-slate-900 dark:text-white">Data Trust Center</h2>
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
              Shows how much collected evidence has actually been analyzed before you trust the score.
            </p>
          </div>
          {trustLoading ? (
            <span className="inline-flex items-center gap-2 text-xs text-slate-500"><RefreshCw className="h-4 w-4 animate-spin" />Checking coverage…</span>
          ) : trust && (
            <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wide ${
              trust.coverage_status === 'verified' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' :
              trust.coverage_status === 'degraded' ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300' :
              'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
            }`}>
              {trust.coverage_status === 'verified' ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              {trust.coverage_status.replace('_', ' ')}
            </span>
          )}
        </div>

        {trust && (
          <div className="mt-5 space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: 'Collected', value: trust.counts.collected, Icon: Database },
                { label: 'Analyzed', value: trust.counts.analyzed, Icon: CheckCircle2 },
                { label: 'Pending', value: trust.counts.pending, Icon: Clock3 },
                { label: 'Coverage', value: `${trust.coverage_pct}%`, Icon: ShieldCheck },
              ].map(({ label, value, Icon }) => (
                <div key={label} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-900/60">
                  <Icon className="h-4 w-4 text-slate-400" />
                  <p className="mt-2 text-xl font-bold text-slate-900 dark:text-white">{value}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
                </div>
              ))}
            </div>
            {(trust.coverage_status !== 'verified' || trust.truncated) && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
                This score is based on partial evidence. Pending mentions are not counted as neutral and should not be read as a clean reputation signal.
              </div>
            )}
            {trust.latest_pipeline?.status === 'failed' && trust.latest_pipeline.error_message && (
              <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                Latest pipeline error: {trust.latest_pipeline.error_message}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {trust.sources.slice(0, 6).map((source) => (
                <span key={source.source} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {source.source}: {source.analyzed}/{source.collected} analyzed
                </span>
              ))}
            </div>
          </div>
        )}
      </Card>

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
