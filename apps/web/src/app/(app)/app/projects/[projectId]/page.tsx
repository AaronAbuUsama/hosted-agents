import FeatureNotEnabled from "@/components/coworker/feature-not-enabled";

export default function ProjectPage() {
  return (
    <FeatureNotEnabled
      featureName="Projects"
      description="Repository workspaces are disabled until they are backed by production repository data. Use reviewer runs for the real operational view."
    />
  );
}
