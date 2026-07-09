"use client";

import { useEffect } from "react";

import { useToast } from "@astryxdesign/core/Toast";

import { setToastHandler } from "@/lib/toast-bridge";

// Registers the mounted viewport's showToast so notify() (from non-React code)
// can dispatch into it. Rendered once inside the providers tree.
export default function ToastBridgeMount(): null {
  const showToast = useToast();

  useEffect(() => {
    setToastHandler(showToast);
    return () => setToastHandler(null);
  }, [showToast]);

  return null;
}
