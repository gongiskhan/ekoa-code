import { redirect } from "next/navigation";

/**
 * S8: the automations LIST is gone. Integrations is the single user-facing surface for work that
 * touches outside systems, so the address that used to list automations now lands on the list that
 * replaced it. A server `redirect()` REPLACES rather than pushes, so the old path does not sit in
 * history as a trap the back button walks into (the rule `settings-redirects.spec.ts` pins).
 *
 * The engine, `/api/v1/automations`, triggers and schedules all keep working underneath: this slice
 * removes a page, never a capability.
 */
export default function AutomationsListRedirect() {
  redirect("/integrations");
}
