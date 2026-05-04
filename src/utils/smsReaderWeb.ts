/**
 * utils/smsReaderWeb.ts — web (dev-mode) fallback for the SmsReader plugin.
 *
 * On the Vite dev server there is no Android Telephony provider.
 * This stub returns safe defaults so the app compiles and runs without errors.
 */

import { WebPlugin } from "@capacitor/core";

interface SmsReaderPlugin {
  checkPermission(): Promise<{ granted: boolean }>;
  requestPermission(): Promise<{ granted: boolean }>;
  readSince(options: { sinceIso: string; limit?: number }): Promise<{
    messages: Array<{
      messageId: string;
      sender: string;
      body: string;
      receivedAt: string;
    }>;
  }>;
  getStagedMessages(): Promise<{
    messages: Array<{
      messageId: string;
      sender: string;
      body: string;
      receivedAt: string;
    }>;
  }>;
  clearStagedMessages(): Promise<void>;
  checkReceiveSmsPermission(): Promise<{ granted: boolean }>;
  requestReceiveSmsPermission(): Promise<{ granted: boolean }>;
}

export class SmsReaderWeb extends WebPlugin implements SmsReaderPlugin {
  async checkPermission(): Promise<{ granted: boolean }> {
    return { granted: false };
  }

  async requestPermission(): Promise<{ granted: boolean }> {
    console.warn("[SmsReaderWeb] SMS reading is not available on the web.");
    return { granted: false };
  }

  async readSince(_options: { sinceIso: string; limit?: number }): Promise<{
    messages: Array<{
      messageId: string;
      sender: string;
      body: string;
      receivedAt: string;
    }>;
  }> {
    return { messages: [] };
  }

  async getStagedMessages(): Promise<{
    messages: Array<{
      messageId: string;
      sender: string;
      body: string;
      receivedAt: string;
    }>;
  }> {
    return { messages: [] };
  }

  async clearStagedMessages(): Promise<void> {
    // No-op on web
  }

  async checkReceiveSmsPermission(): Promise<{ granted: boolean }> {
    return { granted: false };
  }

  async requestReceiveSmsPermission(): Promise<{ granted: boolean }> {
    console.warn("[SmsReaderWeb] RECEIVE_SMS is not available on the web.");
    return { granted: false };
  }
}
