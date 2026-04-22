#!/usr/bin/env bash
# ============================================================
# amban.io — sync-version.sh (installed as scripts/bump-version.sh)
#
# Force every version-bearing string in the repo to match a single
# target version. Idempotent by construction — running it twice with
# the same target is a no-op on the second pass, and running it after
# a partial hand-edit repairs the drift without caring which files
# were touched.
#
# Philosophy
# ----------
# Earlier drafts tried to READ the "old" version from each file and
# rewrite from there. That created cross-file drift bugs whenever a
# file had been hand-edited out-of-band (package-lock.json lagging
# package.json, the workflow default pointing at a previous release,
# doc comments freezing at a stale example). The fix is to stop
# caring about the old value: accept a target version, and make every
# location BE that version. Matching, not bumping.
#
# Invoked by
# ----------
#   * `.github/workflows/release.yml` on every `v*` tag push.
#     The workflow passes the tag (e.g. `v0.1.2`), the script strips
#     the `v`, and writes 0.1.2 everywhere.
#   * A human ahead of cutting a release:
#       ./scripts/bump-version.sh 0.1.2
#     (or `v0.1.2` — the script accepts both).
#
# What this script synchronises
# -----------------------------
#   * package.json                   → top-level "version"
#   * package-lock.json              → top-level "version" + the
#                                      `packages[""]` self-entry
#   * android/app/build.gradle       → versionName "<target>"
#                                      versionCode <derived>
#       versionCode is derived deterministically from the target:
#           MAJOR * 10000 + MINOR * 100 + PATCH
#       so 0.1.2 → 102, 1.2.3 → 10203. Play-compatible monotonic
#       ordering as long as no component exceeds 99, and repeatable
#       across fresh checkouts.
#   * src/constants/buildInfo.ts     → doc-comment example strings
#   * src/utils/exportData.ts        → doc-comment example strings
#   * .github/workflows/release.yml  → `workflow_dispatch` default
#                                      input (`v<target>`)
#
# What this script leaves alone
# -----------------------------
#   * CHANGELOG.md, ROADMAP.md — human-authored per release.
#   * LICENSE — no version concept.
#   * Historical prose mentioning a prior version on purpose
#     (migrations, rewrite comments). The rewrites below are
#     file-scoped and narrowly anchored, so "unchanged from v0.1.0"
#     notes in migrations/comments are safe.
#   * Anything that isn't in the explicit file list.
#
# Portability
# -----------
# All rewrites go through awk (not sed) so the script behaves the
# same on macOS (BSD), Linux (GNU), and Alpine/busybox. No `jq`, no
# `sponge`, no platform-specific `-i` gymnastics.
#
# Exit status
# -----------
#   0 on success (including no-op when everything already matches);
#   64 on bad usage, 65 on malformed version input, non-zero on I/O
#   failure. The release workflow's fail-fast posture means a broken
#   sync never produces an APK.
# ============================================================

set -euo pipefail

