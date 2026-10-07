import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { useEffect } from "react";
import { Platform } from "react-native";

import { AppProvider, useApp } from "../app-context";
import { openPcsOnTap, showNoticesInForeground } from "../push";
import { colors } from "../theme";

function Navigation() {
  const { t } = useApp();
  useEffect(() => {
    if (Platform.OS === "web") return;
    showNoticesInForeground();
    return openPcsOnTap();
  }, []);
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
          name="computers"
          options={{
            title: t("PCs"),
            tabBarIcon: ({ color, size }) => <Ionicons name="desktop-outline" color={color} size={size} />,
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
