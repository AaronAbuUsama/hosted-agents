import FeatureNotEnabled from "@/components/coworker/feature-not-enabled";

export default function RulesStepPage() {
  return (
    <FeatureNotEnabled
      featureName="Rule setup"
      description="Rule setup is disabled until it writes production worker-role policy. Reviewer activation continues through GitHub setup, provider credentials, and real runs."
    />
  );
}
