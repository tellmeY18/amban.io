#!/usr/bin/env python3
"""
train-merchant-model.py — Train the merchant name classifier for amban.io.

Generates a TFLite model that classifies merchant/counterparty names
from bank SMS into spending categories.

Architecture: Character-level CNN
  - Input: 64-char tokenized string (normalized to 0-1)
  - Conv1D (32 filters, kernel 3) → MaxPool → Conv1D (64) → GlobalMaxPool
  - Dense(64) → Dropout → Dense(10, softmax)

Output: android/app/src/main/assets/models/merchant_classifier.tflite

Usage:
  pip install tensorflow numpy
  python scripts/train-merchant-model.py

Model size target: <300KB
Inference time target: <5ms on mid-range Android
"""

import os

import numpy as np

os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"

import tensorflow as tf
from tensorflow import keras

# ---------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------

MAX_LEN = 64  # Max characters in merchant name
NUM_CATEGORIES = 10
VOCAB_SIZE = 39  # a-z(26) + 0-9(10) + space(1) + other(1) + padding(0)
EMBEDDING_DIM = 16
EPOCHS = 50
BATCH_SIZE = 32

CATEGORIES = [
    "food",
    "transport",
    "shopping",
    "subscriptions",
    "health",
    "utilities",
    "emi",
    "housing",
    "insurance",
    "other",
]

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
# Training Data — Indian merchant names
# ---------------------------------------------------------------

