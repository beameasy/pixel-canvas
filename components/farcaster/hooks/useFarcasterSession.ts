import { useEffect, useState } from 'react';
import { useFarcasterMiniApp } from './useFarcasterMiniApp';
import { sdk } from '@farcaster/frame-sdk';

export interface FarcasterSession {
  fid: number;
  custodyAddress: string;
  username?: string;
  displayName?: string;
  pfpUrl?: string;
}

export function useFarcasterSession() {
  const { isMiniApp } = useFarcasterMiniApp();
  const [session, setSession] = useState<FarcasterSession | null>(null);

  useEffect(() => {
    if (!isMiniApp) return;

    let cancelled = false;

    async function loadSession() {
      try {
        const context = await sdk.context;
        if (!cancelled && context?.user?.fid) {
          setSession({
            fid: context.user.fid,
            custodyAddress: (context as any).user.custodyAddress?.toLowerCase() || '',
            username: context.user.username,
            displayName: context.user.displayName,
            pfpUrl: context.user.pfpUrl,
          });
          return;
        }
      } catch (err) {
        // continue with fallback
      }

      if (typeof window === 'undefined') return;

      try {
        const wc: any = (window as any).warpcast;
        if (wc && typeof wc.getUserData === 'function') {
          const data = await wc.getUserData();
          if (data && data.fid && data.custody_address) {
            if (!cancelled) {
              setSession({
                fid: data.fid,
                custodyAddress: data.custody_address.toLowerCase(),
                username: data.username,
                displayName: data.display_name,
                pfpUrl: data.pfp_url,
              });
            }
          }
        }
      } catch (err) {
        console.error('Failed to load Farcaster session', err);
      }
    }

    loadSession();

    return () => {
      cancelled = true;
    };
  }, [isMiniApp]);

  return { session };
}
