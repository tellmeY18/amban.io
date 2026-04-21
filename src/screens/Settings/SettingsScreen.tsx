/**
 * screens/Settings/SettingsScreen.tsx — main settings surface.
 *
 * Source of truth: CLAUDE.md §9.5 (Settings Screen), Appendix I
 * (Reset & Data Wipe Behaviour), and §10 (Notifications).
 *
 * Responsibilities:
 *   - Row-based nav into manage-income, manage-recurring, and
 *     notification settings sub-screens.
 *   - Inline affordances for: profile name/emoji, quick "update
 *     balance" sheet, theme picker.
 *   - The destructive reset flow per Appendix I: type-to-confirm
 *     gate, destructive haptic, full reset pipeline, navigate back
 *     to Welcome.
 *
 * Design rules:
 *   - Every row is a <button> or a labelled control — never a bare
 *     <div> with an onClick. Keeps the tap target discoverable to
 *     screen readers and consistent with the 44×44 minimum.
 *   - Uses the Appendix F haptic map via `utils/haptics`.
 *   - The reset pipeline is called from `db/reset.ts`. This screen
 *     just wires the UI around it.
 */

import { useState } from "react";
import { useHistory } from "react-router-dom";
import { IonContent, IonIcon, IonPage } from "@ionic/react";

import BottomSheet from "../../components/ui/BottomSheet";
import CurrencyInput from "../../components/ui/CurrencyInput";

import { useUserStore } from "../../stores/userStore";
import { useFinanceStore } from "../../stores/financeStore";
import { useSettingsStore } from "../../stores/settingsStore";
import type { ThemeMode } from "../../stores/settingsStore";

import { resetApp } from "../../db/reset";

import { Icons } from "../../theme/icons";
import { useTheme } from "../../theme/ThemeProvider";
import { formatINR, formatTime12h } from "../../utils/formatters";
import { haptics } from "../../utils/haptics";
import { BUILD_INFO, formatBuildLabel } from "../../constants/buildInfo";
import { exportAndOffer } from "../../utils/exportData";

/** One emoji per theme mode — keeps the picker visual and compact. */
const THEME_MODES: ReadonlyArray<{
  key: ThemeMode;
  label: string;
  icon: string;
}> = [
  { key: "light", label: "Light", icon: Icons.theme.light },
  { key: "dark", label: "Dark", icon: Icons.theme.dark },
  { key: "system", label: "System", icon: Icons.theme.system },
];

