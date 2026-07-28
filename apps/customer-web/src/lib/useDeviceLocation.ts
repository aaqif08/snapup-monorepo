'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type LocationStatus =
  | 'idle'
  /** Waiting on the browser prompt or a GPS fix. */
  | 'locating'
  | 'granted'
  /** The customer said no. Never re-prompt automatically — only on an explicit tap. */
  | 'denied'
  /** No geolocation API, or an insecure context (geolocation requires HTTPS). */
  | 'unavailable'
  /** Permission was fine but no fix arrived — indoors, timeout, GPS off. */
  | 'error';

export interface DeviceLocation {
  latitude: number;
  longitude: number;
  /** Radius of uncertainty in metres, as reported by the device. */
  accuracyMeters: number;
}

export interface DeviceLocationState {
  status: LocationStatus;
  location: DeviceLocation | null;
  message: string | null;
  request: () => void;
}

/**
 * High accuracy, because the whole point is to order shops by real proximity and a
 * network-derived fix can be off by kilometres in a city — enough to reorder the list.
 * The cost is a slower first fix and more battery, which is acceptable for a one-shot
 * read on a screen the customer opened specifically to find a nearby store.
 */
const POSITION_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 10_000,
  // Accept a fix up to a minute old. Re-acquiring GPS for someone who has not moved
  // meaningfully is pure latency.
  maximumAge: 60_000,
};

export function useDeviceLocation(): DeviceLocationState {
  const [status, setStatus] = useState<LocationStatus>('idle');
  const [location, setLocation] = useState<DeviceLocation | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Guards against a second request while one is already outstanding, and against the
  // mount effect racing a tap on the button.
  const inFlight = useRef(false);

  const request = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('unavailable');
      setMessage('This browser cannot share your location. Search for a store by name instead.');
      return;
    }
    if (inFlight.current) return;

    inFlight.current = true;
    setStatus('locating');
    setMessage(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        inFlight.current = false;
        setLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
        });
        setStatus('granted');
      },
      (error) => {
        inFlight.current = false;

        if (error.code === error.PERMISSION_DENIED) {
          setStatus('denied');
          setMessage(
            'Location access is off. Turn it on in your browser settings, or search for a store by name.'
          );
          return;
        }

        // Position unavailable or timed out. Distinct from denial: the customer did not
        // refuse, so offering a retry is reasonable here where it would be nagging there.
        setStatus('error');
        setMessage(
          error.code === error.TIMEOUT
            ? 'Could not get a location fix in time. Try again, or search by name.'
            : 'Your location is not available right now. Try again, or search by name.'
        );
      },
      POSITION_OPTIONS
    );
  }, []);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('unavailable');
      return;
    }

    let cancelled = false;

    // Consult the Permissions API first where it exists, so a customer who already
    // granted access gets their stores without seeing a prompt, and one who previously
    // refused is not prompted again on every visit. Firefox and older Safari lack
    // `permissions.query` for geolocation, hence the fallback to asking directly.
    if (navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'geolocation' as PermissionName })
        .then((permission) => {
          if (cancelled) return;
          if (permission.state === 'granted') request();
          else if (permission.state === 'denied') setStatus('denied');
          else setStatus('idle');
        })
        .catch(() => {
          if (!cancelled) setStatus('idle');
        });
    } else {
      setStatus('idle');
    }

    return () => {
      cancelled = true;
    };
  }, [request]);

  return { status, location, message, request };
}
