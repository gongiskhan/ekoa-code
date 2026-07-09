"use client";

import { useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import { useMemoryStore } from "@/stores/memory";
import { useTranslation } from "@/stores/i18n";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button, IconButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function GuardrailsSection() {
  const { pages_memory: t } = useTranslation();
  const g = t.guardrails;

  const memories = useMemoryStore((s) => s.memories);
  const createMemory = useMemoryStore((s) => s.createMemory);
  const deleteMemory = useMemoryStore((s) => s.deleteMemory);
  const fetchMemories = useMemoryStore((s) => s.fetchMemories);

  const [text, setText] = useState("");

  const guardrails = memories.filter(
    (m: any) =>
      m.tier === "core" &&
      m.type === "preference" &&
      Array.isArray(m.tags) &&
      m.tags.includes("guardrail")
  );

  async function handleAdd() {
    const trimmed = text.trim();
    if (!trimmed) return;

    await createMemory({
      type: "preference",
      content: trimmed,
      title: trimmed.substring(0, 80),
      tier: "core",
      tags: ["guardrail"],
      verified: true,
      score: 100,
      scope: "company",
      // The shared Visibility enum is private | org. "shared" was never a legal value, so every
      // "Adicionar guardrail" click 400'd with VALIDATION_FAILED — the only UI create path was dead.
      visibility: "org",
      source: "manual",
      origin: "manual",
    });
    setText("");
    await fetchMemories();
  }

  async function handleDelete(id: string) {
    await deleteMemory(id);
    await fetchMemories();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <ShieldCheck size={20} className="text-teal-600" />
        <div>
          <h3 className="text-sm font-semibold text-neutral-800">{g.title}</h3>
          <p className="mt-0.5 text-xs text-neutral-500">{g.subtitle}</p>
        </div>
      </div>

      {/* Input row */}
      <div className="flex gap-2">
        <Input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={g.addPlaceholder}
          wrapperClassName="flex-1"
        />
        <Button variant="primary" onClick={handleAdd} disabled={!text.trim()}>
          {g.add}
        </Button>
      </div>

      {/* Guardrails list */}
      {guardrails.length > 0 ? (
        <div className="space-y-2">
          {guardrails.map((item: any) => (
            <Card
              key={item.id}
              padding="none"
              className="group flex items-center justify-between px-4 py-3"
            >
              <p className="mr-3 min-w-0 flex-1 text-sm text-neutral-700">
                {item.content}
              </p>
              <IconButton
                icon={X}
                label={t.actions.delete}
                size="sm"
                onClick={() => handleDelete(item.id)}
                className="shrink-0 text-neutral-400 opacity-0 hover:text-red-500 group-hover:opacity-100"
              />
            </Card>
          ))}
        </div>
      ) : (
        /* Empty state */
        <Card>
          <EmptyState icon={ShieldCheck} title={g.empty} description={g.emptyDesc} className="py-6" />
        </Card>
      )}
    </div>
  );
}
