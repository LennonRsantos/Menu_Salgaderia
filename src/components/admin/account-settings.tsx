"use client";

import { Camera, Compass, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { changeMyEmail, changeMyPassword, saveMyAvatar } from "@/actions/auth";
import { uploadImage } from "@/actions/images";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Card } from "@/components/ui/misc";
import { ConfirmDialog } from "@/components/ui/sheet";
import { shrink } from "./image-upload";
import { PageHeader, StaffAvatar, useProfile, useSetProfile, useStartTour } from "./panel-shell";

const OFFLINE = { ok: false as const, error: "Sem conexão. Tente novamente." };

/** Each person's own sign-in e-mail and password. Open to the whole team. */
export function AccountSettings() {
  const profile = useProfile();
  const startTour = useStartTour();
  return (
    <div className="pb-8">
      <PageHeader
        title="Minha conta"
        description="Seu e-mail e sua senha para entrar no painel."
        actions={
          <Button variant="outline" onClick={startTour}>
            <Compass className="size-4" />
            Rever tour
          </Button>
        }
      />
      <div className="max-w-2xl space-y-4 px-4 sm:px-6">
        <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <StaffAvatar profile={profile} size={80} />
            <div className="min-w-0">
              <p className="truncate font-bold">{profile.full_name}</p>
              <p className="truncate text-sm text-muted-foreground">{profile.email}</p>
              <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                {profile.role === "admin" && <ShieldCheck className="size-3.5" />}
                {profile.role === "admin" ? "Gerente" : "Funcionário"}
              </p>
            </div>
          </div>
          <AvatarButtons />
        </Card>
        <EmailCard />
        <PasswordCard />
      </div>
    </div>
  );
}

/** Sends a new photo and saves it at once; "Remover" goes back to the initials. */
function AvatarButtons() {
  const profile = useProfile();
  const setProfile = useSetProfile();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);

  async function save(url: string | null) {
    const result = await saveMyAvatar(url).catch(() => OFFLINE);
    if (!result.ok) return toast.error(result.error);
    setProfile(result.profile);
    toast.success(url ? "Foto atualizada." : "Foto removida.");
  }

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy("upload");
    try {
      let blob: Blob;
      try {
        blob = await shrink(file, 320);
      } catch {
        return toast.error("Não foi possível ler esta imagem. Use uma foto JPG, PNG ou WebP.");
      }
      const form = new FormData();
      form.append("file", blob);
      const uploaded = await uploadImage(form).catch(() => OFFLINE);
      if (!uploaded.ok) return toast.error(uploaded.error);
      await save(uploaded.data.url);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("remove");
    await save(null);
    setBusy(null);
  }

  return (
    <div className="flex gap-2">
      <input ref={fileRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden onChange={pick} />
      <Button variant="outline" size="sm" loading={busy === "upload"} disabled={busy !== null} onClick={() => fileRef.current?.click()}>
        <Camera className="size-4" />
        {profile.avatar_url ? "Trocar foto" : "Pôr foto"}
      </Button>
      {profile.avatar_url && (
        <Button variant="ghost" size="sm" loading={busy === "remove"} disabled={busy !== null} onClick={remove}>
          Remover
        </Button>
      )}
    </div>
  );
}

