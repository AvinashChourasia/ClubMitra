// Legacy route: the event calendar is now the Events TAB. Anything still
// navigating to /races (old links, muscle memory in stale bundles) lands there.
import { Redirect } from "expo-router";

export default function RacesRedirect() {
  return <Redirect href="/events" />;
}
