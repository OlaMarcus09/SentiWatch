'use client';

import { useState } from 'react';
import { Users, Plus, Loader2 } from 'lucide-react';
import { useDashboard } from '@/components/providers/DashboardProvider';
import CompetitorComparisonMatrix from '@/components/dashboard/CompetitorComparisonMatrix';
import Card from '@/components/ui/Card';

export default function CompetitorsPage() {
  const { currentEntity, competitorsData, userToken, finalRiskScore, refreshCompetitors } = useDashboard();

  const [name, setName] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

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
        <CompetitorComparisonMatrix primaryEntity={currentEntity} primaryRiskScore={finalRiskScore} competitors={competitorsData} />
      )}
    </div>
  );
}
