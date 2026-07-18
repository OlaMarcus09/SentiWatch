'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function CreateEntityForm({ userToken }: { userToken: string }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [profileType, setProfileType] = useState('business');
  const [competitorInput, setCompetitorInput] = useState('');
  const [competitors, setCompetitors] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const personas = [
    { id: 'business', label: 'Business / Brand', icon: '🏢' },
    { id: 'student', label: 'Student / Visa Applicant', icon: '🎓' },
    { id: 'influencer', label: 'Creator / Influencer', icon: '✨' },
    { id: 'real_estate', label: 'Real Estate Manager', icon: '🏗️' },
  ];

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
          profile_type: profileType,
          competitors,
        }),
      });

      if (!response.ok) throw new Error('Failed to create profile');
      
      const data = await response.json();
      // Route the user using your app's query parameter structure
      router.push(`/?entity_id=${data.entity_id}`);
    } catch (err) {
      console.error(err);
      setError('Could not create your profile. Please check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl mx-auto space-y-8 bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
      
      {/* 1. Entity Name */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-900">Profile Name</label>
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Enter your brand or personal name"
          className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent transition-all placeholder:text-gray-400"
        />
      </div>

      {/* 2. Persona Selection (Framer-style Radio Group) */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-gray-900">Select Profile Context</label>
        <div className="grid grid-cols-2 gap-3">
          {personas.map((p) => (
            <div
              key={p.id}
              onClick={() => setProfileType(p.id)}
              className={`cursor-pointer p-4 rounded-xl border flex items-center space-x-3 transition-all duration-200 ${
                profileType === p.id 
                  ? 'border-black bg-gray-50/50 shadow-sm' 
                  : 'border-gray-100 hover:border-gray-300'
              }`}
            >
              <span className="text-xl">{p.icon}</span>
              <span className={`text-sm font-medium ${profileType === p.id ? 'text-black' : 'text-gray-600'}`}>
                {p.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 3. Competitor Tags */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-900 flex justify-between">
          <span>Competitors / Tracked Entities</span>
          <span className="text-gray-400 font-normal">{competitors.length}/3 tracked</span>
        </label>
        <div className="p-2 border border-gray-200 rounded-lg focus-within:ring-2 focus-within:ring-black focus-within:border-transparent transition-all min-h-[56px] flex flex-wrap gap-2 items-center bg-white">
          {competitors.map((comp) => (
            <span key={comp} className="flex items-center space-x-1 bg-gray-100 text-gray-800 text-xs font-medium px-2.5 py-1.5 rounded-md">
              <span>{comp}</span>
              <button type="button" onClick={() => removeCompetitor(comp)} className="text-gray-500 hover:text-black">
                &times;
              </button>
            </span>
          ))}
          <input
            type="text"
            value={competitorInput}
            onChange={(e) => setCompetitorInput(e.target.value)}
            onKeyDown={handleAddCompetitor}
            disabled={competitors.length >= 3}
            placeholder={competitors.length >= 3 ? "Limit reached" : "Type a competitor & press Enter..."}
            className="flex-1 min-w-[120px] outline-none text-sm px-2 py-1 disabled:bg-transparent"
          />
        </div>
        <p className="text-xs text-gray-500">Track competitors to automatically generate gap-analysis recommendations.</p>
      </div>

      {/* Error Message */}
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Submit Button */}
      <button
        type="submit"
        disabled={isLoading || !name}
        className="w-full bg-black text-white py-3.5 rounded-lg font-medium text-sm hover:bg-gray-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center"
      >
        {isLoading ? (
          <span className="flex items-center space-x-2">
            <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
            </svg>
            <span>Deploying Agents...</span>
          </span>
        ) : (
          'Initialize SentiWatch Environment'
        )}
      </button>

    </form>
  );
}