"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV === "development") return;
    const registration = navigator.serviceWorker.register("/sw.js");
    registration.catch(() => {
      // Service workers are optional; the app works without them.
    });
  }, []);
  return null;
}