"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { query, transaction } from "@/lib/db";
import { cleanHours } from "@/lib/hours";
import { cleanImageUrl } from "@/lib/menu-admin";
import { SETTINGS_COLUMNS, SETTINGS_TAG, settingsFromRow, SPECIAL_DATES_SQL, ZONES_SQL } from "@/lib/menu";
import { FESTIVE_MODES, PALETTE_IDS } from "@/lib/themes";
import type { DeliveryZone, StoreSettings } from "@/types";

export type SettingsResult = { ok: true; settings: StoreSettings | null } | { ok: false; error: string };

/** What the settings form sends: zones without ids (they are replaced as a whole). */
export type SettingsInput = Omit<StoreSettings, "id" | "zones"> & { zones: { name: string; fee: number }[] };

const message = (e: unknown) =>
  e instanceof z.ZodError ? (e.issues[0]?.message ?? "Dados inválidos.") : e instanceof Error ? e.message : "Erro inesperado.";

export async function getSettingsAdmin(): Promise<SettingsResult> {
  try {
    await requireAdmin();
    const [[row], zones, dates] = await Promise.all([
      query(`select ${SETTINGS_COLUMNS} from store_settings where id = 1`),
      query<DeliveryZone>(ZONES_SQL),
      query<StoreSettings["special_dates"][number]>(SPECIAL_DATES_SQL),
    ]);
    return { ok: true, settings: row ? settingsFromRow(row, zones, dates) : null };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

const money = z.number({ error: "Valor inválido." }).min(0, "Valor inválido.").max(100000);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => v || null);

const minutes = z.number().int().min(0, "Tempo inválido.").max(600, "Tempo máximo: 600 minutos.").nullable();

const settingsSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome da loja.").max(80),
  tagline: optionalText(140),
  phone: optionalText(20),
  logo_url: z.string().nullable(),
  delivery_fee: money,
  min_order: money,
  is_open: z.boolean(),
  opening_hours: optionalText(140),
  auto_hours: z.boolean(),
  hours: z.array(z.unknown()).max(14),
  other_zones: z.boolean(),
  schedule_enabled: z.boolean(),
  schedule_min_hours: z.number().int().min(0, "Antecedência inválida.").max(720, "Antecedência máxima: 720 horas."),
  schedule_max_days: z.number().int().min(1, "Informe ao menos 1 dia.").max(180, "Limite máximo: 180 dias."),
  schedule_view_days: z.number().int().min(1, "Encomendas: informe ao menos 1 dia.").max(180, "Encomendas: limite máximo de 180 dias."),
  zones: z
    .array(z.object({ name: z.string().trim().min(1, "Informe o nome de cada bairro.").max(80), fee: money }))
    .max(200),
  address: optionalText(200),
  delivery_enabled: z.boolean(),
  pickup_enabled: z.boolean(),
  delivery_min: minutes,
  delivery_max: minutes,
  pickup_min: minutes,
  pickup_max: minutes,
  slot_capacity: z.number().int().min(1, "O limite por horário deve ser ao menos 1.").max(500).nullable(),
  special_dates: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data especial inválida."),
        title: z.string().trim().min(1, "Dê um nome a cada data especial.").max(40),
      }),
    )
    .max(100),
  theme_palette: z.enum(PALETTE_IDS, { error: "Cor inválida." }),
  festive_mode: z.enum(FESTIVE_MODES, { error: "Tema festivo inválido." }),
  festive_message: optionalText(80),
  festive_effects: z.boolean(),
  header_image_url: z.string().nullable(),
  address_zip: z.string().regex(/^\d{8}$/, "CEP inválido.").nullable(),
  birthday_alert: z.boolean(),
  birthday_days_before: z.number().int().min(0, "Dias inválidos.").max(30, "Avise no máximo 30 dias antes."),
  birthday_message: optionalText(300),
  sale_units: z
    .array(z.string().trim().min(1, "Dê um nome a cada unidade.").max(30, "Unidade: até 30 caracteres."))
    .max(20, "Máximo de 20 unidades.")
    .transform((list) => [...new Map(list.map((u) => [u.toLocaleLowerCase("pt-BR"), u])).values()]),
});

