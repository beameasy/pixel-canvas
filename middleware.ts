import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export default async function middleware(req: NextRequest) {
  console.log('🔒 Middleware running for path:', req.nextUrl.pathname)
  const res = NextResponse.next()
  const supabase = createMiddlewareClient({ req, res })
  
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error) {
    console.error('❌ Middleware session error:', error)
  } else {
    console.log('✅ Middleware session:', session?.user?.id)
  }
  
  return res
}

// Add config to specify which routes to run middleware on
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|public/).*)',
  ],
} 