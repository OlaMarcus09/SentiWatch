'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import {
  LayoutDashboard,
  Radar,
  Bell,
  Lightbulb,
  Users,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
} from 'lucide-react';

interface NavItem {
  label: string;
  icon: React.ReactNode;
  href: string;
  badge?: number;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', icon: <LayoutDashboard className="w-5 h-5" />, href: '/' },
  { label: 'Insights', icon: <Radar className="w-5 h-5" />, href: '/insights' },
  { label: 'Alerts', icon: <Bell className="w-5 h-5" />, href: '/alerts' },
  { label: 'Recommendations', icon: <Lightbulb className="w-5 h-5" />, href: '/recommendations' },
  { label: 'Competitors', icon: <Users className="w-5 h-5" />, href: '/competitors' },
  { label: 'Settings', icon: <Settings className="w-5 h-5" />, href: '/settings' },
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  isMobile: boolean;
  userName?: string;
  userEmail?: string;
}

export default function Sidebar({ isOpen, onClose, isMobile, userName, userEmail }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const entityId = searchParams.get('entity_id');
  const router = useRouter();
  const prefersReducedMotion = useReducedMotion();
  const [collapsed, setCollapsed] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

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

  const handleNavClick = (href: string) => {
    if (isMobile) onClose();
  };

  const sidebarContent = (
    <div className="h-full flex flex-col bg-white dark:bg-slate-900 border-r border-slate-200/60 dark:border-slate-800/60">
      {/* Logo */}
      <div className="flex items-center justify-between h-16 px-4 border-b border-slate-200/60 dark:border-slate-800/60">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center">
            <span className="text-white font-bold text-sm">SW</span>
          </div>
          {!collapsed && (
            <span className="text-lg font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              SentiWatch
            </span>
          )}
        </Link>
        {!isMobile && !collapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            aria-label="Collapse sidebar"
            className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <ChevronLeft aria-hidden="true" className="w-4 h-4 text-slate-400" />
          </button>
        )}
        {!isMobile && collapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            aria-label="Expand sidebar"
            className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <ChevronRight aria-hidden="true" className="w-4 h-4 text-slate-400" />
          </button>
        )}
        {isMobile && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation menu"
            className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <X aria-hidden="true" className="w-5 h-5 text-slate-500" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          const baseClasses = `
            w-full flex items-center gap-3 px-3 py-2.5 rounded-xl
            transition-colors duration-200
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
            ${isActive
              ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
            }
            ${collapsed ? 'justify-center' : ''}
          `;

          const inner = (
            <>
              <span aria-hidden="true" className={isActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}>
                {item.icon}
              </span>
              {!collapsed && (
                <span className="flex-1 text-sm font-medium text-left">{item.label}</span>
              )}
              {!collapsed && item.badge && (
                <span className="px-2 py-0.5 text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full">
                  {item.badge}
                </span>
              )}
            </>
          );

          // Preserve the selected entity across tab switches.
          const href = entityId ? `${item.href}?entity_id=${entityId}` : item.href;
          return (
            <Link
              key={item.href}
              href={href}
              onClick={() => handleNavClick(item.href)}
              aria-label={collapsed ? item.label : undefined}
              aria-current={isActive ? 'page' : undefined}
              className={baseClasses}
            >
              {inner}
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="border-t border-slate-200/60 dark:border-slate-800/60 p-4 space-y-2">
        <div className={`
          flex items-center gap-3 px-3 py-2.5 rounded-xl
          ${collapsed ? 'justify-center' : ''}
        `}>
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold">
            <span>{initials}</span>
          </div>
          {!collapsed && (
            <div className="flex-1 text-left min-w-0">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{userName || 'Account'}</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 truncate">{userEmail || ''}</p>
            </div>
          )}
          {!collapsed && (
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              aria-label="Sign out"
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <LogOut aria-hidden="true" className="w-4 h-4 text-slate-400" />
            </button>
          )}
        </div>
      </div>
    </div>
  );

  // Mobile drawer overlay
  if (isMobile) {
    return (
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={prefersReducedMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={prefersReducedMotion ? undefined : { opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50"
              onClick={onClose}
            />
            <motion.div
              initial={prefersReducedMotion ? false : { x: -300 }}
              animate={{ x: 0 }}
              exit={prefersReducedMotion ? undefined : { x: -300 }}
              transition={prefersReducedMotion ? { duration: 0 } : { type: 'spring', damping: 25 }}
              className="fixed left-0 top-0 bottom-0 w-72 z-50"
            >
              {sidebarContent}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    );
  }

  // Desktop sidebar
  return (
    <div className={`
      fixed left-0 top-0 bottom-0 z-40
      transition-[width] duration-300
      ${collapsed ? 'w-20' : 'w-64'}
    `}>
      {sidebarContent}
    </div>
  );
}