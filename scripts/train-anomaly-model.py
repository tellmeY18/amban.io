#!/usr/bin/env python3
"""
train-anomaly-model.py — Train the spending anomaly detector for amban.io.

Generates a TFLite autoencoder model that detects unusual spending patterns.
The model learns to reconstruct "normal" spending feature vectors; high
reconstruction error indicates an anomaly.

Architecture: Autoencoder
  - Input: 5 features [amount_norm, dow_norm, dom_norm, is_weekend, ratio_to_avg]
  - Encoder: Dense(16, relu) -> Dense(8, relu) -> Dense(4, relu)
  - Decoder: Dense(8, relu) -> Dense(16, relu) -> Dense(5, sigmoid)

The model is trained on synthetic "normal" spending data that mimics
typical Indian urban professional spending patterns.

Output: android/app/src/main/assets/models/anomaly_detector.tflite

Usage:
  pip install tensorflow numpy
  python scripts/train-anomaly-model.py

Model size target: <100KB
Inference time: <2ms
"""

import os

import numpy as np

os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"

import tensorflow as tf
from tensorflow import keras

# ---------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------

NUM_FEATURES = 5
# Features: [amount_norm, dow_norm, dom_norm, is_weekend, ratio_to_avg]
# All normalized to [0, 1]

NUM_NORMAL_SAMPLES = 5000
NUM_ANOMALY_SAMPLES = 200  # For validation only
EPOCHS = 100
BATCH_SIZE = 64

OUTPUT_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "android",
    "app",
    "src",
    "main",
    "assets",
    "models",
)

# ---------------------------------------------------------------
# Synthetic Data Generation
#
# Normal spending patterns for an Indian urban professional:
#   - Avg daily spend: 1,000-3,000 INR
#   - Lower on weekdays, higher on weekends
#   - Higher around month-end (salary just hit) and mid-month
#   - Amount-to-average ratio typically 0.3-2.0
# ---------------------------------------------------------------


def generate_normal_data(n: int) -> np.ndarray:
    """Generate synthetic 'normal' spending patterns."""
    data = np.zeros((n, NUM_FEATURES), dtype=np.float32)

    for i in range(n):
        # Day of week (normalized 0-1, uniform across week)
        dow = np.random.randint(0, 7)
        dow_norm = dow / 6.0

        # Day of month (normalized)
        dom = np.random.randint(1, 32)
        dom_norm = (dom - 1) / 30.0

        # Is weekend
        is_weekend = 1.0 if dow in [0, 6] else 0.0

        # Base amount (normalized) — typical range
        # Weekend spending is slightly higher
        base = np.random.beta(2, 5)  # Skewed towards lower amounts
        if is_weekend:
            base *= 1.3

        # Salary bump: slightly higher first week
        if dom <= 7:
            base *= 1.2

        amount_norm = np.clip(base, 0, 1)

        # Ratio to average (centered around 1.0, normalized to 0-1 by /5)
        ratio_raw = np.random.lognormal(0, 0.4)  # Centered ~1, right-skewed
        ratio_norm = np.clip(ratio_raw / 5.0, 0, 1)

        data[i] = [amount_norm, dow_norm, dom_norm, is_weekend, ratio_norm]

    return data


def generate_anomaly_data(n: int) -> np.ndarray:
    """Generate synthetic 'anomalous' spending patterns."""
    data = np.zeros((n, NUM_FEATURES), dtype=np.float32)

    for i in range(n):
        dow = np.random.randint(0, 7)
        dow_norm = dow / 6.0
        dom = np.random.randint(1, 32)
        dom_norm = (dom - 1) / 30.0
        is_weekend = 1.0 if dow in [0, 6] else 0.0

        # Anomalous amounts: much higher than normal
        amount_norm = np.random.uniform(0.6, 1.0)  # Very high spends

        # High ratio to average (3x-5x normal)
        ratio_norm = np.random.uniform(0.6, 1.0)

        data[i] = [amount_norm, dow_norm, dom_norm, is_weekend, ratio_norm]

    return data


# ---------------------------------------------------------------
# Model Architecture
# ---------------------------------------------------------------


