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

import { ThemeProvider } from "./theme-provider";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      forcedTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
    >
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
    </ThemeProvider>
  );
}
