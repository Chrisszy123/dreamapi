import type { FastifyRequest, FastifyReply } from 'fastify';
import { UnauthorizedError } from '../errors.js';
import type { AuthenticatedUser } from '@dreamapi/types';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; wallet: string };
    user: AuthenticatedUser;
  }
}

export async function requireAuth(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedError(
      'MISSING_TOKEN',
      'Authorization header with Bearer token is required',
    );
  }

  const token = authHeader.slice(7);

  if (!token) {
    throw new UnauthorizedError(
      'MISSING_TOKEN',
      'Authorization header with Bearer token is required',
    );
  }

  try {
    await request.jwtVerify();
    // formatUser in app.ts maps payload to request.user
  } catch {
    throw new UnauthorizedError(
      'INVALID_TOKEN',
      'Invalid or expired token',
    );
  }
}
