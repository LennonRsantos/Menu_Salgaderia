"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./button";

export type TourStep = {
  /** `data-tour` value of the element to highlight; none = a centered card. */
  target?: string;
  /** Highlighted instead when the target is hidden (e.g. a page behind "Mais"). */
  fallback?: string;
  /** Added to the text when the fallback is the one highlighted. */
  fallbackHint?: string;
  title: string;
  body: string;
};

const GAP = 12;
const PAD = 6;

// The panel renders the same page in the sidebar, the rail and the phone bar: take the one on screen.
function findVisible(key?: string) {
  if (!key) return null;
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${key}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

/** Spotlight walkthrough: dims the page, rings one element per step and explains it in a card. */
export function Tour({ steps, onDone }: { steps: TourStep[]; onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [onFallback, setOnFallback] = useState(false);
  const [cardHeight, setCardHeight] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const step = steps[index];
  const last = index === steps.length - 1;

  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  // keyed on strings, not the step object: parents rebuild the steps on every render
  const target = step?.target;
  const fallback = step?.fallback;
  useLayoutEffect(() => {
    const own = findVisible(target);
    const el = own ?? findVisible(fallback);
    el?.scrollIntoView({ block: "center", inline: "nearest" });
    // measuring the DOM is what this effect is for
    const measure = () => {
      setRect(el ? el.getBoundingClientRect() : null);
      setOnFallback(!own && Boolean(el));
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [index, target, fallback]);

  useLayoutEffect(() => {
    setCardHeight(cardRef.current?.offsetHeight ?? 0);
    cardRef.current?.focus({ preventScroll: true });
  }, [index]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onDoneRef.current();
      }
      // keep Tab inside the card: the page behind is dimmed
      if (e.key === "Tab" && cardRef.current) {
        const items = Array.from(cardRef.current.querySelectorAll<HTMLElement>("button:not([disabled])"));
        if (items.length === 0) return;
        const first = items[0];
        const lastItem = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === cardRef.current)) {
          e.preventDefault();
          lastItem.focus();
        } else if (!e.shiftKey && document.activeElement === lastItem) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, []);

  if (!step) return null;

  // below the target when it fits, otherwise above; centered when there is no target
  let cardStyle: React.CSSProperties;
  if (rect) {
    const below = rect.bottom + PAD + GAP;
    const fitsBelow = below + cardHeight <= window.innerHeight - GAP;
    const top = fitsBelow ? below : Math.max(GAP, rect.top - PAD - GAP - cardHeight);
    const width = Math.min(352, window.innerWidth - 32);
    const left = Math.min(Math.max(16, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 16);
    cardStyle = { top, left, width };
  } else {
    cardStyle = { top: "50%", left: "50%", width: "min(22rem, calc(100vw - 32px))", transform: "translate(-50%, -50%)" };
  }

  return createPortal(
    <div className="fixed inset-0 z-[60]">
      {/* blocks clicks on the page; the ring's shadow does the dimming */}
      <div className="absolute inset-0" style={rect ? undefined : { background: "rgb(0 0 0 / 0.6)" }} aria-hidden />
      {rect && (
        <div
          className="pointer-events-none absolute rounded-lg ring-2 ring-primary transition-all duration-200"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.6)",
          }}
          aria-hidden
        />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="absolute animate-fade-in rounded-xl border border-border bg-surface p-4 shadow-md outline-none"
        style={cardStyle}
      >
        <p className="text-xs font-semibold text-muted-foreground tabular-nums" aria-live="polite">
          {index + 1} de {steps.length}
        </p>
        <h2 id={titleId} className="mt-0.5 text-base font-bold">
          {step.title}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{step.body}
          {onFallback && step.fallbackHint ? ` ${step.fallbackHint}` : ""}
        </p>
        <div className="mt-4 flex items-center gap-2">
          {!last && (
            <button type="button" onClick={onDone} className="mr-auto text-sm font-semibold text-muted-foreground hover:underline">
              Pular
            </button>
          )}
          {index > 0 && (
            <Button variant="outline" size="sm" onClick={() => setIndex(index - 1)} className={last ? "mr-auto" : undefined}>
              Voltar
            </Button>
          )}
          <Button size="sm" onClick={() => (last ? onDone() : setIndex(index + 1))} className={index === 0 && last ? "ml-auto" : undefined}>
            {last ? "Concluir" : "Próximo"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
