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
    <div className="flex flex-col">
      <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
        Monitored Business
      </label>
      <select
        value={currentEntityId}
        onChange={handleChange}
        className="block w-56 bg-slate-800 text-white border border-slate-700 rounded-lg px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all cursor-pointer"
      >
        {entities.map((ent) => (
          <option key={ent.id} value={ent.id} className="bg-slate-900 text-white">
            {ent.name}
          </option>
        ))}
      </select>
    </div>
  );
}