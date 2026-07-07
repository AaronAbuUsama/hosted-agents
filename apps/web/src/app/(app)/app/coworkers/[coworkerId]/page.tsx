import FeatureNotEnabled from "@/components/coworker/feature-not-enabled";

export default function CoworkerProfilePage() {
  return (
    <FeatureNotEnabled
      featureName="Coworkers"
      description="Coworker profiles are disabled until they show real worker-role state. Use runs and GitHub setup for the reviewer activation path."
    />
  );
}
