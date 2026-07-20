'use client';

import { useDashboard } from '@/components/providers/DashboardProvider';
import EntitySelector from '@/components/EntitySelector';
import CreateEntityForm from '@/components/CreateEntityForm';
import Card from '@/components/ui/Card';

export default function SettingsPage() {
  const { allEntities, userToken } = useDashboard();

  return (
    <section className="pt-2">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h2 className="text-sm font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
          Manage Entities
        </h2>
        <Card hover={false} className="p-3">
          <EntitySelector entities={allEntities} />
        </Card>
      </div>
      <CreateEntityForm userToken={userToken} />
    </section>
  );
}
