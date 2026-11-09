"use client";

import { upload } from "@vercel/blob/client";
import { Check, CircleCheck, GraduationCap, Plus, Rocket, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { addTrainingVideo, deleteTrainingVideo, listTrainingVideos, setVideoDone, type TrainingVideo } from "@/actions/training";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Badge, Card, EmptyState, Skeleton } from "@/components/ui/misc";
import { ConfirmDialog, Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/format";
import { canSeeModule, TRAINING_MODULES, VIDEO_MAX_BYTES, VIDEO_PREFIX, VIDEO_TYPES, type TrainingModule } from "@/lib/training";
import { NAV, PageHeader, useProfile } from "./panel-shell";

const OFFLINE = { ok: false as const, error: "Sem conexão. Tente novamente." };

/** Label and icon of each module: the panel menu's, plus "Primeiros passos". */
function moduleInfo(m: TrainingModule) {
  if (m === "geral") return { label: "Primeiros passos", icon: Rocket };
  const item = NAV.find((n) => n.key === m);
  return { label: item?.label ?? m, icon: item?.icon ?? GraduationCap };
}

export function TrainingPage() {
  const { role } = useProfile();
  const isAdmin = role === "admin";
  const [videos, setVideos] = useState<TrainingVideo[] | null>(null);
  const [adding, setAdding] = useState<TrainingModule | null>(null);
  const [toDelete, setToDelete] = useState<TrainingVideo | null>(null);
  const [deleting, startDelete] = useTransition();

  const load = useCallback(async () => {
    const result = await listTrainingVideos().catch(() => OFFLINE);
    if (result.ok) setVideos(result.data);
    else {
      toast.error(result.error);
      setVideos((v) => v ?? []);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load();
  }, [load]);

  async function markDone(v: TrainingVideo, done: boolean) {
    setVideos((list) => list?.map((x) => (x.id === v.id ? { ...x, done } : x)) ?? list);
    const result = await setVideoDone(v.id, done).catch(() => OFFLINE);
    if (!result.ok) {
      toast.error(result.error);
      load();
    } else if (done) toast.success("Vídeo concluído.");
  }

  function confirmDelete() {
    if (!toDelete) return;
    startDelete(async () => {
      const result = await deleteTrainingVideo(toDelete.id).catch(() => OFFLINE);
      if (!result.ok) return void toast.error(result.error);
      toast.success("Vídeo excluído.");
      setToDelete(null);
      load();
    });
  }

  const list = videos ?? [];
  const doneCount = list.filter((v) => v.done).length;
  // Employees see only modules with videos; the manager sees every module, to know where to add.
  const modules = TRAINING_MODULES.filter((m) => canSeeModule(m, role) && (isAdmin || list.some((v) => v.module === m)));

  return (
    <div className="pb-8">
      <PageHeader
        title="Treinamento"
        description={list.length ? `Você concluiu ${doneCount} de ${list.length} ${list.length === 1 ? "vídeo" : "vídeos"}.` : "Vídeos que ensinam a usar o painel, por módulo."}
        actions={
          isAdmin ? (
            <Button onClick={() => setAdding("geral")}>
              <Plus className="size-4" />
              Adicionar vídeo
            </Button>
          ) : undefined
        }
      />
      <div className="space-y-8 px-4 sm:px-6">
        {!videos ? (
          <Skeleton className="h-64" />
        ) : modules.length === 0 ? (
          <EmptyState icon={GraduationCap} title="Nenhum vídeo ainda" description="O gerente ainda não enviou vídeos." />
        ) : (
          modules.map((m) => {
            const { label, icon: Icon } = moduleInfo(m);
            const items = list.filter((v) => v.module === m);
            const done = items.filter((v) => v.done).length;
            return (
              <section key={m} aria-labelledby={`modulo-${m}`} className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-soft text-primary-soft-foreground">
                    <Icon className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 id={`modulo-${m}`} className="font-bold">
                      {label}
                    </h2>
                    {items.length > 0 && (
                      <div className="flex items-center gap-2">
                        <progress value={done} max={items.length} className="h-1.5 w-28 accent-primary" aria-label={`Progresso em ${label}`} />
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {done} de {items.length} {items.length === 1 ? "concluído" : "concluídos"}
                        </span>
                      </div>
                    )}
                  </div>
                  {isAdmin && (
                    <Button variant="ghost" size="icon" onClick={() => setAdding(m)} aria-label={`Adicionar vídeo em ${label}`}>
                      <Plus className="size-4" />
                    </Button>
                  )}
                </div>
                {items.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">Nenhum vídeo neste módulo.</p>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {items.map((v) => (
                      <VideoCard key={v.id} video={v} isAdmin={isAdmin} onDone={(d) => markDone(v, d)} onDelete={() => setToDelete(v)} />
                    ))}
                  </div>
                )}
              </section>
            );
          })
        )}
      </div>

      {isAdmin && (
        <>
          <Sheet open={adding !== null} onClose={() => setAdding(null)} side="right" title="Adicionar vídeo" description="MP4, WebM ou MOV, até 500 MB.">
            {adding !== null && (
              <VideoForm
                initialModule={adding}
                onDone={() => {
                  setAdding(null);
                  load();
                }}
              />
            )}
          </Sheet>
          <ConfirmDialog
            open={Boolean(toDelete)}
            onClose={() => setToDelete(null)}
            onConfirm={confirmDelete}
            loading={deleting}
            title={`Excluir "${toDelete?.title}"?`}
            description="O vídeo sai do treinamento e o arquivo é apagado."
            confirmLabel="Excluir vídeo"
          />
        </>
      )}
    </div>
  );
}

