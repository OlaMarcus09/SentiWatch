'use client';

import { useDashboard } from '@/components/providers/DashboardProvider';
import SentimentChart from '@/components/SentimentChart';
import CategoryHeatmap from '@/components/CategoryHeatmap';
import MentionFeed from '@/components/dashboard/MentionFeed';
import Card from '@/components/ui/Card';

export default function MonitoringPage() {
  const { positive, neutral, negative, categoryBreakdown, mentions } = useDashboard();

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

      <MentionFeed mentions={mentions} />
    </>
  );
}
