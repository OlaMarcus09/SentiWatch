'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { AlertCircle, Loader2 } from 'lucide-react';

// Layout Components
import Sidebar from '../components/layout/Sidebar';
import TopNavbar from '../components/layout/TopNavbar';

// Standard Dashboard Components
import HeroSection from '../components/dashboard/HeroSection';
import KPICards from '../components/dashboard/KPICards';
import RiskGauge from '../components/dashboard/RiskGauge';
import AIInsights from '../components/dashboard/AIInsights';
import RecommendationCenter from '../components/dashboard/RecommendationCenter';
import MentionFeed from '../components/dashboard/MentionFeed';
import AlertCenter from '../components/dashboard/AlertCenter';
import SentimentChart from '../components/SentimentChart';
import Card from '../components/ui/Card';
import CreateEntityForm from '../components/CreateEntityForm';
import EntitySelector from '../components/EntitySelector';

// Pivot Widgets
import StudentVisaAuditWidget from '../components/dashboard/StudentVisaAuditWidget';
import CompetitorComparisonMatrix from '../components/dashboard/CompetitorComparisonMatrix';

export default function Page() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-screen bg-slate-50 dark:bg-slate-900">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    }>
      <Dashboard />
    </Suspense>
  );
}

function Dashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const entityIdParam = searchParams.get('entity_id');

  // Core State
  const [loading, setLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Initializing secure connection...');
  const [error, setError] = useState<string | null>(null);
  const [userToken, setUserToken] = useState<string>('');
  
  // Data State
  const [allEntities, setAllEntities] = useState<any[]>([]);
  const [currentEntity, setCurrentEntity] = useState<any>(null);
  const [competitorsData, setCompetitorsData] = useState<any[]>([]);
  const [mentions, setMentions] = useState<any[]>([]);
  const [finalRiskScore, setFinalRiskScore] = useState(0);
  const [recommendation, setRecommendation] = useState<any>(null);
  const [riskScoreData, setRiskScoreData] = useState<any>(null);
  
  // UI State
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const isDark = document.documentElement.classList.contains('dark');
    setTheme(isDark ? 'dark' : 'light');
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    document.documentElement.classList.toggle('dark');
  };

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
      if (window.innerWidth >= 1024) setSidebarOpen(false);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // ─── POLLING & DATA FETCHING ENGINE ───
  useEffect(() => {
    let isMounted = true;
    let pollInterval: NodeJS.Timeout;
    const MAX_POLLS = 40; // 40 attempts * 3 seconds = 120s (covers Render free-tier cold starts)
    let pollCount = 0;

    const loadingMessages = [
      'Authenticating user...',
      'Deploying data scrapers...',
      'Searching live web context via Tavily...',
      'Analyzing sentiment with Groq Llama-3...',
      'Calculating risk index...',
      'Generating competitor matrix...',
      'Finalizing dashboard...'
    ];

    async function loadData() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          if (isMounted) router.push('/login');
          return;
        }

        if (isMounted) setUserToken(session.access_token);

        const userId = session.user.id;

        // 1. Fetch User Entities
        const { data: entities, error: entitiesError } = await supabase
          .from('monitored_entities')
          .select('*')
          .eq('user_id', userId)
          .order('name');

        if (entitiesError || !entities || entities.length === 0) {
          if (isMounted) { setAllEntities([]); setLoading(false); }
          return;
        }

        if (isMounted) setAllEntities(entities);
        const activeEntity = entities.find(e => e.id === entityIdParam) || entities[0];
        if (isMounted) setCurrentEntity(activeEntity);

        // 2. Fetch Competitors
        const { data: compLinks } = await supabase
          .from('competitor_links')
          .select('competitor_entity_id, monitored_entities!competitor_entity_id(*, risk_scores(*))')
          .eq('primary_entity_id', activeEntity.id);

        if (isMounted && compLinks) {
          setCompetitorsData(compLinks.map((link: any) => link.monitored_entities));
        }

        // 3. Polling Logic for Background Tasks
        const checkDataReady = async () => {
          if (!isMounted) return;
          pollCount++;
          
          // Cycle through loading messages to keep user engaged
          if (pollCount < loadingMessages.length) {
            setLoadingMessage(loadingMessages[pollCount]);
          }

          // Check if FastAPI background worker has finished saving the risk score
          const { data: riskData } = await supabase
            .from('risk_scores')
            .select('*')
            .eq('entity_id', activeEntity.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (!riskData && pollCount < MAX_POLLS) {
            // Data isn't ready yet, FastAPI is still running. Try again in 3 seconds.
            pollInterval = setTimeout(checkDataReady, 3000);
            return;
          } else if (!riskData && pollCount >= MAX_POLLS) {
            setError('Pipeline timeout. The AI is taking longer than expected. Please refresh.');
            return;
          }

          // 4. Data is ready! Fetch the rest of the payloads.
          const { data: fetchedMentions } = await supabase
            .from('mentions')
            .select('*')
            .eq('entity_id', activeEntity.id)
            .order('created_at', { ascending: false });

          const mentionIds = (fetchedMentions || []).map((m: any) => m.id);
          const { data: sentimentRows } = mentionIds.length > 0
            ? await supabase.from('sentiment_results').select('*').in('mention_id', mentionIds)
            : { data: [] };

          const sentimentMap = Object.fromEntries((sentimentRows || []).map((s: any) => [s.mention_id, s]));
          const mergedMentions = (fetchedMentions || []).map((m: any) => ({
            ...m,
            sentiment_results: sentimentMap[m.id] ? [sentimentMap[m.id]] : [],
          }));

          const { data: recData } = await supabase
            .from('recommendations')
            .select('*')
            .eq('entity_id', activeEntity.id)
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
        };

        // Trigger the polling loop
        checkDataReady();

      } catch (err) {
        console.error(err);
        if (isMounted) setError('An unexpected error occurred. Please refresh.');
      }
    }

    loadData();
    return () => { 
      isMounted = false; 
      clearTimeout(pollInterval);
    };
  }, [entityIdParam, router]);

  // ─── RENDERING STATES ───

  if (loading && !error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4 bg-slate-50 dark:bg-slate-900 transition-colors">
        <Loader2 className="w-10 h-10 animate-spin text-black dark:text-white" />
        <div className="flex flex-col items-center space-y-1 text-center">
          <p className="text-sm font-semibold text-slate-900 dark:text-white animate-pulse">
            {loadingMessage}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Fetching real-time web context and analyzing sentiment...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen p-8 bg-slate-50 dark:bg-slate-900">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 rounded-2xl p-6 max-w-md text-center">
          <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-3" />
          <p className="text-red-700 dark:text-red-400 font-medium text-sm">{error}</p>
          <button onClick={() => window.location.reload()} className="mt-4 text-xs font-semibold text-red-600 dark:text-red-400 underline">
            Force Refresh
          </button>
        </div>
      </div>
    );
  }

  if (allEntities.length === 0) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 p-8 flex flex-col items-center justify-center">
        <div className="max-w-2xl w-full space-y-6">
          <div className="text-center space-y-2 mb-8">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Initialize SentiWatch</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">Create your first tracking entity to deploy the monitoring agents.</p>
          </div>
          
          <CreateEntityForm userToken={userToken} />
        </div>
      </div>
    );
  }

  // Calculate Sentiment Stats
  let positive = 0, neutral = 0, negative = 0;
  mentions.forEach((m) => {
    const label = m.sentiment_results?.[0]?.label || 'neutral';
    if (label === 'positive') positive++;
    else if (label === 'negative') negative++;
    else neutral++;
  });

  const rootCauseSummary = riskScoreData?.root_cause_summary || '';
  const currentEntityName = currentEntity?.name || 'Your Profile';
  const currentProfileType = currentEntity?.profile_type || 'business';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors duration-200">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} isMobile={isMobile} />

      <div className={`transition-all duration-300 ${isMobile ? 'lg:ml-0' : 'lg:ml-64'}`}>
        <TopNavbar onMenuClick={() => setSidebarOpen(!sidebarOpen)} theme={theme} onThemeToggle={toggleTheme} entityName={currentEntityName} />

        <main className="max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-6 md:space-y-8">
          
          <HeroSection userName="Marcus" riskScore={finalRiskScore} trend={0} />
          
          <KPICards totalMentions={mentions.length} negative={negative} positive={positive} alerts={finalRiskScore > 60 ? 1 : 0} />

          {currentProfileType === 'student' ? (
            <StudentVisaAuditWidget mentions={mentions} riskScore={finalRiskScore} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="flex flex-col items-center justify-center py-6">
                <h3 className="text-sm font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-4">Live Risk Index</h3>
                <RiskGauge score={finalRiskScore} />
              </Card>
              <AIInsights rootCauseSummary={rootCauseSummary} negativeCount={negative} positiveCount={positive} totalMentions={mentions.length} />
            </div>
          )}

          <RecommendationCenter recommendation={recommendation} score={finalRiskScore} />

          {competitorsData.length > 0 && (
            <CompetitorComparisonMatrix primaryEntity={currentEntity} competitors={competitorsData} />
          )}

          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1"><CreateEntityForm userToken={userToken} /></div>
            <div className="bg-white dark:bg-slate-800/80 p-4 rounded-2xl border border-slate-200/60 dark:border-slate-700/60 shadow-sm flex items-end">
              <EntitySelector entities={allEntities} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-slate-800/80 rounded-2xl border border-slate-200/60 dark:border-slate-700/60 p-6">
              <h3 className="text-sm font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-4">Sentiment Breakdown</h3>
              <SentimentChart positive={positive} neutral={neutral} negative={negative} />
            </div>
            <AlertCenter alerts={[]} />
          </div>

          <MentionFeed mentions={mentions} />
        </main>
      </div>
    </div>
  );
}