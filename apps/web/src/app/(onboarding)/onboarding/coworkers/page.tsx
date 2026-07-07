import FeatureNotEnabled from "@/components/coworker/feature-not-enabled";

export default function CoworkersStepPage() {
  return (
    <FeatureNotEnabled
      featureName="Coworker onboarding"
      description="Coworker onboarding is not part of the reviewer-only activation slice. Continue with GitHub setup and provider credentials instead."
    />
  );
}
