import type { CSSProperties, ReactElement, ReactNode } from "react";

import { Divider } from "@astryxdesign/core/Divider";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";

// The inline settings row idiom from the Astryx settings-sidebar template:
// a semibold label with a supporting value stacked on the left, an optional
// action or status on the right, and a divider between rows.
const rowPadding: CSSProperties = { paddingBlock: "var(--spacing-3)" };

export function SettingsRows({ children }: { children: ReactNode }): ReactElement {
  return <VStack gap={0}>{children}</VStack>;
}

export function SettingsRow({
  label,
  value,
  endContent,
  isLast = false,
}: {
  label: string;
  value?: ReactNode;
  endContent?: ReactNode;
  isLast?: boolean;
}): ReactElement {
  return (
    <>
      <HStack hAlign="between" vAlign="center" gap={4} style={rowPadding}>
        <StackItem size="fill">
          <VStack gap={0}>
            <Text type="body" weight="semibold">
              {label}
            </Text>
            {value != null ? (
              <Text type="supporting" color="secondary">
                {value}
              </Text>
            ) : null}
          </VStack>
        </StackItem>
        {endContent ?? null}
      </HStack>
      {isLast ? null : <Divider />}
    </>
  );
}
