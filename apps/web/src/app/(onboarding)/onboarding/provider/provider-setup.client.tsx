"use client";

import { Button } from "@hosted-agents/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@hosted-agents/ui/components/card";
import { Label } from "@hosted-agents/ui/components/label";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { client, orpc } from "@/utils/orpc";

type ProviderCredential = Awaited<ReturnType<typeof client.providerCredentials>>[number];
type ProviderConnection = Awaited<ReturnType<typeof client.startOpenAICodexCredentialConnection>>;

export default function ProviderSetupClient() {
  const organizations = authClient.useListOrganizations();
  const organizationList = useMemo(() => organizations.data ?? [], [organizations.data]);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState("");
  const [connection, setConnection] = useState<ProviderConnection | null>(null);
  const selectedOrganization = organizationList.find(
    (organization) => organization.id === selectedOrganizationId,
  );

  const credentialsQuery = useQuery(
    orpc.providerCredentials.queryOptions({
      input: selectedOrganizationId ? { organizationId: selectedOrganizationId } : undefined,
      enabled: Boolean(selectedOrganizationId),
    }),
  );
  const credentials = credentialsQuery.data ?? [];
  const connectedOpenAICodexCredential = credentials.find(
    (credential) => credential.provider === "openai-codex" && credential.status === "connected",
  );
  const canContinueToRuns =
    Boolean(connectedOpenAICodexCredential) || connection?.status === "connected";

  const connectionQuery = useQuery(
    orpc.openAICodexCredentialConnection.queryOptions({
      input: connection ? { connectionId: connection.id } : { connectionId: "" },
      enabled: Boolean(connection?.id && connection.status === "pending"),
      refetchInterval: (query) => {
        const status = query.state.data?.status ?? connection?.status;
        return status === "pending" ? 3_000 : false;
      },
    }),
  );

  const startConnection = useMutation({
    mutationFn: async () => {
      if (!selectedOrganizationId) {
        throw new Error("Select an organization before connecting OpenAI Codex.");
      }

      return client.startOpenAICodexCredentialConnection({
        organizationId: selectedOrganizationId,
      });
    },
    onSuccess: (result) => {
      setConnection(result);
      toast.success("OpenAI Codex authorization started.");
      void credentialsQuery.refetch();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Unable to start provider connection.");
    },
  });

  useEffect(() => {
    if (!selectedOrganizationId && organizationList[0]) {
      setSelectedOrganizationId(organizationList[0].id);
    }
  }, [organizationList, selectedOrganizationId]);

  useEffect(() => {
    if (!connectionQuery.data) {
      return;
    }

    setConnection(connectionQuery.data);

    if (connectionQuery.data.status === "connected") {
      void credentialsQuery.refetch();
    }
  }, [connectionQuery.data, credentialsQuery]);

  return (
    <div className="grid w-full gap-4">
      <Card>
        <CardHeader>
          <CardTitle>OpenAI Codex provider</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4" />
              <span>Connect the organization provider account used by reviewer runs.</span>
            </div>
            {selectedOrganization ? (
              <p className="text-muted-foreground">
                Credentials are scoped to {selectedOrganization.name}. The browser only receives
                connection state and credential metadata.
              </p>
            ) : null}
          </div>

          {organizationList.length > 0 ? (
            <div className="grid gap-2">
              <Label htmlFor="provider-setup-organization">Organization</Label>
              <select
                id="provider-setup-organization"
                className="h-8 w-full border border-input bg-background px-2 text-xs"
                value={selectedOrganizationId}
                onChange={(event) => {
                  setSelectedOrganizationId(event.target.value);
                  setConnection(null);
                }}
              >
                {organizationList.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            </div>
          ) : organizations.isPending ? (
            <LoadingState label="Loading organizations" />
          ) : (
            <div className="grid gap-2">
              <p className="text-muted-foreground">
                Create an organization before connecting provider credentials.
              </p>
              <Button nativeButton={false} render={<Link href="/onboarding/organization" />}>
                Create organization
              </Button>
            </div>
          )}

          <ProviderCredentialState
            credentials={credentials}
            isLoading={credentialsQuery.isPending || credentialsQuery.isFetching}
          />

          {connection ? <ConnectionState connection={connection} /> : null}

          {connectionQuery.isError ? (
            <p className="text-destructive">{connectionQuery.error.message}</p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={
                !selectedOrganizationId ||
                startConnection.isPending ||
                connection?.status === "pending"
              }
              onClick={() => startConnection.mutate()}
            >
              {startConnection.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Starting authorization
                </>
              ) : (
                <>
                  <ExternalLink className="size-4" />
                  {connectedOpenAICodexCredential ? "Rotate OpenAI Codex" : "Connect OpenAI Codex"}
                </>
              )}
            </Button>

            {canContinueToRuns ? (
              <Button nativeButton={false} render={<Link href="/app/runs" />}>
                Continue to runs
              </Button>
            ) : (
              <Button type="button" disabled>
                Continue to runs
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  );
}

function ProviderCredentialState({
  credentials,
  isLoading,
}: {
  credentials: ProviderCredential[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return <LoadingState label="Checking provider credentials" />;
  }

  if (credentials.length === 0) {
    return (
      <p className="text-muted-foreground">
        No OpenAI Codex credential is connected for this organization yet.
      </p>
    );
  }

  return (
    <div className="grid gap-2">
      {credentials.map((credential) => (
        <div
          key={credential.id}
          className="grid gap-1 rounded-md border border-border bg-background p-3 text-sm"
        >
          <div className="flex flex-wrap items-center gap-2">
            {credential.status === "connected" ? <CheckCircle2 className="size-4" /> : null}
            <span className="font-medium">{credential.provider}</span>
            <span className="text-muted-foreground">{credential.status}</span>
          </div>
          <p className="text-muted-foreground">
            Type: {credential.credentialType}
            {credential.expiresAt ? ` · Expires: ${new Date(credential.expiresAt).toLocaleString()}` : ""}
          </p>
          <p className="text-muted-foreground">
            Updated: {new Date(credential.updatedAt).toLocaleString()}
          </p>
          {credential.lastError ? <p className="text-destructive">{credential.lastError}</p> : null}
        </div>
      ))}
    </div>
  );
}

function ConnectionState({ connection }: { connection: ProviderConnection }) {
  if (connection.status === "connected") {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <CheckCircle2 className="size-4" />
        OpenAI Codex credential connected.
      </div>
    );
  }

  if (connection.status === "failed") {
    return (
      <p className="text-destructive">
        {connection.errorMessage ?? "OpenAI Codex authorization failed."}
      </p>
    );
  }

  return (
    <div className="grid gap-3 rounded-md border border-border bg-background p-3">
      <LoadingState label="Waiting for OpenAI Codex authorization" />
      {connection.deviceCode ? (
        <div className="grid gap-2 text-sm">
          <p className="text-muted-foreground">
            Open the verification URL and enter the user code shown below. This page never displays
            access tokens or refresh tokens.
          </p>
          <a
            className="inline-flex items-center gap-2 text-primary underline"
            href={connection.deviceCode.verificationUri}
            target="_blank"
            rel="noreferrer"
          >
            {connection.deviceCode.verificationUri}
            <ExternalLink className="size-4" />
          </a>
          <div className="rounded-md border border-border px-3 py-2 font-mono text-lg tracking-normal">
            {connection.deviceCode.userCode}
          </div>
        </div>
      ) : null}
    </div>
  );
}
