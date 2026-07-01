'use client';

import { useEffect, useState } from 'react';
import LandingChoice from '@/components/LandingChoice';
import HomeContent from '@/components/HomeContent';
import { useAuthStore } from '@/store/useAuthStore';

export default function RootPage() {
  // Zustand's persist middleware hydrates from localStorage asynchronously
  // on the client. We track hydration explicitly to avoid a flash of the
  // Landing screen for returning users whose hasEnteredApp is actually true
  // but hasn't loaded from storage yet on first paint.
  const [isHydrated, setIsHydrated] = useState(false);
  const hasEnteredApp = useAuthStore((state) => state.hasEnteredApp);

  useEffect(() => {
    useAuthStore.persist.rehydrate();
    setIsHydrated(true);
  }, []);

  if (!isHydrated) {
    return <div className="min-h-[calc(100vh-64px)] bg-bg" />;
  }

  if (!hasEnteredApp) {
    return <LandingChoice />;
  }

  return <HomeContent />;
}
