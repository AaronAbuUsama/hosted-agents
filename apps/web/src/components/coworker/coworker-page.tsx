import type { ReactElement, ReactNode } from "react";

import {
  HStack,
  Layout,
  LayoutContent,
  LayoutHeader,
  StackItem,
  VStack,
} from "@astryxdesign/core/Layout";
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

const contentWidths: Record<Exclude<CoworkerPageWidth, "full">, number> = {
  default: 960,
  wide: 1180,
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
    <HStack hAlign="between" vAlign="start" gap={4} wrap="wrap">
      <StackItem size="fill">
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
      </StackItem>
      {actions}
    </HStack>
  ) : null;

  if (variant === "workspace") {
    return (
      <Layout
        data-coworker-page="workspace"
        height="fill"
        header={
          header ? (
            <LayoutHeader hasDivider padding={4}>
              {header}
            </LayoutHeader>
          ) : undefined
        }
        content={<LayoutContent padding={0}>{children}</LayoutContent>}
      />
    );
  }

  return (
    <Layout
      data-coworker-page="document"
      height="fill"
      contentWidth={width === "full" ? undefined : contentWidths[width]}
      content={
        <LayoutContent isScrollable padding={6}>
          <VStack gap={6}>
            {header}
            {children}
          </VStack>
        </LayoutContent>
      }
    />
  );
}
