/**
 * hooks/useMLInsights.ts — ML-powered insight enrichment hook.
 *
 * Bridges the async TFLite inference layer (onDeviceML.ts) with the
 * synchronous insight generators. Pre-computes ML results and makes
 * them available as additional context for the insight system.
 *
 * Design:
 *   - Runs TFLite inference asynchronously on app resume / data change
 *   - Caches results in component state
 *   - Exposes enriched transaction data (with ML categories) for
 *     the top-merchant and anomaly insights
 *   - Falls back gracefully when models aren't available
 *
 * Privacy: All inference is on-device. Zero network calls.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Capacitor } from "@capacitor/core";

import { useSmsSuggestionsStore } from "../stores/smsSuggestionsStore";
import { useDailyStore } from "../stores/dailyStore";
import {
  categorizeMerchant,
  detectAnomaly,
  checkMLAvailability,
  type ClassificationResult,
  type AnomalyResult,
  type SpendingFeatures,
} from "../utils/onDeviceML";

/* ------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------ */

export interface MLEnrichedTransaction {
  amount: number;
  direction: "debit" | "credit";
  counterparty: string | null;
  receivedAt: string;
  /** ML-powered category classification. */
  classification: ClassificationResult | null;
}

export interface MLInsightData {
  /** Whether ML models are available on this device. */
  modelsAvailable: {
    merchantClassifier: boolean;
    anomalyDetector: boolean;
  };

  /** Transactions enriched with ML-powered categories. */
  enrichedTransactions: MLEnrichedTransaction[];

  /** Anomaly scores for recent daily logs. */
  anomalyScores: Array<{
    logDate: string;
    spent: number;
    anomalyScore: number;
    isAnomaly: boolean;
    source: "tflite" | "statistical";
  }>;

  /** Whether ML computation is in progress. */
  loading: boolean;

  /** Force a re-computation of ML results. */
  refresh: () => void;
}

/* ------------------------------------------------------------------
 * Helper: compute spending statistics for anomaly detection
 * ------------------------------------------------------------------ */

function computeSpendStats(logs: Array<{ spent: number }>): {
  avg: number;
  stdDev: number;
} {
  const spends = logs.map((l) => l.spent).filter((s) => s > 0);
  if (spends.length < 2) return { avg: 0, stdDev: 0 };

  const avg = spends.reduce((a, b) => a + b, 0) / spends.length;
  const variance = spends.reduce((sum, s) => sum + (s - avg) ** 2, 0) / (spends.length - 1);
  const stdDev = Math.sqrt(variance);

  return { avg, stdDev };
}

/* ------------------------------------------------------------------
 * Hook
 * ------------------------------------------------------------------ */

/**
 * Provides ML-enriched data for the insight system.
 *
 * This hook runs TFLite inference asynchronously and caches results.
 * Components that need ML-powered categories or anomaly scores
 * subscribe to this hook.
 */
export function useMLInsights(): MLInsightData {
  const suggestions = useSmsSuggestionsStore((s) => s.pending);
  const logs = useDailyStore((s) => s.logs);

  const [modelsAvailable, setModelsAvailable] = useState({
    merchantClassifier: false,
    anomalyDetector: false,
  });
  const [enrichedTransactions, setEnrichedTransactions] = useState<MLEnrichedTransaction[]>([]);
  const [anomalyScores, setAnomalyScores] = useState<MLInsightData["anomalyScores"]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Check model availability once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const availability = await checkMLAvailability();
      if (!cancelled) {
        setModelsAvailable({
          merchantClassifier: availability.merchantClassifier,
          anomalyDetector: availability.anomalyDetector,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Run ML inference when data changes
  useEffect(() => {
    let cancelled = false;
    const isAndroid = Capacitor.getPlatform() === "android";

    (async () => {
      setLoading(true);

      // --- Merchant classification ---
      const enriched: MLEnrichedTransaction[] = [];
      for (const s of suggestions.slice(0, 50)) {
        // Limit to avoid perf issues
        let classification: ClassificationResult | null = null;
        if (s.counterparty && isAndroid) {
          try {
            classification = await categorizeMerchant(s.counterparty);
          } catch {
            // Fallback handled inside categorizeMerchant
          }
        }
        enriched.push({
          amount: s.amount,
          direction: s.direction,
          counterparty: s.counterparty,
          receivedAt: s.receivedAt,
          classification,
        });
      }

      if (!cancelled) {
        setEnrichedTransactions(enriched);
      }

      // --- Anomaly detection on recent logs ---
      const recentLogs = logs.slice(0, 14); // Last 2 weeks
      const { avg, stdDev } = computeSpendStats(logs);

      if (avg > 0 && recentLogs.length > 0) {
        const scores: MLInsightData["anomalyScores"] = [];
        for (const log of recentLogs.slice(0, 7)) {
          // Last 7 days
          const logDate = new Date(log.logDate);
          const features: SpendingFeatures = {
            amount: log.spent,
            dayOfWeek: logDate.getDay(),
            dayOfMonth: logDate.getDate(),
            avgDailySpend: avg,
            stdDevSpend: stdDev,
          };

          let result: AnomalyResult;
          try {
            result = await detectAnomaly(features);
          } catch {
            result = { score: 0, isAnomaly: false, source: "statistical" };
          }

          scores.push({
            logDate: log.logDate,
            spent: log.spent,
            anomalyScore: result.score,
            isAnomaly: result.isAnomaly,
            source: result.source,
          });
        }

        if (!cancelled) {
          setAnomalyScores(scores);
        }
      }

      if (!cancelled) {
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [suggestions, logs, refreshTrigger]);

  const refresh = useCallback(() => {
    setRefreshTrigger((t) => t + 1);
  }, []);

  return useMemo(
    () => ({
      modelsAvailable,
      enrichedTransactions,
      anomalyScores,
      loading,
      refresh,
    }),
    [modelsAvailable, enrichedTransactions, anomalyScores, loading, refresh],
  );
}
