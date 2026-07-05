import { notFound } from "next/navigation";

import SentryExampleClient from "./sentry-example.client";

type SentryExamplePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SentryExamplePage({ searchParams }: SentryExamplePageProps) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const params = await searchParams;
  if (params.throw === "1") {
    throw new Error("Sentry hosted-agents server verification error");
  }

  return <SentryExampleClient />;
}