TRAINING_DATA = {
    "food": [
        "swiggy",
        "zomato",
        "dominos pizza",
        "mcdonalds",
        "burger king",
        "kfc india",
        "subway",
        "starbucks coffee",
        "cafe coffee day",
        "haldirams",
        "bikanervala",
        "pizza hut",
        "dunkin donuts",
        "barbeque nation",
        "paradise biryani",
        "behrouz biryani",
        "faasos",
        "box8",
        "eatfit",
        "freshmenu",
        "licious",
        "meatigo",
        "bigbasket fresh",
        "country delight",
        "milkbasket",
        "chai point",
        "chaayos",
        "third wave coffee",
        "blue tokai",
        "sleepy owl",
        "amul parlour",
        "mother dairy",
        "vadapav",
        "idli factory",
        "dosa plaza",
        "saravana bhavan",
        "udupi",
        "sagar ratna",
        "naivedyam",
        "rajdhani",
        "bade miyan",
        "lucky restaurant",
        "meals ready",
        "food court",
        "tiffin",
        "canteen",
        "mess",
        "dhaba",
        "biryani house",
        "tandoor",
        "mughlai",
        "chinese wok",
        "wok express",
        "bowl company",
        "eat sure",
        "rebel foods",
        "cloud kitchen",
        "daily kitchen",
        "home chef",
        "cook my grub",
        "masala box",
        "curry leaf",
    ],
    "transport": [
        "uber india",
        "ola cabs",
        "rapido bike",
        "metro recharge",
        "irctc",
        "indian railways",
        "hp petrol",
        "indian oil",
        "bharat petroleum",
        "parking plaza",
        "fastag recharge",
        "toll nhai",
        "uber auto",
        "ola auto",
        "rapido auto",
        "indigo airlines",
        "spicejet",
        "air india",
        "vistara",
        "makemytrip",
        "goibibo flights",
        "cleartrip",
        "yatra",
        "redbus",
        "abhibus",
        "ksrtc",
        "msrtc",
        "upsrtc",
        "ola electric",
        "bounce",
        "vogo",
        "yulu bike",
        "delhivery",
        "bluedart",
        "dtdc",
        "ecom express",
        "uber eats delivery",
        "dunzo delivery",
        "porter",
    ],
    "shopping": [
        "amazon india",
        "flipkart",
        "myntra fashion",
        "ajio",
        "nykaa beauty",
        "meesho",
        "bigbasket",
        "blinkit",
        "zepto delivery",
        "swiggy instamart",
        "jiomart",
        "dmart ready",
        "reliance digital",
        "croma electronics",
        "tata cliq",
        "snapdeal",
        "shopclues",
        "paytm mall",
        "lenskart",
        "pepperfry",
        "urban ladder",
        "fabindia",
        "westside",
        "lifestyle",
        "shoppers stop",
        "pantaloons",
        "max fashion",
        "zara india",
        "h and m",
        "decathlon",
        "nike india",
        "adidas india",
        "boat electronics",
        "noise smartwatch",
        "realme store",
        "mi store",
        "samsung store",
        "apple store",
        "vijay sales",
    ],
    "subscriptions": [
        "netflix india",
        "disney hotstar",
        "amazon prime",
        "spotify premium",
        "youtube premium",
        "apple one",
        "google one storage",
        "icloud storage",
        "jio fiber",
        "airtel xstream",
        "vi movies",
        "zee5 premium",
        "sony liv",
        "mubi films",
        "audible india",
        "kindle unlimited",
        "gaana plus",
        "jiosaavn pro",
        "tata play",
        "dish tv",
        "sun direct",
        "airtel prepaid",
        "jio prepaid",
        "vi prepaid",
        "act fibernet",
        "hathway broadband",
        "tikona",
    ],
    "health": [
        "apollo pharmacy",
        "pharmeasy",
        "netmeds",
        "1mg tata",
        "medplus",
        "apollo hospital",
        "fortis hospital",
        "max hospital",
        "narayana health",
        "manipal hospital",
        "practo consult",
        "mfine doctor",
        "lybrate",
        "thyrocare lab",
        "dr lal pathlabs",
        "srl diagnostics",
        "metropolis lab",
        "healthians",
        "cult fit",
        "gym membership",
        "gold gym",
        "anytime fitness",
        "yoga class",
        "meditation app",
        "headspace",
    ],
    "utilities": [
        "electricity bill",
        "water bill",
        "piped gas",
        "airtel broadband",
        "jio fiber bill",
        "act broadband",
        "hathway cable",
        "tata sky dth",
        "dish tv recharge",
        "society maintenance",
        "apartment maintenance",
        "municipality tax",
        "property tax",
        "water tax",
        "gas cylinder",
        "indane gas",
        "hp gas",
        "bharat gas",
    ],
    "emi": [
        "hdfc emi",
        "icici emi",
        "sbi emi",
        "bajaj emi",
        "home loan emi",
        "car loan emi",
        "personal loan",
        "education loan",
        "bajaj finserv",
        "tata capital",
        "hdfc credila",
        "muthoot finance",
        "manappuram",
        "lazypay emi",
        "simpl pay later",
        "slice card",
        "uni card emi",
        "onecard emi",
        "credit card bill",
    ],
    "housing": [
        "rent payment",
        "house rent",
        "flat rent",
        "pg accommodation",
        "hostel fee",
        "oyo rooms",
        "nobroker rent",
        "housing society",
        "landlord",
        "apartment rent",
        "room rent",
        "co living",
        "stanza living",
        "zolo stays",
        "nestaway",
    ],
    "insurance": [
        "lic premium",
        "hdfc life",
        "icici prudential",
        "sbi life insurance",
        "max life",
        "bajaj allianz",
        "star health insurance",
        "care health",
        "acko",
        "digit insurance",
        "tata aia",
        "kotak life",
        "new india assurance",
        "oriental insurance",
        "vehicle insurance",
        "health insurance premium",
    ],
    "other": [
        "miscellaneous",
        "general store",
        "local shop",
        "cash withdrawal",
        "atm withdrawal",
        "fund transfer",
        "money transfer",
        "upi payment",
        "neft transfer",
        "imps transfer",
        "rtgs payment",
        "cheque deposit",
        "demand draft",
        "locker rent",
        "bank charges",
        "annual fee",
        "gst payment",
        "income tax",
        "mutual fund",
        "sip investment",
        "stock purchase",
        "zerodha trading",
        "groww investment",
        "upstox",
    ],
}


# ---------------------------------------------------------------
# Tokenization (matches the Java plugin's tokenization exactly)
# ---------------------------------------------------------------


def tokenize(name: str) -> np.ndarray:
    """Convert a merchant name to a normalized float array of length MAX_LEN."""
    tokens = np.zeros(MAX_LEN, dtype=np.float32)
    lower = name.lower().strip()
    for i, c in enumerate(lower[:MAX_LEN]):
        if "a" <= c <= "z":
            tokens[i] = (ord(c) - ord("a") + 1) / 38.0
        elif "0" <= c <= "9":
            tokens[i] = (ord(c) - ord("0") + 27) / 38.0
        elif c == " ":
            tokens[i] = 37.0 / 38.0
        else:
            tokens[i] = 38.0 / 38.0
    return tokens


# ---------------------------------------------------------------
# Data augmentation
# ---------------------------------------------------------------


