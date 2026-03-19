export type Result<T, E = Error> = { ok: true; data: T } | { ok: false; error: E };

export interface AuthenticatedUser {
  id: string;
  walletAddress: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}
