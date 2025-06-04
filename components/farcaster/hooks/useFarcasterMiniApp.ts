import { useEffect, useState } from 'react';
import { sdk } from '@farcaster/frame-sdk';

/**
 * Detect if the app is running inside the Warpcast Farcaster mini app
 * environment. Detection relies on the user agent or the presence of a
 * `warpcast` object on `window` which Warpcast injects for mini apps.
 */
export function useFarcasterMiniApp() {
  const [isMiniApp, setIsMiniApp] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function detect() {
      try {
        const result = await sdk.isInMiniApp();
        if (!cancelled) setIsMiniApp(result);
      } catch {
        if (typeof window !== 'undefined') {
          const ua = navigator.userAgent || '';
          const warpcastUA = /warpcast/i.test(ua) || /farcaster/i.test(ua);
          const hasWarpcastObj = typeof (window as any).warpcast !== 'undefined';
          if (!cancelled && (warpcastUA || hasWarpcastObj)) {
            setIsMiniApp(true);
          }
        }
      }
    }

    detect();

    return () => {
      cancelled = true;
    };
  }, []);

  return { isMiniApp };
}
