# ClubMitra mobile — Expo

This app is on **Expo SDK 54**. When you need exact API details, read the
versioned docs at https://docs.expo.dev/versions/v54.0.0/ (match the installed
SDK in `package.json` — do not assume a newer SDK).

Stack notes:
- Expo Router (file-based routing), React Context for state (no Redux/Zustand).
- HTTP via a small typed `fetch` wrapper in `lib/api.ts` (no axios).
- Theming + tokens in `lib/theme.tsx` (light/dark live bindings).
- Verify changes with `npx tsc --noEmit` and, for runtime, `npx expo export`.
