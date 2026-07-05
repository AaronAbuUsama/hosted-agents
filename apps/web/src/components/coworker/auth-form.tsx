"use client";

import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Divider } from "@astryxdesign/core/Divider";
import { Link } from "@astryxdesign/core/Link";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text, Heading } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { AtSymbolIcon, LockClosedIcon, UserIcon } from "@heroicons/react/24/outline";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth-client";

type AuthMode = "signin" | "signup";

type AuthFormProps = {
  mode: AuthMode;
};

export default function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSignup = mode === "signup";
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);

    if (isSignup) {
      await authClient.signUp.email(
        { email, password, name },
        {
          onSuccess: () => {
            toast.success("Account created");
            router.push("/onboarding/organization");
          },
          onError: (error) => {
            toast.error(error.error.message || error.error.statusText);
          },
        },
      );
      setIsSubmitting(false);
      return;
    }

    await authClient.signIn.email(
      { email, password },
      {
        onSuccess: () => {
          toast.success("Signed in");
          router.push("/app");
        },
        onError: (error) => {
          toast.error(error.error.message || error.error.statusText);
        },
      },
    );
    setIsSubmitting(false);
  }

  return (
    <Card maxWidth={460} padding={8}>
      <form onSubmit={handleSubmit}>
        <VStack gap={6}>
          <VStack gap={2}>
            <Text type="label" color="accent">
              coworker.tech
            </Text>
            <Heading level={1}>{isSignup ? "Hire your first coworker" : "Welcome back"}</Heading>
            <Text type="supporting" as="p">
              {isSignup
                ? "Create your Coworker account, then connect an organization, provider account, GitHub, and named coworkers."
                : "Sign in to manage coworkers, runs, GitHub installs, and automation rules."}
            </Text>
          </VStack>

          <VStack gap={4}>
            {isSignup ? (
              <TextInput
                label="Name"
                value={name}
                onChange={setName}
                startIcon={UserIcon}
                placeholder="Ada Lovelace"
                isRequired
              />
            ) : null}
            <TextInput
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              startIcon={AtSymbolIcon}
              placeholder="you@company.com"
              isRequired
            />
            <TextInput
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              startIcon={LockClosedIcon}
              isRequired
            />
          </VStack>

          <Button
            label={isSignup ? "Create account" : "Sign in"}
            variant="primary"
            type="submit"
            isLoading={isSubmitting}
            isDisabled={email.length === 0 || password.length < 8 || (isSignup && name.length < 2)}
          />

          <Divider label="or" />

          <Button label="Continue with GitHub" variant="secondary" isDisabled />

          <HStack gap={1} hAlign="center">
            <Text type="supporting">
              {isSignup ? "Already have an account?" : "Need an account?"}
            </Text>
            <Link href={isSignup ? "/login" : "/signup"} isStandalone>
              {isSignup ? "Sign in" : "Sign up"}
            </Link>
          </HStack>
        </VStack>
      </form>
    </Card>
  );
}
