import type { ReactElement } from "react";

import SettingsPanel from "@/components/coworker/settings-panel";

type SettingsPageProps = {
  searchParams: Promise<{ section?: string }>;
};

export default async function SettingsPage({ searchParams }: SettingsPageProps): Promise<ReactElement> {
  const { section } = await searchParams;
  return <SettingsPanel section={section} />;
}
