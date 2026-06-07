// The entry route ("/"). Its only job is the AUTH GATE: decide where to send
// the user based on whether they're logged in.
//
//   still checking storage -> show a spinner
//   logged in              -> /home
//   logged out             -> /login
//
// Using <Redirect> (declarative) instead of router.push in an effect avoids a
// brief flash of the wrong screen.

import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { useAuth } from "../lib/auth";

export default function Index() {
  const { user, initializing } = useAuth();

  if (initializing) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return <Redirect href={user ? "/home" : "/login"} />;
}
