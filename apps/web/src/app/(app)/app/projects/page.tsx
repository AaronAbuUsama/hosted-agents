import FeatureNotEnabled from "@/components/coworker/feature-not-enabled";

export default function ProjectsPage() {
  return (
    <FeatureNotEnabled
      featureName="Projects"
      description="Repository management is not enabled in this build. Reviewer runs are the production surface; continue GitHub setup to connect repositories for real review events."
    />
  );
}
