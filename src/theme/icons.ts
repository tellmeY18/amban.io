/**
 * theme/icons.ts — single source of truth for icon imports.
 *
 * Every Ionicon used anywhere in amban flows through this module.
 * Benefits:
 *   - One grep target when swapping an icon set or auditing usage.
 *   - Tree-shaking-friendly (named imports only from 'ionicons/icons').
 *   - Stable aliases, so renaming an underlying Ionicon later is a
 *     single-line change instead of a codebase-wide find-and-replace.
 *
 * Icon choices track CLAUDE.md:
 *   - Appendix C (Spend Categories) — one icon per category key.
 *   - §9 / §10 — navigation, status, action, and notification icons.
 *
 * Rules of the road:
 *   - Do NOT import from 'ionicons/icons' anywhere else in the app.
 *     Always go through `import { Icons } from '@/theme/icons'` (or
 *     the relative path equivalent) so this file stays the choke point.
 *   - When you need a new icon, add it here first, then consume it.
 *   - Prefer outline variants for most UI; filled variants only for
 *     active tab states or emphasis moments.
 */

import {
  // ---- Navigation (BottomNav tab bar) ----
  homeOutline,
  home,
  receiptOutline,
  receipt,
  sparklesOutline,
  sparkles,
  settingsOutline,
  settings,

  // ---- Common actions ----
  addOutline,
  add,
  addCircleOutline,
  closeOutline,
  close,
  closeCircleOutline,
  checkmarkOutline,
  checkmark,
  checkmarkCircleOutline,
  checkmarkCircle,
  pencilOutline,
  trashOutline,
  arrowBackOutline,
  arrowForwardOutline,
  chevronBackOutline,
  chevronForwardOutline,
  chevronDownOutline,
  chevronUpOutline,
  ellipsisHorizontal,
  refreshOutline,

  // ---- Status / signals ----
  alertCircleOutline,
  informationCircleOutline,
  warningOutline,
  flameOutline,
  trendingUpOutline,
  trendingDownOutline,
  timeOutline,
  calendarOutline,
  calendarNumberOutline,
  notificationsOutline,
  notificationsOffOutline,

  // ---- Finance-specific ----
  walletOutline,
  cashOutline,
  trophyOutline,
  pricetagOutline,
  statsChartOutline,
  analyticsOutline,
  pieChartOutline,

  // ---- Theme toggle ----
  sunnyOutline,
  moonOutline,
  contrastOutline,

  // ---- Category icons (Appendix C) ----
  // Note: `housing` reuses `homeOutline` (already imported above).
  flashOutline,
  shieldCheckmarkOutline,
  playCircleOutline,
  cardOutline,
  restaurantOutline,
  carOutline,
  bagHandleOutline,
  medkitOutline,
  ellipsisHorizontalOutline,
} from "ionicons/icons";

import type { CategoryKey } from "../constants/categories";

/**
 * Thematic icon bundles. Import the group you need rather than
 * reaching into the flat export — it documents intent at call sites.
 *
 * Example:
 *   import { Icons } from "@/theme/icons";
 *   <IonIcon icon={Icons.nav.home} />
 */
export const Icons = {
  nav: {
    home: homeOutline,
    homeActive: home,
    log: receiptOutline,
    logActive: receipt,
    insights: sparklesOutline,
    insightsActive: sparkles,
    settings: settingsOutline,
    settingsActive: settings,
  },

  action: {
    add,
    addOutline,
    addCircle: addCircleOutline,
    close,
    closeOutline,
    closeCircle: closeCircleOutline,
    check: checkmark,
    checkOutline: checkmarkOutline,
    checkCircle: checkmarkCircle,
    checkCircleOutline: checkmarkCircleOutline,
    edit: pencilOutline,
    delete: trashOutline,
    back: arrowBackOutline,
    forward: arrowForwardOutline,
    chevronBack: chevronBackOutline,
    chevronForward: chevronForwardOutline,
    chevronDown: chevronDownOutline,
    chevronUp: chevronUpOutline,
    more: ellipsisHorizontal,
    refresh: refreshOutline,
  },

  status: {
    alert: alertCircleOutline,
    info: informationCircleOutline,
    warning: warningOutline,
    streak: flameOutline,
    trendingUp: trendingUpOutline,
    trendingDown: trendingDownOutline,
    time: timeOutline,
    calendar: calendarOutline,
    calendarNumber: calendarNumberOutline,
    notifications: notificationsOutline,
    notificationsOff: notificationsOffOutline,
  },

  finance: {
    wallet: walletOutline,
    cash: cashOutline,
    trophy: trophyOutline,
    tag: pricetagOutline,
    chart: statsChartOutline,
    analytics: analyticsOutline,
    pie: pieChartOutline,
  },

  theme: {
    light: sunnyOutline,
    dark: moonOutline,
    system: contrastOutline,
  },
} as const;

/**
 * Category → Ionicon map.
 *
 * Keys match `CategoryKey` from constants/categories.ts. When a new
 * category is added to Appendix C, add the corresponding icon here and
 * TypeScript's exhaustiveness check (via the `Record<CategoryKey, ...>`
 * constraint) will force the update.
 */
export const CATEGORY_ICONS: Record<CategoryKey, string> = {
  housing: homeOutline,
  utilities: flashOutline,
  insurance: shieldCheckmarkOutline,
  subscriptions: playCircleOutline,
  emi: cardOutline,
  food: restaurantOutline,
  transport: carOutline,
  shopping: bagHandleOutline,
  health: medkitOutline,
  other: ellipsisHorizontalOutline,
};

/**
 * Safe lookup — falls back to the "other" icon when given an unknown
 * key. Useful when the UI renders arbitrary persisted data that may
 * predate a category rename.
 */
export function iconForCategory(key: string): string {
  return (CATEGORY_ICONS as Record<string, string>)[key] ?? ellipsisHorizontalOutline;
}
