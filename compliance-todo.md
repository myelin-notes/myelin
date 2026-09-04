# Compliance to-do

Open items from auditing the app's data flows against COPPA (FTC) and the GDPR.
Engineering audit, not legal advice. Two items already landed: the privacy page
no longer attributes the update endpoint to Cloudflare, and the stale
"error tracking is always on" comment is gone from `src/lib/analytics.ts`.

When any of this changes what leaves the device, update
`packages/website/src/pages/privacy.astro` in the same commit and move the
`updated` date at the top of that file.

## Blocking for an EU/UK release

- [x] **Make analytics opt-in rather than opt-out.** `analytics-enabled` now
      defaults to `false` and the first-run onboarding asks for consent before
      anything is stored, which is what ePrivacy Art 5(3) wants. No PostHog
      persistence key or cookie exists on disk until the user opts in.
- [x] **Add `opt_out_capturing_by_default: true` to the app's `posthog.init`.**
      Done, and `posthog.init` itself no longer runs at boot: it is deferred
      until consent (`src/lib/posthog.ts`), so an opted-out install makes no
      remote-config request and leaks no IP at launch. Verified in the running
      app — no request to the ingestion host before the toggle.
- [ ] **Surface the PostHog `distinct_id` in Settings > Privacy**
      (`src/pages/settings/sections/privacy-section.tsx`). The policy promises to
      walk users through locating their installation identifier, and no UI
      anywhere shows it, so the Art 17 erasure promise is currently
      unhonorable. A copy button is the minimum; a "delete my analytics data"
      action calling PostHog's API is better.

## Data minimization

- [ ] **Allowlist properties at the analytics and error boundaries**
      (`src/lib/analytics.ts`, `packages/shared/src/logger.ts:304`). Arbitrary
      `logger.error` metadata is forwarded to `captureException` verbatim, and
      the redaction regex at `packages/shared/src/logger.ts:27` matches only
      secret-shaped keys, not user text. Two known leaks:
      - `src/components/layout/sidebar/sidebar-tags.tsx:122,146` sends
        `{ tag: normalized }`. Tag names are user-authored content and this is
        not disclosed in the policy.
      - `src/lib/sync/repo/cached/index.ts:1746` sends 200 chars of the raw
        error message, which can carry file paths. This one is disclosed.

## Security of processing (Art 32)

- [ ] **Move the Stronghold vault password to the OS keychain.**
      `getGitHubVaultPassword()`
      (`src/lib/sync/repo/github-credentials.ts:47-59`) generates the password
      and stores it in `UserPrefs`, which is plain localStorage. Any process
      that can read the app data directory gets both the encrypted vault and its
      key, so the policy's "kept on your device in an encrypted vault" oversells
      what the encryption buys against a local attacker.

## Privacy policy text (`packages/website/src/pages/privacy.astro`)

- [ ] Legal basis for each processing purpose.
- [ ] Controller identity and a postal address. "An independent project" is not
      an identity under Art 13.
- [ ] The lawful transfer mechanism for PostHog US. The transfer is disclosed;
      the safeguard is not. Name the DPF certification or the SCCs.
- [ ] The full rights list: access, rectification, erasure, restriction,
      objection, portability, plus the right to lodge a complaint with a
      supervisory authority.
- [ ] A statement that there is no automated decision-making or profiling.

## Operational, outside the repo

- [ ] Set 12-month retention in the PostHog project settings. The policy asserts
      it as fact and nothing in the code enforces it.
- [ ] Execute the DPAs with PostHog and Cloudflare. The policy asserts every
      provider is bound by one.
- [ ] Write a short Art 30 record of processing. Analytics on every app launch
      is regular rather than occasional, so the under-250-employee exemption
      does not clearly apply.
- [ ] Decide whether Art 27 requires a designated EU representative. Same
      reasoning: "occasional" is hard to argue for launch-time analytics.

## COPPA and Google Play

The app is not child-directed under the FTC's multi-factor test: neutral subject
matter, no child-oriented visuals, characters, music, or ads. Transcription runs
on-device via whisper.cpp (`src-tauri/src/transcription.rs`), so voice never
leaves the device. The policy carries the under-13 disclaimer and a removal
contact. Remaining work is about staying in that position.

- [ ] **Set target audience to 13 and over in Play Console.** This is the
      decision that keeps COPPA out of scope. Including under-13 pulls the app
      into the Families policy, where PostHog collecting a persistent identifier
      and IP would need verifiable parental consent that there is no way to
      obtain.
- [ ] Keep the store listing free of child-appealing imagery. Google applies the
      same appeal test to the listing itself, not just the app.
- [ ] Fill the Data Safety form: app activity and crash/diagnostic data, device
      identifiers, encrypted in transit, users can request deletion. That last
      declaration depends on the installation-ID work above being done first.
