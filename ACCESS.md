Accessibility Audit — amban.io
Audited against Android accessibility principles, WCAG 2.1/2.2 AA, and project CLAUDE.md Appendix G. Scope: all of src/, index.html, capacitor.config.ts.

Totals: 40 issues — 4 critical, 11 high, 18 medium, 7 low.

🔴 Critical
1. A11y: Viewport disables user scaling (user-scalable=no, maximum-scale=1.0)
File: index.html:12-14
Category: Dynamic type / zoom
Problem: <meta name="viewport" … maximum-scale=1.0, user-scalable=no> blocks pinch-zoom, which is a hard WCAG failure. Low-vision users cannot enlarge content.
Fix: Remove user-scalable=no and maximum-scale=1.0 (or set maximum-scale=5.0).
Ref: WCAG 1.4.4 Resize Text, 1.4.10 Reflow; Android "Support users with different abilities".
2. A11y: Global :focus { outline: none } removes keyboard focus ring on inputs/buttons
File: src/theme/globals.css (around the :focus / input-focus rules, ~lines 101 & 121-124)
Category: Keyboard / focus visibility
Problem: Blanket outline: none on :focus (and again on input:focus, textarea:focus) defeats the :focus-visible rule on browsers/Ionic Webview scenarios where :focus-visible does not fire (e.g. programmatic focus, Safari edge cases).
Fix: Remove the bare :focus { outline: none } rules; rely exclusively on a strong, tokenised :focus-visible outline (≥2px, high-contrast, outline-offset) that applies to all interactive elements.
Ref: WCAG 2.4.7 Focus Visible, 2.4.11 Focus Not Obscured.
3. A11y: Inline outline: "none" on ~12 input/textarea fields with no :focus-visible replacement
Files:
src/components/ui/CurrencyInput.tsx:265
src/screens/Onboarding/BasicDetails.tsx:114
src/screens/Onboarding/IncomeSources.tsx:233,274
src/screens/Onboarding/RecurringPayments.tsx:258,299
src/screens/Settings/ManageIncome.tsx:162,200
src/screens/Settings/ManageRecurring.tsx:190,228
src/screens/Settings/SettingsScreen.tsx:289,469
src/screens/Settings/NotificationSettings.tsx:390
src/screens/Log/DailyLogScreen.tsx:328
src/screens/Log/LogHistory.tsx:626
Category: Keyboard / focus visibility
Problem: Inline style={{ outline: "none" }} beats CSS cascade; these fields have no visible focus indicator for keyboard/switch-control users.
Fix: Remove all inline outline: "none"; use a shared CurrencyInput/input component that relies on a global :focus-visible token (e.g. outline: 2px solid var(--color-focus-ring); outline-offset: 2px).
Ref: WCAG 2.4.7 Focus Visible.
4. A11y: Touch targets below 44×44 px across the app (widespread)
Files & elements:
src/screens/Onboarding/StepLayout.tsx:141-150 — back button width:40 height:40
src/screens/Settings/ManageIncome.tsx:110,240-250 — delete/edit buttons 40×40
src/screens/Settings/ManageRecurring.tsx:142 — delete button 40×40
src/screens/Settings/NotificationSettings.tsx — time-selector ± buttons minWidth:40
src/screens/Settings/SettingsScreen.tsx — reset-flow close / trailing buttons
src/screens/Home/HomeScreen.tsx:121 — dev button minWidth:40
src/screens/Log/DailyLogScreen.tsx:218 — history button minHeight:40
src/screens/Log/DailyLogScreen.tsx:261 — quick-amount chips minHeight:40
src/screens/Log/DailyLogScreen.tsx:356 — category chips minHeight:36
src/screens/Log/LogHistory.tsx — back button
src/screens/Onboarding/IncomeSources.tsx:110 and RecurringPayments.tsx:141 — delete buttons
Category: Touch target size
Problem: Android guidance is 48 dp and CLAUDE.md Appendix G explicitly mandates 44×44 px min. Many controls are 40×40 or 36×36.
Fix: Introduce a --hit-target-min: 44px token (appears partially used) and enforce it via shared IconButton/Chip components. Audit all inline-styled hit areas.
Ref: WCAG 2.5.5 Target Size, 2.5.8 Target Size (Minimum); Android Material "touch target 48dp".
🟠 High
5. A11y: Recharts charts have no accessible alternative (Insights & LogHistory)
Files: src/screens/Insights/InsightsScreen.tsx (AreaChart, PieChart, stacked bar), src/screens/Log/LogHistory.tsx:25 (30-day BarChart)
Problem: Charts render as pure SVG with no role="img", no aria-label, no <figcaption>, and no tabular/text alternative. Screen-reader users cannot access trend data.
Fix: Wrap each chart in a role="img" with a descriptive aria-label summary (e.g. "30-day spending trend — peak ₹2,800 on 4 Apr, average ₹1,450"). Provide a visually-hidden <table> alternative with the same data behind a "View as table" disclosure.
Ref: WCAG 1.1.1 Non-text Content, 1.3.1 Info and Relationships.
6. A11y: Insight carousel auto-rotates every 5 s with no pause / no reduced-motion opt-out
File: src/screens/Home/components/InsightCarousel.tsx
Problem: Auto-advancing content violates WCAG 2.2.2. Although it pauses on pointer interaction, there is no user-discoverable pause/play control and no prefers-reduced-motion honouring. Swipe-to-dismiss has no keyboard equivalent.
Fix: Add a visible Pause/Play toggle with aria-label; stop auto-rotate when (prefers-reduced-motion: reduce) matches; expose a Delete-key or dedicated dismiss button for keyboard users.
Ref: WCAG 2.2.2 Pause Stop Hide, 2.3.3 Animation from Interactions, 2.1.1 Keyboard.
7. A11y: App-wide prefers-reduced-motion not respected for transitions/animations
Files: src/theme/globals.css, src/theme/tokens.css, carousel, BottomNav transitions, onboarding step transitions
Problem: Only src/utils/haptics.ts and one tokens file check reduce-motion; there is no global @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } } block. CLAUDE.md Appendix F explicitly requires respecting reduce-motion, including carousel auto-rotate and card entrance animations.
Fix: Add a global reduced-motion media query in globals.css; disable carousel auto-advance and score-card entrance animations behind that query.
Ref: WCAG 2.3.3; CLAUDE.md Appendix F.
8. A11y: Badge component encodes status with colour only
File: src/components/ui/Badge.tsx
Problem: tone prop maps to success/warning/danger colours with no text qualifier, no icon differentiation, and no aria-label API. Used throughout for streaks, due-date chips, etc.
Fix: Accept an aria-label or statusLabel prop, require either a qualifying icon or a textual prefix (e.g. "Warning: "), and ensure each tone has a non-colour differentiator (icon/pattern).
Ref: WCAG 1.4.1 Use of Color.
9. A11y: Score status colours (excellent/good/warning) used without text label outside ScoreCard
Files: Home (yesterday spend chip), Log history row dots, Insights mini-indicators
Problem: Green/amber/red dots and tinted rows rely on colour alone for "under / on / over score" state — colour-blind users miss it.
Fix: Pair every coloured dot/row with a text label or icon shape ("Under", "On", "Over") and add aria-label to the row.
Ref: WCAG 1.4.1; CLAUDE.md Appendix G ("Score status … also conveyed via a text label, not colour alone").
10. A11y: Back buttons across sub-screens are 40×40 (covered by #4 but filed separately)
Files: ManageIncome.tsx, ManageRecurring.tsx, NotificationSettings.tsx, LogHistory.tsx, PrivacyStatement.tsx, Onboarding/StepLayout.tsx:141-150
Problem: Primary wayfinding control is below minimum hit target.
Fix: Bump to 44×44; consider 48×48 for frequently-tapped controls.
Ref: WCAG 2.5.5.
11. A11y: Delete / edit icon buttons in Manage* screens have no accessible name
Files: src/screens/Settings/ManageIncome.tsx:110,240-250, src/screens/Settings/ManageRecurring.tsx:142,…
Problem: Icon-only buttons without aria-label — screen readers announce just "button".
Fix: aria-label="Delete income source: Salary" / aria-label="Edit recurring payment: Rent" — must include the item name.
Ref: WCAG 4.1.2 Name Role Value.
12. A11y: Add-row icon buttons in Onboarding Income/Recurring forms lack accessible name & sufficient target
Files: src/screens/Onboarding/IncomeSources.tsx, src/screens/Onboarding/RecurringPayments.tsx (inline add buttons)
Fix: Add aria-label, ensure 44×44.
Ref: WCAG 4.1.2, 2.5.5.
13. A11y: DailyLog "Save Spend" and quick-amount chips do not announce state changes to AT
File: src/screens/Log/DailyLogScreen.tsx:427-442
Problem: Toast uses role="status" aria-live="polite" but auto-dismisses in 2.8 s (below the 4 s rule of thumb). Success/warning messages are critical feedback.
Fix: Increase dwell to ≥5 s or mirror the message into a persistent, screen-reader-only region. Warning toast (over-budget) should use role="alert".
Ref: WCAG 4.1.3 Status Messages, 2.2.1 Timing Adjustable.
14. A11y: Reset-app confirmation input lacks programmatic label & input hints
File: src/screens/Settings/SettingsScreen.tsx (reset flow)
Problem: Typed-confirmation (RESET) input has placeholder-only labelling (fails 1.3.1), no <label htmlFor>, no aria-describedby for the destructive warning, no inputMode/autoCapitalize/autoComplete.
Fix: Add visible <label>, aria-describedby pointing at the warning copy, autoComplete="off", autoCorrect="off", spellCheck={false}, inputMode="text", autoCapitalize="characters".
Ref: WCAG 1.3.1, 3.3.2, 3.3.4 Error Prevention; CLAUDE.md Appendix I.
15. A11y: Keyboard dismissal of carousel slide missing
File: src/screens/Home/components/InsightCarousel.tsx:128
Problem: Swipe-dismiss has no keyboard equivalent; indicator tablist only switches slides.
Fix: Add a visible dismiss × button on each card with aria-label="Dismiss insight: <headline>".
Ref: WCAG 2.1.1 Keyboard.
🟡 Medium
16. A11y: No <main> / landmark roles on screens
Files: HomeScreen.tsx, DailyLogScreen.tsx:177, LogHistory.tsx, InsightsScreen.tsx, SettingsScreen.tsx, ProfileScreen.tsx
Problem: Every screen root is a <div className="amban-screen">. No <main>, no <nav> on BottomNav, no <header> on screen titles. Screen reader rotor users can't jump to main content.
Fix: Use <main>, <nav aria-label="Primary"> on BottomNav, <header>/<h1> on each screen.
Ref: WCAG 1.3.1, 2.4.1 Bypass Blocks.
17. A11y: Heading hierarchy not audited — duplicated/missing <h1>
Files: Most screens use styled <div>s for titles (--text-h1, --text-h2 classes) without semantic <h1>–<h3>.
Fix: Map typography tokens to semantic heading elements; ensure exactly one <h1> per screen, no level skips.
Ref: WCAG 1.3.1, 2.4.6 Headings and Labels.
18. A11y: BottomNav not marked as tablist / navigation with aria-current
File: src/components/layout/BottomNav.tsx:175-227
Problem: Active tab differentiated by colour+weight+filled icon (ok), but the nav container has no <nav aria-label>, items don't have aria-current="page".
Fix: Wrap in <nav aria-label="Primary">; add aria-current="page" on the active tab link.
Ref: WCAG 1.3.1, 4.1.2.
19. A11y: Notes textarea label not programmatically associated
File: src/screens/Log/DailyLogScreen.tsx:300-330
Problem: <label> lacks htmlFor; textarea has id="log-notes" but no linking.
Fix: <label htmlFor="log-notes">.
Ref: WCAG 1.3.1, 3.3.2 Labels or Instructions.
20. A11y: Onboarding income/recurring form fields rely on placeholder for labelling
Files: src/screens/Onboarding/IncomeSources.tsx, src/screens/Onboarding/RecurringPayments.tsx, similar in ManageIncome.tsx, ManageRecurring.tsx
Problem: Some amount/day/label inputs have no <label htmlFor>; placeholders disappear on focus.
Fix: Add visible labels (or visually-hidden labels for compact rows) with htmlFor.
Ref: WCAG 3.3.2, 1.3.1.
21. A11y: Emoji picker "None" option has no accessible name
Files: src/screens/Onboarding/BasicDetails.tsx:161-180, src/screens/Settings/SettingsScreen.tsx:308-326
Problem: Blank/∅ "None" button has no aria-label; SR announces just "button".
Fix: aria-label="No emoji".
Ref: WCAG 4.1.2.
22. A11y: DailyLog category "None" button lacks accessible name
File: src/screens/Log/DailyLogScreen.tsx:347-368
Fix: aria-label="No category".
Ref: WCAG 4.1.2.
23. A11y: Notification time input lacks inputMode and may not be a native time control
File: src/screens/Settings/NotificationSettings.tsx (time selector ± buttons and textual display)
Problem: Custom ± controls are not announced as a spinbutton; no role="spinbutton", no aria-valuenow/min/max/text, no inputMode="numeric" on any underlying input.
Fix: Either use a native <input type="time"> with label, or add full ARIA spinbutton semantics plus Up/Down arrow key handlers.
Ref: WCAG 4.1.2; ARIA Spinbutton pattern.
24. A11y: Notification enable toggle — verify role="switch" + aria-checked
File: src/screens/Settings/NotificationSettings.tsx
Problem: If custom-rendered (not IonToggle), it must expose switch semantics.
Fix: Use IonToggle (which exposes switch role) or add role="switch" aria-checked={boolean} and keyboard handler for Space.
Ref: ARIA Switch pattern, WCAG 4.1.2.
25. A11y: CurrencyInput disabled state uses opacity: 0.55 — contrast risk
Files: src/components/ui/CurrencyInput.tsx:191, src/components/ui/DatePicker.tsx:139
Problem: 55% opacity on muted text tokens can drop below 3:1 on light bg and 4.5:1 for placeholders; also Ionic lowers opacity further on disabled.
Fix: Use a dedicated --color-text-disabled token measured against both themes (CLAUDE.md Appendix G). Note: WCAG 1.4.3 exempts disabled controls, but CLAUDE.md's own bar is stricter.
Ref: WCAG 1.4.3; CLAUDE.md Appendix G.
26. A11y: --color-text-secondary contrast not verified in dark mode
File: src/theme/tokens.css:26,118
Problem: #9AA0A6 on #1E1E1E ≈ 5.8:1 (ok), but on --color-surface-variant-dark: #2A2A2A it is ~4.9:1 — marginal; on any lighter dark-mode surface it can fail.
Fix: Audit every text/bg token pair; publish a small contrast test file.
Ref: WCAG 1.4.3 (AA), 1.4.11 Non-text Contrast.
27. A11y: Score number may not meet AAA as required by CLAUDE.md
File: src/screens/Home/components/ScoreCard.tsx
Problem: Appendix G says score digits must meet AAA (7:1 normal text / 4.5:1 large). Score colour tokens (#1E8C45, #F29900, #E94235) on tinted backgrounds have not been verified.
Fix: Verify each score state at both themes; use darker shades for the foreground number when on tinted fill.
Ref: WCAG 1.4.6 Contrast (Enhanced).
28. A11y: Insight card tone / severity not surfaced to AT
File: src/screens/Insights/InsightsScreen.tsx, src/screens/Home/components/InsightCarousel.tsx
Problem: tone (positive/neutral/warning/critical) is visual-only.
Fix: Prefix the accessible name with the tone: aria-label="Warning insight: You've overspent 4 days in a row".
Ref: WCAG 1.4.1, 1.3.1.
29. A11y: Balance / score updates not announced
Files: ScoreCard.tsx, HomeScreen.tsx, any balance-update flow
Problem: When the user saves a log and the score changes, the new number is re-rendered silently.
Fix: Wrap the score number in aria-live="polite" aria-atomic="true" or fire a role="status" announcement on change.
Ref: WCAG 4.1.3 Status Messages.
30. A11y: IonIcon decoratives lack aria-hidden="true"
Files: Many — e.g. src/screens/Home/components/InsightCarousel.tsx, DailyLogPrompt.tsx:153,210,244, BottomNav.tsx
Problem: Decorative icons next to text labels get announced by SR ("home icon Home"), creating duplication.
Fix: Add aria-hidden="true" on every decorative icon; keep icons meaningful only when icon-only.
Ref: WCAG 1.1.1.
31. A11y: ProgressRing in onboarding has no accessible name
File: src/components/ui/ProgressRing.tsx:121-126
Problem: Only exposes aria-valuemin/max/now when aria-label is explicitly provided; onboarding uses it in "decorative" mode with no step announcement.
Fix: Default to role="progressbar" with aria-valuetext="Step 2 of 6" from the parent always.
Ref: WCAG 4.1.2.
32. A11y: SettingsRow trailing chevron — row hit target & aria-label completeness
File: src/screens/Settings/SettingsScreen.tsx:122-132
Problem: Row button aria-label is just the row label; no "opens submenu / page" hint, and rows may be <48 px tall on compact density.
Fix: Use <button> semantics (already there), ensure row ≥48 px; accessible name can include destination e.g. "Manage income sources, 3 items".
Ref: WCAG 2.5.5, 2.4.4 Link Purpose (In Context).
33. A11y: No skip-to-content link / no landmark bypass
File: src/App.tsx, src/components/layout/AppShell.tsx
Problem: Keyboard users must tab through the BottomNav on every screen.
Fix: Add a visually-hidden "Skip to main content" link as the first focusable element in AppShell.
Ref: WCAG 2.4.1.
🟢 Low
34. A11y: Splash/status-bar colour contrast for any future overlay text untested
File: capacitor.config.ts:7,20
Fix: Document that splash text (if added) must be white on #1A73E8 (contrast ≈ 4.7:1 — AA large only).
Ref: WCAG 1.4.3.
35. A11y: Hardcoded rem/px icon sizes may not scale with OS text size
Files: BottomNav.tsx:211, DailyLogPrompt.tsx:153,210,244, SettingsScreen.tsx:92,127
Fix: Introduce --icon-size-* tokens tied to 1em / typography scale.
Ref: WCAG 1.4.4.
36. A11y: Autocomplete hints missing on non-critical fields
Files: IncomeSources.tsx, RecurringPayments.tsx label inputs
Fix: autoComplete="off" to suppress inappropriate suggestions.
Ref: WCAG 1.3.5.
37. A11y: Amount inputs should use inputMode="decimal" and enterKeyHint
Files: CurrencyInput.tsx, BankBalance.tsx, DailyLogScreen.tsx, ManageIncome.tsx, ManageRecurring.tsx
Problem: Native numeric keypad with decimal point only appears with inputMode="decimal".
Fix: Verify all currency inputs set inputMode="decimal" and enterKeyHint="done".
Ref: WCAG 1.3.5.
38. A11y: Haptics used as sole success cue in some flows
Files: src/utils/haptics.ts callers in DailyLogScreen.tsx, SettingsScreen.tsx (reset)
Problem: Reset-confirm, balance update haptic may fire without visible/SR confirmation on slow renders.
Fix: Ensure every haptic-emitting action also produces a visible + role="status" message.
Ref: WCAG 4.1.3, 1.3.1.
39. A11y: StyleGuide screen itself should demonstrate a11y states
File: src/screens/StyleGuide/StyleGuideScreen.tsx
Fix: Add focus-visible, disabled, and error examples with live contrast ratios so future components inherit the pattern.
Ref: CLAUDE.md Appendix G (tokens as single source of truth).
40. A11y: Toast/snackbar region should be a single page-level live region
File: DailyLogScreen.tsx:427-442 (toast is inside the screen)
Problem: Re-rendering the toast inside the screen can mount/unmount the live region, suppressing announcements.
Fix: Hoist a single <div role="status" aria-live="polite" /> in AppShell and push messages into it via context.
Ref: WCAG 4.1.3.
