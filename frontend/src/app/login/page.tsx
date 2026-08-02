// app/login/page.tsx
'use client';

import { supabase } from '@/lib/supabase';
import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function LoginPage() {
  const router = useRouter();

  useEffect(() => {
    // Listen for login state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        router.push('/'); // Send them to the dashboard when they log in
        router.refresh();
      }
    });

    return () => subscription.unsubscribe();
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full p-8 bg-white rounded-2xl shadow-sm border border-gray-100">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-slate-900">SentiWatch Auth</h1>
          <p className="text-slate-500 text-sm mt-2">Sign in to monitor your brands</p>
        </div>
        
        <Auth
          supabaseClient={supabase}
          appearance={{ theme: ThemeSupa }}
          providers={['google']} // You can add 'github' etc. later
          theme="light"
          redirectTo="https://senti-watch.vercel.app/auth/callback"
        />
      </div>
    </div>
  );
}