def build_autoencoder() -> keras.Model:
    """Build a small autoencoder for anomaly detection."""
    inputs = keras.Input(shape=(NUM_FEATURES,), name="spending_features")

    # Encoder
    x = keras.layers.Dense(16, activation="relu")(inputs)
    x = keras.layers.Dense(8, activation="relu")(x)
    encoded = keras.layers.Dense(4, activation="relu", name="bottleneck")(x)

    # Decoder
    x = keras.layers.Dense(8, activation="relu")(encoded)
    x = keras.layers.Dense(16, activation="relu")(x)
    decoded = keras.layers.Dense(
        NUM_FEATURES, activation="sigmoid", name="reconstruction"
    )(x)

    model = keras.Model(inputs=inputs, outputs=decoded)
    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=0.001),
        loss="mse",
    )
    return model


# ---------------------------------------------------------------
# Export
# ---------------------------------------------------------------


def export_tflite(model: keras.Model, output_path: str):
    """Convert to TFLite with float16 quantization."""
    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    converter.target_spec.supported_types = [tf.float16]
    tflite_model = converter.convert()

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(tflite_model)

    size_kb = len(tflite_model) / 1024
    print(f"  Model saved to: {output_path}")
    print(f"  Model size: {size_kb:.1f} KB")


# ---------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------


def evaluate_model(
    model: keras.Model, normal_data: np.ndarray, anomaly_data: np.ndarray
):
    """Evaluate anomaly detection performance."""
    # Reconstruction error on normal data
    normal_reconstructed = model.predict(normal_data, verbose=0)
    normal_mse = np.mean((normal_data - normal_reconstructed) ** 2, axis=1)

    # Reconstruction error on anomaly data
    anomaly_reconstructed = model.predict(anomaly_data, verbose=0)
    anomaly_mse = np.mean((anomaly_data - anomaly_reconstructed) ** 2, axis=1)

    # Find threshold that separates normal from anomaly
    threshold = np.percentile(normal_mse, 95)  # 95th percentile of normal

    # Classification at this threshold
    normal_flagged = np.sum(normal_mse > threshold) / len(normal_mse)
    anomaly_detected = np.sum(anomaly_mse > threshold) / len(anomaly_mse)

    print(f"\n  Evaluation Results:")
    print(f"  {'─' * 40}")
    print(
        f"  Normal MSE — mean: {np.mean(normal_mse):.6f}, std: {np.std(normal_mse):.6f}"
    )
    print(
        f"  Anomaly MSE — mean: {np.mean(anomaly_mse):.6f}, std: {np.std(anomaly_mse):.6f}"
    )
    print(f"  Threshold (95th pctl of normal): {threshold:.6f}")
    print(f"  False positive rate: {normal_flagged:.2%}")
    print(f"  Anomaly detection rate: {anomaly_detected:.2%}")


# ---------------------------------------------------------------
# Main
# ---------------------------------------------------------------


def main():
    print("=" * 60)
    print("amban.io — Anomaly Detector Training")
    print("=" * 60)

    np.random.seed(42)

    print("\n[1/5] Generating synthetic data...")
    normal_data = generate_normal_data(NUM_NORMAL_SAMPLES)
    anomaly_data = generate_anomaly_data(NUM_ANOMALY_SAMPLES)
    print(f"  Normal samples: {len(normal_data)}")
    print(f"  Anomaly samples: {len(anomaly_data)} (for evaluation only)")

    print("\n[2/5] Building autoencoder...")
    model = build_autoencoder()
    model.summary()

    print("\n[3/5] Training on normal data only...")
    # Train only on normal data — anomalies should have high reconstruction error
    split = int(0.9 * len(normal_data))
    train_data = normal_data[:split]
    val_data = normal_data[split:]

    history = model.fit(
        train_data,
        train_data,  # Autoencoder: input = target
        validation_data=(val_data, val_data),
        epochs=EPOCHS,
        batch_size=BATCH_SIZE,
        verbose=1,
        callbacks=[
            keras.callbacks.EarlyStopping(patience=10, restore_best_weights=True),
        ],
    )

    final_loss = history.history["val_loss"][-1]
    print(f"\n  Final validation loss (MSE): {final_loss:.6f}")

    print("\n[4/5] Evaluating...")
    evaluate_model(model, val_data, anomaly_data)

    print("\n[5/5] Exporting to TFLite...")
    output_path = os.path.join(OUTPUT_DIR, "anomaly_detector.tflite")
    export_tflite(model, output_path)

    print("\n\u2705 Done!")
    print(f"  Place the model at: assets/models/anomaly_detector.tflite")


if __name__ == "__main__":
    main()
