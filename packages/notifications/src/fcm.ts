import type { Result } from '@dreamapi/types';
import type { TokenMessage } from 'firebase-admin/messaging';

export interface FcmPayload {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

let initialized = false;

export function initFcm(_projectId: string, _clientEmail: string, _privateKey: string): void {
  initialized = true;
}

export async function sendFcmNotification(
  payload: FcmPayload,
): Promise<Result<{ messageId: string }>> {
  if (!initialized) {
    return { ok: false, error: new Error('FCM not initialized') };
  }

  try {
    const { getMessaging } = await import('firebase-admin/messaging');
    const messaging = getMessaging();

    const message: TokenMessage = {
      token: payload.token,
      notification: { title: payload.title, body: payload.body },
    };

    if (payload.data) {
      message.data = payload.data;
    }

    const messageId = await messaging.send(message);

    return { ok: true, data: { messageId } };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
