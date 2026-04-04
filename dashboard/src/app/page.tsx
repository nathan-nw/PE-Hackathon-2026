import { OpsDashboard } from "@/components/ops-dashboard";

export default function Home() {
  return (
    <div className="bg-background flex min-h-full flex-col">
      <header className="border-border border-b">
        <div className="mx-auto flex h-12 max-w-6xl items-center gap-6 px-4">
          <span className="text-sm font-medium tracking-tight">Visibility</span>
          <nav className="text-muted-foreground flex gap-4 text-sm">
            <span className="text-foreground font-medium">Ops</span>
            <span className="cursor-not-allowed opacity-50" title="Not implemented">
              Settings
            </span>
          </nav>
        </div>
      </header>
      <OpsDashboard />
    </div>
  );
}
