import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { AppProvider, useApp } from "../app-context";
import { colors } from "../theme";

function Navigation() {
  const { t } = useApp();
  return (
    <>
      <StatusBar style="light" />
      <Tabs
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.ink,
          headerShadowVisible: false,
          tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.line },
          tabBarActiveTintColor: colors.ink,
          tabBarInactiveTintColor: colors.dim,
          sceneStyle: { backgroundColor: colors.bg },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: t("Hoy"),
            tabBarIcon: ({ color, size }) => <Ionicons name="sparkles" color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: t("Ajustes"),
            tabBarIcon: ({ color, size }) => <Ionicons name="settings-sharp" color={color} size={size} />,
          }}
        />
      </Tabs>
    </>
  );
}

export default function Layout() {
  return (
    <AppProvider>
      <Navigation />
    </AppProvider>
  );
}
