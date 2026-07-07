import FeatureNotEnabled from "@/components/coworker/feature-not-enabled";

export default function SettingsPage() {
  return (
    <FeatureNotEnabled
      featureName="Settings"
      description="Settings are disabled until each control reads and writes production organization data. Continue through GitHub setup and reviewer runs for the current activation path."
    />
  );
}
