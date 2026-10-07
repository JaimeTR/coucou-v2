// Notifications when a PC needs you, even with the app closed. The phone asks
// Expo for a push token and gives it to your sync server, which pings it when a
// permission or a question waits. What arrives is generic ("Claude Code pide
// permiso en JAIME-PC"): never the command.

import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { Platform } from "react-native";

/** While the app is open the notice still shows, so a waiting permission is not missed. */
export function showNoticesInForeground() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

/** Tapping a notice opens the PCs tab, where Allow / Deny are. */
export function openPcsOnTap(): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener(() => router.push("/computers"));
  return () => sub.remove();
}

export type PushResult = { ok: true; token: string } | { ok: false; why: string };

/** Asks permission and returns this phone's Expo push token. */
export async function getPushToken(): Promise<PushResult> {
  if (Platform.OS === "web") return { ok: false, why: "Los avisos no existen en el navegador." };
  if (!Device.isDevice) return { ok: false, why: "Los avisos necesitan un teléfono de verdad, no un simulador." };
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("approvals", {
      name: "Permisos y preguntas",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
    });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted") return { ok: false, why: "Sin permiso de notificaciones no se pueden enviar avisos. Actívalo en los ajustes del teléfono." };
  // Expo needs the project this app was built in (eas init writes it into app.json).
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return { ok: false, why: "Falta enlazar el proyecto de EAS (npx eas-cli init). Ver mobile/README.md." };
  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return { ok: true, token: data };
  } catch (e) {
    return { ok: false, why: `No se pudo obtener el token de avisos: ${e instanceof Error ? e.message : String(e)}` };
  }
}
