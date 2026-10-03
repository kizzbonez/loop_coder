import type { SessionRow, UserRow } from '../db/schema';

declare global {
  namespace Express {
    interface Request {
      identity?: {
        user: UserRow;
        session: SessionRow;
      };
    }
  }
}

export {};
