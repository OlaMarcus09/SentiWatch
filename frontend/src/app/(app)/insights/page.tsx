'use client';
/* eslint-disable @typescript-eslint/no-explicit-any -- provider metadata varies by source. */

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Database, RefreshCw, ShieldCheck, Signal } from 'lucide-react';
import { useDashboard } from '@/components/providers/DashboardProvider';
import SentimentChart from '@/components/SentimentChart';
import { sourceLabel } from '@/lib/sourceLabels';
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
  freshness: { status: 'fresh' | 'aging' | 'mixed' | 'stale' | 'no_data'; latest_at: string | null; stale_sources: number; total_sources: number };
  sources: { source: string; collected: number; analyzed: number; pending: number; latest_at: string | null; freshness_status: 'fresh' | 'aging' | 'stale' | 'no_data'; age_hours: number | null }[];
  truncated: boolean;
}

function formatEvidenceAge(ageHours: number | null) {
  if (ageHours === null) return 'No evidence yet';
  if (ageHours < 1) return 'Updated within the hour';
  if (ageHours < 24) return `Updated ${ageHours}h ago`;
  const days = Math.floor(ageHours / 24);
  return `Updated ${days}d ago`;
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
  const [trustRefreshKey, setTrustRefreshKey] = useState(0);
  const [analysisStarting, setAnalysisStarting] = useState(false);
  const [analysisMessage, setAnalysisMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!currentEntity?.id || !userToken) return;
    let active = true;
    queueMicrotask(() => { if (active) setTrustLoading(true); });
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/entities/${currentEntity.id}/trust`, {
      headers: { Authorization: `Bearer ${userToken}` },
    })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Trust summary failed')))
      .then((payload) => { if (active) setTrust(payload); })
      .catch(() => { if (active) setTrust(null); })
      .finally(() => { if (active) setTrustLoading(false); });
    return () => { active = false; };
  }, [currentEntity?.id, userToken, mentions.length, trustRefreshKey]);

  useEffect(() => {
    if (trust?.latest_pipeline?.status !== 'running') return;
    const timer = window.setInterval(() => setTrustRefreshKey((key) => key + 1), 5000);
    return () => window.clearInterval(timer);
  }, [trust?.latest_pipeline?.status]);

  const runAnalysisNow = async () => {
    if (!currentEntity?.id || !userToken || analysisStarting) return;
    setAnalysisStarting(true);
    setAnalysisMessage(null);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/entities/${currentEntity.id}/analyze`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${userToken}` },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || 'Could not start analysis');
      setAnalysisMessage(payload.scheduled
        ? 'Analysis started. Coverage will update as evidence is processed.'
        : 'Analysis is already running for this profile.');
      setTrust((current) => current ? {
        ...current,
        latest_pipeline: payload.pipeline_run || current.latest_pipeline,
      } : current);
      setTrustRefreshKey((key) => key + 1);
    } catch (error) {
      setAnalysisMessage(error instanceof Error ? error.message : 'Could not start analysis.');
    } finally {
      setAnalysisStarting(false);
    }
  };

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
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={runAnalysisNow}
              disabled={analysisStarting || trust?.latest_pipeline?.status === 'running'}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-950/70"
            >
              <RefreshCw className={`h-4 w-4 ${analysisStarting || trust?.latest_pipeline?.status === 'running' ? 'animate-spin' : ''}`} />
              {analysisStarting ? 'Starting…' : trust?.latest_pipeline?.status === 'running' ? 'Analysis running' : 'Run analysis now'}
            </button>
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
        </div>

        {analysisMessage && (
          <p role="status" className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300">
            {analysisMessage}
          </p>
        )}

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
            <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${
              trust.freshness.status === 'fresh'
                ? 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/60 dark:bg-emerald-950/20'
                : trust.freshness.status === 'stale' || trust.freshness.status === 'no_data'
                  ? 'border-red-200 bg-red-50/70 dark:border-red-900/60 dark:bg-red-950/20'
                  : 'border-amber-200 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/20'
            }`}>
              <Signal className={`mt-0.5 h-4 w-4 shrink-0 ${
                trust.freshness.status === 'fresh' ? 'text-emerald-600' :
                trust.freshness.status === 'stale' || trust.freshness.status === 'no_data' ? 'text-red-600' : 'text-amber-600'
              }`} />
              <div>
                <p className="text-xs font-semibold capitalize text-slate-800 dark:text-slate-100">
                  Source freshness: {trust.freshness.status.replace('_', ' ')}
                </p>
                <p className="mt-0.5 text-xs leading-5 text-slate-600 dark:text-slate-400">
                  {trust.freshness.latest_at
                    ? `Latest evidence received ${new Date(trust.freshness.latest_at).toLocaleString()}.`
                    : 'No source has supplied evidence yet.'}
                  {trust.freshness.stale_sources > 0 && ` ${trust.freshness.stale_sources} of ${trust.freshness.total_sources} sources are older than 72 hours.`}
                </p>
              </div>
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
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {trust.sources.slice(0, 6).map((source) => (
                <div key={source.source} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900/50">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-100">{sourceLabel(source.source)}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{source.analyzed}/{source.collected} analyzed · {formatEvidenceAge(source.age_hours)}</p>
                  </div>
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                    source.freshness_status === 'fresh' ? 'bg-emerald-500' :
                    source.freshness_status === 'aging' ? 'bg-amber-500' : 'bg-red-500'
                  }`} title={source.freshness_status.replace('_', ' ')} />
                </div>
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
