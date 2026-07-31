'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function CreateEntityForm({ userToken }: { userToken: string }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [socialHandle, setSocialHandle] = useState('');
  const [competitorInput, setCompetitorInput] = useState('');
  const [competitors, setCompetitors] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const handleAddCompetitor = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && competitorInput.trim() !== '') {
      e.preventDefault();
      if (!competitors.includes(competitorInput.trim()) && competitors.length < 3) {
        setCompetitors([...competitors, competitorInput.trim()]);
        setCompetitorInput('');
      }
    }
  };

  const removeCompetitor = (tag: string) => {
    setCompetitors(competitors.filter((c) => c !== tag));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      // A user may type the last competitor and click submit without pressing
      // Enter. Treat the pending input as a competitor instead of dropping it.
      const pendingCompetitor = competitorInput.trim();
      const submittedCompetitors = pendingCompetitor
        ? [...competitors, pendingCompetitor]
            .filter((value, index, values) => values.indexOf(value) === index)
            .slice(0, 3)
        : competitors;

      // Wake the backend first. On Render's free tier the service sleeps after
      // ~15min idle and takes ~30s to cold-start; pinging root before the POST
      // means the pipeline runs on a warm server instead of racing the wake-up.
      try {
        await fetch(`${process.env.NEXT_PUBLIC_API_URL}/`, { method: 'GET' });
      } catch {
        // Non-fatal: if the warm-up ping fails we still attempt the create below.
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/entities`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userToken}`,
        },
        body: JSON.stringify({
          name,
          social_handle: socialHandle || undefined,
          competitors: submittedCompetitors,
        }),
      });

      if (!response.ok) throw new Error('Failed to create profile');

      const data = await response.json();
      // Route the user using your app's query parameter structure
      router.push(`/?entity_id=${data.entity_id}`);
    } catch (err) {
      console.error(err);
      setError('Could not create your profile. Check your connection and try again.');
      nameRef.current?.focus();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl mx-auto space-y-8 bg-white dark:bg-slate-800 p-8 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700">

      {/* 1. Entity Name */}
      <div className="space-y-2">
        <label htmlFor="entity-name" className="text-sm font-medium text-gray-900 dark:text-slate-100">Profile Name</label>
        <input
          id="entity-name"
          name="entity-name"
          ref={nameRef}
          type="text"
          required
          autoComplete="off"
          spellCheck={false}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Cowrywise…"
          className="w-full px-4 py-3 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-black dark:focus-visible:ring-blue-500 focus:border-transparent transition-colors placeholder:text-gray-400 dark:placeholder:text-slate-500"
        />
      </div>

      {/* 2. Social Handle */}
      <div className="space-y-2">
        <label htmlFor="social-handle" className="text-sm font-medium text-gray-900 dark:text-slate-100">Social Handle</label>
        <input
          id="social-handle"
          name="social-handle"
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={socialHandle}
          onChange={(e) => setSocialHandle(e.target.value)}
          placeholder="@gtbank"
          className="w-full px-4 py-3 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-black dark:focus-visible:ring-blue-500 focus:border-transparent transition-colors placeholder:text-gray-400 dark:placeholder:text-slate-500"
        />
        <p className="text-xs text-gray-500 dark:text-slate-400">Optional, but highly recommended for the most accurate scraping results.</p>
      </div>

      {/* 3. Competitor Tags */}
      <div className="space-y-2">
        <label htmlFor="competitor-input" className="text-sm font-medium text-gray-900 dark:text-slate-100 flex justify-between">
          <span>Competitors / Tracked Entities</span>
          <span className="text-gray-400 dark:text-slate-500 font-normal">{competitors.length}/3 tracked</span>
        </label>
        <div className="p-2 border border-gray-200 dark:border-slate-600 rounded-lg focus-within:ring-2 focus-within:ring-black dark:focus-within:ring-blue-500 focus-within:border-transparent transition-colors min-h-[56px] flex flex-wrap gap-2 items-center bg-white dark:bg-slate-900">
          {competitors.map((comp) => (
            <span key={comp} className="flex items-center space-x-1 bg-gray-100 dark:bg-slate-700 text-gray-800 dark:text-slate-200 text-xs font-medium px-2.5 py-1.5 rounded-md">
              <span>{comp}</span>
              <button
                type="button"
                onClick={() => removeCompetitor(comp)}
                aria-label={`Remove ${comp}`}
                className="text-gray-500 dark:text-slate-400 hover:text-black dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black dark:focus-visible:ring-blue-500 rounded"
              >
                &times;
              </button>
            </span>
          ))}
          <input
            id="competitor-input"
            name="competitor"
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={competitorInput}
            onChange={(e) => setCompetitorInput(e.target.value)}
            onKeyDown={handleAddCompetitor}
            disabled={competitors.length >= 3}
            placeholder={competitors.length >= 3 ? 'Limit reached' : 'Type a competitor & press Enter…'}
            className="flex-1 min-w-[120px] bg-transparent text-gray-900 dark:text-slate-100 outline-none text-sm px-2 py-1 disabled:bg-transparent placeholder:text-gray-400 dark:placeholder:text-slate-500"
          />
        </div>
        <p className="text-xs text-gray-500 dark:text-slate-400">Track competitors to automatically generate gap-analysis recommendations.</p>
      </div>

      {/* Error Message */}
      <div aria-live="polite">
        {error && (
          <div role="alert" className="rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}
      </div>

      {/* Submit Button */}
      <button
        type="submit"
        disabled={isLoading || !name}
        className="w-full bg-black dark:bg-blue-600 text-white py-3.5 rounded-lg font-medium text-sm hover:bg-gray-900 dark:hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black dark:focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800"
      >
        {isLoading ? (
          <span className="flex items-center space-x-2">
            <svg aria-hidden="true" className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
            </svg>
            <span>Deploying Agents…</span>
          </span>
        ) : (
          'Initialize SentiWatch Environment'
        )}
      </button>

    </form>
  );
}
