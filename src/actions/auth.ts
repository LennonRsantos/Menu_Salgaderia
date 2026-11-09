"use server";

import { z } from "zod";
import { authErrorMessage, findStaff, requireStaff, setLoginEmail } from "@/lib/auth";
import { query } from "@/lib/db";
import { neonAuth } from "@/lib/neon-auth";
import { IMAGE_PATH } from "@/lib/images";
import { pinsError } from "@/lib/nav";
import { tooManyRequests } from "@/lib/rate-limit";
import type { Profile } from "@/types";

export type SignInResult = { ok: true } | { ok: false; error: string };

export async function signInStaff(email: string, password: string): Promise<SignInResult> {
  try {
    const { data, error } = await neonAuth().signIn.email({ email: String(email).trim().toLowerCase(), password: String(password) });
    if (error || !data?.user) {
      // the SDK normalizes Better Auth errors to lowercase codes (invalid_credentials…)
      const code = error?.code ?? "";
      const message = (error?.message ?? "").toLowerCase();
      return {
        ok: false,
        error:
          code === "invalid_credentials" || error?.status === 401
            ? "E-mail ou senha incorretos."
            : message.includes("banned")
              ? "Esta conta está desativada. Fale com o gerente."
              : code === "over_request_rate_limit" || error?.status === 429
                ? "Muitas tentativas. Aguarde alguns minutos."
                : code.startsWith("NETWORK_")
                  ? "Serviço de login indisponível. Confira NEON_AUTH_BASE_URL no .env.local."
                  : "Não foi possível entrar. Tente novamente.",
      };
    }
    const profile = await findStaff(data.user.id);
    if (!profile?.active) {
      await neonAuth().signOut();
      return { ok: false, error: "Sua conta não tem acesso ao painel." };
    }
    return { ok: true };
  } catch (e) {
    console.error("signInStaff failed", e);
    return { ok: false, error: "Não foi possível entrar. Tente novamente." };
  }
}

export async function signOutStaff() {
  await neonAuth()
    .signOut()
    .catch(() => {});
}

/** The signed-in staff profile, or null when signed out or without access. */
export async function getMyProfile(): Promise<{ profile: Profile | null; error?: string }> {
  try {
    return { profile: await requireStaff() };
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    // a missing session or staff row is a normal "no access"; anything else is a connection problem
    if (message.startsWith("Sessão") || message.startsWith("Sua conta")) return { profile: null };
    console.error("getMyProfile failed", e);
    return { profile: null, error: "Não foi possível conectar ao banco de dados. Verifique a internet e o .env.local." };
  }
}

/** Saves the signed-in person's pinned pages; null goes back to the defaults. Only their own row. */
export async function saveNavPins(keys: string[] | null): Promise<SignInResult> {
  try {
    const profile = await requireStaff();
    const pins = keys === null ? null : (Array.isArray(keys) ? keys : []).map(String);
    const error = pins && pinsError(pins, profile.role);
    if (error) return { ok: false, error };
    await query("update staff set nav_pins = $2 where user_id = $1", [profile.id, pins]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Não foi possível salvar os atalhos." };
  }
}

/** Marks the first-access tour as seen for the signed-in person, so it does not open again on any device. */
export async function markTourDone(): Promise<SignInResult> {
  try {
    const profile = await requireStaff();
    await query("update staff set tour_done_at = now() where user_id = $1", [profile.id]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Não foi possível salvar o tour." };
  }
}

const MIN_PASSWORD = 8;

/** The signed-in person changes their own password; other devices are signed out. */
export async function changeMyPassword(input: { current: string; next: string }): Promise<SignInResult> {
  try {
    await requireStaff();
    const current = String(input?.current ?? "");
    const next = String(input?.next ?? "");
    if (!current) return { ok: false, error: "Informe a senha atual." };
    if (next.length < MIN_PASSWORD) return { ok: false, error: `A nova senha precisa ter ao menos ${MIN_PASSWORD} caracteres.` };
    if (next === current) return { ok: false, error: "A nova senha deve ser diferente da atual." };
    const { error } = await neonAuth().changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true });
    if (error) return { ok: false, error: authErrorMessage(error) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Não foi possível trocar a senha." };
  }
}

const emailSchema = z.email("E-mail inválido.").trim().toLowerCase();

/** The signed-in person changes their own sign-in e-mail, after confirming the password. */
export async function changeMyEmail(input: { email: string; password: string }): Promise<{ ok: true; profile: Profile } | { ok: false; error: string }> {
  try {
    const me = await requireStaff();
    const parsed = emailSchema.safeParse(String(input?.email ?? ""));
    if (!parsed.success) return { ok: false, error: "E-mail inválido." };
    const email = parsed.data;
    const password = String(input?.password ?? "");
    if (email === me.email) return { ok: false, error: "Este já é o seu e-mail." };
    if (!password) return { ok: false, error: "Informe a senha atual." };
    if (await tooManyRequests("email-change", 5, 15)) return { ok: false, error: "Muitas tentativas. Aguarde alguns minutos." };
    // Neon Auth has no password check on its own; changing it to itself confirms it without changing anything
    const { error } = await neonAuth().changePassword({ currentPassword: password, newPassword: password, revokeOtherSessions: false });
    if (error) return { ok: false, error: authErrorMessage(error) };
    await setLoginEmail(me.id, email);
    return { ok: true, profile: { ...me, email } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Não foi possível trocar o e-mail." };
  }
}

/** The signed-in person's profile photo: a photo sent with uploadImage, or null for the initials. */
export async function saveMyAvatar(url: string | null): Promise<{ ok: true; profile: Profile } | { ok: false; error: string }> {
  try {
    const me = await requireStaff();
    const avatar = url === null ? null : String(url);
    if (avatar !== null && !IMAGE_PATH.test(avatar)) return { ok: false, error: "Envie uma foto pelo botão." };
    await query("update staff set avatar_url = $2 where user_id = $1", [me.id, avatar]);
    return { ok: true, profile: { ...me, avatar_url: avatar } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Não foi possível salvar a foto." };
  }
}
