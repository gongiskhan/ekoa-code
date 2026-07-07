"use client";

import { useState } from "react";
import { ArrowRight, X, Copy, Check, CheckCircle2, AlertTriangle } from "lucide-react";
import type { DemoSpec, TourState } from "@/lib/demo/types";

interface DemoOverlayProps {
  spec: DemoSpec;
  tour: TourState;
  injectedPrompt: string | null;
  /** API base (cortex origin) for resolving external-image-step assets. */
  apiBase: string;
  onNext: () => void;
  onCancel: () => void;
}

/**
 * The host control card for a running demo tour. It floats over the served-app
 * iframe (the in-app spotlight mask is drawn by the injected bridge), showing
 * the step copy and the advance / exit controls. The root carries
 * data-demo-status + data-demo-step-index so the e2e harness can follow the
 * machine deterministically.
 */
export function DemoOverlay({ spec, tour, injectedPrompt, apiBase, onNext, onCancel }: DemoOverlayProps) {
  const [copied, setCopied] = useState(false);
  const step = tour.step;
  const terminal = tour.status === "done" || tour.status === "error";
  const copy = step && "copy" in step ? step.copy : undefined;

  function stepInstruction(): { title: string; body: string } {
    if (tour.status === "done") {
      return { title: "Demonstração concluída", body: "Percorreu todos os passos. Pode sair e experimentar por si." };
    }
    if (tour.status === "error") {
      return {
        title: "A demonstração foi interrompida",
        body: "Não foi possível concluir este passo. Pode sair e tentar novamente mais tarde.",
      };
    }
    if (copy) return { title: copy.titlePt, body: copy.bodyPt };
    if (step?.type === "await-action") {
      return { title: "A sua vez", body: "Realize a acção destacada na aplicação para continuar." };
    }
    return { title: spec.card.titlePt, body: spec.card.descriptionPt };
  }

  const promptText = injectedPrompt ?? (step?.type === "inject-prompt" ? step.prompt : null);
  const imageSrc =
    step?.type === "external-image-step" ? `${apiBase}/api/demos/assets/${step.image}` : null;

  async function copyPrompt() {
    if (!promptText) return;
    try {
      await navigator.clipboard.writeText(promptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked; the text is still selectable */
    }
  }

  const instruction = stepInstruction();

  return (
    <div
      data-testid="demo-overlay"
      data-demo-status={tour.status}
      data-demo-step-index={tour.stepIndex}
      /* pointer-events-none so a live user (and the e2e harness) can click the
         highlighted app element beneath the card; only the controls below opt
         back in. Without this the card would intercept the very click the demo
         is asking for. */
      className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 w-[min(560px,calc(100%-2rem))]
                 rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 border border-neutral-100 overflow-hidden"
    >
      <div className="flex items-start gap-3 px-5 pt-4 pb-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-teal-50 text-teal-600 flex-shrink-0 mt-0.5">
          {tour.status === "done" ? (
            <CheckCircle2 size={16} />
          ) : tour.status === "error" ? (
            <AlertTriangle size={16} />
          ) : (
            <span className="text-xs font-semibold" data-testid="demo-step-counter">
              {Math.min(tour.stepIndex + 1, tour.totalSteps)}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          {!terminal && (
            <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">
              Passo {Math.min(tour.stepIndex + 1, tour.totalSteps)} de {tour.totalSteps}
            </p>
          )}
          <h3 className="text-sm font-semibold text-neutral-900 mt-0.5">{instruction.title}</h3>
          <p className="text-[13px] leading-relaxed text-neutral-600 mt-1">{instruction.body}</p>

          {promptText && (
            <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">Pergunta sugerida</span>
                <button
                  type="button"
                  onClick={copyPrompt}
                  className="pointer-events-auto inline-flex items-center gap-1 text-[11px] font-medium text-teal-700 hover:text-teal-800"
                  aria-label="Copiar pergunta"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? "Copiado" : "Copiar"}
                </button>
              </div>
              <code data-testid="demo-injected-prompt" className="block text-[13px] text-neutral-800 whitespace-pre-wrap break-words">
                {promptText}
              </code>
            </div>
          )}

          {imageSrc && (
            <div className="mt-3 rounded-lg border border-neutral-200 overflow-hidden bg-neutral-50">
              {/* External demo asset served cross-origin by cortex; not a Next-optimizable image. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                data-testid="demo-external-image"
                src={imageSrc}
                alt={instruction.title}
                className="w-full h-auto block max-h-[42vh] object-contain"
              />
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-neutral-100 bg-neutral-50/60">
        <button
          type="button"
          data-testid="demo-exit"
          onClick={onCancel}
          className="pointer-events-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium text-neutral-600
                     hover:text-neutral-900 hover:bg-neutral-100 transition-colors cursor-pointer"
        >
          <X size={14} />
          {terminal ? "Fechar" : "Sair da demonstração"}
        </button>

        {tour.awaitingManual && tour.status === "running" && (
          <button
            type="button"
            data-testid="demo-next"
            onClick={onNext}
            className="pointer-events-auto inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md text-[13px] font-semibold text-white
                       bg-teal-600 hover:bg-teal-700 transition-colors cursor-pointer"
          >
            Seguinte
            <ArrowRight size={14} />
          </button>
        )}

        {tour.status === "awaiting" && (
          <span className="text-[12px] text-neutral-400" data-testid="demo-awaiting">
            A aguardar a sua acção...
          </span>
        )}
      </div>
    </div>
  );
}