function EmailCard() {
  const profile = useProfile();
  const setProfile = useSetProfile();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const next = email.trim().toLowerCase();

  function review(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) return setError("Informe um e-mail válido.");
    if (next === profile.email) return setError("Este já é o seu e-mail.");
    if (!password) return setError("Informe a senha atual.");
    setConfirming(true);
  }

  async function save() {
    setSaving(true);
    const result = await changeMyEmail({ email: next, password }).catch(() => OFFLINE);
    setSaving(false);
    setConfirming(false);
    if (!result.ok) return setError(result.error);
    setProfile(result.profile);
    setEmail("");
    setPassword("");
    toast.success("E-mail trocado. Use o novo e-mail para entrar.");
  }

  return (
    <Card className="p-5">
      <form onSubmit={review} noValidate className="space-y-4">
        <div>
          <h2 className="font-bold">E-mail de acesso</h2>
          <p className="text-sm text-muted-foreground">
            Hoje você entra com <strong className="font-semibold break-all text-foreground">{profile.email}</strong>.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Novo e-mail">
            {(p) => (
              <Input
                {...p}
                type="email"
                autoComplete="email"
                spellCheck={false}
                autoCapitalize="off"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError("");
                }}
                placeholder="voce@loja.com"
              />
            )}
          </Field>
          <PasswordField
            label="Senha atual"
            autoComplete="current-password"
            value={password}
            onChange={(v) => {
              setPassword(v);
              setError("");
            }}
          />
        </div>
        {error && (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm font-medium text-danger-soft-foreground">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <Button type="submit" variant="outline" className="w-full sm:w-auto">
            Trocar e-mail
          </Button>
        </div>
      </form>
      <ConfirmDialog
        open={confirming}
        onClose={() => !saving && setConfirming(false)}
        onConfirm={save}
        loading={saving}
        title="Trocar o e-mail de acesso?"
        description={`Você vai entrar com ${next}. Confira se está certo: com o e-mail errado, só o gerente consegue corrigir.`}
        confirmLabel="Trocar e-mail"
      />
    </Card>
  );
}

function PasswordCard() {
  const [form, setForm] = useState({ current: "", next: "", repeat: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof form) => (v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setError("");
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.current) return setError("Informe a senha atual.");
    if (form.next.length < 8) return setError("A nova senha precisa ter ao menos 8 caracteres.");
    if (form.next !== form.repeat) return setError("As duas senhas novas não são iguais.");
    if (form.next === form.current) return setError("A nova senha deve ser diferente da atual.");
    setSaving(true);
    const result = await changeMyPassword({ current: form.current, next: form.next }).catch(() => OFFLINE);
    setSaving(false);
    if (!result.ok) return setError(result.error);
    setForm({ current: "", next: "", repeat: "" });
    toast.success("Senha trocada.");
  }

  return (
    <Card className="p-5">
      <form onSubmit={submit} noValidate className="space-y-4">
        <div>
          <h2 className="font-bold">Senha</h2>
          <p className="text-sm text-muted-foreground">Ao trocar, os outros aparelhos conectados saem da conta. Este continua conectado.</p>
        </div>
        <PasswordField label="Senha atual" autoComplete="current-password" value={form.current} onChange={set("current")} className="sm:max-w-[calc(50%-0.5rem)]" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <PasswordField label="Nova senha" hint="Mínimo de 8 caracteres." autoComplete="new-password" value={form.next} onChange={set("next")} />
          <PasswordField label="Repita a nova senha" autoComplete="new-password" value={form.repeat} onChange={set("repeat")} />
        </div>
        {error && (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm font-medium text-danger-soft-foreground">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <Button type="submit" loading={saving} className="w-full sm:w-auto">
            Trocar senha
          </Button>
        </div>
      </form>
    </Card>
  );
}

function PasswordField({
  label,
  hint,
  autoComplete,
  value,
  onChange,
  className,
}: {
  label: string;
  hint?: string;
  autoComplete: "current-password" | "new-password";
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <Field label={label} hint={hint} className={className}>
      {(p) => (
        <div className="relative">
          <Input {...p} type={show ? "text" : "password"} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} className="pr-11" />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute top-1/2 right-1 grid size-9 -translate-y-1/2 place-items-center rounded-sm text-muted-foreground hover:text-foreground"
            aria-label={show ? "Ocultar senha" : "Mostrar senha"}
          >
            {show ? <EyeOff className="size-4.5" /> : <Eye className="size-4.5" />}
          </button>
        </div>
      )}
    </Field>
  );
}