function VideoCard({ video: v, isAdmin, onDone, onDelete }: { video: TrainingVideo; isAdmin: boolean; onDone: (done: boolean) => void; onDelete: () => void }) {
  return (
    <Card className={cn("flex flex-col overflow-hidden", v.done && "border-success/40")}>
      <video
        src={v.video_url}
        controls
        preload="metadata"
        playsInline
        onEnded={() => !v.done && onDone(true)}
        className="aspect-video w-full bg-black"
      />
      <div className="flex flex-1 flex-col gap-3 px-4 py-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="flex flex-wrap items-center gap-2 font-semibold">
              {v.title}
              {v.done && (
                <Badge tone="success">
                  <Check className="size-3" />
                  Concluído
                </Badge>
              )}
            </h3>
            {v.description && <p className="text-sm whitespace-pre-line text-muted-foreground">{v.description}</p>}
          </div>
          {isAdmin && (
            <Button variant="ghost" size="icon" className="-mr-2 shrink-0" onClick={onDelete} aria-label={`Excluir ${v.title}`}>
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
        <Button variant={v.done ? "ghost" : "outline"} className="mt-auto self-start" onClick={() => onDone(!v.done)} aria-pressed={v.done}>
          <CircleCheck className="size-4" />
          {v.done ? "Desmarcar concluído" : "Marcar como concluído"}
        </Button>
      </div>
    </Card>
  );
}

/** "Tela de Pedidos.MP4" -> "treinamento/tela-de-pedidos.mp4" */
function blobPath(name: string) {
  const dot = name.lastIndexOf(".");
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${VIDEO_PREFIX}${base || "video"}${dot > 0 ? name.slice(dot).toLowerCase() : ""}`;
}

function VideoForm({ initialModule, onDone }: { initialModule: TrainingModule; onDone: () => void }) {
  const [module, setModule] = useState<TrainingModule>(initialModule);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);

  // Closing the sheet mid-upload cancels it.
  useEffect(() => () => abort.current?.abort(), []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return void toast.error("Dê um título ao vídeo.");
    if (!file) return void toast.error("Escolha o arquivo do vídeo.");
    if (!VIDEO_TYPES.includes(file.type)) return void toast.error("Formato não suportado. Use MP4, WebM ou MOV.");
    if (file.size > VIDEO_MAX_BYTES) return void toast.error("Vídeo grande demais. O limite é 500 MB.");

    abort.current = new AbortController();
    setProgress(0);
    try {
      const blob = await upload(blobPath(file.name), file, {
        access: "public",
        handleUploadUrl: "/api/training/upload",
        multipart: true,
        abortSignal: abort.current.signal,
        onUploadProgress: (p) => setProgress(p.percentage),
      });
      const result = await addTrainingVideo({ module, title, description, video_url: blob.url }).catch(() => OFFLINE);
      if (!result.ok) throw new Error(result.error);
      toast.success("Vídeo adicionado.");
      onDone();
    } catch (err) {
      if (abort.current?.signal.aborted) return;
      toast.error(err instanceof Error ? err.message : "Não foi possível enviar o vídeo.");
      setProgress(null);
    }
  }

  const sending = progress !== null;

  return (
    <form onSubmit={submit} noValidate className="space-y-4 px-5 py-5">
      <Field label="Módulo">
        {(p) => (
          <Select {...p} value={module} onChange={(e) => setModule(e.target.value as TrainingModule)} disabled={sending}>
            {TRAINING_MODULES.map((m) => (
              <option key={m} value={m}>
                {moduleInfo(m).label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Título">{(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} disabled={sending} placeholder="Como aceitar um pedido" />}</Field>
      <Field label="Descrição" optional>
        {(p) => <Textarea {...p} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} disabled={sending} placeholder="O que o vídeo mostra." />}
      </Field>
      <Field label="Arquivo do vídeo" hint="Grave a tela do celular ou do computador mostrando a tarefa.">
        {(p) => <Input {...p} type="file" accept={VIDEO_TYPES.join(",")} disabled={sending} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="py-2" />}
      </Field>
      {sending && (
        <div className="space-y-1">
          <progress value={progress} max={100} className="h-2 w-full accent-primary" aria-label="Envio do vídeo" />
          <p className="text-xs text-muted-foreground tabular-nums">Enviando… {Math.round(progress)}%. Não feche esta janela.</p>
        </div>
      )}
      <div className="flex justify-end pt-2">
        <Button type="submit" loading={sending}>
          Enviar vídeo
        </Button>
      </div>
    </form>
  );
}
