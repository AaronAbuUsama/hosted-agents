"use client";

import type { CSSProperties, ReactElement } from "react";
import { useEffect, useMemo, useState } from "react";

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Icon } from "@astryxdesign/core/Icon";
import { Link } from "@astryxdesign/core/Link";
import { Selector } from "@astryxdesign/core/Selector";
import { Spinner } from "@astryxdesign/core/Spinner";
import { HStack, Stack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import {
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import { useMutation, useQuery } from "@tanstack/react-query";

import { authClient } from "@/lib/auth-client";
import { client, orpc } from "@/utils/orpc";

type ProviderCredential = Awaited<ReturnType<typeof client.providerCredentials>>[number];
type ProviderConnection = Awaited<ReturnType<typeof client.startOpenAICodexCredentialConnection>>;

const codeBoxStyle: CSSProperties = {
  border: "var(--border-width) solid var(--color-border)",
  borderRadius: "var(--radius-container)",
  paddingBlock: "var(--spacing-2)",
  paddingInline: "var(--spacing-3)",
  fontFamily: "var(--font-family-mono, ui-monospace, SFMono-Regular, monospace)",
  fontSize: "var(--font-size-large)",
  letterSpacing: "0.08em",
};

export default function ProviderSetupClient(): ReactElement {
  const showToast = useToast();
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
      showToast({ body: "OpenAI Codex authorization started." });
      void credentialsQuery.refetch();
    },
    onError: (error) => {
      showToast({
        body: error instanceof Error ? error.message : "Unable to start provider connection.",
        type: "error",
      });
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
    <VStack gap={5}>
      <VStack gap={2}>
        <HStack gap={2} vAlign="center">
          <Icon icon={ShieldCheckIcon} size="sm" />
          <Text weight="semibold">
            Connect the organization provider account used by reviewer runs.
          </Text>
        </HStack>
        {selectedOrganization ? (
          <Text type="supporting" color="secondary">
            Credentials are scoped to {selectedOrganization.name}. The browser only receives
            connection state and credential metadata.
          </Text>
        ) : null}
      </VStack>

      {organizationList.length > 0 ? (
        <Selector
          label="Organization"
          placeholder="Select an organization"
          options={organizationList.map((organization) => ({
            value: organization.id,
            label: organization.name,
          }))}
          value={selectedOrganizationId}
          onChange={(value) => {
            setSelectedOrganizationId(value);
            setConnection(null);
          }}
        />
      ) : organizations.isPending ? (
        <LoadingState label="Loading organizations" />
      ) : (
        <VStack gap={2}>
          <Text type="supporting" color="secondary">
            Create an organization before connecting provider credentials.
          </Text>
          <Button label="Create organization" href="/onboarding/organization" variant="secondary" />
        </VStack>
      )}

      <ProviderCredentialState
        credentials={credentials}
        isLoading={credentialsQuery.isPending || credentialsQuery.isFetching}
      />

      {connection ? <ConnectionState connection={connection} /> : null}

      {connectionQuery.isError ? (
        <Banner
          status="error"
          title="Authorization check failed"
          description={connectionQuery.error.message}
          container="section"
        />
      ) : null}

      <HStack gap={2} wrap="wrap">
        <Button
          label={connectedOpenAICodexCredential ? "Rotate OpenAI Codex" : "Connect OpenAI Codex"}
          variant="primary"
          icon={<Icon icon={ArrowTopRightOnSquareIcon} size="sm" />}
          isLoading={startConnection.isPending}
          isDisabled={!selectedOrganizationId || connection?.status === "pending"}
          onClick={() => startConnection.mutate()}
        />
        <Button
          label="Continue to runs"
          variant="secondary"
          href={canContinueToRuns ? "/app/runs" : undefined}
          isDisabled={!canContinueToRuns}
        />
      </HStack>
    </VStack>
  );
}

function LoadingState({ label }: { label: string }): ReactElement {
  return <Spinner size="sm" label={label} />;
}

function ProviderCredentialState({
  credentials,
  isLoading,
}: {
  credentials: ProviderCredential[];
  isLoading: boolean;
}): ReactElement {
  if (isLoading) {
    return <LoadingState label="Checking provider credentials" />;
  }

  if (credentials.length === 0) {
    return (
      <Text type="supporting" color="secondary">
        No OpenAI Codex credential is connected for this organization yet.
      </Text>
    );
  }

  return (
    <VStack gap={2}>
      {credentials.map((credential) => (
        <Card key={credential.id} variant="muted" padding={3}>
          <VStack gap={1}>
            <HStack gap={2} vAlign="center" wrap="wrap">
              {credential.status === "connected" ? <Icon icon={CheckCircleIcon} size="sm" /> : null}
              <Text weight="semibold">{credential.provider}</Text>
              <Text type="supporting" color="secondary">
                {credential.status}
              </Text>
            </HStack>
            <Text type="supporting" color="secondary">
              Type: {credential.credentialType}
              {credential.expiresAt
                ? ` · Expires: ${new Date(credential.expiresAt).toLocaleString()}`
                : ""}
            </Text>
            <Text type="supporting" color="secondary">
              Updated: {new Date(credential.updatedAt).toLocaleString()}
            </Text>
            {credential.lastError ? (
              <Text type="supporting" color="secondary">
                Error: {credential.lastError}
              </Text>
            ) : null}
          </VStack>
        </Card>
      ))}
    </VStack>
  );
}

function ConnectionState({ connection }: { connection: ProviderConnection }): ReactElement {
  if (connection.status === "connected") {
    return (
      <HStack gap={2} vAlign="center">
        <Icon icon={CheckCircleIcon} size="sm" />
        <Text color="secondary">OpenAI Codex credential connected.</Text>
      </HStack>
    );
  }

  if (connection.status === "failed") {
    return (
      <Banner
        status="error"
        title="Authorization failed"
        description={connection.errorMessage ?? "OpenAI Codex authorization failed."}
        container="section"
      />
    );
  }

  return (
    <Card variant="muted" padding={3}>
      <VStack gap={3}>
        <LoadingState label="Waiting for OpenAI Codex authorization" />
        {connection.deviceCode ? (
          <VStack gap={2}>
            <Text type="supporting" color="secondary">
              Open the verification URL and enter the user code shown below. This page never
              displays access tokens or refresh tokens.
            </Text>
            <Link href={connection.deviceCode.verificationUri} isStandalone isExternalLink>
              {connection.deviceCode.verificationUri}
            </Link>
            <Stack style={codeBoxStyle}>
              <Text>{connection.deviceCode.userCode}</Text>
            </Stack>
          </VStack>
        ) : null}
      </VStack>
    </Card>
  );
}
