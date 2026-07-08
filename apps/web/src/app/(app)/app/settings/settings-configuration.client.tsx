"use client";

import { Button } from "@hosted-agents/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@hosted-agents/ui/components/card";
import { Checkbox } from "@hosted-agents/ui/components/checkbox";
import {
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  ExternalLink,
  GitPullRequest,
  KeyRound,
  Settings2,
} from "lucide-react";
import Link from "next/link";
import { useState, type ReactElement, type ReactNode } from "react";
import { toast } from "sonner";

import { client } from "@/utils/orpc";

type ActiveOrganization = Awaited<ReturnType<typeof client.activeOrganization>>;
type GitHubInstallation = Awaited<ReturnType<typeof client.githubInstallations>>[number];
type ProviderCredential = Awaited<ReturnType<typeof client.providerCredentials>>[number];

type SettingsConfigurationClientProps = {
  activeOrganization: ActiveOrganization;
  githubInstallations: GitHubInstallation[];
  providerCredentials: ProviderCredential[];
};

type StatusTone = "success" | "warning" | "neutral";

export default function SettingsConfigurationClient({
  activeOrganization,
  githubInstallations,
  providerCredentials,
}: SettingsConfigurationClientProps): ReactElement {
  const linkedReviewerInstallations = githubInstallations.filter(
    (installation) => installation.status === "connected",
  );
  const connectedProviderCredentials = providerCredentials.filter(
    (credential) => credential.provider === "openai-codex" && credential.status === "connected",
  );
  const repositoryCount = linkedReviewerInstallations.reduce(
    (count, installation) => count + installation.repositoryCount,
    0,
  );
  const hasGitHubInstallation = linkedReviewerInstallations.length > 0;
  const hasProviderCredential = connectedProviderCredentials.length > 0;

  return (
    <div className="grid gap-6">
      <div className="grid gap-3 md:grid-cols-3">
        <SummaryCard
          title="Organization"
          value={activeOrganization?.name ?? "No active organization"}
          description={
            activeOrganization?.slug
              ? `/${activeOrganization.slug}`
              : "Create an organization first"
          }
          tone={activeOrganization ? "success" : "warning"}
        />
        <SummaryCard
          title="GitHub App"
          value={
            hasGitHubInstallation
              ? pluralize(linkedReviewerInstallations.length, "installation")
              : "Not linked"
          }
          description={
            hasGitHubInstallation
              ? pluralize(repositoryCount, "repository")
              : "Install or link the Reviewer GitHub App"
          }
          tone={hasGitHubInstallation ? "success" : "warning"}
        />
        <SummaryCard
          title="Provider account"
          value={hasProviderCredential ? "Connected" : "Not connected"}
          description="OpenAI Codex credential for reviewer runs"
          tone={hasProviderCredential ? "success" : "warning"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="flex flex-wrap gap-2 lg:block lg:space-y-1">
          {settingsSections.map((section) => (
            <a
              key={section.href}
              href={section.href}
              className="inline-flex h-8 items-center border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground lg:flex"
            >
              {section.label}
            </a>
          ))}
        </nav>

        <div className="grid gap-4">
          <SettingsSection
            id="organization"
            title="Organization"
            description="The Coworker organization that owns runs, GitHub installations, provider credentials, and future rules."
            icon={<Settings2 className="size-4" />}
          >
            <SettingsRow
              label="Name"
              value={activeOrganization?.name ?? "No active organization"}
            />
            <SettingsRow label="Slug" value={activeOrganization?.slug ?? "Not set"} />
            <SettingsRow label="Current role" value={activeOrganization?.role ?? "none"} />
          </SettingsSection>

          <SettingsSection
            id="github-app"
            title="GitHub App and repositories"
            description="Reviewer runs start from GitHub installations that are linked to this Coworker organization."
            icon={<GitPullRequest className="size-4" />}
            action={
              <Button
                nativeButton={false}
                variant="outline"
                render={<Link href="/dashboard/github/setup" />}
              >
                <ExternalLink className="size-4" />
                Manage GitHub setup
              </Button>
            }
          >
            <SettingsRow
              label="Linked installations"
              value={hasGitHubInstallation ? linkedReviewerInstallations.length.toString() : "None"}
            />
            <SettingsRow
              label="Linked repositories"
              value={hasGitHubInstallation ? repositoryCount.toString() : "None"}
            />
            {githubInstallations.length > 0 ? (
              <div className="grid gap-2 pt-2">
                {githubInstallations.map((installation) => (
                  <div key={installation.id} className="grid gap-2">
                    <ConfigurationRow
                      title={installation.accountLogin ?? "GitHub installation"}
                      description={`${pluralize(installation.repositoryCount, "repository")} linked`}
                      status={installation.status}
                      tone={installation.status === "connected" ? "success" : "neutral"}
                    />
                    <RepositoryToggleList repositories={installation.repositories} />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyConfiguration
                title="No GitHub installation is linked"
                description="If the app is already installed on GitHub, use GitHub setup to link that installation to this Coworker organization."
              />
            )}
          </SettingsSection>

          <SettingsSection
            id="provider-account"
            title="Provider account"
            description="The model-provider credential used by reviewer runs for code review work."
            icon={<KeyRound className="size-4" />}
            action={
              <Button
                nativeButton={false}
                variant="outline"
                render={<Link href="/onboarding/provider" />}
              >
                <ExternalLink className="size-4" />
                Manage provider
              </Button>
            }
          >
            {connectedProviderCredentials.length > 0 ? (
              <div className="grid gap-2">
                {connectedProviderCredentials.map((credential) => (
                  <ConfigurationRow
                    key={credential.id}
                    title={formatProviderName(credential.provider)}
                    description={`Type: ${credential.credentialType}${formatExpiresAt(credential.expiresAt)}`}
                    status={credential.status}
                    tone="success"
                  />
                ))}
              </div>
            ) : (
              <EmptyConfiguration
                title="No provider credential is connected"
                description="Connect OpenAI Codex before expecting reviewer runs to execute."
              />
            )}
          </SettingsSection>

          <SettingsSection
            id="reviewer-rules"
            title="Reviewer behavior"
            description="The reviewer's prompt, model, and skills are configured on the Reviewer page and apply to every new run."
            icon={<CircleDashed className="size-4" />}
            action={
              <Button nativeButton={false} variant="outline" render={<Link href="/app/reviewer" />}>
                <ExternalLink className="size-4" />
                Configure reviewer
              </Button>
            }
          >
            <SettingsRow label="Prompt and skills" value="Managed on the Reviewer page" />
            <SettingsRow
              label="Triggers"
              value="PR opened, reopened, synchronized, ready for review, and manual requests"
            />
          </SettingsSection>

          <SettingsSection
            id="run-defaults"
            title="Run defaults"
            description="Defaults for future run creation, repository scope, labels, and artifact retention."
            icon={<CircleDashed className="size-4" />}
          >
            <SettingsRow label="Default run type" value="GitHub pull request review" />
            <SettingsRow
              label="Repository scope"
              value={hasGitHubInstallation ? "From linked GitHub installations" : "Not configured"}
            />
            <SettingsRow label="Artifact retention" value="Durable run events and GitHub output" />
          </SettingsSection>
        </div>
      </div>
    </div>
  );
}

const settingsSections = [
  { href: "#organization", label: "Organization" },
  { href: "#github-app", label: "GitHub App" },
  { href: "#provider-account", label: "Provider account" },
  { href: "#reviewer-rules", label: "Reviewer rules" },
  { href: "#run-defaults", label: "Run defaults" },
];

function SummaryCard({
  title,
  value,
  description,
  tone,
}: {
  title: string;
  value: string;
  description: string;
  tone: StatusTone;
}): ReactElement {
  return (
    <Card size="sm">
      <CardContent className="grid gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-muted-foreground">{title}</span>
          <StatusIcon tone={tone} />
        </div>
        <div className="truncate text-sm font-medium">{value}</div>
        <div className="truncate text-xs text-muted-foreground">{description}</div>
      </CardContent>
    </Card>
  );
}

function SettingsSection({
  id,
  title,
  description,
  icon,
  action,
  children,
}: {
  id: string;
  title: string;
  description: string;
  icon: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <Card id={id}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">{children}</CardContent>
    </Card>
  );
}

type InstallationRepository = GitHubInstallation["repositories"][number];

function RepositoryToggleList({
  repositories,
}: {
  repositories: InstallationRepository[];
}): ReactElement | null {
  const [selections, setSelections] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(repositories.map((repository) => [repository.id, repository.selected])),
  );
  const [pendingRepositoryId, setPendingRepositoryId] = useState<string | null>(null);

  if (repositories.length === 0) {
    return null;
  }

  async function toggleRepository(repositoryId: string, selected: boolean): Promise<void> {
    setPendingRepositoryId(repositoryId);
    try {
      const updated = await client.setRepositorySelected({ repositoryId, selected });
      setSelections((current) => ({ ...current, [updated.id]: updated.selected }));
      toast.success(
        updated.selected
          ? `${updated.fullName} enabled for reviewer runs.`
          : `${updated.fullName} disabled. New pull requests will be ignored.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the repository.");
    } finally {
      setPendingRepositoryId(null);
    }
  }

  return (
    <div className="grid gap-1 border border-border bg-background p-3">
      <div className="pb-1 text-xs font-medium text-muted-foreground">
        Repositories the reviewer runs on
      </div>
      {repositories.map((repository) => (
        <label
          key={repository.id}
          className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-b-0"
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{repository.fullName}</span>
            <span className="block text-xs text-muted-foreground">
              {repository.private ? "Private" : "Public"}
              {repository.defaultBranch ? ` · ${repository.defaultBranch}` : ""}
            </span>
          </span>
          <Checkbox
            checked={selections[repository.id] ?? repository.selected}
            disabled={pendingRepositoryId === repository.id}
            onCheckedChange={(checked) => {
              void toggleRepository(repository.id, checked === true);
            }}
          />
        </label>
      ))}
    </div>
  );
}

function SettingsRow({ label, value }: { label: string; value: ReactNode }): ReactElement {
  return (
    <div className="grid gap-1 border-b border-border py-2 last:border-b-0 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 font-medium break-words">{value}</span>
    </div>
  );
}

function ConfigurationRow({
  title,
  description,
  status,
  tone,
}: {
  title: string;
  description: string;
  status: string;
  tone: StatusTone;
}): ReactElement {
  return (
    <div className="grid gap-2 border border-border bg-background p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      <StatusPill tone={tone}>{status}</StatusPill>
    </div>
  );
}

function EmptyConfiguration({
  title,
  description,
}: {
  title: string;
  description: string;
}): ReactElement {
  return (
    <div className="grid gap-1 border border-dashed border-border bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <CircleAlert className="size-4 text-muted-foreground" />
        {title}
      </div>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function StatusPill({ children, tone }: { children: ReactNode; tone: StatusTone }): ReactElement {
  const toneClassName = {
    success: "border-green-600/20 bg-green-600/10 text-green-700 dark:text-green-300",
    warning: "border-amber-600/20 bg-amber-600/10 text-amber-700 dark:text-amber-300",
    neutral: "border-border bg-muted text-muted-foreground",
  }[tone];

  return (
    <span
      className={`inline-flex h-6 items-center justify-center border px-2 text-xs font-medium ${toneClassName}`}
    >
      {children}
    </span>
  );
}

function StatusIcon({ tone }: { tone: StatusTone }): ReactElement {
  if (tone === "success") {
    return <CheckCircle2 className="size-4 text-green-600" />;
  }

  if (tone === "warning") {
    return <CircleAlert className="size-4 text-amber-600" />;
  }

  return <CircleDashed className="size-4 text-muted-foreground" />;
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function formatProviderName(provider: string): string {
  if (provider === "openai-codex") {
    return "OpenAI Codex";
  }

  return provider;
}

function formatExpiresAt(expiresAt: string | Date | null | undefined): string {
  if (!expiresAt) {
    return "";
  }

  const parsedDate = new Date(expiresAt);

  if (Number.isNaN(parsedDate.getTime())) {
    return "";
  }

  return ` - Expires: ${parsedDate.toLocaleString()}`;
}
