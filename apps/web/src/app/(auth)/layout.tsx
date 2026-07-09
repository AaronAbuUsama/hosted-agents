import type { CSSProperties, ReactNode } from "react";

import { Stack } from "@astryxdesign/core/Stack";

const authLayoutStyle: CSSProperties = {
  minHeight: "100dvh",
  backgroundColor: "var(--color-background-body)",
};

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <Stack style={authLayoutStyle}>{children}</Stack>;
}
