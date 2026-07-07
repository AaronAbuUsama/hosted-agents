import { redirect } from "next/navigation";

import { APP_LANDING_PATH } from "@/lib/organization-routing";

export default function AppOverviewPage(): never {
  redirect(APP_LANDING_PATH);
}
