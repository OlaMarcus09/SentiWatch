'use client';

import { useDashboard } from '@/components/providers/DashboardProvider';
import RecommendationCenter from '@/components/dashboard/RecommendationCenter';

export default function RecommendationsPage() {
  const { recommendation, finalRiskScore, userToken } = useDashboard();

  return <RecommendationCenter key={recommendation?.id || 'empty'} recommendation={recommendation} score={finalRiskScore} userToken={userToken} />;
}
