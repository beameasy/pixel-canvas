import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { redis } from '@/lib/server/redis'
import { jwtVerify, createRemoteJWKSet } from 'jose'
import { z } from 'zod'

// Define public routes that don't need auth
const PUBLIC_ROUTES = [
  { path: '/api/pixels', method: 'GET' },
  { path: '/api/canvas', method: 'GET' },
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
  { path: '/api/farcaster', method: 'GET' },
  { path: '/api/users/check-profile', method: 'POST' },
  { path: '/api/users/balance', method: 'GET' },
  { path: '/api/users/[address]', method: 'GET' }
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

const JWKS = createRemoteJWKSet(
  new URL('https://auth.privy.io/api/v1/apps/cm619rgk5006nbotrbkyoanze/jwks.json')
);

export async function validatePrivyToken(token: string): Promise<string | null> {
  try {
    if (!token) return null;
    
    // Use proper JWT verification
    const { payload, protectedHeader } = await jwtVerify(token, JWKS);
    
    // Additional time-based validation
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < now) {
      console.log('Token expired', { exp: payload.exp, now });
      return null;
    }

    if (!payload.iat || now - payload.iat > 60 * 60 * 24) { // 24 hour max token age
      console.log('Token too old', { iat: payload.iat, now });
      return null;
    }
    
    // Add additional validation if needed
    const sub = payload.sub as string;
    if (!sub) return null;
    
    return sub;
  } catch (error) {
    console.error('Error validating Privy token:', error);
    return null;
  }
}

// Add validation schemas
const PixelPlacementSchema = z.object({
  x: z.number().int().min(0).max(399),
  y: z.number().int().min(0).max(399),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  version: z.number().optional()
});

const UserProfileSchema = z.object({
  wallet_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  privy_id: z.string()
});

// Add before middleware function
async function validateRequestBody(req: Request, schema: z.ZodSchema) {
  try {
    const contentType = req.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      throw new Error('Content-Type must be application/json');
    }

    const body = await req.json();
    return schema.parse(body);
  } catch (error) {
    console.error('Request validation error:', error);
    return null;
  }
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const res = NextResponse.next();
  
  // Add size limit check
  const contentLength = parseInt(req.headers.get('content-length') || '0');
  if (contentLength > 10000) { // 10KB limit
    return NextResponse.json({ error: 'Request too large' }, { status: 413 });
  }
  
  // Only add security headers to API responses, not HTML pages
  if (req.nextUrl.pathname.startsWith('/api/')) {
    // Add security headers to API responses
    res.headers.set('Content-Type', 'application/json; charset=utf-8');
    res.headers.set('X-Content-Type-Options', 'nosniff');
    
    // Override the response generation
    const originalJson = NextResponse.json;
    NextResponse.json = function(body: any, init?: ResponseInit) {
      // Add anti-hijacking prefix to JSON
      const safeBody = typeof body === 'object' ? 
        { ...body, security_prefix: ")]}',\n" } : body;
      
      const response = originalJson(safeBody, init);
      
      // Add security headers
      response.headers.set('Content-Type', 'application/json; charset=utf-8');
      response.headers.set('X-Content-Type-Options', 'nosniff');
      
      return response;
    };
    
    // For state-changing operations, ensure CSRF protection
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      // Check origin header against your domain
      const origin = req.headers.get('origin');
      const host = req.headers.get('host');
      
      if (!origin || !host || !origin.includes(host)) {
        return NextResponse.json(
          { error: 'Cross-origin request rejected' }, 
          { status: 403 }
        );
      }
    }
  }
  
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
  
  // For protected and admin routes, strengthen verification
  if (isProtectedRoute || isAdminRoute) {
    const privyToken = req.headers.get('x-privy-token');
    const walletAddress = req.headers.get('x-wallet-address')?.toLowerCase();
    
    if (!privyToken || !walletAddress) {
      return NextResponse.json({ error: 'Unauthorized - Missing credentials' }, { status: 401 });
    }
    
    // Validate Privy token
    const privyId = await validatePrivyToken(privyToken);
    if (!privyId) {
      return NextResponse.json({ error: 'Unauthorized - Invalid token' }, { status: 401 });
    }

    // SPECIAL HANDLING FOR PROFILE CREATION
    // If this is a check-profile request, allow it to proceed with verified token
    // but without requiring an existing user profile
    if (pathname === '/api/users/check-profile' && method === 'POST') {
      // Add validated data to headers for profile creation
      res.headers.set('x-privy-id', privyId);
      res.headers.set('x-verified-wallet', walletAddress);
      res.headers.set('x-wallet-verified-at', Date.now().toString());
      return res;
    }

    // For all other protected routes, require existing user profile
    const userData = await redis.hget('users', walletAddress);
    if (!userData) {
      return NextResponse.json({ error: 'Unauthorized - Wallet not found' }, { status: 401 });
    }

    const parsedData = typeof userData === 'string' ? JSON.parse(userData) : userData;
    if (parsedData.privy_id !== privyId) {
      console.log('🚨 Attempted wallet address spoofing', {
        wallet: walletAddress,
        claimed_privy_id: privyId
      });
      return NextResponse.json({ error: 'Unauthorized - Invalid wallet' }, { status: 401 });
    }

    // Add validated data to headers
    res.headers.set('x-privy-id', privyId);
    res.headers.set('x-verified-wallet', walletAddress);
    // Add timestamp to indicate when verification happened
    res.headers.set('x-wallet-verified-at', Date.now().toString());
    
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

  // Add JSON validation for specific routes
  if (pathname === '/api/pixels' && method === 'POST') {
    const reqClone = new Request(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body
    });
    const validatedBody = await validateRequestBody(reqClone, PixelPlacementSchema);
    if (!validatedBody) {
      return NextResponse.json({ error: 'Invalid pixel placement data' }, { status: 400 });
    }
  }

  if (pathname === '/api/users/check-profile' && method === 'POST') {
    const reqClone = new Request(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body
    });
    const validatedBody = await validateRequestBody(reqClone, UserProfileSchema);
    if (!validatedBody) {
      return NextResponse.json({ error: 'Invalid user profile data' }, { status: 400 });
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