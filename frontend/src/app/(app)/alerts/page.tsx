'use client';

import { useDashboard } from '@/components/providers/DashboardProvider';
import AlertCenter from '@/components/dashboard/AlertCenter';
import { useSearchParams } from 'next/navigation';

export default function AlertsPage() {
  const { alerts } = useDashboard();
  const searchParams = useSearchParams();
  const query = (searchParams.get('search') || '').trim().toLowerCase();
  const filteredAlerts = query
    ? alerts.filter((alert) => `${alert.title} ${alert.source} ${alert.risk}`.toLowerCase().includes(query))
    : alerts;

  return <AlertCenter alerts={filteredAlerts} />;
}
