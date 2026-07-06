"use client";

import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import {
  ArrowPathIcon,
  Cog6ToothIcon,
  PlayCircleIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";
import type { ReactElement } from "react";

type HeaderActionButtonProps = {
  variant?: "primary" | "secondary";
};

export function KickOffRunButton({ variant = "primary" }: HeaderActionButtonProps): ReactElement {
  return (
    <Button
      label="Kick off run"
      variant={variant}
      size="md"
      icon={<Icon icon={PlayCircleIcon} />}
    />
  );
}

export function LinkRepositoryButton({
  variant = "secondary",
}: HeaderActionButtonProps): ReactElement {
  return (
    <Button label="Link repository" variant={variant} size="md" icon={<Icon icon={PlusIcon} />} />
  );
}

export function SyncGitHubButton({ variant = "secondary" }: HeaderActionButtonProps): ReactElement {
  return (
    <Button label="Sync GitHub" variant={variant} size="md" icon={<Icon icon={ArrowPathIcon} />} />
  );
}

export function AddCoworkerButton({ variant = "primary" }: HeaderActionButtonProps): ReactElement {
  return (
    <Button label="Add coworker" variant={variant} size="md" icon={<Icon icon={PlusIcon} />} />
  );
}

export function ConfigureButton({ variant = "secondary" }: HeaderActionButtonProps): ReactElement {
  return (
    <Button label="Configure" variant={variant} size="md" icon={<Icon icon={Cog6ToothIcon} />} />
  );
}
