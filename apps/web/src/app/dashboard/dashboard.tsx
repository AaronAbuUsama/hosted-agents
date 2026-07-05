"use client";

import { Button } from "@hosted-agents/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@hosted-agents/ui/components/card";
import { Input } from "@hosted-agents/ui/components/input";
import { Label } from "@hosted-agents/ui/components/label";
import { Textarea } from "@hosted-agents/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

export default function Dashboard({ session }: { session: typeof authClient.$Infer.Session }) {
  const queryClient = useQueryClient();
  const organizations = authClient.useListOrganizations();
  const [selectedOrganizationId, setSelectedOrganizationId] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [repositoryOwner, setRepositoryOwner] = useState("");
  const [repositoryName, setRepositoryName] = useState("");
  const [branch, setBranch] = useState("");
  const [baseBranch, setBaseBranch] = useState("main");
  const [reviewContext, setReviewContext] = useState("");

  const organizationList = useMemo(() => organizations.data ?? [], [organizations.data]);
  const reviewRuns = useQuery(
    orpc.reviewRuns.queryOptions({
      input: selectedOrganizationId ? { organizationId: selectedOrganizationId } : {},
      enabled: organizationList.length > 0,
    }),
  );
  const providerCredentials = useQuery(
    orpc.providerCredentials.queryOptions({
      input: selectedOrganizationId ? { organizationId: selectedOrganizationId } : {},
      enabled: !!selectedOrganizationId,
    }),
  );
  const openAICodexCredential = providerCredentials.data?.find(
    (credential) => credential.provider === "openai-codex" && credential.status === "connected",
  );
  const [credentialConnectionId, setCredentialConnectionId] = useState("");
  const credentialConnection = useQuery({
    ...orpc.openAICodexCredentialConnection.queryOptions({
      input: { connectionId: credentialConnectionId },
      enabled: !!credentialConnectionId,
    }),
    refetchInterval: (query) => (query.state.data?.status === "pending" ? 3000 : false),
  });
  const activeCredentialConnection = credentialConnectionId ? credentialConnection.data : undefined;

  const createOrganization = useMutation({
    mutationFn: async () => {
      const slug = organizationName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

      if (!slug) {
        throw new Error("Organization name needs at least one letter or number.");
      }

      const result = await authClient.organization.create({
        name: organizationName.trim(),
        slug,
      });

      if (result.error) {
        throw new Error(result.error.message || result.error.statusText);
      }

      return result.data;
    },
    onSuccess: async (organization) => {
      setOrganizationName("");
      if (organization?.id) {
        setSelectedOrganizationId(organization.id);
        await authClient.organization.setActive({ organizationId: organization.id });
      }
      await organizations.refetch();
      toast.success("Organization created");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const createReviewRun = useMutation(
    orpc.createReviewRun.mutationOptions({
      onSuccess: async () => {
        setRepositoryUrl("");
        setRepositoryOwner("");
        setRepositoryName("");
        setBranch("");
        setReviewContext("");
        await queryClient.invalidateQueries({ queryKey: orpc.reviewRuns.key() });
        toast.success("Review run started");
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );
  const startOpenAICodexConnection = useMutation(
    orpc.startOpenAICodexCredentialConnection.mutationOptions({
      onSuccess: (connection) => {
        setCredentialConnectionId(connection.id);
        toast.success("OpenAI Codex connection started");
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );
  const revokeProviderCredential = useMutation(
    orpc.revokeProviderCredential.mutationOptions({
      onSuccess: async () => {
        await providerCredentials.refetch();
        toast.success("OpenAI Codex disconnected");
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );

  useEffect(() => {
    if (!selectedOrganizationId && organizationList[0]) {
      setSelectedOrganizationId(organizationList[0].id);
    }
  }, [organizationList, selectedOrganizationId]);

  useEffect(() => {
    if (credentialConnection.data?.status === "connected") {
      setCredentialConnectionId("");
      void providerCredentials.refetch();
      toast.success("OpenAI Codex connected");
    }

    if (credentialConnection.data?.status === "failed") {
      setCredentialConnectionId("");
      toast.error(credentialConnection.data.errorMessage || "OpenAI Codex connection failed");
    }
  }, [credentialConnection.data, providerCredentials]);

  const organizationCard = (
    <Card>
      <CardHeader>
        <CardTitle>Organization</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="space-y-2">
          <Label htmlFor="organization">Active Organization</Label>
          <select
            id="organization"
            className="h-8 w-full border border-input bg-background px-2 text-xs"
            value={selectedOrganizationId}
            onChange={async (event) => {
              const organizationId = event.target.value;
              setSelectedOrganizationId(organizationId);
              if (organizationId) {
                await authClient.organization.setActive({ organizationId });
              }
            }}
          >
            <option value="">No organization</option>
            {organizationList.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </select>
        </div>
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            createOrganization.mutate();
          }}
        >
          <Label htmlFor="new-organization">Create Organization</Label>
          <div className="flex gap-2">
            <Input
              id="new-organization"
              value={organizationName}
              onChange={(event) => setOrganizationName(event.target.value)}
              placeholder={`${session.user.name}'s org`}
            />
            <Button
              type="submit"
              variant="outline"
              disabled={!organizationName.trim() || createOrganization.isPending}
            >
              Create
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );

  const providerConnectionsCard = (
    <Card>
      <CardHeader>
        <CardTitle>Provider Connections</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-1">
          <div className="flex items-center justify-between gap-3">
            <span>OpenAI Codex</span>
            <span className="text-muted-foreground">
              {openAICodexCredential ? "Connected" : "Not connected"}
            </span>
          </div>
          {openAICodexCredential?.lastUsedAt ? (
            <span className="text-muted-foreground">
              Last used {new Date(openAICodexCredential.lastUsedAt).toLocaleString()}
            </span>
          ) : null}
        </div>

        {activeCredentialConnection?.deviceCode ? (
          <div className="grid gap-2 border border-border p-3">
            <a
              className="underline"
              href={activeCredentialConnection.deviceCode.verificationUri}
              rel="noreferrer"
              target="_blank"
            >
              Open verification page
            </a>
            <div className="font-mono text-sm">
              {activeCredentialConnection.deviceCode.userCode}
            </div>
            <div className="text-muted-foreground capitalize">
              {activeCredentialConnection.status}
            </div>
          </div>
        ) : null}

        <div className="flex gap-2">
          <Button
            type="button"
            variant={openAICodexCredential ? "outline" : "default"}
            disabled={
              !selectedOrganizationId ||
              startOpenAICodexConnection.isPending ||
              !!credentialConnectionId
            }
            onClick={() => {
              startOpenAICodexConnection.mutate({
                organizationId: selectedOrganizationId || undefined,
              });
            }}
          >
            {openAICodexCredential ? "Reconnect" : "Connect"}
          </Button>
          {openAICodexCredential ? (
            <Button
              type="button"
              variant="outline"
              disabled={revokeProviderCredential.isPending}
              onClick={() => {
                revokeProviderCredential.mutate({
                  id: openAICodexCredential.id,
                  organizationId: selectedOrganizationId || undefined,
                });
              }}
            >
              Disconnect
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );

  if (!organizations.isPending && organizationList.length === 0) {
    return <div className="grid gap-4 lg:grid-cols-[22rem]">{organizationCard}</div>;
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader>
            <CardTitle>Start Review</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                createReviewRun.mutate({
                  organizationId: selectedOrganizationId || undefined,
                  repositoryUrl,
                  repositoryOwner,
                  repositoryName,
                  branch,
                  baseBranch,
                  reviewContext,
                });
              }}
            >
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="repository-owner">Owner</Label>
                  <Input
                    id="repository-owner"
                    value={repositoryOwner}
                    onChange={(event) => setRepositoryOwner(event.target.value)}
                    placeholder="capxul"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="repository-name">Repository</Label>
                  <Input
                    id="repository-name"
                    value={repositoryName}
                    onChange={(event) => setRepositoryName(event.target.value)}
                    placeholder="platform"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="repository-url">Repository URL</Label>
                <Input
                  id="repository-url"
                  value={repositoryUrl}
                  onChange={(event) => setRepositoryUrl(event.target.value)}
                  placeholder="https://github.com/org/repo"
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="branch">Branch</Label>
                  <Input
                    id="branch"
                    value={branch}
                    onChange={(event) => setBranch(event.target.value)}
                    placeholder="feature/code-review-agent"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="base-branch">Base Branch</Label>
                  <Input
                    id="base-branch"
                    value={baseBranch}
                    onChange={(event) => setBaseBranch(event.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="review-context">Review Context</Label>
                <Textarea
                  id="review-context"
                  value={reviewContext}
                  onChange={(event) => setReviewContext(event.target.value)}
                  placeholder="Paste a diff, PR summary, or files changed for this first review run."
                  rows={8}
                />
              </div>
              <Button
                type="submit"
                className="w-fit"
                disabled={
                  !selectedOrganizationId ||
                  !branch ||
                  !openAICodexCredential ||
                  createReviewRun.isPending
                }
              >
                {createReviewRun.isPending ? "Starting..." : "Start Review"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="grid gap-4">
          {organizationCard}
          {providerConnectionsCard}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Review Runs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Repository</th>
                  <th className="py-2 pr-3 font-medium">Branch</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Findings</th>
                  <th className="py-2 pr-3 font-medium">Summary</th>
                  <th className="py-2 pr-3 font-medium">Started</th>
                </tr>
              </thead>
              <tbody>
                {reviewRuns.data?.map((run) => (
                  <tr key={run.id} className="border-b last:border-b-0">
                    <td className="py-2 pr-3">
                      {run.repositoryOwner && run.repositoryName
                        ? `${run.repositoryOwner}/${run.repositoryName}`
                        : run.repositoryUrl || "Manual context"}
                    </td>
                    <td className="py-2 pr-3">
                      <span>{run.branch}</span>
                      {run.baseBranch ? (
                        <span className="text-muted-foreground"> to {run.baseBranch}</span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 capitalize">{run.status}</td>
                    <td className="py-2 pr-3">{run.findings.length}</td>
                    <td className="max-w-[22rem] py-2 pr-3 text-muted-foreground">
                      {run.summary || run.errorMessage || "Pending"}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {new Date(run.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
                {!reviewRuns.isLoading && reviewRuns.data?.length === 0 ? (
                  <tr>
                    <td className="py-6 text-center text-muted-foreground" colSpan={6}>
                      No review runs yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
