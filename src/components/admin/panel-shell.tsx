"use client";

import {
  Boxes,
  Calculator,
  Compass,
  CalendarClock,
  ChevronRight,
  ClipboardList,
  Contact,
  Ellipsis,
  LayoutDashboard,
  LogOut,
  Monitor,
  Moon,
  Pin,
  Settings,
  Store,
  ShieldCheck,
  Sun,
  TicketPercent,
  UserCog,
  UtensilsCrossed,
  Users,
} from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, use, useEffect, useState } from "react";
import { toast } from "sonner";
import { getMyProfile, markTourDone, saveNavPins, signOutStaff } from "@/actions/auth";
import { Button, buttonClasses } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { Sheet } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Tour, type TourStep } from "@/components/ui/tour";
import { cn } from "@/lib/format";
import { canSee, MAX_PINS, resolvePins, type NavKey } from "@/lib/nav";
import { clearStaff, markStaff } from "@/lib/staff-hint";
import { useIsDesktop } from "@/lib/use-media-query";
import { useMounted } from "@/lib/use-mounted";
import type { Profile } from "@/types";

const ProfileContext = createContext<Profile | null>(null);
const SetProfileContext = createContext<(profile: Profile) => void>(() => {});
const StartTourContext = createContext<() => void>(() => {});

/** Current staff profile. Only usable inside the panel shell. */
export function useProfile() {
  const profile = use(ProfileContext);
  if (!profile) throw new Error("useProfile must be used inside PanelShell");
  return profile;
}

/** Replaces the profile shown in the shell, after the person edits their own account. */
export const useSetProfile = () => use(SetProfileContext);

/** Opens the first-access tour again ("Rever tour"). */
export const useStartTour = () => use(StartTourContext);

type NavItem = {
  key: NavKey;
  href: string;
  label: string;
  /** Label under the icon on phones and tablets. */
  short?: string;
  icon: typeof LayoutDashboard;
};

