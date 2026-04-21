/**
 * constants/categories.ts — Spend category definitions.
 *
 * Source of truth: CLAUDE.md Appendix C (Spend Categories).
 *
 * Rules:
 *   - Recurring payments MUST select exactly one category.
 *   - Daily log category is OPTIONAL; if not provided, stored as null.
 *   - Category keys are the stable enum — NEVER change them. Labels and
 *     colours can evolve, but the key is persisted in SQLite and must
 *     survive forever. Add a migration if a key ever needs to rename.
 *
 * Ionicon names reference constants/icons once that helper lands; for now
 * they're stored as strings and resolved at render time.
 */

/** Stable enum of category keys. Persisted in SQLite — do not rename. */
export type CategoryKey =
  | "housing"
  | "utilities"
  | "insurance"
  | "subscriptions"
  | "emi"
  | "food"
  | "transport"
  | "shopping"
  | "health"
  | "other";

export interface CategoryDefinition {
  /** Stable key — matches what's written to SQLite. */
  key: CategoryKey;
  /** Human-readable label for UI. Safe to evolve over time. */
  label: string;
  /** Ionicon name (outline variant preferred for consistency). */
  icon: string;
  /**
   * CSS custom property name exposing the category's accent colour.
   * Defined in src/theme/tokens.css. Consumers read `var(<token>)` so
   * the palette can be retuned globally without touching this table.
   */
  colorToken: `--color-cat-${CategoryKey}`;
  /**
   * Raw hex fallback from Appendix C. Used only when a CSS variable
   * isn't available (e.g. charting libraries that demand literal hex).
   */
  colorHex: string;
}

/**
 * The ordered list of categories.
 *
 * Ordering rules:
 *   1. Recurring-heavy categories first (housing, utilities, insurance,
 *      subscriptions, emi) — these dominate the Manage Recurring screen.
 *   2. Daily-spend categories next (food, transport, shopping, health).
 *   3. `other` is always last so it stays the fallback pick.
 */
export const CATEGORIES: ReadonlyArray<CategoryDefinition> = [
  {
    key: "housing",
    label: "Housing & Rent",
    icon: "home-outline",
    colorToken: "--color-cat-housing",
    colorHex: "#4285F4",
  },
  {
    key: "utilities",
    label: "Utilities",
    icon: "flash-outline",
    colorToken: "--color-cat-utilities",
    colorHex: "#F29900",
  },
  {
    key: "insurance",
    label: "Insurance",
    icon: "shield-checkmark-outline",
    colorToken: "--color-cat-insurance",
    colorHex: "#1E8C45",
  },
  {
    key: "subscriptions",
    label: "Subscriptions",
    icon: "play-circle-outline",
    colorToken: "--color-cat-subscriptions",
    colorHex: "#AB47BC",
  },
  {
    key: "emi",
    label: "EMI / Loans",
    icon: "card-outline",
    colorToken: "--color-cat-emi",
    colorHex: "#E94235",
  },
  {
    key: "food",
    label: "Food & Dining",
    icon: "restaurant-outline",
    colorToken: "--color-cat-food",
    colorHex: "#FB8C00",
  },
  {
    key: "transport",
    label: "Transport",
    icon: "car-outline",
    colorToken: "--color-cat-transport",
    colorHex: "#26A69A",
  },
  {
    key: "shopping",
    label: "Shopping",
    icon: "bag-handle-outline",
    colorToken: "--color-cat-shopping",
    colorHex: "#EC407A",
  },
  {
    key: "health",
    label: "Health",
    icon: "medkit-outline",
    colorToken: "--color-cat-health",
    colorHex: "#66BB6A",
  },
  {
    key: "other",
    label: "Other",
    icon: "ellipsis-horizontal-outline",
    colorToken: "--color-cat-other",
    colorHex: "#9AA0A6",
  },
];

/**
 * Lookup map for O(1) access when resolving a stored category key.
 * Lazily built from CATEGORIES so the list remains the single source.
 */
export const CATEGORY_BY_KEY: Readonly<Record<CategoryKey, CategoryDefinition>> = CATEGORIES.reduce(
  (acc, category) => {
    acc[category.key] = category;
    return acc;
  },
  {} as Record<CategoryKey, CategoryDefinition>,
);

/**
 * Type guard: true when the given string is a valid CategoryKey.
 * Useful at the storage boundary (reading a legacy row, parsing user
 * input) before trusting the value in typed code.
 */
export function isCategoryKey(value: unknown): value is CategoryKey {
  return typeof value === "string" && value in CATEGORY_BY_KEY;
}

/**
 * Resolves a raw string to a CategoryDefinition, falling back to
 * `other` when the input is unknown or null. Never throws — category
 * keys are user-visible data and should degrade gracefully.
 */
export function resolveCategory(value: unknown): CategoryDefinition {
  if (isCategoryKey(value)) {
    return CATEGORY_BY_KEY[value];
  }
  return CATEGORY_BY_KEY.other;
}

/**
 * Default category for a freshly-added recurring payment. Picked to
 * minimise wrong defaults — most first-time users add rent first.
 */
export const DEFAULT_RECURRING_CATEGORY: CategoryKey = "housing";
