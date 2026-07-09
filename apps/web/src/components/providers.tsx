"use client";

import { LayerProvider } from "@astryxdesign/core/Layer";
import { LinkProvider } from "@astryxdesign/core/Link";
import { Theme as AstryxTheme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import Link from "next/link";

import ToastBridgeMount from "@/components/toast-bridge-mount";
import { queryClient } from "@/utils/orpc";

// The app is permanently dark: the theme is set statically via `data-theme` on
// <html> (see layout.tsx) and Astryx renders `mode="dark"`. next-themes used to
// wrap this, but it was configured for `attribute="class"` — a class nothing
// reads — so it only added a post-mount hydration mutation. Removed.
export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AstryxTheme theme={neutralTheme} mode="dark">
      <LayerProvider>
        <LinkProvider component={Link}>
          <QueryClientProvider client={queryClient}>
            {children}
            <ReactQueryDevtools />
            <ToastBridgeMount />
          </QueryClientProvider>
        </LinkProvider>
      </LayerProvider>
    </AstryxTheme>
  );
}
