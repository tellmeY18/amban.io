/**
 * utils/smsParser.ts — pure-function SMS parser for Indian bank/UPI messages.
 *
 * Source of truth: CLAUDE.md §15.5 (SMS Capture — Parser).
 *
 * This module receives a raw SMS (sender, body, timestamp) and attempts
 * to extract a structured transaction from it. It runs entirely on-device
 * with zero network calls.
 *
 * Supported banks / UPI providers:
 *   HDFC, ICICI, SBI, Axis, Kotak, IDFC, GPay, PhonePe, Paytm, BHIM,
 *   and a generic UPI / NEFT / IMPS fallback.
 *
 * Privacy contract (§15.8):
 *   - The original SMS body is NEVER stored. Only the parsed fields
 *     (amount, direction, counterparty, account last-4, reference) are
 *     returned.
 *   - This function is pure: it allocates no state, performs no I/O,
 *     and can be tested with plain unit tests.
 *
 * Design rules:
 *   - Every regex template runs against the normalised (uppercased) body.
 *   - Templates are tried in order; the first match with confidence ≥
 *     minimum wins. If no template matches, `null` is returned.
 *   - Confidence is computed from how many optional fields were captured:
 *     amount + direction are mandatory (0.5 base), counterparty adds 0.2,
 *     account last-4 adds 0.15, reference adds 0.15 → max 1.0.
 *   - Amount parsing handles ₹, Rs., Rs, INR prefixes and Indian-style
 *     comma formatting (1,23,456.78).
 */

/* ------------------------------------------------------------------
 * Public types
 * ------------------------------------------------------------------ */

/** Structured transaction extracted from an SMS. */
export interface ParsedTxn {
  amount: number;
  direction: "debit" | "credit";
  counterparty: string | null;
  accountLast4: string | null;
  referenceId: string | null;
  confidence: number; // 0..1
}

/** Raw SMS as delivered by the Capacitor SMS reader plugin. */
export interface RawSms {
  messageId: string;
  sender: string;
  body: string;
  receivedAt: string; // ISO timestamp
}

/* ------------------------------------------------------------------
 * Bank sender allowlist
 *
 * Only senders matching one of these patterns are considered
 * transactional. Anything else (marketing, OTP, promos) is rejected
 * before template matching.
 * ------------------------------------------------------------------ */

const BANK_SENDER_PATTERNS: ReadonlyArray<RegExp> = [
  // HDFC Bank
  /HDFCBK/i,
  /HDFCBN/i,
  // ICICI Bank
  /ICICIB/i,
  /ICICIS/i,
  // SBI
  /SBIINB/i,
  /SBIPSG/i,
  /SBIUPI/i,
  /SBMSMS/i,
  // Axis Bank
  /AXISBK/i,
  /AXSBNK/i,
  // Kotak
  /KOTAKB/i,
  /CBKOTK/i,
  // IDFC First
  /IDFCFB/i,
  /IDFCBK/i,
  // PhonePe
  /PHONPE/i,
  /PHNPE/i,
  // GPay / Google Pay (sender is sometimes bank-side)
  /GPAY/i,
  // Paytm
  /PAYTMB/i,
  /PAYTM/i,
  // BHIM / UPI generic
  /BHIMUPI/i,
  // Yes Bank
  /YESBK/i,
  // IndusInd
  /IDFCBK/i,
  /INDUSB/i,
  // RBL Bank
  /RBLBNK/i,
  // Federal Bank
  /FEDBK/i,
  // BOB
  /BOBRBL/i,
  /BOBIBN/i,
  // Canara
  /CANBNK/i,
  // PNB
  /PNBSMS/i,
  // Union Bank
  /UBOI/i,
  // Generic bank-style senders (2-letter prefix + 6 letter alpha)
  /^[A-Z]{2}-[A-Z]{4,8}$/i,
];

/* ------------------------------------------------------------------
 * Rejection filters
 *
 * These run BEFORE template matching. If any matches, the SMS is
 * rejected immediately.
 * ------------------------------------------------------------------ */

/** Keywords that indicate OTP / verification messages — never transactions. */
const OTP_PATTERNS: ReadonlyArray<RegExp> = [
  /\bOTP\b/i,
  /one[\s-]*time[\s-]*password/i,
  /verification[\s-]*code/i,
  /\bCVV\b/i,
  /do not share/i,
];

