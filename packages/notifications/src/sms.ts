import type { Result } from '@dreamapi/types';

export interface SmsPayload {
  to: string;
  body: string;
}

export async function sendSms(_payload: SmsPayload): Promise<Result<{ sid: string }>> {
  // Twilio integration — configured during notifications module build (step 14)
  return { ok: true, data: { sid: 'placeholder' } };
}
