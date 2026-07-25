'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export default function EntitySelector({ entities }: { entities: any[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentEntityId = searchParams.get('entity_id') || entities[0]?.id;

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    // Stay on the current tab; only swap the entity_id query param.
    router.push(`${pathname}?entity_id=${e.target.value}`);
  };

  return (
    <select
      value={currentEntityId}
      onChange={handleChange}
      aria-label="Switch monitored entity"
      className="block w-48 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-white border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-all cursor-pointer"
    >
      {entities.map((ent) => (
        <option key={ent.id} value={ent.id}>
          {ent.name}
        </option>
      ))}
    </select>
  );
}