'use client';

import { useEffect, useState } from 'react';
import {
  AlertCircle,
  Bell,
  Building2,
  CheckCircle2,
  ChevronDown,
  Globe2,
  Mail,
  Monitor,
  Moon,
  Plus,
  Save,
  ShieldCheck,
  Sun,
  UserRound,
} from 'lucide-react';
import { useDashboard } from '@/components/providers/DashboardProvider';
import EntitySelector from '@/components/EntitySelector';
import CreateEntityForm from '@/components/CreateEntityForm';
import Card from '@/components/ui/Card';

const inputClass = 'mt-2 w-full min-h-11 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-blue-400';

function Toggle({ checked, disabled, label, description, onChange }: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  description: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-slate-200/80 p-3.5 transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/60 ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{label}</span>
        <span className="mt-0.5 block text-xs leading-5 text-slate-500 dark:text-slate-400">{description}</span>
      </span>
      <span className="relative shrink-0">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="block h-7 w-12 rounded-full bg-slate-300 transition peer-checked:bg-blue-600 peer-focus-visible:ring-4 peer-focus-visible:ring-blue-500/20 dark:bg-slate-600" />
        <span className="absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

function SectionTitle({ icon, title, description }: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-5 flex items-start gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-300">
        {icon}
      </span>
      <div className="min-w-0">
        <h2 className="font-semibold text-slate-900 dark:text-white">{title}</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{description}</p>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const {
    allEntities, currentEntity, userToken, displayName, displayEmail, theme,
    toggleTheme, refreshCompetitors, updateCurrentEntity,
  } = useDashboard();
  const [name, setName] = useState(currentEntity?.name || '');
  const [profileType, setProfileType] = useState(currentEntity?.profile_type || 'business');
  const [socialHandle, setSocialHandle] = useState(currentEntity?.social_handle || '');
  const [competitor, setCompetitor] = useState('');
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [dailyDigest, setDailyDigest] = useState(false);
  const [dailyDigestAvailable, setDailyDigestAvailable] = useState(false);
  const [loadingPreferences, setLoadingPreferences] = useState(true);
  const [showCreateProfile, setShowCreateProfile] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      setName(currentEntity?.name || '');
      setProfileType(currentEntity?.profile_type || 'business');
      setSocialHandle(currentEntity?.social_handle || '');
    });
  }, [currentEntity]);

  useEffect(() => {
    if (!userToken) return;
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/notification-preferences`, {
      headers: { Authorization: `Bearer ${userToken}` },
    })
      .then((response) => response.ok ? response.json() : null)
      .then((preferences) => {
        if (!preferences) return;
        setEmailAlerts(preferences.email_alerts_enabled !== false);
        setDailyDigestAvailable(preferences.daily_digest_available === true);
        setDailyDigest(preferences.daily_digest_available === true && preferences.daily_digest_enabled === true);
      })
      .catch(() => setMessage({ type: 'error', text: 'Could not load notification preferences.' }))
      .finally(() => setLoadingPreferences(false));
  }, [userToken]);

  const saveNotificationPreferences = async (nextEmail: boolean, nextDigest: boolean) => {
    const previousEmail = emailAlerts;
    const previousDigest = dailyDigest;
    setEmailAlerts(nextEmail);
    setDailyDigest(nextDigest);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/notification-preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
        body: JSON.stringify({ email_alerts_enabled: nextEmail, daily_digest_enabled: nextDigest }),
      });
      if (!response.ok) throw new Error('Preference update failed');
      setMessage({ type: 'success', text: 'Notification preferences saved.' });
    } catch {
      setEmailAlerts(previousEmail);
      setDailyDigest(previousDigest);
      setMessage({ type: 'error', text: 'Could not save notification preferences. Please try again.' });
    }
  };

  const saveEntity = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentEntity?.id) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/entities/${currentEntity.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
        body: JSON.stringify({ name, profile_type: profileType, social_handle: socialHandle || null }),
      });
      if (!response.ok) throw new Error('Update failed');
      updateCurrentEntity({ name, profile_type: profileType, social_handle: socialHandle || null });
      setMessage({ type: 'success', text: 'Profile settings saved.' });
    } catch {
      setMessage({ type: 'error', text: 'Could not save profile settings. Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  const addCompetitor = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!competitor.trim() || !currentEntity?.id) return;
    setAdding(true);
    setMessage(null);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/entities/${currentEntity.id}/competitors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
        body: JSON.stringify({ name: competitor.trim() }),
      });
      if (!response.ok) throw new Error('Add failed');
      setCompetitor('');
      await refreshCompetitors();
      setMessage({ type: 'success', text: 'Competitor added. Its analysis is now running.' });
    } catch {
      setMessage({ type: 'error', text: 'Could not add competitor. Please try again.' });
    } finally {
      setAdding(false);
    }
  };

  return (
    <section className="mx-auto max-w-6xl space-y-5 pb-10 sm:space-y-6">
      <header className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm dark:border-slate-700/70 dark:bg-slate-900">
        <div className="bg-gradient-to-br from-blue-600 via-blue-600 to-indigo-700 px-5 py-6 text-white sm:px-7 sm:py-8">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-100">Workspace settings</p>
          <div className="mt-2 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Manage your SentiWatch workspace</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-blue-100">Update monitored profiles, alert preferences, competitors, and how your dashboard appears.</p>
            </div>
            <div className="w-full rounded-xl bg-white/10 p-2 ring-1 ring-white/20 backdrop-blur-sm lg:w-auto lg:min-w-64">
              <EntitySelector entities={allEntities} />
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2 px-5 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-7 dark:text-slate-400">
          <span className="flex min-w-0 items-center gap-2"><UserRound className="h-4 w-4 shrink-0" /><span className="truncate">{displayName || 'Account'} · {displayEmail}</span></span>
          <span className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400"><ShieldCheck className="h-4 w-4" />Protected by Row Level Security</span>
        </div>
      </header>

      {message && (
        <div role={message.type === 'error' ? 'alert' : 'status'} className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${message.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300' : 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300'}`}>
          {message.type === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{message.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3 lg:gap-6">
        <div className="space-y-5 lg:col-span-2 lg:space-y-6">
          <Card hover={false} animate={false} className="p-4 sm:p-6">
            <SectionTitle icon={<Building2 className="h-5 w-5" />} title="Monitored profile" description="Define the identity used for search, sentiment analysis, and reputation scoring." />
            <form onSubmit={saveEntity} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-700 sm:col-span-2 dark:text-slate-300">Profile name
                <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} required />
              </label>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Profile type
                <select className={inputClass} value={profileType} onChange={(event) => setProfileType(event.target.value)}>
                  <option value="business">Business</option><option value="influencer">Influencer</option><option value="real_estate">Real estate</option><option value="student">Student</option>
                </select>
              </label>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Primary social handle
                <input className={inputClass} value={socialHandle} onChange={(event) => setSocialHandle(event.target.value)} placeholder="@yourbrand" />
              </label>
              <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-4 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
                <p className="text-xs leading-5 text-slate-500">Changes affect future searches and analysis runs.</p>
                <button disabled={saving || !name.trim()} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">
                  <Save className="h-4 w-4" />{saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          </Card>

          <Card hover={false} animate={false} className="p-4 sm:p-6">
            <SectionTitle icon={<Plus className="h-5 w-5" />} title="Competitor tracking" description="Add a competing brand to unlock side-by-side risk and mention comparisons." />
            <form onSubmit={addCompetitor} className="flex flex-col gap-3 sm:flex-row">
              <label className="sr-only" htmlFor="competitor-name">Competitor name</label>
              <input id="competitor-name" className={`${inputClass} mt-0 flex-1`} value={competitor} onChange={(event) => setCompetitor(event.target.value)} placeholder="e.g. OPay" />
              <button disabled={adding || !competitor.trim()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100">
                <Plus className="h-4 w-4" />{adding ? 'Adding…' : 'Add competitor'}
              </button>
            </form>
          </Card>

          <Card hover={false} animate={false} className="p-4 sm:p-6">
            <SectionTitle icon={<Globe2 className="h-5 w-5" />} title="Connected data sources" description="See which channels currently contribute evidence to your reputation score." />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/30">
                <div className="flex items-center justify-between gap-3"><span className="font-semibold text-emerald-800 dark:text-emerald-300">Web and news</span><span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300">Active</span></div>
                <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-400">RSS publishers and live Tavily search context.</p>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-900/50 dark:bg-amber-950/30">
                <div className="flex items-center justify-between gap-3"><span className="font-semibold text-amber-800 dark:text-amber-300">Social channels</span><span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:bg-amber-900/60 dark:text-amber-300">Configured by API</span></div>
                <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-400">YouTube, X, Facebook, Reddit, and approved connectors.</p>
              </div>
            </div>
          </Card>
        </div>

        <aside className="space-y-5 lg:space-y-6">
          <Card hover={false} animate={false} className="p-4 sm:p-5">
            <SectionTitle icon={<Bell className="h-5 w-5" />} title="Notifications" description="Choose which reputation events reach your inbox." />
            <div className="space-y-3">
              <Toggle checked={emailAlerts} disabled={loadingPreferences} label="Risk alerts" description="Email me when a score crosses an alert threshold." onChange={(checked) => saveNotificationPreferences(checked, dailyDigest)} />
              <Toggle checked={dailyDigest} disabled={loadingPreferences || !dailyDigestAvailable} label="Daily digest" description={dailyDigestAvailable ? 'Receive a daily summary of important changes.' : 'Available after digest delivery is enabled.'} onChange={(checked) => saveNotificationPreferences(emailAlerts, checked)} />
            </div>
          </Card>

          <Card hover={false} animate={false} className="p-4 sm:p-5">
            <SectionTitle icon={<Monitor className="h-5 w-5" />} title="Appearance" description="This preference is saved on your current device." />
            <button type="button" onClick={toggleTheme} className="flex min-h-12 w-full items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-left transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/20 dark:border-slate-700 dark:hover:bg-slate-800">
              <span className="flex items-center gap-3 text-sm font-semibold text-slate-800 dark:text-slate-100">{theme === 'dark' ? <Moon className="h-4 w-4 text-indigo-400" /> : <Sun className="h-4 w-4 text-amber-500" />}{theme === 'dark' ? 'Dark mode' : 'Light mode'}</span>
              <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">Switch</span>
            </button>
          </Card>

          <Card hover={false} animate={false} className="p-4 sm:p-5">
            <SectionTitle icon={<ShieldCheck className="h-5 w-5" />} title="Privacy and security" description="Workspace data is isolated per account with database-enforced access controls." />
            <div className="space-y-3 text-xs leading-5 text-slate-500 dark:text-slate-400">
              <p className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />Service credentials never reach your browser.</p>
              <p className="flex gap-2"><Mail className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />Alerts are sent only to your account email.</p>
            </div>
          </Card>
        </aside>
      </div>

      <Card hover={false} animate={false} className="overflow-hidden p-0">
        <button type="button" onClick={() => setShowCreateProfile((open) => !open)} aria-expanded={showCreateProfile} className="flex w-full items-center justify-between gap-4 p-4 text-left transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-blue-500/20 sm:p-6 dark:hover:bg-slate-800/60">
          <span className="flex min-w-0 items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-300"><UserRound className="h-5 w-5" /></span><span><span className="block font-semibold text-slate-900 dark:text-white">Create another profile</span><span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">Track another brand, public profile, or organization.</span></span></span>
          <ChevronDown className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${showCreateProfile ? 'rotate-180' : ''}`} />
        </button>
        {showCreateProfile && <div className="border-t border-slate-200 p-3 sm:p-6 dark:border-slate-700"><CreateEntityForm userToken={userToken} /></div>}
      </Card>
    </section>
  );
}
