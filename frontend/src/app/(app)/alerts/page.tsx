'use client';

import { useDashboard } from '@/components/providers/DashboardProvider';
import AlertCenter from '@/components/dashboard/AlertCenter';

export default function AlertsPage() {
  const { alerts } = useDashboard();

  return <AlertCenter alerts={alerts} />;
}
