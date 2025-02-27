import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { redis } from '@/lib/server/redis'

// Define public routes that don't need auth
const PUBLIC_ROUTES = [
  { path: '/api/pixels', method: 'GET' },
  { path: '/api/canvas', method: 'GET' },
  { path: '/api/farcaster', method: 'GET' },
  { path: '/api/pixels/history', method: 'GET' },
  { path: '/api/pixels/latest', method: 'GET' },
  { path: '/api/ticker', method: 'GET' }
];

// Define canvas-specific rate limits
const RATE_LIMIT = {
  pixels: { points: 150, duration: 60 },   // More permissive, let tokenTiers handle specific cooldowns
  canvas: { points: 60, duration: 60 },    // Canvas state fetching
  general: { points: 100, duration: 60 }   // Other endpoints
};

// Define protected routes that need specific auth
const PROTECTED_ROUTES = [
  { path: '/api/pixels', method: 'POST' },
  { path: '/api/users/check-profile', method: 'POST' },
  { path: '/api/users/balance', method: 'GET' }
];

// Define admin-only routes
const ADMIN_ROUTES = [
  { path: '/api/admin', method: 'ALL' },
  // Add other admin routes here
];

// Define cron routes that need special secret
const CRON_ROUTES = [
  { path: '/api/cron/process-queue', method: 'ALL' }
];

// Define admin wallets array from environment variable
const ADMIN_WALLETS = (process.env.ADMIN_WALLETS || '')
  .split(',')
  .map(wallet => wallet.trim().toLowerCase())
  .filter(wallet => wallet.length > 0);

// Helper function to check if wallet is an admin
function isAdminWallet(walletAddress: string): boolean {
  return ADMIN_WALLETS.includes(walletAddress.toLowerCase());
}

async function checkRateLimit(ip: string, type: 'pixels' | 'canvas' | 'general') {
  const key = `rate_limit:${type}:${ip}`
  const limit = RATE_LIMIT[type]

  try {
    const requests = await redis.incr(key)
    if (requests === 1) {
      await redis.expire(key, limit.duration)
    }
    return requests <= limit.points
  } catch (error) {
    console.error('Rate limit error:', error)
    return true // Fail open for now
  }
}

// New function to check if a wallet is banned
async function isWalletBanned(walletAddress: string): Promise<boolean> {
  if (!walletAddress) return false;
  try {
    const result = await redis.sismember('banned:wallets:permanent', walletAddress.toLowerCase());
    return result === 1;
  } catch (error) {
    console.error('Error checking banned wallet status:', error);
    return false; // Fail open if Redis error
  }
}

// This function handles Privy token validation
export async function validatePrivyToken(token: string): Promise<string | null> {
  try {
    if (!token) return null;
    
    // Extract the payload to get the Privy ID
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const payload = Buffer.from(parts[1], 'base64').toString();
    const data = JSON.parse(payload);
    
    // Return the Privy ID from the token
    return data.sub || null;
  } catch (error) {
    console.error('Error validating Privy token:', error);
    return null;
  }
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const res = NextResponse.next();
  
  // Get the pathname and method from the request
  const { pathname } = req.nextUrl;
  const method = req.method;
  
  // Get real client IP for rate limiting
  const ip = req.headers.get('x-forwarded-for') || '127.0.0.1';
  
  // Check if route is in PUBLIC_ROUTES
  const isPublicRoute = PUBLIC_ROUTES.some(route => 
    pathname === route.path && (route.method === method || route.method === 'ALL')
  );
  
  // Check if route is in PROTECTED_ROUTES
  const isProtectedRoute = PROTECTED_ROUTES.some(route => 
    pathname === route.path && (route.method === method || route.method === 'ALL')
  );
  
  // Check if route is in ADMIN_ROUTES
  const isAdminRoute = ADMIN_ROUTES.some(route => 
    pathname.startsWith(route.path) && (route.method === method || route.method === 'ALL')
  );
  
  // Check if route is in CRON_ROUTES
  const isCronRoute = CRON_ROUTES.some(route => 
    pathname.startsWith(route.path) && (route.method === method || route.method === 'ALL')
  );
  
  // Apply rate limiting based on route type
  if (pathname.includes('/api/pixels') && method === 'POST') {
    const passed = await checkRateLimit(ip, 'pixels');
    if (!passed) {
      return NextResponse.json({ error: 'Rate limit exceeded for pixel placement' }, { status: 429 });
    }
  } else if (pathname.includes('/api/canvas')) {
    const passed = await checkRateLimit(ip, 'canvas');
    if (!passed) {
      return NextResponse.json({ error: 'Rate limit exceeded for canvas requests' }, { status: 429 });
    }
  } else if (pathname.includes('/api/')) {
    const passed = await checkRateLimit(ip, 'general');
    if (!passed) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }
  }
  
  // Special handling for cron routes
  if (isCronRoute) {
    const cronSecret = req.headers.get('x-cron-secret');
    if (cronSecret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return res;
  }
  
  // Public routes don't need authentication
  if (isPublicRoute) {
    return res;
  }
  
  // For protected and admin routes, verify authentication
  if (isProtectedRoute || isAdminRoute) {
    const privyToken = req.headers.get('x-privy-token');
    const walletAddress = req.headers.get('x-wallet-address');
    
    if (!privyToken) {
      console.log('No Privy token provided for protected route:', pathname);
      return NextResponse.json({ error: 'Unauthorized - Missing authentication' }, { status: 401 });
    }
    
    const privyId = await validatePrivyToken(privyToken);
    if (!privyId) {
      console.log('Invalid Privy token for protected route:', pathname);
      return NextResponse.json({ error: 'Unauthorized - Invalid authentication' }, { status: 401 });
    }
    
    // Add the validated Privy ID to the request headers
    res.headers.set('x-privy-id', privyId);
    
    // Check if the wallet is banned (only for pixel placement)
    if (pathname === '/api/pixels' && method === 'POST' && walletAddress) {
      const isBanned = await isWalletBanned(walletAddress);
      if (isBanned) {
        console.log('Banned wallet attempted pixel placement:', walletAddress);
        return NextResponse.json({ 
          error: 'Your wallet has been banned. You probably deserved it.',
          banned: true
        }, { status: 403 });
      }
    }
    
    // Check if the wallet is an admin and add to headers
    if (walletAddress && isAdminWallet(walletAddress)) {
      res.headers.set('x-is-admin', 'true');
      console.log('Admin access granted for wallet:', walletAddress);
    }
    
    // For admin routes, additional verification
    if (isAdminRoute) {
      if (!walletAddress || !isAdminWallet(walletAddress)) {
        return NextResponse.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
      }
    }
  }

  return res;
}

export const config = {
  matcher: [
    '/api/:path*',
    '/((?!_next/static|_next/image|favicon.ico|public/).*)',
  ]
} 