'use client';

import { useDashboard } from '@/components/providers/DashboardProvider';
import RecommendationCenter from '@/components/dashboard/RecommendationCenter';

export default function RecommendationsPage() {
  const { recommendation, finalRiskScore } = useDashboard();

  return <RecommendationCenter recommendation={recommendation} score={finalRiskScore} />;
}