/** Balance-only enquiries that mention an amount but no transaction. */
const BALANCE_ONLY_PATTERNS: ReadonlyArray<RegExp> = [
  /\bavailable\s+balance\b.*\bnot\b.*\btransaction\b/i,
  /\bavl\s*bal\b/i,
  /\bbal(?:ance)?\s*(?:is|:)\s*(?:Rs\.?|INR|₹)\s*[\d,]+/i,
];

/* ------------------------------------------------------------------
 * Amount extraction
 *
 * Indian bank SMS use a wild variety of amount formats:
 *   Rs. 1,23,456.78  |  Rs 1234.00  |  INR 1,234  |  ₹1234
 *   Rs.1,23,456      |  1,23,456.78 (when preceded by context word)
 * ------------------------------------------------------------------ */

/**
 * Matches amount prefixed by a currency indicator.
 * Captures the numeric part (digits, commas, optional decimal).
 */
const AMOUNT_RE = /(?:Rs\.?\s*|INR\.?\s*|₹\s*)([\d,]+(?:\.\d{1,2})?)/;

/**
 * Parse an Indian-formatted number string into a float.
 * Strips commas, parses the remainder.
 */
function parseAmount(raw: string): number {
  const cleaned = raw.replace(/,/g, "").trim();
  const value = parseFloat(cleaned);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/* ------------------------------------------------------------------
 * Account last-4 extraction
 * ------------------------------------------------------------------ */

/** Matches "a/c XX1234", "a/c **1234", "acct 1234", "card ending 1234" etc. */
const ACCOUNT_RE =
  /(?:a\/c|acct?|account|card)\s*(?:no\.?\s*)?(?:ending\s*(?:in\s*)?)?(?:\*{1,}|[xX]{1,})?\s*(\d{4})\b/i;

/* ------------------------------------------------------------------
 * Reference ID extraction
 * ------------------------------------------------------------------ */

/** Matches UPI ref, txn ref, IMPS ref, NEFT ref patterns. */
const REFERENCE_RE =
  /(?:UPI\s*(?:Ref\.?\s*(?:No\.?\s*)?)?|(?:Txn|Ref|IMPS|NEFT|RTGS)\s*(?:Ref\.?\s*)?(?:No\.?\s*)?|Ref\.?\s*#?\s*):?\s*([A-Za-z0-9]{6,30})\b/i;

/* ------------------------------------------------------------------
 * Transaction templates
 *
 * Each template defines:
 *   - `senderMatch`: regex to match sender (optional; null = any bank)
 *   - `bodyPatterns`: array of regexes to try against the body. Each
 *     must capture groups named `amount` (via the helper) or have a
 *     specific structure to extract direction.
 *
 * We process templates in a flat pipeline rather than nesting because:
 *   - The same bank can send different formats for UPI vs card vs NEFT.
 *   - Many patterns are generic across banks (UPI debit/credit format).
 *   - A simpler loop is easier to debug and extend.
 * ------------------------------------------------------------------ */

interface TemplateResult {
  direction: "debit" | "credit";
  amount: number;
  counterparty: string | null;
  accountLast4: string | null;
  referenceId: string | null;
}

/**
 * Ordered list of (regex, direction-extractor) pairs. First match wins.
 *
 * Each entry is a function that receives the normalised body and returns
 * a partial result, or null if it doesn't match. This keeps each
 * template self-contained and easy to unit-test.
 */
type TemplateFn = (body: string, sender: string) => TemplateResult | null;

/** Helper: extract amount from body using the standard AMOUNT_RE. */
function extractAmount(body: string): number {
  const m = AMOUNT_RE.exec(body);
  if (!m || !m[1]) return 0;
  return parseAmount(m[1]);
}

/** Helper: extract account last-4. */
function extractAccount(body: string): string | null {
  const m = ACCOUNT_RE.exec(body);
  return m && m[1] ? m[1] : null;
}

/** Helper: extract reference ID. */
function extractRef(body: string): string | null {
  const m = REFERENCE_RE.exec(body);
  return m && m[1] ? m[1] : null;
}

/** Helper: extract counterparty from "to <name>" or "by <name>" patterns. */
function extractCounterparty(body: string, direction: "debit" | "credit"): string | null {
  // UPI-style: "to VPA xyz@bank" or "from VPA xyz@bank"
  const vpaMatch = /(?:to|from)\s+(?:VPA\s+)?([a-zA-Z0-9._-]+@[a-zA-Z]+)\b/i.exec(body);
  if (vpaMatch && vpaMatch[1]) return vpaMatch[1];

  // "to <Merchant/Person>" — captures text after "to " until a common stop word/symbol
  if (direction === "debit") {
    const toMatch =
      /(?:to|at|towards)\s+([A-Za-z][A-Za-z0-9 ._&'-]{1,40})(?:\s+(?:on|ref|upi|via|a\/c|acct|txn|w\.e\.f|credited|debited)|\.|$)/i.exec(
        body,
      );
    if (toMatch && toMatch[1]) return cleanCounterparty(toMatch[1]);
  }

  // "from <Name>" for credits
  if (direction === "credit") {
    const fromMatch =
      /from\s+([A-Za-z][A-Za-z0-9 ._&'-]{1,40})(?:\s+(?:on|ref|upi|via|a\/c|acct|txn|w\.e\.f|credited|debited)|\.|$)/i.exec(
        body,
      );
    if (fromMatch && fromMatch[1]) return cleanCounterparty(fromMatch[1]);
  }

  // "Info: <merchant>" pattern (HDFC style)
  const infoMatch = /Info:\s*([A-Za-z][A-Za-z0-9 ._&'-]{1,40})/i.exec(body);
  if (infoMatch && infoMatch[1]) return cleanCounterparty(infoMatch[1]);

  return null;
}

/** Clean up counterparty strings: trim, collapse whitespace, title-case-ish. */
function cleanCounterparty(raw: string): string {
  const trimmed = raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.\s]+$/, "");
  return trimmed.length > 0 ? trimmed : "";
}

/* ------------------------------------------------------------------
 * Template implementations
 * ------------------------------------------------------------------ */

/**
 * Generic debit template.
 * Matches: "debited", "spent", "withdrawn", "purchase", "paid",
 *          "sent", "deducted", "payment of" etc.
 */
const debitTemplate: TemplateFn = (body) => {
  const debitKeywords =
    /\b(?:debit(?:ed)?|spent|withdraw(?:n|al)?|purchase|paid|sent|deducted|payment\s+of|txn\s+of|DR)\b/i;
  if (!debitKeywords.test(body)) return null;

  const amount = extractAmount(body);
  if (amount <= 0) return null;

  return {
    direction: "debit",
    amount,
    counterparty: extractCounterparty(body, "debit"),
    accountLast4: extractAccount(body),
    referenceId: extractRef(body),
  };
};

/**
 * Generic credit template.
 * Matches: "credited", "received", "deposited", "refund", "cashback", "CR"
 */
const creditTemplate: TemplateFn = (body) => {
  const creditKeywords =
    /\b(?:credit(?:ed)?|received|deposited|refund(?:ed)?|cashback|CR|reversed)\b/i;
  if (!creditKeywords.test(body)) return null;

  // Make sure this isn't a debit message that happens to mention "credit card"
  // (e.g. "your credit card has been debited")
  const debitOverride = /\b(?:debit(?:ed)?|spent|withdraw(?:n|al)?)\b/i;
  if (debitOverride.test(body)) {
    // It has both — if "debited" appears, treat as debit
    const amount = extractAmount(body);
    if (amount <= 0) return null;
    return {
      direction: "debit",
      amount,
      counterparty: extractCounterparty(body, "debit"),
      accountLast4: extractAccount(body),
      referenceId: extractRef(body),
    };
  }

  const amount = extractAmount(body);
  if (amount <= 0) return null;

  return {
    direction: "credit",
    amount,
    counterparty: extractCounterparty(body, "credit"),
    accountLast4: extractAccount(body),
    referenceId: extractRef(body),
  };
};

/**
 * UPI-specific template. UPI messages often have a recognisable format:
 * "Rs.XXX debited from A/c ...UPI/..."  or  "Received Rs.XXX from ..."
 */
const upiTemplate: TemplateFn = (body) => {
  if (!/\bUPI\b/i.test(body)) return null;

  const amount = extractAmount(body);
  if (amount <= 0) return null;

  // Determine direction from keywords around UPI
  const isDebit = /\b(?:debit|sent|paid|DR)\b/i.test(body);
  const isCredit = /\b(?:credit|received|CR)\b/i.test(body);

  const direction: "debit" | "credit" = isCredit && !isDebit ? "credit" : "debit";

  return {
    direction,
    amount,
    counterparty: extractCounterparty(body, direction),
    accountLast4: extractAccount(body),
    referenceId: extractRef(body),
  };
};

/**
 * NEFT/RTGS/IMPS template. These mention the transfer type explicitly.
 */
const bankTransferTemplate: TemplateFn = (body) => {
  if (!/\b(?:NEFT|RTGS|IMPS)\b/i.test(body)) return null;

  const amount = extractAmount(body);
  if (amount <= 0) return null;

  const isCredit = /\b(?:credit|received|CR)\b/i.test(body);
  const direction: "debit" | "credit" = isCredit ? "credit" : "debit";

  return {
    direction,
    amount,
    counterparty: extractCounterparty(body, direction),
    accountLast4: extractAccount(body),
    referenceId: extractRef(body),
  };
};

/**
 * Wallet / payment app template.
 * PhonePe, GPay, Paytm messages that may not follow bank SMS patterns.
 */
const walletTemplate: TemplateFn = (body, sender) => {
  const isWallet = /(?:PHONPE|PHNPE|GPAY|PAYTM|BHIM)/i.test(sender);
  if (!isWallet) return null;

  const amount = extractAmount(body);
  if (amount <= 0) return null;

  const isCredit = /\b(?:credit|received|added|cashback|refund|CR)\b/i.test(body);
  const direction: "debit" | "credit" = isCredit ? "credit" : "debit";

  return {
    direction,
    amount,
    counterparty: extractCounterparty(body, direction),
    accountLast4: extractAccount(body),
    referenceId: extractRef(body),
  };
};

/**
 * Ordered template pipeline. More specific templates first, then
 * generic fallbacks. First match with a positive amount wins.
 */
const TEMPLATES: ReadonlyArray<TemplateFn> = [
  upiTemplate,
  bankTransferTemplate,
  walletTemplate,
  debitTemplate,
  creditTemplate,
];

/* ------------------------------------------------------------------
 * Confidence scoring
 *
 * Base: 0.5 (amount + direction were captured — the bare minimum).
 * Bonus:
 *   +0.2 if counterparty was extracted
 *   +0.15 if account last-4 was extracted
 *   +0.15 if reference ID was extracted
 * Max total: 1.0
 * ------------------------------------------------------------------ */

function computeConfidence(result: TemplateResult): number {
  let score = 0.5;
  if (result.counterparty && result.counterparty.length > 0) score += 0.2;
  if (result.accountLast4) score += 0.15;
  if (result.referenceId) score += 0.15;
  return Math.min(1.0, score);
}

/* ------------------------------------------------------------------
 * Public API
 * ------------------------------------------------------------------ */

/**
 * Attempts to parse a transactional SMS into a structured transaction.
 *
 * @param sms  The raw SMS with sender, body, and timestamp.
 * @returns    A `ParsedTxn` if the SMS looks like a bank/UPI transaction,
 *             or `null` if it's promotional, OTP, or unparseable.
 *
 * The caller is responsible for filtering on `confidence >= SMS_MIN_CONFIDENCE`
 * before persisting — this function does not apply that threshold itself.
 */
export function parseSms(sms: RawSms): ParsedTxn | null {
  const { sender, body } = sms;

  // ---- Step 1: Sender allowlist check ----
  const senderMatch = BANK_SENDER_PATTERNS.some((re) => re.test(sender));
  if (!senderMatch) return null;

  // ---- Step 2: OTP / verification rejection ----
  if (OTP_PATTERNS.some((re) => re.test(body))) return null;

  // ---- Step 3: Balance-only rejection ----
  // Only reject if there's NO debit/credit keyword at all
  const hasTransactionKeyword =
    /\b(?:debit|credit|spent|paid|received|withdraw|sent|refund|purchase|cashback|DR|CR)\b/i.test(
      body,
    );
  if (!hasTransactionKeyword && BALANCE_ONLY_PATTERNS.some((re) => re.test(body))) return null;

  // ---- Step 4: Run template pipeline ----
  for (const template of TEMPLATES) {
    const result = template(body, sender);
    if (result && result.amount > 0) {
      // Sanitise counterparty: empty string → null
      const counterparty =
        result.counterparty && result.counterparty.trim().length > 0
          ? result.counterparty.trim()
          : null;

      const confidence = computeConfidence(result);

      return {
        amount: result.amount,
        direction: result.direction,
        counterparty,
        accountLast4: result.accountLast4,
        referenceId: result.referenceId,
        confidence,
      };
    }
  }

  return null;
}
