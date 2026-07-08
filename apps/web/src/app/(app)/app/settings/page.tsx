import { redirect } from "next/navigation";

// Settings is a route group; the left rail exposes each section. Landing on the
// bare /app/settings path resolves to the first section.
export default function SettingsPage(): never {
  redirect("/app/settings/organization");
}
