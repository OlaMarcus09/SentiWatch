'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  Radar,
  Bell,
  FileText,
  Lightbulb,
  Users,
  Puzzle,
  CreditCard,
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
  comingSoon?: boolean;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', icon: <LayoutDashboard className="w-5 h-5" />, href: '/' },
  { label: 'Monitoring', icon: <Radar className="w-5 h-5" />, href: '/monitoring', comingSoon: true },
  { label: 'Alerts', icon: <Bell className="w-5 h-5" />, href: '/alerts', comingSoon: true },
  { label: 'Reports', icon: <FileText className="w-5 h-5" />, href: '/reports', comingSoon: true },
  { label: 'Recommendations', icon: <Lightbulb className="w-5 h-5" />, href: '/recommendations', comingSoon: true },
  { label: 'Competitors', icon: <Users className="w-5 h-5" />, href: '/competitors', comingSoon: true },
  { label: 'Integrations', icon: <Puzzle className="w-5 h-5" />, href: '/integrations', comingSoon: true },
  { label: 'Billing', icon: <CreditCard className="w-5 h-5" />, href: '/billing', comingSoon: true },
  { label: 'Settings', icon: <Settings className="w-5 h-5" />, href: '/settings', comingSoon: true },
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  isMobile: boolean;
}

export default function Sidebar({ isOpen, onClose, isMobile }: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  const handleNavClick = (href: string, comingSoon?: boolean) => {
    if (comingSoon) {
      alert('🚀 Coming soon! This feature is in development.');
      return;
    }
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
            onClick={() => setCollapsed(!collapsed)}
            className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <ChevronLeft className="w-4 h-4 text-slate-400" />
          </button>
        )}
        {isMobile && (
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <button
              key={item.href}
              onClick={() => handleNavClick(item.href, item.comingSoon)}
              className={`
                w-full flex items-center gap-3 px-3 py-2.5 rounded-xl
                transition-all duration-200
                ${isActive 
                  ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' 
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                }
                ${collapsed ? 'justify-center' : ''}
              `}
            >
              <span className={isActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}>
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
              {!collapsed && item.comingSoon && (
                <span className="px-2 py-0.5 text-[10px] font-medium bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-full">
                  Soon
                </span>
              )}
            </button>
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
            <span>MA</span>
          </div>
          {!collapsed && (
            <div className="flex-1 text-left">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Marcus Adeyemi</p>
              <p className="text-xs text-slate-400 dark:text-slate-500">Pro Plan</p>
            </div>
          )}
          {!collapsed && (
            <button className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
              <LogOut className="w-4 h-4 text-slate-400" />
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
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50"
              onClick={onClose}
            />
            <motion.div
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              transition={{ type: 'spring', damping: 25 }}
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
      transition-all duration-300
      ${collapsed ? 'w-20' : 'w-64'}
    `}>
      {sidebarContent}
    </div>
  );
}