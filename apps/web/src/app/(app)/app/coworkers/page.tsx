import FeatureNotEnabled from "@/components/coworker/feature-not-enabled";

export default function CoworkersPage() {
  return (
    <FeatureNotEnabled
      featureName="Coworkers"
      description="The coworker roster is not enabled until worker roles are backed by production data. The reviewer run surfaces are available now."
    />
  );
}