// Who may open each page is in src/lib/nav.ts; each person picks which ones sit
// in the phone bar / tablet rail, the rest go behind "Mais".
const NAV: NavItem[] = [
  { key: "dashboard", href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { key: "pedidos", href: "/admin/pedidos", label: "Pedidos", icon: ClipboardList },
  { key: "encomendas", href: "/admin/encomendas", label: "Encomendas", short: "Agenda", icon: CalendarClock },
  { key: "cardapio", href: "/admin/cardapio", label: "Cardápio", icon: UtensilsCrossed },
  { key: "estoque", href: "/admin/estoque", label: "Estoque", icon: Boxes },
  { key: "custos", href: "/admin/custos", label: "Custos", icon: Calculator },
  { key: "clientes", href: "/admin/clientes", label: "Clientes", icon: Contact },
  { key: "cupons", href: "/admin/cupons", label: "Cupons", icon: TicketPercent },
  { key: "equipe", href: "/admin/equipe", label: "Equipe", icon: Users },
  { key: "loja", href: "/admin/configuracoes", label: "Loja", icon: Settings },
  { key: "conta", href: "/admin/conta", label: "Minha conta", short: "Conta", icon: UserCog },
];

// One line per page for the first-access tour; the page list follows the person's role.
const TOUR_TEXT: Record<NavKey, string> = {
  dashboard: "Resumo das vendas: faturamento, pedidos e produtos que mais saem.",
  pedidos: "Os pedidos do cardápio chegam aqui na hora. Acompanhe cada um até a entrega.",
  encomendas: "Pedidos agendados para outros dias e o que produzir em cada dia.",
  cardapio: "Crie, edite, pause ou oculte produtos. As mudanças aparecem no link público em instantes.",
  estoque: "Cada venda baixa os itens ligados ao produto. Sem estoque, o produto aparece como esgotado.",
  custos: "Quanto custa cada produto: insumos da ficha técnica, extras e a parte das despesas do mês.",
  clientes: "Quem já pediu, quanto gastou e como falar com cada um.",
  cupons: "Descontos que o cliente digita ao fechar o pedido.",
  equipe: "Convide gerentes e funcionários. Funcionários só veem pedidos, agenda, cardápio e estoque.",
  loja: "Nome, logo, horários, entrega e regras do pedido que aparecem no cardápio público.",
  conta: "Sua foto, seu e-mail e sua senha. Aqui também dá para rever este tour.",
};

function tourSteps(nav: NavItem[]): TourStep[] {
  return [
    { title: "Bem-vindo ao painel!", body: "Veja em poucos passos onde fica cada coisa. Você pode pular quando quiser." },
    ...nav.map((n) => ({ target: n.key, fallback: "mais", fallbackHint: "Fica no botão Mais.", title: n.label, body: TOUR_TEXT[n.key] })),
    {
      target: "cardapio-publico",
      fallback: "mais",
      fallbackHint: "Fica no botão Mais.",
      title: "Ver cardápio público",
      body: "Abre a loja como o cliente vê. Lá, o botão Painel traz você de volta.",
    },
    {
      target: "mais",
      title: "Mais e atalhos",
      body: "No celular e no tablet, Mais mostra as outras páginas. Em Escolher atalhos você decide o que fica na barra.",
    },
  ];
}

/** The store logo set in the panel; the default brand icon until one is set. */
export function StoreMark({ logoUrl, size, alt = "", className }: { logoUrl: string | null; size: number; alt?: string; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- uploaded photo or external link set in the panel
    <img
      src={logoUrl ?? "/brand/menu-icon.png"}
      alt={alt}
      width={size}
      height={size}
      className={cn("shrink-0 border border-border bg-surface object-cover", className)}
      style={{ width: size, height: size }}
    />
  );
}

export function PanelShell({ logoUrl, children }: { logoUrl: string | null; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [tourAgain, setTourAgain] = useState(false);
  // "Mais" closes by itself on navigation
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setMoreOpen(false);
  }

  // Re-checks the session and staff row on load and whenever the tab regains
  // focus, so a deactivated or demoted account loses access without reloading.
  // Server actions and routes check it again on every call.
  useEffect(() => {
    let cancelled = false;
    let hadProfile = false;

    const check = async () => {
      const result = await getMyProfile().catch(() => ({ profile: null, error: "Sem conexão. Tente novamente." }));
      if (cancelled) return;
      if (result.profile) {
        hadProfile = true;
        // lets the storefront offer the "Painel" button on this device
        markStaff();
        setProfile(result.profile);
        setLoadError(null);
      } else if (result.error) {
        if (!hadProfile) setLoadError(result.error);
      } else {
        if (hadProfile) toast.error("Sua conta não tem mais acesso ao painel.");
        setProfile(null);
        clearStaff();
        await signOutStaff();
        router.replace("/admin/login");
      }
    };

    check();
    const onFocus = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [router]);

  async function signOut() {
    clearStaff();
    await signOutStaff();
    router.replace("/admin/login");
  }

  const role = profile?.role ?? "staff";
  const nav = NAV.filter((n) => canSee(n.key, role));
  const pins = resolvePins(profile?.nav_pins, role);
  const main = nav.filter((n) => pins.includes(n.key));
  const more = nav.filter((n) => !pins.includes(n.key));

  // the bar changes at once; a failed save puts the previous pins back
  async function savePins(next: NavKey[] | null) {
    if (!profile) return false;
    const previous = profile.nav_pins;
    setProfile({ ...profile, nav_pins: next });
    const result = await saveNavPins(next).catch(() => ({ ok: false as const, error: "Sem conexão. Tente novamente." }));
    if (!result.ok) {
      setProfile((p) => (p ? { ...p, nav_pins: previous } : p));
      toast.error(result.error);
      return false;
    }
    toast.success("Atalhos salvos.");
    return true;
  }
  // opens by itself until the person finishes or skips it once (saved on the account, so every device)
  const tourOpen = Boolean(profile) && (tourAgain || profile?.tour_done_at === null);
  function finishTour() {
    setTourAgain(false);
    if (!profile || profile.tour_done_at !== null) return;
    setProfile({ ...profile, tour_done_at: new Date().toISOString() });
    markTourDone()
      .then((r) => !r.ok && toast.error(r.error))
      .catch(() => toast.error("Sem conexão. O tour pode aparecer de novo."));
  }
  const startTour = () => {
    setMoreOpen(false);
    setTourAgain(true);
  };

  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href));
  const moreActive = more.some((n) => isActive(n.href));

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      {/* Desktop sidebar: every page, labelled */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-border bg-surface lg:flex">
        <div className="flex h-16 items-center gap-2.5 px-5">
          <StoreMark logoUrl={logoUrl} size={36} className="rounded-lg" />
          <div className="leading-tight">
            <p className="font-bold" translate="no">
              Menu
            </p>
            <p className="text-xs text-muted-foreground">Gestão de pedidos</p>
          </div>
          <ThemeToggle className="ml-auto" />
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4" aria-label="Painel">
          {profile
            ? // "Minha conta" opens from the name card at the bottom
              nav.filter((n) => n.key !== "conta").map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  data-tour={n.key}
                  aria-current={isActive(n.href) ? "page" : undefined}
                  className={cn(
                    "flex h-11 items-center gap-3 rounded-md px-3 text-sm font-semibold transition-colors",
                    isActive(n.href)
                      ? "bg-primary-soft text-primary-soft-foreground"
                      : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                  )}
                >
                  <n.icon className="size-5" />
                  {n.label}
                </Link>
              ))
            : Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-11" />)}
        </nav>
        <div className="border-t border-border p-3">
          {/* same tab: the storefront shows a "Painel" button back to the team */}
          <Link href="/" data-tour="cardapio-publico" className="flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-surface-2 hover:text-foreground">
            <Store className="size-4" />
            Ver cardápio público
          </Link>
          {profile && <UserCard profile={profile} onSignOut={signOut} />}
        </div>
      </aside>

      {/* Tablet rail: the daily pages + "Mais" */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-20 flex-col items-center border-r border-border bg-surface py-4 md:flex lg:hidden">
        <StoreMark logoUrl={logoUrl} size={40} alt="Menu" className="mb-6 rounded-xl" />
        {profile && (
          <nav className="flex w-full flex-1 flex-col items-center gap-1 px-2" aria-label="Painel">
            {main.map((n) => (
              <NavTab key={n.href} item={n} active={isActive(n.href)} />
            ))}
            <div className="mt-auto w-full">
              <MoreButton active={moreActive} onOpen={() => setMoreOpen(true)} />
            </div>
          </nav>
        )}
      </aside>

      <div className="flex min-w-0 flex-col overflow-x-clip md:pl-20 lg:pl-0">
        <main id="conteudo" tabIndex={-1} className="flex-1 pb-[calc(4.5rem+env(safe-area-inset-bottom))] outline-none md:pb-0">
          {profile ? (
            <ProfileContext value={profile}>
              <SetProfileContext value={setProfile}>
                <StartTourContext value={startTour}>{children}</StartTourContext>
              </SetProfileContext>
            </ProfileContext>
          ) : loadError ? (
            <EmptyState
              icon={ShieldCheck}
              title="Não foi possível abrir o painel"
              description={loadError}
              action={
                <div className="flex gap-2">
                  <button type="button" onClick={() => window.location.reload()} className={buttonClasses("primary")}>
                    Tentar de novo
                  </button>
                  <button type="button" onClick={signOut} className={buttonClasses("outline")}>
                    Sair
                  </button>
                </div>
              }
              className="py-24"
            />
          ) : (
            <div className="space-y-4 p-4 sm:p-6">
              <Skeleton className="h-8 w-48" />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-28" />
                ))}
              </div>
              <Skeleton className="h-72" />
            </div>
          )}
        </main>

        {/* Phone bottom bar: the daily pages + "Mais" */}
        {profile && (
          <nav
            className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
            aria-label="Painel"
          >
            {main.map((n) => (
              <NavTab key={n.href} item={n} active={isActive(n.href)} />
            ))}
            <MoreButton active={moreActive} onOpen={() => setMoreOpen(true)} />
          </nav>
        )}
      </div>

      {profile && (
        <MoreSheet
          open={moreOpen}
          onClose={() => setMoreOpen(false)}
          items={more}
          all={nav}
          pins={pins}
          onSavePins={savePins}
          isActive={isActive}
          profile={profile}
          onSignOut={signOut}
          onStartTour={startTour}
        />
      )}
      {tourOpen && <Tour steps={tourSteps(nav)} onDone={finishTour} />}
    </div>
  );
}

