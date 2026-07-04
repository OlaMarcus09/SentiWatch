'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { AlertCircle, Loader2, Menu, X } from 'lucide-react';

// ─── Existing Components ──────────────────────
import EntitySelector from './components/EntitySelector';
import SentimentChart from './components/SentimentChart';
import AddBrandForm from './components/AddBrandForm';

// ─── Layout Components ────────────────────────
import Sidebar from './components/layout/Sidebar';
import TopNavbar from './components/layout/TopNavbar';

// ─── Dashboard Components ─────────────────────
import HeroSection from './components/dashboard/HeroSection';
import KPICards from './components/dashboard/KPICards';
import RiskGauge from './components/dashboard/RiskGauge';
import AIInsights from './components/dashboard/AIInsights';
import RecommendationCenter from './components/dashboard/RecommendationCenter';
import MentionFeed from './components/dashboard/MentionFeed';
import AlertCenter from './components/dashboard/AlertCenter';

// ─── UI Components ────────────────────────────
import Card from './components/ui/Card';

// ──────────────────────────────────────────────
// Main Page
// ──────────────────────────────────────────────
export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen bg-slate-50 dark:bg-slate-900">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      }
    >
      <Dashboard />
    </Suspense>
  );
}

function Dashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const entityIdParam = searchParams.get('entity_id');

  // ─── State ──────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allEntities, setAllEntities] = useState<any[]>([]);
  const [mentions, setMentions] = useState<any[]>([]);
  const [finalRiskScore, setFinalRiskScore] = useState(0);
  const [recommendation, setRecommendation] = useState<any>(null);
  const [riskScoreData, setRiskScoreData] = useState<any>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  // ─── Theme detection ──────────────────────
  useEffect(() => {
    const isDark = document.documentElement.classList.contains('dark');
    setTheme(isDark ? 'dark' : 'light');
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    document.documentElement.classList.toggle('dark');
  };

  // ─── Mobile detection ──────────────────────
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
      if (window.innerWidth >= 1024) setSidebarOpen(false);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // ─── Data fetching (EXACTLY the same as before) ──
  useEffect(() => {
    let attempts = 0;
    const MAX_ATTEMPTS = 8;
    let isMounted = true;

    async function loadDashboard() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          if (isMounted) router.push('/login');
          return;
        }

        const userId = session.user.id;

        const { data: entities, error: entitiesError } = await supabase
          .from('monitored_entities')
          .select('*')
          .eq('user_id', userId)
          .order('name');

        if (entitiesError) {
          console.error('Entities error:', entitiesError);
          if (isMounted) setError('Failed to load your brands. Please refresh.');
          return;
        }

        if (!entities || entities.length === 0) {
          if (isMounted) {
            setAllEntities([]);
            setLoading(false);
          }
          return;
        }

        if (isMounted) setAllEntities(entities);

        const currentEntityId = entityIdParam || entities[0].id;

        const { data: fetchedMentions, error: mentionsError } = await supabase
          .from('mentions')
          .select('*')
          .eq('entity_id', currentEntityId)
          .order('created_at', { ascending: false });

        if (mentionsError) {
          console.error('Mentions error:', mentionsError);
          if (
            mentionsError.code === '42501' ||
            mentionsError.message?.includes('403')
          ) {
            if (isMounted)
              setError('Permission denied reading mentions. Check RLS policies.');
            return;
          }
        }

        if (
          !mentionsError &&
          (!fetchedMentions || fetchedMentions.length === 0) &&
          attempts < MAX_ATTEMPTS
        ) {
          attempts++;
          setTimeout(() => {
            if (isMounted) loadDashboard();
          }, 3000);
          return;
        }

        const mentionIds = (fetchedMentions || []).map((m: any) => m.id);

        const { data: sentimentRows } =
          mentionIds.length > 0
            ? await supabase
                .from('sentiment_results')
                .select('mention_id, label, confidence, category, severity, risk_level, root_cause, reason')
                .in('mention_id', mentionIds)
            : { data: [] };

        const sentimentMap = Object.fromEntries(
          (sentimentRows || []).map((s: any) => [s.mention_id, s])
        );

        const mergedMentions = (fetchedMentions || []).map((m: any) => ({
          ...m,
          sentiment_results: sentimentMap[m.id] ? [sentimentMap[m.id]] : [],
        }));

        const { data: riskData } = await supabase
          .from('risk_scores')
          .select('*')
          .eq('entity_id', currentEntityId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const { data: recData } = await supabase
          .from('recommendations')
          .select('*')
          .eq('entity_id', currentEntityId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (isMounted) {
          setMentions(mergedMentions);
          setFinalRiskScore(Math.min(riskData?.score || 0, 100));
          setRiskScoreData(riskData);
          setRecommendation(recData);
          setLoading(false);
        }
      } catch (err) {
        console.error('Dashboard load error:', err);
        if (isMounted) setError('Something went wrong. Please refresh.');
      }
    }

    loadDashboard();

    return () => {
      isMounted = false;
    };
  }, [entityIdParam, router]);

  // ─── Loading ──────────────────────────────
  if (loading && !error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-3 bg-slate-50 dark:bg-slate-900">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        <div className="text-slate-500 dark:text-slate-400 font-medium text-sm">
          Synchronizing brand data...
        </div>
      </div>
    );
  }

  // ─── Error ──────────────────────────────────
  if (error) {
    return (
      <div className="flex items-center justify-center h-screen p-8 bg-slate-50 dark:bg-slate-900">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 rounded-2xl p-6 max-w-md text-center">
          <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-3" />
          <p className="text-red-700 dark:text-red-400 font-medium text-sm">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 text-xs text-red-600 dark:text-red-400 underline"
          >
            Refresh page
          </button>
        </div>
      </div>
    );
  }

  // ─── No Entities ────────────────────────────
  if (allEntities.length === 0) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 p-8">
        <div className="max-w-7xl mx-auto space-y-6">
          <AddBrandForm />
          <div className="p-12 text-center text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm">
            Welcome to SentiWatch! Use the form above to activate tracking on
            your first brand.
          </div>
        </div>
      </div>
    );
  }

  // ─── Compute counts ──────────────────────────
  let positive = 0,
    neutral = 0,
    negative = 0;
  mentions.forEach((m) => {
    const label = m.sentiment_results?.[0]?.label || 'neutral';
    if (label === 'positive') positive++;
    else if (label === 'negative') negative++;
    else neutral++;
  });

  const categoryBreakdown = riskScoreData?.category_breakdown || {};
  const rootCauseSummary = riskScoreData?.root_cause_summary || '';
  const currentEntityName = allEntities.find(e => e.id === (entityIdParam || allEntities[0]?.id))?.name || 'Your Brand';

  // ─── Main Render ──────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors duration-200">
      {/* Sidebar */}
      <Sidebar 
        isOpen={sidebarOpen} 
        onClose={() => setSidebarOpen(false)} 
        isMobile={isMobile} 
      />

      {/* Main Content */}
      <div className={`
        transition-all duration-300
        ${isMobile ? 'lg:ml-0' : 'lg:ml-64'}
      `}>
        {/* Top Navbar */}
        <TopNavbar 
          onMenuClick={() => setSidebarOpen(!sidebarOpen)}
          theme={theme}
          onThemeToggle={toggleTheme}
          entityName={currentEntityName}
        />

        {/* Page Content */}
        <main className="max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-6 md:space-y-8">
          {/* Hero Section */}
          <HeroSection 
            userName="Marcus" 
            riskScore={finalRiskScore} 
            trend={4} 
          />

          {/* KPI Cards */}
          <KPICards 
            totalMentions={mentions.length} 
            negative={negative} 
            positive={positive} 
            alerts={finalRiskScore > 60 ? 1 : 0} 
          />

          {/* Two-column: Risk Gauge + AI Insights */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="flex flex-col items-center justify-center py-6">
              <h3 className="text-sm font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-4">
                Live Risk Index
              </h3>
              <RiskGauge score={finalRiskScore} />
            </Card>

            <AIInsights 
              rootCauseSummary={rootCauseSummary}
              negativeCount={negative}
              positiveCount={positive}
              totalMentions={mentions.length}
            />
          </div>

          {/* Recommendation Center */}
          <RecommendationCenter 
            recommendation={recommendation} 
            score={finalRiskScore} 
          />

          {/* Two-column: Sentiment Chart + Alert Center */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-slate-800/80 rounded-2xl border border-slate-200/60 dark:border-slate-700/60 p-6">
              <h3 className="text-sm font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-4">
                Sentiment Breakdown
              </h3>
              <SentimentChart
                positive={positive}
                neutral={neutral}
                negative={negative}
              />
            </div>
            <AlertCenter alerts={[]} />
          </div>

          {/* Entity Selector (existing) */}
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <AddBrandForm />
            </div>
            <div className="bg-white dark:bg-slate-800/80 p-4 rounded-2xl border border-slate-200/60 dark:border-slate-700/60 shadow-sm flex items-end">
              <EntitySelector entities={allEntities} />
            </div>
          </div>

          {/* Mention Feed */}
          <MentionFeed mentions={mentions} />
        </main>
      </div>
    </div>
  );
}