export async function saveSettings(input: SettingsInput): Promise<SettingsResult> {
  try {
    await requireAdmin();
    const s = settingsSchema.parse(input);
    const hours = cleanHours(s.hours);
    if (s.auto_hours && hours.length === 0) throw new Error("Cadastre ao menos um dia de funcionamento para o modo automático.");
    if (!s.delivery_enabled && !s.pickup_enabled) throw new Error("Ative a entrega ou a retirada.");
    for (const [min, max, what] of [
      [s.delivery_min, s.delivery_max, "entrega"],
      [s.pickup_min, s.pickup_max, "retirada"],
    ] as const) {
      if (min !== null && max !== null && max < min) throw new Error(`No tempo de ${what}, o máximo deve ser maior que o mínimo.`);
    }

    const settings = await transaction(async (db) => {
      const { rows } = await db.query(
        `insert into store_settings (id, name, tagline, phone, logo_url, delivery_fee, min_order, is_open, opening_hours,
           auto_hours, hours, other_zones, schedule_enabled, schedule_min_hours, schedule_max_days,
           address, delivery_enabled, pickup_enabled, delivery_min, delivery_max, pickup_min, pickup_max, slot_capacity,
           theme_palette, festive_mode, festive_message, festive_effects, header_image_url, address_zip,
           birthday_alert, birthday_days_before, birthday_message, schedule_view_days, sale_units, updated_at)
         values (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22,
           $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, now())
         on conflict (id) do update set name = excluded.name, tagline = excluded.tagline, phone = excluded.phone,
           logo_url = excluded.logo_url, delivery_fee = excluded.delivery_fee, min_order = excluded.min_order,
           is_open = excluded.is_open, opening_hours = excluded.opening_hours, auto_hours = excluded.auto_hours,
           hours = excluded.hours, other_zones = excluded.other_zones, schedule_enabled = excluded.schedule_enabled,
           schedule_min_hours = excluded.schedule_min_hours, schedule_max_days = excluded.schedule_max_days,
           address = excluded.address, delivery_enabled = excluded.delivery_enabled, pickup_enabled = excluded.pickup_enabled,
           delivery_min = excluded.delivery_min, delivery_max = excluded.delivery_max,
           pickup_min = excluded.pickup_min, pickup_max = excluded.pickup_max, slot_capacity = excluded.slot_capacity,
           theme_palette = excluded.theme_palette, festive_mode = excluded.festive_mode,
           festive_message = excluded.festive_message, festive_effects = excluded.festive_effects,
           header_image_url = excluded.header_image_url, address_zip = excluded.address_zip,
           birthday_alert = excluded.birthday_alert, birthday_days_before = excluded.birthday_days_before,
           birthday_message = excluded.birthday_message, schedule_view_days = excluded.schedule_view_days,
           sale_units = excluded.sale_units, updated_at = now()
         returning ${SETTINGS_COLUMNS}`,
        [
          s.name,
          s.tagline,
          s.phone,
          cleanImageUrl(s.logo_url),
          s.delivery_fee,
          s.min_order,
          s.is_open,
          s.opening_hours,
          s.auto_hours,
          JSON.stringify(hours),
          s.other_zones,
          s.schedule_enabled,
          s.schedule_min_hours,
          s.schedule_max_days,
          s.address,
          s.delivery_enabled,
          s.pickup_enabled,
          s.delivery_min,
          s.delivery_max,
          s.pickup_min,
          s.pickup_max,
          s.slot_capacity,
          s.theme_palette,
          s.festive_mode,
          s.festive_message,
          s.festive_effects,
          cleanImageUrl(s.header_image_url),
          s.address_zip,
          s.birthday_alert,
          s.birthday_days_before,
          s.birthday_message,
          s.schedule_view_days,
          s.sale_units,
        ],
      );

      // zones are replaced as a whole; duplicate names keep the last fee
      const zones = new Map(s.zones.map((z) => [z.name.toLocaleLowerCase("pt-BR"), z]));
      const list = [...zones.values()];
      await db.query("delete from delivery_zones");
      await db.query(
        `insert into delivery_zones (name, fee, position)
         select z.name, z.fee, z.n from unnest($1::text[], $2::numeric[]) with ordinality as z(name, fee, n)`,
        [list.map((z) => z.name), list.map((z) => z.fee)],
      );
      await db.query("delete from special_dates");
      await db.query(
        "insert into special_dates (date, title) select d.date, d.title from unnest($1::date[], $2::text[]) as d(date, title)",
        [s.special_dates.map((d) => d.date), s.special_dates.map((d) => d.title)],
      );
      const saved = (await db.query<DeliveryZone>(ZONES_SQL)).rows;
      const dates = (await db.query<StoreSettings["special_dates"][number]>(SPECIAL_DATES_SQL)).rows;
      return settingsFromRow(rows[0], saved, dates);
    });

    updateTag(SETTINGS_TAG);
    return { ok: true, settings };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}
