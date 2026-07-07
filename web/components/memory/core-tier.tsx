"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  Star,
  X,
  Plus,
  AlertTriangle,
  Brain,
  Lock,
  Globe,
  CheckCircle2,
} from "lucide-react";
import { useMemoryStore } from "@/stores/memory";
import { useTranslation } from "@/stores/i18n";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

const MAX_CORE_SLOTS = 5;

const TYPE_TONE: Record<string, "info" | "brand" | "success" | "warning" | "neutral"> = {
  lesson: "info",
  workflow: "brand",
  fact: "success",
  preference: "warning",
  context: "info",
  pattern: "brand",
};

const cardVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.05, duration: 0.25, ease: "easeOut" as const },
  }),
  exit: { opacity: 0, scale: 0.95, transition: { duration: 0.15 } },
};

export function CoreTier() {
  const { pages_memory: t } = useTranslation();
  const memories = useMemoryStore((s) => s.memories);
  const updateMemoryTier = useMemoryStore((s) => s.updateMemoryTier);

  const coreMemories = memories.filter((m: any) => m.tier === "core");
  const activeMemories = memories.filter(
    (m: any) => m.tier === "active" || (!m.tier && m.tier !== "archive")
  );
  const slotsUsed = coreMemories.length;
  const isFull = slotsUsed >= MAX_CORE_SLOTS;
  const progressPercent = Math.min((slotsUsed / MAX_CORE_SLOTS) * 100, 100);

  const typeLabels = t.types as Record<string, string>;

  async function handleRemoveFromCore(id: string) {
    await updateMemoryTier(id, "active");
  }

  async function handlePromoteToCore(id: string) {
    if (isFull) return;
    await updateMemoryTier(id, "core");
  }

  return (
    <div className="space-y-6">
      {/* Slot indicator */}
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Star size={16} className="text-teal-600" />
            <span className="text-sm font-semibold text-neutral-800">
              {t.tabs.alwaysActive}
            </span>
          </div>
          <span className="text-sm text-neutral-500">
            {slotsUsed} / {MAX_CORE_SLOTS} {t.coreTier.slotsUsed}
          </span>
        </div>

        {/* Progress bar */}
        <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-100">
          <motion.div
            className={`h-full rounded-full ${
              isFull ? "bg-amber-500" : "bg-teal-500"
            }`}
            initial={{ width: 0 }}
            animate={{ width: `${progressPercent}%` }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          />
        </div>

        {isFull && (
          <div className="mt-3 flex items-center space-x-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
            <AlertTriangle size={14} className="shrink-0 text-amber-600" />
            <div>
              <p className="text-xs font-medium text-amber-700">
                {t.coreTier.full}
              </p>
              <p className="text-[11px] text-amber-600">
                {t.coreTier.fullDesc}
              </p>
            </div>
          </div>
        )}
      </Card>

      {/* Core memories list */}
      {coreMemories.length > 0 && (
        <div className="space-y-2">
          <AnimatePresence mode="popLayout">
            {coreMemories.map((memory: any, i: number) => (
              <motion.div
                key={memory.id}
                layout
                custom={i}
                variants={cardVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <Card className="group border-teal-200">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <Star size={13} className="shrink-0 text-teal-500" />
                        <span className="truncate text-sm font-semibold text-neutral-800">
                          {memory.title}
                        </span>
                        {memory.metadata?.verified && (
                          <CheckCircle2
                            size={13}
                            className="shrink-0 text-teal-500"
                          />
                        )}
                      </div>
                      <div className="mb-2 flex items-center gap-1.5">
                        <Badge tone={TYPE_TONE[memory.type] || "neutral"} className="text-xs">
                          {typeLabels[memory.type] || memory.type}
                        </Badge>
                        {memory.visibility === "private" ? (
                          <Lock size={12} className="text-neutral-400" />
                        ) : (
                          <Globe size={12} className="text-teal-500" />
                        )}
                      </div>
                      <p className="line-clamp-2 text-xs text-neutral-500">
                        {memory.content}
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={X}
                      onClick={() => handleRemoveFromCore(memory.id)}
                      className="ml-3 shrink-0 text-neutral-500 opacity-0 hover:border-red-300 hover:text-red-600 group-hover:opacity-100"
                    >
                      {t.coreTier.removeFromCore}
                    </Button>
                  </div>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Empty state for core */}
      {coreMemories.length === 0 && (
        <EmptyState icon={Star} title={t.coreTier.promoteCandidates} />
      )}

      {/* Promote candidates */}
      {!isFull && activeMemories.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center space-x-2">
            <Plus size={14} className="text-neutral-400" />
            <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
              {t.coreTier.promoteCandidates}
            </span>
          </div>
          <div className="space-y-1.5">
            {activeMemories.slice(0, 8).map((memory: any) => (
              <Card
                key={memory.id}
                padding="none"
                className="group flex items-center justify-between bg-neutral-50 px-4 py-3 hover:border-teal-300"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Brain size={13} className="shrink-0 text-neutral-400" />
                    <span className="truncate text-sm text-neutral-700">
                      {memory.title}
                    </span>
                    <Badge tone={TYPE_TONE[memory.type] || "neutral"} className="text-xs">
                      {typeLabels[memory.type] || memory.type}
                    </Badge>
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Star}
                  onClick={() => handlePromoteToCore(memory.id)}
                  className="ml-3 shrink-0 border-teal-200 bg-white text-teal-600 opacity-0 hover:border-teal-400 hover:text-teal-800 group-hover:opacity-100"
                >
                  {t.coreTier.addToCore}
                </Button>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
