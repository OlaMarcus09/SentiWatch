'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import EntitySelector from '@/components/EntitySelector';
import Link from 'next/link';
import {
  Search,
  Bell,
  Moon,
  Sun,
  Menu,
  ChevronDown,
  User,
  Settings,
  LogOut,
} from 'lucide-react';

interface TopNavbarProps {
  onMenuClick: () => void;
  theme: 'light' | 'dark';
  onThemeToggle: () => void;
  entityName: string;
  entities: any[];
  userName?: string;
  userEmail?: string;
}

export default function TopNavbar({
  onMenuClick,
  theme,
  onThemeToggle,
  entityName,
  entities,
  userName,
  userEmail,
}: TopNavbarProps) {
  const router = useRouter();
  const prefersReducedMotion = useReducedMotion();
  const [showProfile, setShowProfile] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [query, setQuery] = useState('');
  const profileRef = useRef<HTMLDivElement>(null);

  // Close the profile dropdown on outside click or Escape.
  useEffect(() => {
    if (!showProfile) return;
    const onPointerDown = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setShowProfile(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowProfile(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showProfile]);

  const handleSignOut = async () => {
    setSigningOut(true);
    await supabase.auth.signOut();
    router.push('/login');
  };

  const initials =
    (userName || userEmail || '?')
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('') || '?';

  return (
    <header className="sticky top-0 z-30 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-slate-200/60 dark:border-slate-800/60">
      <div className="flex items-center justify-between h-16 px-4 md:px-6">
        {/* Left: Menu + Title + Entity Switcher */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <button
            type="button"
            onClick={onMenuClick}
            aria-label="Open navigation menu"
            className="lg:hidden p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 flex-shrink-0"
          >
            <Menu aria-hidden="true" className="w-5 h-5 text-slate-600 dark:text-slate-400" />
          </button>
          {/* Mobile: entity selector only */}
          {entities.length > 1 ? (
            <div className="lg:hidden min-w-0 flex-1">
              <EntitySelector entities={entities} />
            </div>
          ) : (
            <span className="lg:hidden text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">
              {entityName || 'Overview'}
            </span>
          )}
          {/* Desktop: breadcrumb + entity selector */}
          <div className="hidden lg:flex items-center gap-2">
            <h2 className="text-sm font-medium text-slate-600 dark:text-slate-400">
              Dashboard
            </h2>
            <span className="text-slate-300 dark:text-slate-600">/</span>
            {entities.length > 1 ? (
              <EntitySelector entities={entities} />
            ) : (
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                {entityName || 'Overview'}
              </span>
            )}
          </div>
        </div>

        {/* Center: Search (desktop) */}
        <div className="hidden md:flex flex-1 max-w-md mx-8">
          <div className="relative w-full">
            <label htmlFor="global-search" className="sr-only">Search mentions, alerts &amp; brands</label>
            <Search aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
            <input
              id="global-search"
              name="search"
              type="search"
              autoComplete="off"
              spellCheck={false}
              placeholder="Search current alerts…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && query.trim()) {
                  router.push(`/alerts?search=${encodeURIComponent(query.trim())}`);
                }
              }}
              className="w-full pl-9 pr-4 py-2 text-sm bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus:border-transparent transition-colors"
            />
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1">
          {/* Theme toggle */}
          <button
            type="button"
            onClick={onThemeToggle}
            aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {theme === 'light' ? (
              <Moon aria-hidden="true" className="w-5 h-5 text-slate-500" />
            ) : (
              <Sun aria-hidden="true" className="w-5 h-5 text-yellow-400" />
            )}
          </button>

          {/* Notifications */}
          <button
            type="button"
            aria-label="Notifications"
            onClick={() => router.push('/alerts')}
            className="relative p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <Bell aria-hidden="true" className="w-5 h-5 text-slate-500" />
          </button>

          {/* Profile */}
          <div className="relative" ref={profileRef}>
            <button
              type="button"
              onClick={() => setShowProfile(!showProfile)}
              aria-label="Account menu"
              aria-haspopup="menu"
              aria-expanded={showProfile}
              className="flex items-center gap-2 pl-2 pr-1 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold">
                <span>{initials}</span>
              </div>
              <ChevronDown aria-hidden="true" className="w-4 h-4 text-slate-400" />
            </button>

            {showProfile && (
              <motion.div
                role="menu"
                initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute right-0 mt-2 w-56 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xl overflow-hidden z-50"
              >
                <div className="p-4 border-b border-slate-100 dark:border-slate-700">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{userName || 'Account'}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{userEmail || ''}</p>
                </div>
                <div className="p-2">
                  <Link href="/settings" role="menuitem" onClick={() => setShowProfile(false)} className="w-full flex items-center gap-3 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg">
                    <User aria-hidden="true" className="w-4 h-4" />
                    <span className="flex-1 text-left">Profile</span>
                  </Link>
                  <Link href="/settings" role="menuitem" onClick={() => setShowProfile(false)} className="w-full flex items-center gap-3 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg">
                    <Settings aria-hidden="true" className="w-4 h-4" />
                    <span className="flex-1 text-left">Settings</span>
                  </Link>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleSignOut}
                    disabled={signingOut}
                    className="w-full flex items-center gap-3 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                  >
                    <LogOut aria-hidden="true" className="w-4 h-4" /> {signingOut ? 'Signing out…' : 'Sign out'}
                  </button>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
