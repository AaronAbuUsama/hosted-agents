import FeatureNotEnabled from "@/components/coworker/feature-not-enabled";

export default function ProjectIssuePage() {
  return (
    <FeatureNotEnabled
      featureName="Project issues"
      description="Issue views are disabled until issue data is sourced from production systems. Reviewer run detail and workspace pages remain available for real artifacts."
    />
  );
}
