'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export default function AddBrandForm() {
  const [brandName, setBrandName] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'idle' | 'creating' | 'syncing' | 'analyzing' | 'calculating' | 'done'>('idle');
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!brandName.trim()) return;

    setLoading(true);
    setStep('creating');
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) {
        alert("You must be logged in to track a brand.");
        setLoading(false);
        setStep('idle');
        return;
      }

      const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
      
      // ─── Step 1: Create Entity ─────────────────────────────
      const response = await fetch(`${API_BASE_URL}/entities`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ name: brandName }),
      });

      const data = await response.json();
      
      if (!data.success) {
        alert(`Error: ${data.detail || data.error || 'Failed to create entity'}`);
        setLoading(false);
        setStep('idle');
        return;
      }

      const entityId = data.entity_id;
      setStep('syncing');

      // ─── Step 2: Sync (Scrape mentions) ────────────────────
      try {
        const syncRes = await fetch(`${API_BASE_URL}/sync/${entityId}?brand_name=${brandName}`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!syncRes.ok) {
          console.warn('Sync warning:', await syncRes.text());
        }
      } catch (e) {
        console.warn('Sync error (continuing):', e);
      }

      setStep('analyzing');

      // ─── Step 3: Analyze (AI Sentiment) ────────────────────
      try {
        const analyzeRes = await fetch(
          `${API_BASE_URL}/analyze?entity_id=${entityId}&brand_name=${brandName}`,
          { 
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
          }
        );
        if (!analyzeRes.ok) {
          console.warn('Analysis warning:', await analyzeRes.text());
        }
      } catch (e) {
        console.warn('Analysis error (continuing):', e);
      }

      setStep('calculating');

      // ─── Step 4: Calculate Risk ────────────────────────────
      try {
        const riskRes = await fetch(`${API_BASE_URL}/calculate-risk/${entityId}`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!riskRes.ok) {
          console.warn('Risk calculation warning:', await riskRes.text());
        }
      } catch (e) {
        console.warn('Risk calculation error (continuing):', e);
      }

      setStep('done');
      
      // ─── Success: Redirect to dashboard ────────────────────
      setBrandName('');
      window.location.href = `/?entity_id=${entityId}`;

    } catch (err) {
      alert('Could not connect to the backend server. Make sure it is running.');
      console.error('Error:', err);
      setLoading(false);
      setStep('idle');
    }
  };

  // Helper to show current step in button text
  const getButtonText = () => {
    if (!loading) return 'Activate Tracking';
    switch (step) {
      case 'creating': return 'Creating brand...';
      case 'syncing': return 'Scraping mentions...';
      case 'analyzing': return 'Analyzing with AI...';
      case 'calculating': return 'Calculating risk...';
      case 'done': return '✅ Ready!';
      default: return 'Loading...';
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-gray-100 dark:border-slate-700 shadow-sm flex flex-col sm:flex-row gap-4 items-end">
      <div className="flex-1 space-y-1">
        <label className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
          Monitor a New Brand
        </label>
        <input
          type="text"
          placeholder="e.g. OPay, Cowrywise, PiggyVest"
          value={brandName}
          onChange={(e) => setBrandName(e.target.value)}
          disabled={loading}
          className="block w-full border border-gray-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/50 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white transition-all"
        />
        {loading && (
          <p className="text-xs text-blue-500 dark:text-blue-400 mt-1 animate-pulse">
            {step === 'syncing' && '🔍 Finding mentions...'}
            {step === 'analyzing' && '🧠 AI is analyzing...'}
            {step === 'calculating' && '📊 Scoring reputation...'}
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={loading || !brandName.trim()}
        className="bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm px-5 py-2.5 rounded-xl flex items-center transition-all disabled:opacity-50 cursor-pointer h-[42px] whitespace-nowrap"
      >
        <Plus className="w-4 h-4 mr-1.5" />
        {getButtonText()}
      </button>
    </form>
  );
}