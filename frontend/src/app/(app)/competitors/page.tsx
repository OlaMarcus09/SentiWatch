'use client';

import { Users } from 'lucide-react';
import { useDashboard } from '@/components/providers/DashboardProvider';
import CompetitorComparisonMatrix from '@/components/dashboard/CompetitorComparisonMatrix';
import Card from '@/components/ui/Card';

export default function CompetitorsPage() {
  const { currentEntity, competitorsData } = useDashboard();

  if (competitorsData.length === 0) {
    return (
      <Card hover={false} className="text-center py-12">
        <Users aria-hidden="true" className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">No competitors tracked yet</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Link a competitor to this entity to see a side-by-side risk comparison.
        </p>
      </Card>
    );
  }

  return <CompetitorComparisonMatrix primaryEntity={currentEntity} competitors={competitorsData} />;
}
