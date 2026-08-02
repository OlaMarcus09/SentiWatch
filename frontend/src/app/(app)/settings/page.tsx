'use client';

import { useEffect, useState } from 'react';
import { Bell, Globe2, Monitor, Plus, Save, ShieldCheck, UserRound } from 'lucide-react';
import { useDashboard } from '@/components/providers/DashboardProvider';
import EntitySelector from '@/components/EntitySelector';
import CreateEntityForm from '@/components/CreateEntityForm';
import Card from '@/components/ui/Card';

const inputClass = 'w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

export default function SettingsPage() {
  const {
    allEntities,
    currentEntity,
    userToken,
    displayName,
    displayEmail,
    theme,
    toggleTheme,
    refreshCompetitors,
    updateCurrentEntity,
  } = useDashboard();
  const [name, setName] = useState(currentEntity?.name || '');
  const [profileType, setProfileType] = useState(currentEntity?.profile_type || 'business');
  const [socialHandle, setSocialHandle] = useState(currentEntity?.social_handle || '');
  const [competitor, setCompetitor] = useState('');
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [dailyDigest, setDailyDigest] = useState(false);
  const [dailyDigestAvailable, setDailyDigestAvailable] = useState(false);
  const [loadingPreferences, setLoadingPreferences] = useState(true);

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
      .catch(() => setMessage('Could not load notification preferences.'))
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
      setMessage('Notification preferences saved.');
    } catch {
      setEmailAlerts(previousEmail);
      setDailyDigest(previousDigest);
      setMessage('Could not save notification preferences. Please try again.');
    }
  };

  const saveEntity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentEntity?.id) return;
    setSaving(true); setMessage(null);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/entities/${currentEntity.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
        body: JSON.stringify({ name, profile_type: profileType, social_handle: socialHandle || null }),
      });
      if (!response.ok) throw new Error('Update failed');
      updateCurrentEntity({ name, profile_type: profileType, social_handle: socialHandle || null });
      setMessage('Profile settings saved.');
    } catch {
      setMessage('Could not save profile settings. Please try again.');
    } finally { setSaving(false); }
  };

  const addCompetitor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!competitor.trim() || !currentEntity?.id) return;
    setAdding(true); setMessage(null);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/entities/${currentEntity.id}/competitors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
        body: JSON.stringify({ name: competitor.trim() }),
      });
      if (!response.ok) throw new Error('Add failed');
      setCompetitor('');
      await refreshCompetitors();
      setMessage('Competitor added and analysis started.');
    } catch { setMessage('Could not add competitor. Please try again.'); }
    finally { setAdding(false); }
  };

  return (
    <section className="space-y-6 pb-8">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600 dark:text-blue-400">Workspace settings</p>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">Control how SentiWatch works</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">Manage your profile, monitored entities, alerts, and connected data sources.</p>
        </div>
        <Card hover={false} className="p-2"><EntitySelector entities={allEntities} /></Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
          <Card hover={false} className="p-6">
            <div className="flex items-start gap-3 mb-5"><UserRound className="w-5 h-5 text-blue-500 mt-0.5" /><div><h2 className="font-semibold text-slate-900 dark:text-white">Monitored profile</h2><p className="text-xs text-slate-500 mt-1">This is the identity SentiWatch searches and scores.</p></div></div>
            <form onSubmit={saveEntity} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="text-sm text-slate-600 dark:text-slate-300 md:col-span-2">Profile name<input className={`${inputClass} mt-1.5`} value={name} onChange={(e) => setName(e.target.value)} required /></label>
              <label className="text-sm text-slate-600 dark:text-slate-300">Profile type<select className={`${inputClass} mt-1.5`} value={profileType} onChange={(e) => setProfileType(e.target.value)}><option value="business">Business</option><option value="influencer">Influencer</option><option value="real_estate">Real estate</option><option value="student">Student</option></select></label>
              <label className="text-sm text-slate-600 dark:text-slate-300">Primary social handle<input className={`${inputClass} mt-1.5`} value={socialHandle} onChange={(e) => setSocialHandle(e.target.value)} placeholder="@yourbrand" /></label>
              <div className="md:col-span-2 flex items-center justify-between gap-3 pt-2"><span className="text-xs text-slate-500">Signed in as {displayName || 'account'} · {displayEmail}</span><button disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"><Save className="w-4 h-4" />{saving ? 'Saving…' : 'Save changes'}</button></div>
            </form>
          </Card>

          <Card hover={false} className="p-6">
            <div className="flex items-start gap-3 mb-5"><Plus className="w-5 h-5 text-violet-500 mt-0.5" /><div><h2 className="font-semibold text-slate-900 dark:text-white">Competitor tracking</h2><p className="text-xs text-slate-500 mt-1">Add competitors here and they will appear immediately in the competitor workspace.</p></div></div>
            <form onSubmit={addCompetitor} className="flex flex-col sm:flex-row gap-3"><input className={inputClass} value={competitor} onChange={(e) => setCompetitor(e.target.value)} placeholder="e.g. PiggyVest" /><button disabled={adding || !competitor.trim()} className="inline-flex justify-center items-center gap-2 rounded-lg bg-slate-900 dark:bg-white dark:text-slate-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"><Plus className="w-4 h-4" />{adding ? 'Adding…' : 'Add competitor'}</button></form>
          </Card>

          <Card hover={false} className="p-6"><div className="flex items-start gap-3"><Globe2 className="w-5 h-5 text-emerald-500 mt-0.5" /><div><h2 className="font-semibold text-slate-900 dark:text-white">Data sources</h2><p className="text-xs text-slate-500 mt-1">News and web search are active. Social connectors can be enabled as provider credentials and permissions are configured.</p><div className="grid sm:grid-cols-2 gap-3 mt-4"><div className="rounded-xl border border-emerald-200 bg-emerald-50/70 dark:bg-emerald-900/10 dark:border-emerald-900/40 p-3 text-sm"><span className="font-medium text-emerald-700 dark:text-emerald-300">Web/news</span><p className="text-xs text-slate-500 mt-1">Active via RSS and Tavily context.</p></div><div className="rounded-xl border border-amber-200 bg-amber-50/70 dark:bg-amber-900/10 dark:border-amber-900/40 p-3 text-sm"><span className="font-medium text-amber-700 dark:text-amber-300">Social comments</span><p className="text-xs text-slate-500 mt-1">Requires official APIs or approved connectors.</p></div></div></div></div></Card>
        </div>

        <div className="space-y-6">
          <Card hover={false} className="p-6"><div className="flex items-start gap-3"><Bell className="w-5 h-5 text-rose-500 mt-0.5" /><div><h2 className="font-semibold text-slate-900 dark:text-white">Alerts</h2><p className="text-xs text-slate-500 mt-1">Email alerts are sent when risk thresholds are crossed.</p><label className="flex items-center justify-between gap-4 mt-5 text-sm text-slate-600 dark:text-slate-300">Email notifications<input type="checkbox" disabled={loadingPreferences} checked={emailAlerts} onChange={(e) => saveNotificationPreferences(e.target.checked, dailyDigest)} className="h-4 w-4 accent-blue-600" /></label><label className="flex items-center justify-between gap-4 mt-4 text-sm text-slate-600 dark:text-slate-300">Daily digest<span className="flex items-center gap-2"><input type="checkbox" disabled={loadingPreferences || !dailyDigestAvailable} checked={dailyDigest} onChange={(e) => saveNotificationPreferences(emailAlerts, e.target.checked)} className="h-4 w-4 accent-blue-600" />{!dailyDigestAvailable && <span className="text-[10px] text-slate-400">Coming soon</span>}</span></label><p className="text-[11px] text-slate-400 mt-3">Changes apply to future risk calculations.</p></div></div></Card>
          <Card hover={false} className="p-6"><div className="flex items-start gap-3"><Monitor className="w-5 h-5 text-slate-500 mt-0.5" /><div><h2 className="font-semibold text-slate-900 dark:text-white">Appearance</h2><p className="text-xs text-slate-500 mt-1">Choose how the dashboard looks on this device.</p><button type="button" onClick={toggleTheme} className="mt-4 w-full flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2.5 text-sm text-slate-700 dark:text-slate-200"><span>{theme === 'dark' ? 'Dark mode' : 'Light mode'}</span><span className="text-xs text-blue-600">Change</span></button></div></div></Card>
          <Card hover={false} className="p-6"><div className="flex items-start gap-3"><ShieldCheck className="w-5 h-5 text-blue-500 mt-0.5" /><div><h2 className="font-semibold text-slate-900 dark:text-white">Privacy & security</h2><p className="text-xs text-slate-500 mt-1">Your browser reads only data permitted by Supabase Row Level Security. Service credentials are never exposed to the frontend.</p></div></div></Card>
          {message && <p role="status" className="text-sm text-emerald-600 dark:text-emerald-400">{message}</p>}
        </div>
      </div>
      <Card hover={false} className="p-6"><h2 className="font-semibold text-slate-900 dark:text-white">Create another profile</h2><p className="text-xs text-slate-500 mt-1 mb-4">Track another brand, public profile, or organization from the same workspace.</p><CreateEntityForm userToken={userToken} /></Card>
    </section>
  );
}
