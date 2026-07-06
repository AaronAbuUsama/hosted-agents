"use client";

import { Button } from "@astryxdesign/core/Button";
import { Center } from "@astryxdesign/core/Center";
import { Grid } from "@astryxdesign/core/Grid";
import { Icon } from "@astryxdesign/core/Icon";
import { Link } from "@astryxdesign/core/Link";
import { Section } from "@astryxdesign/core/Section";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { ArrowRightIcon, SparklesIcon } from "@heroicons/react/24/outline";
import { useState, type CSSProperties } from "react";

import { authClient } from "@/lib/auth-client";

type AuthMode = "signin" | "signup";

type AuthFormProps = {
  mode: AuthMode;
};

const columnMinWidth = 260;

const authPageStyle: CSSProperties = {
  minHeight: "100dvh",
  padding: "var(--spacing-6)",
  backgroundColor: "var(--color-background-body)",
};

const authShellStyle: CSSProperties = {
  width: "100%",
  maxWidth: 1040,
  marginInline: "auto",
};

const coverPanelStyle: CSSProperties = {
  height: "100%",
  minHeight: 460,
  backgroundColor: "var(--color-background-surface)",
  border: "var(--border-width) solid var(--color-border)",
  borderRadius: "var(--radius-container)",
  backgroundImage:
    "url('https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=1200&q=80')",
  backgroundPosition: "center",
  backgroundSize: "cover",
};

const AUTH_SPLIT_CSS = `
.coworker-auth-grid {
  container-type: inline-size;
  container-name: coworker-auth;
  padding: var(--spacing-8);
}

@container coworker-auth (max-width: 559px) {
  .coworker-auth-grid {
    padding: var(--spacing-4);
  }
}
`;

export default function AuthForm({ mode }: AuthFormProps) {
  const isSignup = mode === "signup";
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function continueWithGitHub(): Promise<void> {
    setIsSigningIn(true);
    setErrorMessage(null);

    const callbackPath = isSignup ? "/onboarding/github" : "/app";

    try {
      await authClient.signIn.social({
        provider: "github",
        callbackURL: new URL(callbackPath, window.location.origin).toString(),
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "GitHub sign-in failed.");
      setIsSigningIn(false);
    }
  }

  return (
    <Center axis="both" style={authPageStyle}>
      <style>{AUTH_SPLIT_CSS}</style>
      <VStack gap={4} width="100%">
        <section style={authShellStyle}>
          <Section variant="section" padding={0}>
            <Grid
              columns={{ minWidth: columnMinWidth, repeat: "fit" }}
              gap={8}
              align="stretch"
              className="coworker-auth-grid"
            >
              <VStack gap={5} height="100%">
                <HStack gap={2} vAlign="center">
                  <Icon icon={SparklesIcon} size="sm" />
                  <Text type="body" weight="bold">
                    Coworker
                  </Text>
                </HStack>

                <StackItem size="fill">
                  <Center axis="vertical" height="100%">
                    <VStack gap={5} width="100%">
                      <VStack gap={1}>
                        <Text type="display-2" as="h1">
                          {isSignup ? "Create your workspace" : "Welcome back"}
                        </Text>
                        <Text type="body" color="secondary" size="sm" as="p">
                          {isSignup
                            ? "Use GitHub to install Coworker, connect repositories, and start setup."
                            : "Use GitHub to return to your coworker workspace."}
                        </Text>
                      </VStack>

                      <Button
                        label={isSigningIn ? "Opening GitHub" : "Continue with GitHub"}
                        variant="primary"
                        size="lg"
                        icon={<Icon icon={ArrowRightIcon} size="sm" />}
                        isDisabled={isSigningIn}
                        isLoading={isSigningIn}
                        onClick={continueWithGitHub}
                      />
                      {errorMessage ? (
                        <Text type="supporting" color="secondary" as="p">
                          {errorMessage}
                        </Text>
                      ) : null}
                    </VStack>
                  </Center>
                </StackItem>

                <HStack gap={1} wrap="wrap">
                  <Text type="supporting" color="secondary">
                    {isSignup ? "Already have an account?" : "Need an account?"}
                  </Text>
                  <Link href={isSignup ? "/login" : "/signup"} type="supporting">
                    {isSignup ? "Sign in" : "Sign up"}
                  </Link>
                </HStack>
              </VStack>

              <section aria-label="People collaborating at a workstation" style={coverPanelStyle} />
            </Grid>
          </Section>
        </section>
        <VStack hAlign="center">
          <Text type="supporting" color="secondary">
            By continuing, you agree to the Terms of Service and Privacy Policy.
          </Text>
        </VStack>
      </VStack>
    </Center>
  );
}
