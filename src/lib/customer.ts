// Shared by the customer account actions and forms.

export const REFERRAL_SOURCES = ["instagram", "indicacao", "google", "passou_na_frente", "whatsapp", "outro"] as const;
export type ReferralSource = (typeof REFERRAL_SOURCES)[number];

export const REFERRAL_LABEL: Record<ReferralSource, string> = {
  instagram: "Instagram",
  indicacao: "Indicação de alguém",
  google: "Google",
  passou_na_frente: "Passei em frente à loja",
  whatsapp: "WhatsApp",
  outro: "Outro",
};

/** Congratulation sent on WhatsApp; {nome} = first name, {loja} = store name. No emoji, to keep wa.me links portable. */
export const DEFAULT_BIRTHDAY_MESSAGE = "Feliz aniversário, {nome}! A equipe da {loja} deseja um dia incrível pra você.";
export const birthdayMessage = (template: string | null, name: string, store: string) =>
  (template?.trim() || DEFAULT_BIRTHDAY_MESSAGE).replaceAll("{nome}", name.trim().split(" ")[0]).replaceAll("{loja}", store);
