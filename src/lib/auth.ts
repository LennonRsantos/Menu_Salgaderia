import "server-only";
import type { DashboardLayout, Profile } from "@/types";
import { iso, query, transaction } from "./db";
import { neonAuth } from "./neon-auth";

type StaffRow = {
  user_id: string;
  full_name: string;
  email: string;
  role: Profile["role"];
  active: boolean;
  created_at: Date;
  nav_pins?: string[] | null;
  avatar_url?: string | null;
  tour_done_at?: Date | null;
  dashboard_layout?: DashboardLayout | null;
};

export function profileFromRow(r: StaffRow): Profile {
  return {
    id: r.user_id,
    full_name: r.full_name,
    email: r.email,
    role: r.role,
    active: r.active,
    created_at: iso(r.created_at) ?? "",
    nav_pins: r.nav_pins ?? null,
    avatar_url: r.avatar_url ?? null,
    tour_done_at: iso(r.tour_done_at ?? null),
    dashboard_layout: r.dashboard_layout ?? null,
  };
}

export async function findStaff(userId: string) {
  const [row] = await query<StaffRow>("select * from staff where user_id = $1", [userId]);
  return row ? profileFromRow(row) : null;
}

/**
 * Data access layer for server actions and route handlers: reads the Neon Auth
 * session cookie, then re-reads the staff row on every call, so a deactivated
 * or demoted account loses access immediately.
 */
export async function requireStaff(): Promise<Profile> {
  const { data: session } = await neonAuth().getSession();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Sessão expirada. Entre novamente.");
  const profile = await findStaff(userId);
  if (!profile?.active) throw new Error("Sua conta não tem acesso ao painel.");
  return profile;
}

export async function requireAdmin() {
  const profile = await requireStaff();
  if (profile.role !== "admin") throw new Error("Apenas o gerente pode fazer isso.");
  return profile;
}

export type AuthError = { code?: string; message?: string; status?: number } | null | undefined;

/**
 * Message for a Neon Auth error. Codes come either normalized (user_already_exists)
 * or raw from Better Auth (USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL), so match loosely.
 */
export function authErrorMessage(error: AuthError): string {
  const code = (error?.code ?? "").toLowerCase();
  const message = (error?.message ?? "").toLowerCase();
  if (code.includes("already_exists") || code === "email_exists" || message.includes("already exists")) return "Já existe uma conta com este e-mail.";
  if (code === "weak_password" || code.includes("password_too_short")) return "A senha precisa ter ao menos 8 caracteres.";
  if (code.includes("invalid_password") || code === "invalid_credentials" || message.includes("invalid password")) return "Senha atual incorreta.";
  if (code === "over_request_rate_limit" || error?.status === 429) return "Muitas tentativas. Aguarde alguns minutos.";
  return error?.message || "Erro no serviço de login.";
}

/**
 * Changes the sign-in e-mail. Neon Auth has no server call for it, so the
 * managed `neon_auth.user` row is updated directly, together with `staff`.
 * Sign-in looks the user up by e-mail and the password by user id, so the
 * password keeps working.
 */
export async function setLoginEmail(userId: string, email: string) {
  try {
    await transaction(async (client) => {
      const { rowCount } = await client.query(`update neon_auth."user" set email = $2, "updatedAt" = now() where id = $1`, [userId, email]);
      if (!rowCount) throw new Error("Conta não encontrada.");
      await client.query("update staff set email = $2 where user_id = $1", [userId, email]);
    });
  } catch (e) {
    if ((e as { code?: string })?.code === "23505") throw new Error("Já existe uma conta com este e-mail.");
    throw e;
  }
}
