"use client";

import { Button } from "@hosted-agents/ui/components/button";

export default function SentryExampleClient() {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Button
        type="button"
        onClick={() => {
          throw new Error("Sentry hosted-agents browser verification error");
        }}
      >
        Throw test error
      </Button>
    </main>
  );
}
