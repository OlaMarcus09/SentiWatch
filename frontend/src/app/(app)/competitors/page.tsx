'use client';

import { useEffect, useState } from 'react';
import { Users, Plus, Loader2, RefreshCw } from 'lucide-react';
import { useDashboard } from '@/components/providers/DashboardProvider';
import CompetitorComparisonMatrix from '@/components/dashboard/CompetitorComparisonMatrix';
import CompetitorMentionsModal from '@/components/dashboard/CompetitorMentionsModal';
import CompetitiveIntelligenceDashboard, {
  type ComparisonFilters,
  type CompetitiveEntity,
  type CompetitiveIntelligenceResponse,
} from '@/components/dashboard/CompetitiveIntelligenceDashboard';
import Card from '@/components/ui/Card';

export default function CompetitorsPage() {
  const { currentEntity, competitorsData, userToken, finalRiskScore, refreshCompetitors } = useDashboard();

  const [name, setName] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [windowDays, setWindowDays] = useState<7 | 30 | 90>(30);
  const [comparison, setComparison] = useState<CompetitiveIntelligenceResponse | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [analyzingEntityId, setAnalyzingEntityId] = useState<string | null>(null);
  const [analysisMessage, setAnalysisMessage] = useState<string | null>(null);
  const [evidenceView, setEvidenceView] = useState<{
    entity: CompetitiveEntity;
    filters: ComparisonFilters;
    title: string;
  } | null>(null);

  const competitorSignature = competitorsData.map((competitor) => competitor.id).sort().join(',');

  useEffect(() => {
    if (!currentEntity?.id) return;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      await refreshCompetitors();
      attempts += 1;
      if (attempts < 24) timer = setTimeout(poll, 5000);
    };
    poll();
    return () => { if (timer) clearTimeout(timer); };
  }, [currentEntity?.id, refreshCompetitors]);

  useEffect(() => {
    if (!currentEntity?.id || !userToken || !competitorSignature) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;

    const loadComparison = async (showLoading = false) => {
      if (showLoading) setComparisonLoading(true);
      setComparisonError(null);
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/entities/${currentEntity.id}/competitive-intelligence?window=${windowDays}`,
          { headers: { Authorization: `Bearer ${userToken}` } }
        );
        if (!response.ok) throw new Error(`Comparison request failed with ${response.status}`);
        const result = await response.json() as CompetitiveIntelligenceResponse;
        if (!cancelled) setComparison(result);
      } catch (loadError) {
        console.error(loadError);
        if (!cancelled) setComparisonError('Could not load the competitive evidence right now.');
      } finally {
        if (!cancelled) setComparisonLoading(false);
      }

      attempts += 1;
      if (!cancelled && attempts < 8) timer = setTimeout(() => loadComparison(false), 15000);
    };

    loadComparison(true);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [currentEntity?.id, userToken, competitorSignature, windowDays]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || !currentEntity?.id) return;

    setIsAdding(true);
    setError(null);
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/entities/${currentEntity.id}/competitors`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${userToken}`,
          },
          body: JSON.stringify({ name: trimmed }),
        }
      );

      if (!response.ok) throw new Error('Failed to add competitor');

      setName('');
      setSubmitted(true);
      await refreshCompetitors();
    } catch (err) {
      console.error(err);
      setError('Could not add competitor. Please try again.');
    } finally {
      setIsAdding(false);
    }
  };

  const handleAnalyze = async (entity: CompetitiveEntity) => {
    setAnalyzingEntityId(entity.id);
    setAnalysisMessage(null);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/entities/${entity.id}/analyze`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${userToken}` },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.detail || 'Could not start analysis');
      setAnalysisMessage(result.status === 'already_running'
        ? `${entity.name} is already being analyzed. We’ll refresh the comparison as it completes.`
        : `Analysis started for ${entity.name}. Pending mentions will move into the comparison when classification completes.`);
    } catch (analysisError) {
      console.error(analysisError);
      setAnalysisMessage(`We couldn’t start analysis for ${entity.name}. Try again in a moment.`);
    } finally {
      setAnalyzingEntityId(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card hover={false} className="p-6">
        <div className="flex items-start gap-3 mb-4">
          <Users aria-hidden="true" className="w-5 h-5 text-slate-400 dark:text-slate-500 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Track a competitor</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Link a competitor to {currentEntity?.name || 'this entity'} to see a side-by-side risk comparison. Analysis runs in the background and may take a minute to appear.
            </p>
          </div>
        </div>

        <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-3">
          <label htmlFor="competitor-name" className="sr-only">Competitor name</label>
          <input
            id="competitor-name"
            name="competitor-name"
            type="text"
            required
            autoComplete="off"
            value={name}
            onChange={(e) => { setName(e.target.value); setSubmitted(false); }}
            placeholder="e.g. PiggyVest…"
            className="flex-1 px-4 py-2.5 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-black dark:focus-visible:ring-blue-500 focus:border-transparent transition-colors placeholder:text-gray-400 dark:placeholder:text-slate-500"
          />
          <button
            type="submit"
            disabled={isAdding || !name.trim()}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-black dark:bg-blue-600 text-white text-sm font-medium hover:bg-gray-800 dark:hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black dark:focus-visible:ring-blue-500"
          >
            {isAdding ? (
              <>
                <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" />
                Adding…
              </>
            ) : (
              <>
                <Plus aria-hidden="true" className="w-4 h-4" />
                Add competitor
              </>
            )}
          </button>
        </form>

        {error && (
          <p role="alert" className="text-xs text-rose-600 dark:text-rose-400 mt-3">{error}</p>
        )}
        {submitted && !error && (
          <p role="status" className="text-xs text-emerald-600 dark:text-emerald-400 mt-3">
            Competitor added. Its risk analysis is now running in the background.
          </p>
        )}
      </Card>

      {competitorsData.length === 0 ? (
        <Card hover={false} className="text-center py-12">
          <Users aria-hidden="true" className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">No competitors tracked yet</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Add a competitor above to see a side-by-side risk comparison.
          </p>
        </Card>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-lg font-semibold text-slate-950 dark:text-white">Competitive intelligence</h1>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Compare market conversation, sentiment, risk, sources, and complaint themes using traceable mention evidence.
              </p>
            </div>
            <div className="inline-flex self-start rounded-xl border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-800" aria-label="Comparison window">
              {([7, 30, 90] as const).map((days) => (
                <button
                  type="button"
                  key={days}
                  onClick={() => setWindowDays(days)}
                  aria-pressed={windowDays === days}
                  className={`min-h-9 rounded-lg px-3 text-xs font-semibold transition-colors ${windowDays === days ? 'bg-slate-950 text-white dark:bg-blue-600' : 'text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700'}`}
                >
                  {days} days
                </button>
              ))}
            </div>
          </div>

          {analysisMessage && (
            <p role="status" className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300">
              {analysisMessage}
            </p>
          )}

          {comparisonLoading && !comparison ? (
            <Card hover={false} className="flex min-h-72 flex-col items-center justify-center gap-3 text-center">
              <Loader2 aria-hidden="true" className="h-7 w-7 animate-spin text-blue-600" />
              <div>
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Building the market comparison…</p>
                <p className="mt-1 text-xs text-slate-400">Aggregating traceable evidence for the last {windowDays} days.</p>
              </div>
            </Card>
          ) : comparisonError && !comparison ? (
            <Card hover={false} className="flex min-h-56 flex-col items-center justify-center gap-3 text-center">
              <RefreshCw aria-hidden="true" className="h-6 w-6 text-slate-400" />
              <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{comparisonError}</p>
              <p className="text-xs text-slate-400">The page will retry automatically while the backend wakes up.</p>
            </Card>
          ) : comparison ? (
            <CompetitiveIntelligenceDashboard
              data={comparison}
              onInspect={(entity, filters, title) => setEvidenceView({ entity, filters, title })}
              onAnalyze={handleAnalyze}
              analyzingEntityId={analyzingEntityId}
            />
          ) : (
            <CompetitorComparisonMatrix primaryEntity={currentEntity} primaryRiskScore={finalRiskScore} competitors={competitorsData} />
          )}
        </>
      )}

      {evidenceView && (
        <CompetitorMentionsModal
          competitor={{ id: evidenceView.entity.id, name: evidenceView.entity.name }}
          filters={evidenceView.filters}
          title={evidenceView.title}
          onClose={() => setEvidenceView(null)}
        />
      )}
    </div>
  );
}