/** Shared row primitive — icon + label + trailing control. */
const SettingsRow: React.FC<{
  icon: string;
  label: string;
  value?: string;
  onSelect?: () => void;
  tone?: "default" | "danger";
  ariaLabel?: string;
}> = ({ icon, label, value, onSelect, tone = "default", ariaLabel }) => {
  const color = tone === "danger" ? "var(--color-score-warning)" : "var(--text-strong)";
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={ariaLabel ?? label}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-md)",
        width: "100%",
        padding: "var(--space-md)",
        borderRadius: "var(--radius-md)",
        backgroundColor: "var(--surface-raised)",
        boxShadow: "var(--shadow-card)",
        border: "none",
        color,
        textAlign: "left",
        minHeight: "var(--hit-target-min)",
        cursor: onSelect ? "pointer" : "default",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <IonIcon
        icon={icon}
        aria-hidden="true"
        style={{ fontSize: "1.25rem", color, flexShrink: 0 }}
      />
      <span
        style={{
          flex: 1,
          fontSize: "var(--text-body)",
          fontWeight: "var(--font-weight-medium)",
          color,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      {value ? (
        <span
          style={{
            fontSize: "var(--text-caption)",
            color: "var(--text-muted)",
            fontWeight: "var(--font-weight-medium)",
            maxWidth: "12ch",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {value}
        </span>
      ) : null}
      {onSelect && tone !== "danger" ? (
        <IonIcon
          icon={Icons.action.chevronForward}
          aria-hidden="true"
          style={{
            fontSize: "1.1rem",
            color: "var(--text-muted)",
            flexShrink: 0,
          }}
        />
      ) : null}
    </button>
  );
};

const SectionHeader: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h2
    style={{
      fontSize: "var(--text-caption)",
      fontWeight: "var(--font-weight-semibold)",
      color: "var(--text-muted)",
      textTransform: "uppercase",
      letterSpacing: "0.06em",
      margin: "var(--space-md) var(--space-xs) var(--space-xs)",
    }}
  >
    {children}
  </h2>
);

/* ------------------------------------------------------------------
 * Balance update bottom sheet
 *
 * Identical semantics to the Home "income day" sheet but reachable
 * from Settings at any time (CLAUDE.md §6.3). Appends a new row to
 * balance_snapshots dated today — snapshots are append-only, so a
 * correction is another snapshot, not an edit.
 * ------------------------------------------------------------------ */

const BalanceUpdateSheet: React.FC<{
  open: boolean;
  onDismiss: () => void;
}> = ({ open, onDismiss }) => {
  const latestBalance = useFinanceStore((s) => s.latestBalance);
  const setBalance = useFinanceStore((s) => s.setBalance);
  const [draft, setDraft] = useState<number | null>(latestBalance?.amount ?? null);
  const [busy, setBusy] = useState(false);

  const handleSave = async () => {
    if (draft == null || busy) return;
    setBusy(true);
    try {
      await setBalance(draft);
      void haptics.tapMedium();
      onDismiss();
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet open={open} onDismiss={onDismiss} title="Update balance" initialBreakpoint={0.5}>
      {latestBalance ? (
        <p
          style={{
            margin: 0,
            fontSize: "var(--text-caption)",
            color: "var(--text-muted)",
          }}
        >
          Last recorded: {formatINR(latestBalance.amount)} on {latestBalance.recordedAt}.
        </p>
      ) : (
        <p
          style={{
            margin: 0,
            fontSize: "var(--text-caption)",
            color: "var(--text-muted)",
          }}
        >
          No balance captured yet.
        </p>
      )}
      <CurrencyInput label="New balance" value={draft} onChange={setDraft} autoFocus />
      <button
        type="button"
        onClick={handleSave}
        disabled={draft == null || busy}
        style={{
          minHeight: "var(--hit-target-min)",
          padding: "var(--space-sm) var(--space-lg)",
          borderRadius: "var(--radius-md)",
          backgroundColor: draft == null || busy ? "var(--surface-sunken)" : "var(--color-primary)",
          color: draft == null || busy ? "var(--text-muted)" : "#ffffff",
          border: "none",
          fontWeight: "var(--font-weight-semibold)",
          cursor: draft == null || busy ? "not-allowed" : "pointer",
        }}
      >
        {busy ? "Saving…" : "Save balance"}
      </button>
    </BottomSheet>
  );
};

/* ------------------------------------------------------------------
 * Profile edit bottom sheet — name + emoji.
 * ------------------------------------------------------------------ */

const EMOJI_CHOICES = ["🙂", "😎", "🌟", "🚀", "💸", "🧘", "🌱", "🔥", "🎯", "👋"];

const ProfileSheet: React.FC<{
  open: boolean;
  onDismiss: () => void;
}> = ({ open, onDismiss }) => {
  const storedName = useUserStore((s) => s.name);
  const storedEmoji = useUserStore((s) => s.emoji);
  const setUser = useUserStore((s) => s.setUser);

  const [name, setName] = useState(storedName);
  const [emoji, setEmoji] = useState<string | null>(storedEmoji);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && trimmed.length <= 40;

  const handleSave = async () => {
    if (!canSave || busy) return;
    setBusy(true);
    setError(null);
    try {
      await setUser({ name: trimmed, emoji });
      onDismiss();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet open={open} onDismiss={onDismiss} title="Edit profile" initialBreakpoint={0.75}>
      <label
        htmlFor="profile-name"
        style={{
          fontSize: "var(--text-caption)",
          fontWeight: "var(--font-weight-medium)",
          color: "var(--text-muted)",
        }}
      >
        Name
      </label>
      <input
        id="profile-name"
        type="text"
        maxLength={40}
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{
          minHeight: "var(--hit-target-min)",
          padding: "var(--space-sm) var(--space-md)",
          borderRadius: "var(--radius-md)",
          backgroundColor: "var(--surface-sunken)",
          border: "1px solid transparent",
          fontSize: "var(--text-body)",
          color: "var(--text-strong)",
          outline: "none",
          width: "100%",
        }}
      />
      <span
        style={{
          fontSize: "var(--text-caption)",
          fontWeight: "var(--font-weight-medium)",
          color: "var(--text-muted)",
          marginTop: "var(--space-xs)",
        }}
      >
        Emoji
      </span>
      <div
        role="radiogroup"
        aria-label="Profile emoji"
        style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-xs)" }}
      >
        <button
          type="button"
          role="radio"
          aria-checked={emoji == null}
          onClick={() => setEmoji(null)}
          style={{
            minWidth: 44,
            minHeight: 44,
            padding: "var(--space-xs) var(--space-md)",
            borderRadius: "var(--radius-pill)",
            backgroundColor: emoji == null ? "var(--color-primary-light)" : "var(--surface-sunken)",
            color: emoji == null ? "var(--color-primary-dark)" : "var(--text-muted)",
            border: "none",
            fontSize: "var(--text-caption)",
            fontWeight: "var(--font-weight-medium)",
          }}
        >
          None
        </button>
        {EMOJI_CHOICES.map((choice) => (
          <button
            key={choice}
            type="button"
            role="radio"
            aria-checked={emoji === choice}
            aria-label={`Emoji ${choice}`}
            onClick={() => setEmoji(choice)}
            style={{
              minWidth: 44,
              minHeight: 44,
              borderRadius: "var(--radius-pill)",
              backgroundColor:
                emoji === choice ? "var(--color-primary-light)" : "var(--surface-sunken)",
              border: emoji === choice ? "2px solid var(--color-primary)" : "2px solid transparent",
              fontSize: "1.25rem",
              cursor: "pointer",
            }}
          >
            {choice}
          </button>
        ))}
      </div>

      {error ? (
        <p
          role="alert"
          style={{
            fontSize: "var(--text-caption)",
            color: "var(--color-score-warning)",
            margin: 0,
          }}
        >
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={handleSave}
        disabled={!canSave || busy}
        style={{
          minHeight: "var(--hit-target-min)",
          padding: "var(--space-sm) var(--space-lg)",
          borderRadius: "var(--radius-md)",
          backgroundColor: !canSave || busy ? "var(--surface-sunken)" : "var(--color-primary)",
          color: !canSave || busy ? "var(--text-muted)" : "#ffffff",
          border: "none",
          fontWeight: "var(--font-weight-semibold)",
          cursor: !canSave || busy ? "not-allowed" : "pointer",
        }}
      >
        {busy ? "Saving…" : "Save"}
      </button>
    </BottomSheet>
  );
};

/* ------------------------------------------------------------------
 * Reset sheet — destructive, type-to-confirm per Appendix I.
 * ------------------------------------------------------------------ */

const CONFIRM_TOKEN = "RESET";

const ResetSheet: React.FC<{
  open: boolean;
  onDismiss: () => void;
}> = ({ open, onDismiss }) => {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canReset = typed.trim().toUpperCase() === CONFIRM_TOKEN && !busy;

  const handleReset = async () => {
    if (!canReset) return;
    setBusy(true);
    setError(null);
    void haptics.error();
    try {
      const result = await resetApp();
      if (!result.ok) {
        setError("Reset partially failed. Please relaunch the app.");
        return;
      }
      // On success the user store has been reset; the App.tsx-level
      // router will see `onboardingComplete = false` on next render
      // and swap to the onboarding stack. No manual navigation needed.
      onDismiss();
      if (typeof window !== "undefined") {
        // Force a clean re-render cycle so the router picks up the
        // flag flip even if the component tree doesn't re-subscribe.
        window.location.reload();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onDismiss={busy ? () => {} : onDismiss}
      title="Reset app"
      initialBreakpoint={0.75}
      dismissOnBackdrop={!busy}
    >
      <p
        style={{
          fontSize: "var(--text-body)",
          color: "var(--text-strong)",
          margin: 0,
          lineHeight: "var(--line-height-body)",
        }}
      >
        This deletes every log, every setting, and every number you've entered. It can't be undone.
      </p>
      <p
        style={{
          fontSize: "var(--text-caption)",
          color: "var(--text-muted)",
          margin: 0,
        }}
      >
        Type <strong>RESET</strong> to confirm.
      </p>
      <input
        type="text"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder="RESET"
        style={{
          minHeight: "var(--hit-target-min)",
          padding: "var(--space-sm) var(--space-md)",
          borderRadius: "var(--radius-md)",
          backgroundColor: "var(--surface-sunken)",
          border: "1px solid transparent",
          fontSize: "var(--text-body)",
          color: "var(--text-strong)",
          outline: "none",
          width: "100%",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        }}
      />

      {error ? (
        <p
          role="alert"
          style={{
            fontSize: "var(--text-caption)",
            color: "var(--color-score-warning)",
            margin: 0,
          }}
        >
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={handleReset}
        disabled={!canReset}
        style={{
          minHeight: "var(--hit-target-min)",
          padding: "var(--space-sm) var(--space-lg)",
          borderRadius: "var(--radius-md)",
          backgroundColor: canReset ? "var(--color-score-warning)" : "var(--surface-sunken)",
          color: canReset ? "#ffffff" : "var(--text-muted)",
          border: "none",
          fontWeight: "var(--font-weight-bold)",
          cursor: canReset ? "pointer" : "not-allowed",
        }}
      >
        {busy ? "Resetting…" : "Erase everything"}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        disabled={busy}
        style={{
          minHeight: "var(--hit-target-min)",
          padding: "var(--space-sm) var(--space-lg)",
          borderRadius: "var(--radius-md)",
          backgroundColor: "transparent",
          color: "var(--text-muted)",
          border: "1px solid var(--divider)",
          fontWeight: "var(--font-weight-medium)",
        }}
      >
        Cancel
      </button>
    </BottomSheet>
  );
};

/* ------------------------------------------------------------------
 * Main screen
 * ------------------------------------------------------------------ */

const SettingsScreen: React.FC = () => {
  const history = useHistory();
  const name = useUserStore((s) => s.name);
  const emoji = useUserStore((s) => s.emoji);

  const incomeSources = useFinanceStore((s) => s.incomeSources);
  const recurringPayments = useFinanceStore((s) => s.recurringPayments);
  const latestBalance = useFinanceStore((s) => s.latestBalance);

  const notificationTime = useSettingsStore((s) => s.notificationTime);
  const notificationsEnabled = useSettingsStore((s) => s.notificationsEnabled);
  const storedTheme = useSettingsStore((s) => s.theme);
  const setStoredTheme = useSettingsStore((s) => s.setTheme);
  const { setTheme: applyTheme } = useTheme();

  const [balanceOpen, setBalanceOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const activeIncomeCount = incomeSources.filter((s) => s.isActive).length;
  const activeRecurringCount = recurringPayments.filter((p) => p.isActive).length;

  const handleThemeChange = async (theme: ThemeMode) => {
    void haptics.selection();
    // Push to the ThemeProvider first so the document attribute flips
    // in the same tick. The store write-through persists it.
    applyTheme(theme);
    try {
      await setStoredTheme(theme);
    } catch {
      /* swallow — the UI already reflects the new choice */
    }
  };

  return (
    <IonPage>
      <IonContent fullscreen>
        <main
          className="amban-screen"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-xs)",
          }}
        >
          <header
            style={{
              padding: "var(--space-md) var(--space-xs) var(--space-md)",
            }}
          >
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "var(--text-h1)",
                fontWeight: "var(--font-weight-bold)",
                color: "var(--text-strong)",
                margin: 0,
              }}
            >
              Settings
            </h1>
          </header>

          <SectionHeader>Profile</SectionHeader>
          <SettingsRow
            icon={Icons.finance.tag}
            label={name ? `${name}${emoji ? ` ${emoji}` : ""}` : "Your name"}
            value="Edit"
            onSelect={() => setProfileOpen(true)}
          />

          <SectionHeader>Money</SectionHeader>
          <SettingsRow
            icon={Icons.finance.wallet}
            label="Update balance"
            value={latestBalance ? formatINR(latestBalance.amount) : "Not set"}
            onSelect={() => setBalanceOpen(true)}
          />
          <SettingsRow
            icon={Icons.finance.cash}
            label="Manage income"
            value={`${activeIncomeCount} active`}
            onSelect={() => history.push("/settings/income")}
          />
          <SettingsRow
            icon={Icons.finance.chart}
            label="Manage recurring"
            value={`${activeRecurringCount} active`}
            onSelect={() => history.push("/settings/recurring")}
          />

          <SectionHeader>App</SectionHeader>
          <SettingsRow
            icon={Icons.status.notifications}
            label="Notifications"
            value={notificationsEnabled ? formatTime12h(notificationTime) : "Off"}
            onSelect={() => history.push("/settings/notifications")}
          />
          <SettingsRow
            icon={Icons.action.forward}
            label="Export data"
            value="JSON"
            onSelect={() => {
              void exportAndOffer().then((result) => {
                if (result.ok) {
                  void haptics.selection();
                }
              });
            }}
          />

          {/* Theme picker — three segmented buttons. */}
          <div
            role="radiogroup"
            aria-label="Theme"
            style={{
              display: "flex",
              gap: "var(--space-xs)",
              padding: "var(--space-xs)",
              borderRadius: "var(--radius-md)",
              backgroundColor: "var(--surface-raised)",
              boxShadow: "var(--shadow-card)",
            }}
          >
            {THEME_MODES.map((mode) => {
              const selected = storedTheme === mode.key;
              return (
                <button
                  key={mode.key}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => void handleThemeChange(mode.key)}
                  style={{
                    flex: 1,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 4,
                    minHeight: 40,
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: selected ? "var(--color-primary-light)" : "transparent",
                    color: selected ? "var(--color-primary-dark)" : "var(--text-muted)",
                    border: "none",
                    fontSize: "var(--text-caption)",
                    fontWeight: "var(--font-weight-semibold)",
                    cursor: "pointer",
                  }}
                >
                  <IonIcon icon={mode.icon} aria-hidden="true" />
                  {mode.label}
                </button>
              );
            })}
          </div>

          <SectionHeader>About</SectionHeader>
          <article
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-xs)",
              padding: "var(--space-md)",
              borderRadius: "var(--radius-md)",
              backgroundColor: "var(--surface-raised)",
              boxShadow: "var(--shadow-card)",
            }}
          >
            <span
              style={{
                fontSize: "var(--text-body)",
                fontWeight: "var(--font-weight-semibold)",
                color: "var(--text-strong)",
              }}
            >
              {formatBuildLabel()}
            </span>
            <span
              style={{
                fontSize: "var(--text-caption)",
                color: "var(--text-muted)",
                lineHeight: "var(--line-height-body)",
              }}
            >
              Your data lives only on this device. amban makes no network requests. No accounts, no
              tracking, no cloud.
            </span>
            <span
              style={{
                fontSize: "var(--text-micro)",
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono, monospace)",
              }}
            >
              Built {BUILD_INFO.buildDate.slice(0, 10)}
            </span>
            <button
              type="button"
              onClick={() => history.push("/settings/privacy")}
              style={{
                marginTop: "var(--space-xs)",
                alignSelf: "flex-start",
                background: "transparent",
                border: "none",
                padding: 0,
                color: "var(--color-primary)",
                fontSize: "var(--text-caption)",
                fontWeight: "var(--font-weight-semibold)",
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              Read the privacy statement →
            </button>
          </article>

          <SectionHeader>Danger zone</SectionHeader>
          <SettingsRow
            icon={Icons.action.delete}
            label="Reset app"
            tone="danger"
            onSelect={() => setResetOpen(true)}
          />

          <footer
            style={{
              textAlign: "center",
              padding: "var(--space-lg) 0 var(--space-xl)",
              fontSize: "var(--text-micro)",
              color: "var(--text-muted)",
            }}
          >
            Know your number. Own your day.
          </footer>
        </main>

        <BalanceUpdateSheet open={balanceOpen} onDismiss={() => setBalanceOpen(false)} />
        <ProfileSheet open={profileOpen} onDismiss={() => setProfileOpen(false)} />
        <ResetSheet open={resetOpen} onDismiss={() => setResetOpen(false)} />
      </IonContent>
    </IonPage>
  );
};

export default SettingsScreen;
