package io.amban.app.ml;

import android.content.res.AssetFileDescriptor;
import android.content.res.AssetManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;

import java.io.FileInputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.MappedByteBuffer;
import java.nio.channels.FileChannel;
import java.util.concurrent.locks.ReentrantLock;

/**
 * TFLitePlugin — On-device ML inference via TensorFlow Lite.
 *
 * Provides two models:
 *   1. Merchant Classifier: counterparty name → spending category
 *   2. Anomaly Detector: spending features → anomaly score (0-1)
 *
 * Models ship as .tflite files in assets/models/.
 * All inference is on-device, zero network calls.
 *
 * Architecture:
 *   - Merchant classifier: char-level CNN, input [1,64], output [1,10] (softmax)
 *   - Anomaly detector: autoencoder, input [1,5], output [1,5] (reconstruction)
 *
 * Thread safety: model access is guarded by ReentrantLock.
 * Lazy loading: models are loaded on first inference call.
 */
@CapacitorPlugin(name = "TFLite")
public class TFLitePlugin extends Plugin {

    private static final String MERCHANT_MODEL_PATH = "models/merchant_classifier.tflite";
    private static final String ANOMALY_MODEL_PATH = "models/anomaly_detector.tflite";

    private static final int MERCHANT_INPUT_LENGTH = 64;
    private static final int NUM_CATEGORIES = 10;
    private static final int ANOMALY_FEATURES = 5;

    private static final String[] CATEGORY_LABELS = {
        "food", "transport", "shopping", "subscriptions",
        "health", "utilities", "emi", "housing", "insurance", "other"
    };

    // TFLite interpreter instances (null until loaded)
    private org.tensorflow.lite.Interpreter merchantInterpreter = null;
    private org.tensorflow.lite.Interpreter anomalyInterpreter = null;

    private boolean merchantModelAvailable = false;
    private boolean anomalyModelAvailable = false;
    private boolean modelsChecked = false;

    private final ReentrantLock merchantLock = new ReentrantLock();
    private final ReentrantLock anomalyLock = new ReentrantLock();

    /* ---------------------------------------------------------------
     * Model loading
     * --------------------------------------------------------------- */

    private MappedByteBuffer loadModelFile(String modelPath) throws IOException {
        AssetManager assetManager = getContext().getAssets();
        AssetFileDescriptor fileDescriptor = assetManager.openFd(modelPath);
        FileInputStream inputStream = new FileInputStream(fileDescriptor.getFileDescriptor());
        FileChannel fileChannel = inputStream.getChannel();
        long startOffset = fileDescriptor.getStartOffset();
        long declaredLength = fileDescriptor.getDeclaredLength();
        MappedByteBuffer buffer = fileChannel.map(FileChannel.MapMode.READ_ONLY, startOffset, declaredLength);
        inputStream.close();
        return buffer;
    }

    private void ensureMerchantModel() {
        if (merchantInterpreter != null) return;
        merchantLock.lock();
        try {
            if (merchantInterpreter != null) return; // Double-check after acquiring lock
            MappedByteBuffer model = loadModelFile(MERCHANT_MODEL_PATH);
            org.tensorflow.lite.Interpreter.Options options = new org.tensorflow.lite.Interpreter.Options();
            options.setNumThreads(2);
            merchantInterpreter = new org.tensorflow.lite.Interpreter(model, options);
            merchantModelAvailable = true;
        } catch (Exception e) {
            merchantModelAvailable = false;
        } finally {
            merchantLock.unlock();
        }
    }

    private void ensureAnomalyModel() {
        if (anomalyInterpreter != null) return;
        anomalyLock.lock();
        try {
            if (anomalyInterpreter != null) return; // Double-check after acquiring lock
            MappedByteBuffer model = loadModelFile(ANOMALY_MODEL_PATH);
            org.tensorflow.lite.Interpreter.Options options = new org.tensorflow.lite.Interpreter.Options();
            options.setNumThreads(2);
            anomalyInterpreter = new org.tensorflow.lite.Interpreter(model, options);
            anomalyModelAvailable = true;
        } catch (Exception e) {
            anomalyModelAvailable = false;
        } finally {
            anomalyLock.unlock();
        }
    }

    /* ---------------------------------------------------------------
     * isModelAvailable() → { merchant: boolean, anomaly: boolean }
     * --------------------------------------------------------------- */

    @PluginMethod
    public void isModelAvailable(PluginCall call) {
        if (!modelsChecked) {
            // Quick check: see if files exist in assets
            AssetManager am = getContext().getAssets();
            try {
                am.openFd(MERCHANT_MODEL_PATH).close();
                merchantModelAvailable = true;
            } catch (Exception e) {
                merchantModelAvailable = false;
            }
            try {
                am.openFd(ANOMALY_MODEL_PATH).close();
                anomalyModelAvailable = true;
            } catch (Exception e) {
                anomalyModelAvailable = false;
            }
            modelsChecked = true;
        }

        JSObject result = new JSObject();
        result.put("merchant", merchantModelAvailable);
        result.put("anomaly", anomalyModelAvailable);
        call.resolve(result);
    }

    /* ---------------------------------------------------------------
     * classifyMerchant({ name: string }) →
     *   { category: string, confidence: number, allScores: number[] }
     *
     * Tokenizes the merchant name into a char-level vector and runs
     * it through the classifier model.
     * --------------------------------------------------------------- */

