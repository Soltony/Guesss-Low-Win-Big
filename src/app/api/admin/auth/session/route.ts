import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Authoritative session endpoint.
 *
 * The Edge middleware calls this on every guarded request rather than
 * duplicating JWT and Prisma logic in the Edge runtime, so permissions are
 * always read fresh from the database — revoking a role takes effect at once.
 */
export async function GET(req: NextRequest) {
  // Called from middleware, cookies cannot be written on this pass.
  const fromMiddleware = req.headers.get('x-auth-session-check') === 'middleware';
  const user = await getCurrentUser({ allowRefresh: !fromMiddleware });

  if (!user) {
    return NextResponse.json({ authenticated: false }, { status: 200 });
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phoneNumber: user.phoneNumber,
    },
    role: user.role,
    roleId: user.roleId,
    permissions: user.permissions,
    passwordChangeRequired: user.passwordChangeRequired,
  });
}
