"use client";

import { useRef, useState, type FormEvent } from "react";

import { Button } from "@astryxdesign/core/Button";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useRouter } from "next/navigation";

import { normalizeOrganizationNextPath } from "@/lib/organization-routing";
import { client } from "@/utils/orpc";

type OrganizationFormProps = {
  nextPath: string;
};

export default function OrganizationForm({ nextPath }: OrganizationFormProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);

  async function submitOrganization(): Promise<void> {
    if (isSubmittingRef.current) {
      return;
    }

    const organizationName = name.trim();

    if (!organizationName) {
      setErrorMessage("Organization name is required.");
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await client.createOrganization({ name: organizationName });
      router.push(normalizeOrganizationNextPath(nextPath));
      router.refresh();
    } catch (error) {
      isSubmittingRef.current = false;
      setErrorMessage(error instanceof Error ? error.message : "Organization could not be created.");
      setIsSubmitting(false);
    }
  }

  function submitForm(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submitOrganization();
  }

  return (
    <form id="organization-form" onSubmit={submitForm}>
      <VStack gap={4}>
        <TextInput label="Organization name" value={name} onChange={setName} />
        <Text type="supporting" color="secondary" as="p">
          Use the legal or team name that should own reviewer setup, provider credentials, runs,
          and GitHub installations.
        </Text>
        {errorMessage ? (
          <Text type="supporting" color="secondary" as="p">
            {errorMessage}
          </Text>
        ) : null}
        <Button
          label={isSubmitting ? "Creating organization" : "Create organization"}
          variant="primary"
          isDisabled={isSubmitting}
          isLoading={isSubmitting}
          onClick={() => {
            void submitOrganization();
          }}
        />
      </VStack>
    </form>
  );
}