function MoreButton({ active, onOpen }: { active: boolean; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} aria-haspopup="dialog" data-tour="mais" className={tabClasses(active)}>
      <span className={pillClasses(active)}>
        <Ellipsis className="size-5" />
      </span>
      Mais
    </button>
  );
}

const tabClasses = (active: boolean) =>
  cn(
    "flex h-16 min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors md:w-full md:flex-none",
    active ? "text-primary-soft-foreground" : "text-muted-foreground hover:text-foreground",
  );
const pillClasses = (active: boolean) => cn("grid h-8 w-14 place-items-center rounded-full transition-colors", active && "bg-primary-soft");

function NavTab({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link href={item.href} data-tour={item.key} aria-current={active ? "page" : undefined} className={tabClasses(active)}>
      <span className={pillClasses(active)}>
        <item.icon className="size-5" />
      </span>
      {item.short ?? item.label}
    </Link>
  );
}

/** "Mais": the pages not pinned, choosing the pins, the public menu, theme and sign out, for phones and tablets. */
function MoreSheet({
  open,
  onClose,
  items,
  all,
  pins,
  onSavePins,
  isActive,
  profile,
  onSignOut,
  onStartTour,
}: {
  open: boolean;
  onClose: () => void;
  items: NavItem[];
  all: NavItem[];
  pins: NavKey[];
  onSavePins: (next: NavKey[] | null) => Promise<boolean>;
  isActive: (href: string) => boolean;
  profile: Profile;
  onSignOut: () => void;
  onStartTour: () => void;
}) {
  const row = "flex h-12 w-full items-center gap-3 rounded-md px-3 text-sm font-semibold transition-colors hover:bg-surface-2";
  // the pins being chosen; null = not editing
  const [draft, setDraft] = useState<NavKey[] | null>(null);
  const [saving, setSaving] = useState(false);
  // closing the sheet (or navigating away) leaves the editor
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) setDraft(null);
  }
  async function save(next: NavKey[] | null) {
    setSaving(true);
    const ok = await onSavePins(next);
    setSaving(false);
    if (ok) setDraft(null);
  }

  if (draft) {
    const full = draft.length >= MAX_PINS;
    return (
      <Sheet open={open} onClose={onClose} title="Escolher atalhos" size="sm">
        <div className="space-y-4 px-5 pt-1 pb-5">
          <p className="text-sm text-muted-foreground">
            Fixe até {MAX_PINS} páginas na barra do celular e do tablet. As outras ficam em &quot;Mais&quot;.
          </p>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {all.map((n) => {
              const on = draft.includes(n.key);
              return (
                <li key={n.key} className="flex items-center gap-3 px-3">
                  <n.icon className="size-5 shrink-0 text-muted-foreground" />
                  <Switch
                    checked={on}
                    disabled={(!on && full) || (on && draft.length === 1)}
                    onCheckedChange={(v) => setDraft(v ? [...draft, n.key] : draft.filter((k) => k !== n.key))}
                    label={n.label}
                    className="flex-1 flex-row-reverse justify-between"
                  />
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {draft.length} de {MAX_PINS} atalhos{full ? ". Desmarque um para trocar." : "."}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button onClick={() => save(draft)} loading={saving} className="flex-1">
              Salvar atalhos
            </Button>
            <Button variant="outline" onClick={() => save(null)} disabled={saving} className="flex-1">
              Restaurar padrão
            </Button>
          </div>
          <button type="button" onClick={() => setDraft(null)} className="w-full text-center text-sm font-semibold text-muted-foreground hover:underline">
            Voltar
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onClose={onClose} title="Menu" size="sm">
      <div className="space-y-4 px-5 pt-1 pb-5">
        <div className="flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-3">
          <StaffAvatar profile={profile} />
          <div className="min-w-0 leading-tight">
            <p className="truncate font-semibold">{profile.full_name || profile.email}</p>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              {profile.role === "admin" && <ShieldCheck className="size-3" />}
              {profile.role === "admin" ? "Gerente" : "Funcionário"}
            </p>
          </div>
        </div>

        {items.length > 0 && (
          <nav aria-label="Outras páginas">
            <p className="px-3 pb-1 text-xs font-bold tracking-wide text-muted-foreground uppercase">Outras páginas</p>
            {items.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                onClick={onClose}
                aria-current={isActive(n.href) ? "page" : undefined}
                className={cn(row, isActive(n.href) && "bg-primary-soft text-primary-soft-foreground hover:bg-primary-soft")}
              >
                <n.icon className="size-5 text-muted-foreground" />
                <span className="flex-1">{n.label}</span>
                <ChevronRight className="size-4 text-muted-foreground" />
              </Link>
            ))}
          </nav>
        )}

        <div className="space-y-1 border-t border-border pt-3">
          <button type="button" onClick={() => setDraft(pins)} className={row}>
            <Pin className="size-5 text-muted-foreground" />
            <span className="flex-1 text-left">Escolher atalhos</span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </button>
          <Link href="/" onClick={onClose} className={row}>
            <Store className="size-5 text-muted-foreground" />
            <span className="flex-1">Ver cardápio público</span>
          </Link>
          <button type="button" onClick={onStartTour} className={row}>
            <Compass className="size-5 text-muted-foreground" />
            <span className="flex-1 text-left">Rever tour</span>
          </button>
          <div className="flex items-center gap-3 px-3 py-1.5">
            <span className="flex-1 text-sm font-semibold">Tema</span>
            <ThemeChoice />
          </div>
          <button type="button" onClick={onSignOut} className={cn(row, "text-danger hover:bg-danger-soft")}>
            <LogOut className="size-5" />
            Sair
          </button>
        </div>
      </div>
    </Sheet>
  );
}

const THEMES = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Escuro", icon: Moon },
  { value: "system", label: "Sistema", icon: Monitor },
] as const;

function ThemeChoice() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();
  const desktop = useIsDesktop();
  const saved = mounted ? (theme ?? "system") : "system";
  // "system" only on computers; elsewhere a saved "system" marks the theme it resolves to
  const options = desktop ? THEMES : THEMES.filter((t) => t.value !== "system");
  const current = mounted && !desktop && saved === "system" ? (resolvedTheme === "dark" ? "dark" : "light") : saved;
  return (
    <div className="flex rounded-full border border-border-strong p-0.5" role="radiogroup" aria-label="Tema">
      {options.map((t) => (
        <button
          key={t.value}
          type="button"
          role="radio"
          aria-checked={current === t.value}
          aria-label={t.label}
          title={t.label}
          onClick={() => setTheme(t.value)}
          className={cn(
            "grid size-8 place-items-center rounded-full transition-colors",
            current === t.value ? "bg-primary-soft text-primary-soft-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <t.icon className="size-4" />
        </button>
      ))}
    </div>
  );
}

/** The person's photo, or their initials when there is none. */
export function StaffAvatar({ profile, size = 36 }: { profile: Pick<Profile, "full_name" | "email" | "avatar_url">; size?: number }) {
  if (profile.avatar_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- photo sent from "Minha conta"
      <img
        src={profile.avatar_url}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full border border-border bg-surface-3 object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  const initials = (profile.full_name || profile.email)
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full bg-surface-3 font-bold"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

function UserCard({ profile, onSignOut }: { profile: Profile; onSignOut: () => void }) {
  return (
    <div className="mt-2 flex items-center gap-1 rounded-md">
      <Link
        href="/admin/conta"
        data-tour="conta"
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-2 hover:bg-surface-2"
        aria-label={`Minha conta: ${profile.full_name || profile.email}`}
      >
        <StaffAvatar profile={profile} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-semibold">{profile.full_name || profile.email}</p>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            {profile.role === "admin" && <ShieldCheck className="size-3" />}
            {profile.role === "admin" ? "Gerente" : "Funcionário"}
          </p>
        </div>
      </Link>
      <button
        type="button"
        onClick={onSignOut}
        className="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-surface-2 hover:text-foreground"
        aria-label="Sair"
        title="Sair"
      >
        <LogOut className="size-4" />
      </button>
    </div>
  );
}

/** Wraps admin-only pages; staff sees a friendly notice instead. */
export function AdminOnly({ children }: { children: React.ReactNode }) {
  const profile = useProfile();
  if (profile.role === "admin") return children;
  return (
    <EmptyState
      icon={ShieldCheck}
      title="Acesso restrito ao gerente"
      description="Seu perfil de funcionário tem acesso a pedidos e cardápio."
      action={
        <Link href="/admin/pedidos" className={buttonClasses("primary")}>
          Ir para pedidos
        </Link>
      }
      className="py-24"
    />
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 px-4 pt-5 pb-4 sm:px-6 sm:pt-6 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2 lg:shrink-0 lg:justify-end">{actions}</div>}
    </div>
  );
}
