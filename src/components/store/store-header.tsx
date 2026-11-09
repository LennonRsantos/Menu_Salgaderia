"use client";

import { Bike, CalendarClock, Clock, LayoutDashboard, MapPin, Receipt, ShoppingBag, Store, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { getMyProfile } from "@/actions/auth";
import { getMyAccount } from "@/actions/customer";
import Link from "next/link";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { forgetOrder, loadRecentOrders, type RecentOrder } from "@/lib/cart-store";
import { clearStaff, hasStaffHint } from "@/lib/staff-hint";
import { useReservation } from "@/lib/reservation-store";
import { useStoreStatus } from "@/lib/use-store-status";
import { cn, formatBRL, mapsLink } from "@/lib/format";
import { etaLabel } from "@/lib/hours";
import { DEFAULT_THEME, type ActiveTheme } from "@/lib/themes";
import type { OrderStatus, StoreSettings } from "@/types";
import { FestiveBanner, FestiveEffects } from "./festive-decor";

export const DEFAULT_STORE_NAME = "Menu Salgaderia e Confeitaria";

export function StoreLogo({ settings, size = 56 }: { settings: StoreSettings | null; size?: number }) {
  const name = settings?.name ?? DEFAULT_STORE_NAME;
  if (settings?.logo_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- logo is an external link set in the panel
      <img
        src={settings.logo_url}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full border border-border object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full bg-primary font-bold text-primary-foreground"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

export function StoreHeader({ settings, theme = DEFAULT_THEME }: { settings: StoreSettings | null; theme?: ActiveTheme }) {
  const [recent, setRecent] = useState<RecentOrder | null>(null);
  useEffect(() => {
    let cancelled = false;
    // the shortcut is only for an order still on its way; finished ones leave the list
    (async () => {
      for (const order of loadRecentOrders()) {
        const res = await fetch(`/api/track/${order.token}`, { cache: "no-store" }).catch(() => null);
        if (cancelled || !res) return;
        if (res.status === 404) {
          forgetOrder(order.token);
          continue;
        }
        if (!res.ok) return;
        const { order: tracked } = (await res.json()) as { order: { status: OrderStatus } };
        if (cancelled) return;
        if (tracked.status === "completed" || tracked.status === "cancelled") {
          forgetOrder(order.token);
          continue;
        }
        setRecent(order);
        return;
      }
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const status = useStoreStatus(settings);
  const openReservation = useReservation((s) => s.setOpen);
  const [firstName, setFirstName] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getMyAccount()
      .then((a) => !cancelled && setFirstName(a ? a.name.split(" ")[0] : null))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  // "Painel" shortcut for the team only: asked to the server, and only on
  // devices where someone already opened the panel (customers never ask)
  const [isStaff, setIsStaff] = useState(false);
  useEffect(() => {
    if (!hasStaffHint()) return;
    let cancelled = false;
    getMyProfile()
      .then((r) => {
        if (cancelled) return;
        if (r.profile) setIsStaff(true);
        else if (!r.error) clearStaff();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const isOpen = status.open;
  // with zones the fee depends on the neighborhood: show the lowest one
  const deliveryEta = etaLabel(settings?.delivery_min, settings?.delivery_max);
  const pickupEta = etaLabel(settings?.pickup_min, settings?.pickup_max);
  const deliveryFrom = settings?.zones.length ? Math.min(...settings.zones.map((z) => z.fee), settings.other_zones ? settings.delivery_fee : Infinity) : null;
  const deliveryFee = !settings
    ? ""
    : deliveryFrom === null
      ? settings.delivery_fee > 0
        ? `Taxa ${formatBRL(settings.delivery_fee)}`
        : "Grátis"
      : deliveryFrom > 0
        ? `Taxa a partir de ${formatBRL(deliveryFrom)}`
        : "Grátis em alguns bairros";

  return (
    <header className="relative overflow-hidden border-b border-border bg-surface">
      {settings?.header_image_url ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- uploaded photo or external link set in the panel */}
          <img
            src={settings.header_image_url}
            alt=""
            fetchPriority="high"
            className="pointer-events-none absolute inset-0 size-full object-cover"
            aria-hidden
          />
          {/* veil over the photo keeps the text readable in both themes */}
          <div className="pointer-events-none absolute inset-0 bg-linear-to-b from-surface/55 via-surface/80 to-surface" aria-hidden />
        </>
      ) : (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-linear-to-b from-primary-soft to-transparent"
          aria-hidden
        />
      )}
      <FestiveBanner theme={theme} />
      <FestiveEffects theme={theme} />
      <div className="relative mx-auto flex max-w-5xl flex-col gap-4 px-4 pt-4 pb-5 sm:px-6">
        <div className="flex items-center justify-end gap-1">
          {isStaff && (
            <Link
              href="/admin"
              className="mr-auto inline-flex h-10 items-center gap-2 rounded-full bg-primary-soft px-3.5 text-sm font-semibold text-primary-soft-foreground hover:bg-primary-soft-hover"
            >
              <LayoutDashboard className="size-4" />
              Painel
            </Link>
          )}
          {recent && (
            <Link
              href={`/pedido/${recent.token}`}
              className="inline-flex h-10 items-center gap-2 rounded-full px-3 text-sm font-semibold text-primary-soft-foreground hover:bg-primary-soft"
            >
              <Receipt className="size-4" />
              Pedido #{recent.code}
            </Link>
          )}
          <Link
            href="/conta"
            data-tour="conta"
            className="inline-flex h-10 items-center gap-2 rounded-full px-3 text-sm font-semibold hover:bg-surface-2"
            aria-label={firstName ? `Minha conta, ${firstName}` : "Entrar ou criar conta"}
          >
            <UserRound className="size-4" />
            <span className="max-w-24 truncate">{firstName ?? "Entrar"}</span>
          </Link>
          <ThemeToggle />
        </div>
        <div className="flex items-center gap-4">
          {settings?.logo_url && <StoreLogo settings={settings} size={64} />}
          <div className="min-w-0 flex-1">
            {settings?.logo_url ? (
              <h1 className="truncate text-2xl font-bold tracking-tight" translate="no">
                {settings.name}
              </h1>
            ) : (
              <h1 translate="no">
                {/* transparent in light mode; on dark the black script needs its cream plate */}
                {/* eslint-disable-next-line @next/next/no-img-element -- small static brand image */}
                <img
                  src="/brand/menu-wordmark.png"
                  alt={settings?.name ?? DEFAULT_STORE_NAME}
                  width={556}
                  height={196}
                  className="h-auto w-56 sm:w-64 dark:hidden"
                />
                {/* eslint-disable-next-line @next/next/no-img-element -- small static brand image */}
                <img
                  src="/brand/menu-wordmark-plate.png"
                  alt={settings?.name ?? DEFAULT_STORE_NAME}
                  width={556}
                  height={196}
                  className="hidden h-auto w-56 rounded-lg sm:w-64 dark:block"
                />
              </h1>
            )}
            {settings?.tagline && <p className="mt-1 truncate text-sm text-muted-foreground">{settings.tagline}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-muted-foreground">
              {status.known && (
              <span
                className={
                  isOpen
                    ? "inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2 py-0.5 font-semibold text-success-soft-foreground"
                    : "inline-flex items-center gap-1.5 rounded-full bg-danger-soft px-2 py-0.5 font-semibold text-danger-soft-foreground"
                }
              >
                <span className={isOpen ? "size-1.5 rounded-full bg-success" : "size-1.5 rounded-full bg-danger"} />
                {isOpen ? "Aberto agora" : status.next ? `Fechado · ${status.next}` : "Fechado"}
              </span>
              )}
              {status.hoursText && (
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3.5" />
                  {status.hoursText}
                </span>
              )}
              {settings?.schedule_enabled && (
                <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 font-semibold text-foreground">
                  <CalendarClock className="size-3.5" />
                  Agendamento disponível
                </span>
              )}
            </div>
            {settings?.address && (
              <a
                href={mapsLink(settings.address)}
                target="_blank"
                rel="noreferrer"
                className="mt-1.5 flex max-w-full items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
                title="Abrir no mapa"
              >
                <MapPin className="size-3.5 shrink-0" />
                <span className="truncate">{settings.address}</span>
              </a>
            )}
          </div>
        </div>
        {settings && (
          <div className="grid grid-cols-2 gap-2 text-sm sm:max-w-2xl sm:grid-cols-3">
            <InfoTile
              icon={Bike}
              title="Entrega"
              muted={!settings.delivery_enabled}
              value={settings.delivery_enabled ? (deliveryEta ?? deliveryFee) : "Sem entregas hoje"}
              note={settings.delivery_enabled && deliveryEta ? deliveryFee : undefined}
            />
            {settings.pickup_enabled && (
              <InfoTile icon={Store} title="Retirada" value={pickupEta ?? "Grátis"} note={pickupEta ? "Grátis" : undefined} />
            )}
            <InfoTile
              icon={ShoppingBag}
              title="Pedido mínimo"
              value={settings.min_order > 0 ? formatBRL(settings.min_order) : "Sem mínimo"}
              className={settings.pickup_enabled ? "col-span-2 sm:col-span-1" : undefined}
            />
          </div>
        )}
        {settings?.schedule_enabled && (
          <button
            type="button"
            onClick={() => openReservation(true)}
            data-tour="reservar"
            className="flex w-full items-center justify-center gap-2 rounded-md border border-accent bg-accent-soft px-4 py-2.5 text-sm font-semibold transition-colors hover:brightness-95 sm:w-auto sm:self-start dark:hover:brightness-125"
          >
            <CalendarClock className="size-4" />
            Reservar para outro dia
          </button>
        )}
      </div>
    </header>
  );
}

function InfoTile({
  icon: Icon,
  title,
  value,
  note,
  muted,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  value: string;
  note?: string;
  muted?: boolean;
  className?: string;
}) {
  return (
    // translucent so a header photo still shows through
    <div className={cn("flex items-start gap-2.5 rounded-md bg-surface-2/80 px-3 py-2 backdrop-blur-sm", className)}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", muted ? "text-muted-foreground" : "text-primary-soft-foreground")} />
      <div className="min-w-0 leading-snug">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        <p className={cn("font-semibold tabular-nums", muted && "font-medium text-muted-foreground")}>{value}</p>
        {note && <p className="text-xs text-muted-foreground tabular-nums">{note}</p>}
      </div>
    </div>
  );
}
