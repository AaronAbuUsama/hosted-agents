import type { ReactElement, ReactNode } from "react";

import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";

type CoworkerPageVariant = "document" | "workspace";
type CoworkerPageWidth = "default" | "wide" | "full";

type CoworkerPageProps = {
  children: ReactNode;
  eyebrow?: string;
  title?: string;
  description?: string;
  actions?: ReactNode;
  variant?: CoworkerPageVariant;
  width?: CoworkerPageWidth;
};

const contentWidthClasses: Record<CoworkerPageWidth, string> = {
  default: "mx-auto w-full max-w-6xl px-6 py-6",
  wide: "mx-auto w-full max-w-7xl px-6 py-6",
  full: "w-full px-6 py-6",
};

export default function CoworkerPage({
  children,
  eyebrow,
  title,
  description,
  actions,
  variant = "document",
  width = "wide",
}: CoworkerPageProps): ReactElement {
  const header = title ? (
    <HStack hAlign="between" vAlign="start">
      <VStack gap={1}>
        {eyebrow ? (
          <Text type="label" color="accent">
            {eyebrow}
          </Text>
        ) : null}
        <Heading level={1}>{title}</Heading>
        {description ? (
          <Text type="supporting" color="secondary" as="p">
            {description}
          </Text>
        ) : null}
      </VStack>
      {actions}
    </HStack>
  ) : null;

  if (variant === "workspace") {
    return (
      <main data-coworker-page="workspace" className="flex h-full min-h-0 flex-col bg-body text-primary">
        {header ? <div className="shrink-0 border-b border-border px-6 py-4">{header}</div> : null}
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </main>
    );
  }

  return (
    <main data-coworker-page="document" className="h-full overflow-y-auto bg-body text-primary">
      <div className={contentWidthClasses[width]}>
        <VStack gap={6}>
          {header}
          {children}
        </VStack>
      </div>
    </main>
  );
}
