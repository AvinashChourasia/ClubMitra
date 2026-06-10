// The entry route ("/"). Routing by who's opening the app:
//
//   still checking storage  -> spinner
//   logged in               -> /home
//   brand new (no welcome)  -> /welcome  (pick a city, see the value)
//   returning guest         -> /explore  (browse clubs/challenges; auth gates
//                                         fire only when they try to act)
//
// The old behaviour (logged out -> /login) put a login wall in front of any
// value; guests now browse first and identity is asked at commitment moments.

import { useEffect, useState } from "react";
import { Redirect, type Href } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { useAuth } from "../lib/auth";
import { welcomeSeen } from "../lib/discover";

export default function Index() {
  const { user, initializing } = useAuth();
  const [seen, setSeen] = useState<boolean | null>(null);

  useEffect(() => {
    welcomeSeen().then(setSeen).catch(() => setSeen(false));
  }, []);

  if (initializing || (!user && seen === null)) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (user) return <Redirect href="/home" />;
  return <Redirect href={(seen ? "/explore" : "/welcome") as Href} />;
}
