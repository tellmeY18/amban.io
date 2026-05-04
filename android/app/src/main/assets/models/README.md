# On-Device ML Models

This directory holds TensorFlow Lite model files for amban.io's on-device ML inference.

## Required Model Files

### `merchant_classifier.tflite`

**Purpose:** Classifies merchant/counterparty names into spending categories.

| Property | Value |
|----------|-------|
| Architecture | Character-level CNN |
| Input shape | `[1, 64]` — 64 chars, normalized float tokens |
| Output shape | `[1, 10]` — softmax over 10 categories |
| Tokenization | Char-level: a-z→1-26, 0-9→27-36, space→37, other→38, divided by 38 |
| Categories | food, transport, shopping, subscriptions, health, utilities, emi, housing, insurance, other |

### `anomaly_detector.tflite`

**Purpose:** Detects anomalous spending patterns via reconstruction error.

| Property | Value |
|----------|-------|
| Architecture | Autoencoder (encoder-decoder) |
| Input shape | `[1, 5]` — feature vector |
| Output shape | `[1, 5]` — reconstructed feature vector |
| Features | `[amount_normalized, day_of_week/7, day_of_month/31, is_weekend, amount_vs_avg_ratio]` |
| Scoring | MSE between input and output → sigmoid transform → 0-1 anomaly score |
| Threshold | Score > 0.5 flagged as anomaly |

## Notes

- Models are loaded lazily on first inference call (not at app startup).
- If a model file is missing, the plugin returns `{ available: false }` and the TypeScript layer falls back to heuristic classification.
- Files in this directory must NOT be compressed by AAPT (configured via `noCompress "tflite"` in `build.gradle`) because TFLite requires memory-mapped access.
- All inference is 100% on-device. Zero network calls. Consistent with amban's privacy-first architecture.

## Training

Models are trained offline and placed here before building the APK. See the project's ML training pipeline (future) for reproduction instructions.
