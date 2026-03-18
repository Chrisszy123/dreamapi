import type { Result } from '@dreamapi/types';

export interface ApnsPayload {
  deviceToken: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

export async function sendApnsNotification(
  _payload: ApnsPayload,
): Promise<Result<{ sent: boolean }>> {
  // node-apn integration — configured during notifications module build (step 14)
  return { ok: true, data: { sent: true } };
}
