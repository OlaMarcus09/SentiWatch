'use client';

import { useDashboard } from '@/components/providers/DashboardProvider';
import HeroSection from '@/components/dashboard/HeroSection';
import KPICards from '@/components/dashboard/KPICards';
import RiskGauge from '@/components/dashboard/RiskGauge';
import AIInsights from '@/components/dashboard/AIInsights';
import Card from '@/components/ui/Card';

export default function DashboardPage() {
  const {
    displayName,
    finalRiskScore,
    trendDelta,
    mentions,
    negative,
    positive,
    rootCauseSummary,
  } = useDashboard();

  return (
    <>
      {/* ── Overview ── */}
      <HeroSection userName={displayName} riskScore={finalRiskScore} trend={trendDelta} />

      <KPICards totalMentions={mentions.length} negative={negative} positive={positive} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card hover={false} className="flex flex-col items-center justify-center py-6">
          <h3 className="text-sm font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-4">
            Live Risk Index
          </h3>
          <RiskGauge score={finalRiskScore} />
        </Card>
        <AIInsights
          rootCauseSummary={rootCauseSummary}
          negativeCount={negative}
          positiveCount={positive}
          totalMentions={mentions.length}
        />
      </div>
    </>
  );
}
