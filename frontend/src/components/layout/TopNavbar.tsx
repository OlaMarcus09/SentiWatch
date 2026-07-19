'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
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
  userName?: string;
  userEmail?: string;
}

export default function TopNavbar({
  onMenuClick,
  theme,
  onThemeToggle,
  entityName,
  userName,
  userEmail,
}: TopNavbarProps) {
  const [showProfile, setShowProfile] = useState(false);

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
        {/* Left: Menu + Title */}
        <div className="flex items-center gap-3">
          <button
            onClick={onMenuClick}
            className="lg:hidden p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <Menu className="w-5 h-5 text-slate-600 dark:text-slate-400" />
          </button>
          <div className="hidden lg:flex items-center gap-2">
            <h2 className="text-sm font-medium text-slate-600 dark:text-slate-400">
              Dashboard
            </h2>
            <span className="text-slate-300 dark:text-slate-600">/</span>
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              {entityName || 'Overview'}
            </span>
          </div>
        </div>

        {/* Center: Search (desktop) */}
        <div className="hidden md:flex flex-1 max-w-md mx-8">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
            <input
              type="text"
              placeholder="Search mentions, alerts, brands..."
              className="w-full pl-9 pr-4 py-2 text-sm bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            />
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1">
          {/* Theme toggle */}
          <button
            onClick={onThemeToggle}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            {theme === 'light' ? (
              <Moon className="w-5 h-5 text-slate-500" />
            ) : (
              <Sun className="w-5 h-5 text-yellow-400" />
            )}
          </button>

          {/* Notifications */}
          <button className="relative p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <Bell className="w-5 h-5 text-slate-500" />
            <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
          </button>

          {/* Profile */}
          <div className="relative">
            <button
              onClick={() => setShowProfile(!showProfile)}
              className="flex items-center gap-2 pl-2 pr-1 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold">
                <span>{initials}</span>
              </div>
              <ChevronDown className="w-4 h-4 text-slate-400" />
            </button>

            {showProfile && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute right-0 mt-2 w-56 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xl overflow-hidden z-50"
              >
                <div className="p-4 border-b border-slate-100 dark:border-slate-700">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{userName || 'Account'}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{userEmail || ''}</p>
                </div>
                <div className="p-2">
                  <button className="w-full flex items-center gap-3 px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-colors">
                    <User className="w-4 h-4" /> Profile
                  </button>
                  <button className="w-full flex items-center gap-3 px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-colors">
                    <Settings className="w-4 h-4" /> Settings
                  </button>
                  <button className="w-full flex items-center gap-3 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors">
                    <LogOut className="w-4 h-4" /> Sign out
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