/**
 * utils/smsReaderWeb.ts — web (dev-mode) fallback for the SmsReader plugin.
 *
 * On the Vite dev server there is no Android Telephony provider to
 * read from. This stub returns safe defaults so the app compiles and
 * runs without errors — SMS-related UI simply shows no suggestions.
 *
 * The real native implementation lives in the custom Capacitor plugin
 * at `android/app/src/main/java/io/amban/app/sms/SmsReaderPlugin.java`.
 */

import { WebPlugin } from "@capacitor/core";

/** Plugin interface — matches the definition in smsScan.ts. */
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
}

export class SmsReaderWeb extends WebPlugin implements SmsReaderPlugin {
  async checkPermission(): Promise<{ granted: boolean }> {
    return { granted: false };
  }

  async requestPermission(): Promise<{ granted: boolean }> {
    console.info("[SmsReaderWeb] SMS reading is not available on the web.");
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
}