    @PluginMethod
    public void classifyMerchant(PluginCall call) {
        String name = call.getString("name");
        if (name == null || name.isEmpty()) {
            call.reject("name is required");
            return;
        }

        ensureMerchantModel();
        if (merchantInterpreter == null) {
            // Model not available — return null so TS falls back to heuristic
            JSObject result = new JSObject();
            result.put("available", false);
            result.put("category", (String) null);
            result.put("confidence", 0.0);
            call.resolve(result);
            return;
        }

        merchantLock.lock();
        try {
            // Tokenize: lowercase, map chars to indices
            // a=1..z=26, 0-9=27-36, space=37, other=38
            // Normalized to 0-1 range by dividing by 38
            float[][] input = new float[1][MERCHANT_INPUT_LENGTH];
            String lower = name.toLowerCase().trim();
            for (int i = 0; i < Math.min(lower.length(), MERCHANT_INPUT_LENGTH); i++) {
                char c = lower.charAt(i);
                if (c >= 'a' && c <= 'z') {
                    input[0][i] = (c - 'a' + 1) / 38.0f;
                } else if (c >= '0' && c <= '9') {
                    input[0][i] = (c - '0' + 27) / 38.0f;
                } else if (c == ' ') {
                    input[0][i] = 37.0f / 38.0f;
                } else {
                    input[0][i] = 38.0f / 38.0f;
                }
            }
            // Remaining positions stay 0.0 (padding)

            // Run inference
            float[][] output = new float[1][NUM_CATEGORIES];
            merchantInterpreter.run(input, output);

            // Find best category
            int bestIdx = 0;
            float bestScore = output[0][0];
            for (int i = 1; i < NUM_CATEGORIES; i++) {
                if (output[0][i] > bestScore) {
                    bestScore = output[0][i];
                    bestIdx = i;
                }
            }

            JSObject result = new JSObject();
            result.put("available", true);
            result.put("category", CATEGORY_LABELS[bestIdx]);
            result.put("confidence", bestScore);

            // Include all scores for debugging/transparency
            JSArray scores = new JSArray();
            for (int i = 0; i < NUM_CATEGORIES; i++) {
                scores.put(output[0][i]);
            }
            result.put("allScores", scores);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Inference failed: " + e.getMessage());
        } finally {
            merchantLock.unlock();
        }
    }

    /* ---------------------------------------------------------------
     * detectAnomaly({ features: number[] }) →
     *   { score: number, isAnomaly: boolean }
     *
     * Features vector:
     *   [amount_normalized, day_of_week/7, day_of_month/31, is_weekend, amount_vs_avg_ratio]
     *
     * Returns a reconstruction error as the anomaly score.
     * Score > 0.5 → likely anomaly.
     * --------------------------------------------------------------- */

    @PluginMethod
    public void detectAnomaly(PluginCall call) {
        JSArray featuresArr = call.getArray("features");
        if (featuresArr == null) {
            call.reject("features array is required");
            return;
        }

        ensureAnomalyModel();
        if (anomalyInterpreter == null) {
            JSObject result = new JSObject();
            result.put("available", false);
            result.put("score", 0.0);
            result.put("isAnomaly", false);
            call.resolve(result);
            return;
        }

        anomalyLock.lock();
        try {
            float[][] input = new float[1][ANOMALY_FEATURES];
            for (int i = 0; i < Math.min(featuresArr.length(), ANOMALY_FEATURES); i++) {
                input[0][i] = (float) featuresArr.getDouble(i);
            }

            // Autoencoder output: reconstructed input vector
            float[][] output = new float[1][ANOMALY_FEATURES];
            anomalyInterpreter.run(input, output);

            // Compute reconstruction error (MSE between input and output)
            double mse = 0.0;
            for (int i = 0; i < ANOMALY_FEATURES; i++) {
                double diff = input[0][i] - output[0][i];
                mse += diff * diff;
            }
            mse /= ANOMALY_FEATURES;

            // Normalize to 0-1 range using sigmoid-like transform
            // Higher MSE = more anomalous
            // Threshold calibrated: MSE of 0.1 maps to ~0.5
            double anomalyScore = 1.0 / (1.0 + Math.exp(-10.0 * (mse - 0.1)));

            JSObject result = new JSObject();
            result.put("available", true);
            result.put("score", anomalyScore);
            result.put("isAnomaly", anomalyScore > 0.5);
            result.put("reconstructionError", mse);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Anomaly detection failed: " + e.getMessage());
        } finally {
            anomalyLock.unlock();
        }
    }

    /* ---------------------------------------------------------------
     * getModelInfo() → model metadata for debugging
     * --------------------------------------------------------------- */

    @PluginMethod
    public void getModelInfo(PluginCall call) {
        JSObject result = new JSObject();

        JSObject merchant = new JSObject();
        merchant.put("path", MERCHANT_MODEL_PATH);
        merchant.put("inputLength", MERCHANT_INPUT_LENGTH);
        merchant.put("numCategories", NUM_CATEGORIES);
        merchant.put("loaded", merchantInterpreter != null);
        merchant.put("available", merchantModelAvailable);
        result.put("merchant", merchant);

        JSObject anomaly = new JSObject();
        anomaly.put("path", ANOMALY_MODEL_PATH);
        anomaly.put("numFeatures", ANOMALY_FEATURES);
        anomaly.put("loaded", anomalyInterpreter != null);
        anomaly.put("available", anomalyModelAvailable);
        result.put("anomaly", anomaly);

        result.put("categories", new JSArray(java.util.Arrays.asList(CATEGORY_LABELS)));
        call.resolve(result);
    }
}
