'use client';

import { Suspense, useEffect, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';

import DashboardProvider, { useDashboard } from '@/components/providers/DashboardProvider';
import Sidebar from '@/components/layout/Sidebar';
import TopNavbar from '@/components/layout/TopNavbar';
import CreateEntityForm from '@/components/CreateEntityForm';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div
          role="status"
          aria-live="polite"
          className="flex items-center justify-center h-screen bg-slate-50 dark:bg-slate-900"
        >
          <Loader2 aria-hidden="true" className="w-8 h-8 animate-spin text-blue-500" />
          <span className="sr-only">Loading…</span>
        </div>
      }
    >
      <DashboardProvider>
        <AppShell>{children}</AppShell>
      </DashboardProvider>
    </Suspense>
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  const {
    loading,
    loadingMessage,
    error,
    allEntities,
    userToken,
    displayName,
    displayEmail,
    currentEntityName,
    theme,
    toggleTheme,
  } = useDashboard();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
      if (window.innerWidth >= 1024) setSidebarOpen(false);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // ─── GLOBAL GATE ───

  if (loading && !error) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex flex-col items-center justify-center h-screen gap-4 bg-slate-50 dark:bg-slate-900 transition-colors"
      >
        <Loader2 aria-hidden="true" className="w-10 h-10 animate-spin text-black dark:text-white" />
        <div className="flex flex-col items-center space-y-1 text-center">
          <p className="text-sm font-semibold text-slate-900 dark:text-white animate-pulse">
            {loadingMessage}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Fetching real-time web context and analyzing sentiment…
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen p-8 bg-slate-50 dark:bg-slate-900">
        <div
          role="alert"
          className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 rounded-2xl p-6 max-w-md text-center"
        >
          <AlertCircle aria-hidden="true" className="w-8 h-8 text-red-500 mx-auto mb-3" />
          <p className="text-red-700 dark:text-red-400 font-medium text-sm">{error}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 text-xs font-semibold text-red-600 dark:text-red-400 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded"
          >
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
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              Create your first tracking entity to deploy the monitoring agents.
            </p>
          </div>

          <CreateEntityForm userToken={userToken} />
        </div>
      </div>
    );
  }

  // ─── APP CHROME ───

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors duration-200">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        isMobile={isMobile}
        userName={displayName}
        userEmail={displayEmail}
      />

      <div className={`transition-[margin] duration-300 ${isMobile ? 'lg:ml-0' : 'lg:ml-64'}`}>
        <TopNavbar
          onMenuClick={() => setSidebarOpen(!sidebarOpen)}
          theme={theme}
          onThemeToggle={toggleTheme}
          entityName={currentEntityName}
          entities={allEntities}
          userName={displayName}
          userEmail={displayEmail}
        />

        <main className="max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-6 md:space-y-8">
          {children}
        </main>
      </div>
    </div>
  );
}