def augment_name(name: str) -> list:
    """Generate variations of a merchant name for training."""
    variations = [name]
    # Uppercase
    variations.append(name.upper())
    # Title case
    variations.append(name.title())
    # With common prefixes/suffixes
    variations.append(f"paid to {name}")
    variations.append(f"{name} payment")
    variations.append(f"{name} india")
    # Truncated
    if len(name) > 5:
        variations.append(name[: len(name) // 2])
    # With typos (swap adjacent chars)
    if len(name) > 3:
        chars = list(name)
        i = len(chars) // 2
        chars[i], chars[i - 1] = chars[i - 1], chars[i]
        variations.append("".join(chars))
    return variations


# ---------------------------------------------------------------
# Build dataset
# ---------------------------------------------------------------


def build_dataset():
    """Build training data from the merchant name dictionary."""
    X, y = [], []
    for cat_idx, category in enumerate(CATEGORIES):
        names = TRAINING_DATA.get(category, [])
        for name in names:
            for variation in augment_name(name):
                X.append(tokenize(variation))
                y.append(cat_idx)

    X = np.array(X, dtype=np.float32)
    y = np.array(y, dtype=np.int32)

    # Shuffle
    indices = np.random.permutation(len(X))
    X = X[indices]
    y = y[indices]

    return X, y


# ---------------------------------------------------------------
# Model architecture
# ---------------------------------------------------------------


def build_model() -> keras.Model:
    """Build a char-level CNN for merchant classification."""
    inputs = keras.Input(shape=(MAX_LEN,), name="char_input")

    # Reshape for Conv1D: (batch, 64) -> (batch, 64, 1)
    x = keras.layers.Reshape((MAX_LEN, 1))(inputs)

    # Conv layers
    x = keras.layers.Conv1D(32, 3, activation="relu", padding="same")(x)
    x = keras.layers.MaxPooling1D(2)(x)
    x = keras.layers.Conv1D(64, 3, activation="relu", padding="same")(x)
    x = keras.layers.GlobalMaxPooling1D()(x)

    # Dense layers
    x = keras.layers.Dense(64, activation="relu")(x)
    x = keras.layers.Dropout(0.3)(x)
    outputs = keras.layers.Dense(NUM_CATEGORIES, activation="softmax", name="category")(
        x
    )

    model = keras.Model(inputs=inputs, outputs=outputs)
    model.compile(
        optimizer="adam",
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    return model


# ---------------------------------------------------------------
# Export to TFLite
# ---------------------------------------------------------------


def export_tflite(model: keras.Model, output_path: str):
    """Convert Keras model to TFLite and save."""
    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    # Quantize for smaller size and faster inference
    converter.target_spec.supported_types = [tf.float16]
    tflite_model = converter.convert()

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(tflite_model)

    size_kb = len(tflite_model) / 1024
    print(f"  Model saved to: {output_path}")
    print(f"  Model size: {size_kb:.1f} KB")


# ---------------------------------------------------------------
# Main
# ---------------------------------------------------------------


def main():
    print("=" * 60)
    print("amban.io — Merchant Classifier Training")
    print("=" * 60)

    print("\n[1/4] Building dataset...")
    X, y = build_dataset()
    print(f"  Total samples: {len(X)}")
    print(f"  Categories: {NUM_CATEGORIES}")
    print(f"  Input shape: {X.shape}")

    # Split train/val
    split = int(0.85 * len(X))
    X_train, X_val = X[:split], X[split:]
    y_train, y_val = y[:split], y[split:]
    print(f"  Train: {len(X_train)}, Val: {len(X_val)}")

    print("\n[2/4] Building model...")
    model = build_model()
    model.summary()

    print("\n[3/4] Training...")
    history = model.fit(
        X_train,
        y_train,
        validation_data=(X_val, y_val),
        epochs=EPOCHS,
        batch_size=BATCH_SIZE,
        verbose=1,
    )

    val_acc = history.history["val_accuracy"][-1]
    print(f"\n  Final validation accuracy: {val_acc:.4f}")

    print("\n[4/4] Exporting to TFLite...")
    output_path = os.path.join(OUTPUT_DIR, "merchant_classifier.tflite")
    export_tflite(model, output_path)

    print("\n\u2705 Done!")
    print(f"  Place the model at: assets/models/merchant_classifier.tflite")


if __name__ == "__main__":
    main()