# ------------------------------------------------------------
# Arg parsing + validation
# ------------------------------------------------------------
if [[ $# -ne 1 ]]; then
  echo "usage: $0 <version>" >&2
  echo "  version may be a bare semver (0.1.2) or a tag (v0.1.2)." >&2
  exit 64
fi

TARGET="$1"

# Accept `v0.1.2` or `0.1.2` — the tag-push path passes the former,
# humans reach for either.
TARGET="${TARGET#v}"

if ! [[ "$TARGET" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "error: '$TARGET' is not a bare numeric semver (MAJOR.MINOR.PATCH)" >&2
  echo "  prerelease / build-metadata suffixes are intentionally not supported" >&2
  echo "  while the project is on the alpha track." >&2
  exit 65
fi

# Derive the monotonic Android versionCode from the target semver.
# The encoding MAJOR*10000 + MINOR*100 + PATCH gives us 99.99.99 of
# headroom, which is plenty for the alpha track. If we ever release
# a 1.x with >99 patches on a minor, we widen the encoding then.
IFS='.' read -r V_MAJOR V_MINOR V_PATCH <<<"$TARGET"
TARGET_CODE=$(( 10#${V_MAJOR} * 10000 + 10#${V_MINOR} * 100 + 10#${V_PATCH} ))

# ------------------------------------------------------------
# Resolve repo root so the script works from any cwd.
# ------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

echo "sync-version: target = $TARGET (versionCode = $TARGET_CODE)"

# ------------------------------------------------------------
# Atomic-write awk helper.
#
# Runs the given awk program over `$file` and atomically replaces
# the file with the output via mktemp + mv. Never leaves a partial
# write behind, even on Ctrl-C mid-run.
#
#   awk_rewrite FILE AWK_PROGRAM
#
# The awk program may reference variables passed via `-v` by the
# caller; we keep this wrapper deliberately minimal so every
# rewrite below reads like plain awk.
# ------------------------------------------------------------
awk_rewrite() {
  local file="$1"
  shift
  if [[ ! -f "$file" ]]; then
    return 0
  fi
  local tmp
  tmp="$(mktemp "${file}.sync.XXXXXX")"
  # shellcheck disable=SC2068
  awk "$@" "$file" >"$tmp"
  mv "$tmp" "$file"
}

# Track whether anything actually changed, for a truthful summary.
CHANGED=0
mark_changed() { CHANGED=1; }

# ------------------------------------------------------------
# 1. package.json — top-level "version" (within the first 20 lines
#    so a nested dep manifest can never be clobbered).
#
# The awk program only rewrites the FIRST matching line it sees,
# and only inside the window. Idempotent: if the value already
# matches, the replacement is a no-op.
# ------------------------------------------------------------
before="$(cat package.json)"
awk_rewrite package.json -v target="$TARGET" '
  BEGIN { done = 0 }
  NR <= 20 && !done && match($0, /"version"[[:space:]]*:[[:space:]]*"[0-9]+\.[0-9]+\.[0-9]+"/) {
    head = substr($0, 1, RSTART - 1)
    tail = substr($0, RSTART + RLENGTH)
    printf "%s\"version\": \"%s\"%s\n", head, target, tail
    done = 1
    next
  }
  { print }
'
if [[ "$(cat package.json)" != "$before" ]]; then
  echo "  • package.json"
  mark_changed
fi

# ------------------------------------------------------------
# 2. package-lock.json — two occurrences in the top ~20 lines:
#    the top-level "version" (line ~3) and the `packages[""]`
#    self-entry (around line ~9). We rewrite BOTH by looking for
#    a bare semver next to a `"version":` key within the window,
#    regardless of its current value. This sidesteps the drift
#    bug where `package.json` was ahead and `package-lock.json`
#    still said "0.0.0".
#
# Any `"version":` line beyond the 20-line window (i.e. inside a
# nested dependency) is untouched.
# ------------------------------------------------------------
if [[ -f package-lock.json ]]; then
  before="$(cat package-lock.json)"
  awk_rewrite package-lock.json -v target="$TARGET" '
    NR <= 20 && match($0, /"version"[[:space:]]*:[[:space:]]*"[0-9]+\.[0-9]+\.[0-9]+"/) {
      head = substr($0, 1, RSTART - 1)
      tail = substr($0, RSTART + RLENGTH)
      printf "%s\"version\": \"%s\"%s\n", head, target, tail
      next
    }
    { print }
  '
  if [[ "$(cat package-lock.json)" != "$before" ]]; then
    echo "  • package-lock.json"
    mark_changed
  fi
fi

# ------------------------------------------------------------
# 3. android/app/build.gradle — versionName + versionCode.
#
# versionName is forced to the target string; versionCode is forced
# to the derived integer. Idempotent: the awk checks the current
# line and only rewrites when it differs.
# ------------------------------------------------------------
GRADLE_FILE="android/app/build.gradle"
if [[ -f "$GRADLE_FILE" ]]; then
  before="$(cat "$GRADLE_FILE")"
  awk_rewrite "$GRADLE_FILE" -v target="$TARGET" -v code="$TARGET_CODE" '
    {
      # versionName "<anything>" → versionName "<target>"
      if (match($0, /versionName[[:space:]]+"[^"]*"/)) {
        head = substr($0, 1, RSTART - 1)
        tail = substr($0, RSTART + RLENGTH)
        printf "%sversionName \"%s\"%s\n", head, target, tail
        next
      }
      # versionCode <integer> → versionCode <target_code>
      if (match($0, /versionCode[[:space:]]+[0-9]+/)) {
        head = substr($0, 1, RSTART - 1)
        tail = substr($0, RSTART + RLENGTH)
        printf "%sversionCode %s%s\n", head, code, tail
        next
      }
      print
    }
  '
  if [[ "$(cat "$GRADLE_FILE")" != "$before" ]]; then
    echo "  • $GRADLE_FILE"
    echo "    versionName = \"$TARGET\", versionCode = $TARGET_CODE"
    mark_changed
  fi
fi

# ------------------------------------------------------------
# 4. Doc-comment example strings.
#
# These are illustrative (the runtime value comes from package.json
# via vite.config.ts's `define` block) but keeping them current
# avoids confusing readers of the source. We match any bare semver
# in the two narrowly-scoped doc files and force it to the target.
#
# The regex is anchored enough to not touch commit SHAs, build-date
# stamps, or anything else: we look specifically for X.Y.Z with
# 1–3 digit components. Historical prose in these files ("released
# with v0.1.0") would also match — that's acceptable here because
# these files don't carry historical prose; migrations and rewrite
# comments that do are not in the list.
# ------------------------------------------------------------
DOC_FILES=(
  "src/constants/buildInfo.ts"
  "src/utils/exportData.ts"
)
for f in "${DOC_FILES[@]}"; do
  if [[ -f "$f" ]]; then
    before="$(cat "$f")"
    # Only announce the touch if something actually differs, to keep
    # the output truthful on a re-run.
    awk_rewrite "$f" -v target="$TARGET" '
      {
        line = $0
        out = ""
        while (match(line, /[0-9]+\.[0-9]+\.[0-9]+/)) {
          out = out substr(line, 1, RSTART - 1) target
          line = substr(line, RSTART + RLENGTH)
        }
        print out line
      }
    '
    if [[ "$(cat "$f")" != "$before" ]]; then
      echo "  • $f"
      mark_changed
    fi
  fi
done

# ------------------------------------------------------------
# 5. Release workflow — `workflow_dispatch` default input.
#
# Only the `default:` line is rewritten. The tag-triggered path
# reads from `github.ref` at runtime and doesn't care about this
# literal; but keeping it current means a dry-run dispatch matches
# the most recent release by default.
#
# We match the `default: "v<anything>"` shape so this works even
# if the file has drifted to some unrelated value out-of-band.
# Indentation is preserved because we only substitute the quoted
# literal, not the whole line.
# ------------------------------------------------------------
WF_FILE=".github/workflows/release.yml"
if [[ -f "$WF_FILE" ]]; then
  before="$(cat "$WF_FILE")"
  awk_rewrite "$WF_FILE" -v target="$TARGET" '
    {
      if (match($0, /default:[[:space:]]*"v[0-9]+\.[0-9]+\.[0-9]+"/)) {
        head = substr($0, 1, RSTART - 1)
        tail = substr($0, RSTART + RLENGTH)
        printf "%sdefault: \"v%s\"%s\n", head, target, tail
        next
      }
      print
    }
  '
  if [[ "$(cat "$WF_FILE")" != "$before" ]]; then
    echo "  • $WF_FILE"
    mark_changed
  fi
fi

# ------------------------------------------------------------
# Summary
# ------------------------------------------------------------
echo ""
if [[ "$CHANGED" -eq 0 ]]; then
  echo "sync-version: already at $TARGET — no files changed."
else
  echo "sync-version: synced to $TARGET."
  echo ""
  echo "Review with: git diff"
  echo "This script does not stage, commit, or push."
fi
