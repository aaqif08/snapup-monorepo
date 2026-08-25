'use client';

import { useEffect } from 'react';
import HomeContent from '@/components/HomeContent';
import { useAuthStore } from '@/store/useAuthStore';

/**
 * The home screen, shown immediately.
 *
 * There used to be a landing gate here — "Continue as Guest" or "Login with Phone Number"
 * — before the app would show anything. The design has no such screen: it opens on Home
 * with an avatar in the corner, which is the better shape. Browsing shops needs no
 * account, and asking for one before showing anything is a wall in front of the thing
 * that would persuade someone to sign up.
 *
 * Signing in still happens, just at the point it is actually needed: the avatar, and the
 * checkout discount.
 */
export default function RootPage() {
  const hydrate = useAuthStore((state) => state.hydrate);

  useEffect(() => {
    useAuthStore.persist.rehydrate();
    // Local storage says what we last knew; the server says what is true. This is what
    // makes a session that never expires still respond to being revoked.
    void hydrate();
  }, [hydrate]);

  return <HomeContent />;
}
