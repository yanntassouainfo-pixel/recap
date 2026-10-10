import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getScope, getSettings, getSnapshot, visibleCompanies } from "@/lib/data";
import { getFormOptions } from "@/lib/options";
import { ToastProvider } from "@/components/toast";
import { QuickActionsProvider } from "@/components/quick/provider";
import { MobileNav, Sidebar } from "@/components/shell/nav";
import { Topbar } from "@/components/shell/topbar";
import { ScopeSwitcher, type ScopeOption } from "@/components/shell/scope-switcher";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const settings = getSettings(user.id);
  if (!settings.onboardedAt) redirect("/onboarding");
  const [scope, options, snapshot] = await Promise.all([getScope(user.id), getFormOptions(user.id), getSnapshot(user.id)]);
  const companies = visibleCompanies(user.id);
  const pros = companies.filter((c) => c.kind !== "personal");
  const personal = companies.find((c) => c.kind === "personal");
  const scopeOptions: ScopeOption[] = [];
  if (companies.length > 1) {
    scopeOptions.push({ key: "all", label: personal ? "Vue consolidée" : "Toutes les structures", hint: personal ? "Pro + personnel, flux internes neutralisés" : "Flux entre structures neutralisés", kind: "all" });
    if (personal && pros.length > 1) scopeOptions.push({ key: "pro", label: "Activités professionnelles", hint: "Toutes les structures, sans le personnel", kind: "pro" });
  }
  for (const c of pros) scopeOptions.push({ key: c.id, label: c.name, kind: "company", color: c.color });
  if (personal) scopeOptions.push({ key: personal.id, label: "Espace personnel", hint: "Séparé de vos structures", kind: "personal" });
  const switcher = <ScopeSwitcher current={scope.key} options={scopeOptions} />;
  const overdue = snapshot.receivables.items.filter((i) => i.status === "overdue").length;

  return (
    <ToastProvider>
      <QuickActionsProvider options={options}>
        <Sidebar userName={user.name} overdueCount={overdue} scopeSwitcher={switcher} />
        <div className="lg:pl-[248px]">
          <Topbar scopeLabel={scope.label} userName={user.name} />
          <main className="mx-auto max-w-[1320px] px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-16 lg:pt-8">{children}</main>
        </div>
        <MobileNav scopeSwitcher={switcher} />
      </QuickActionsProvider>
    </ToastProvider>
  );
}
