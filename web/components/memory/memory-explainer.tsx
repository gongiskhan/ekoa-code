"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Info, ChevronDown, Star, Zap, Archive, Sparkles } from "lucide-react";
import { useTranslation } from "@/stores/i18n";
import { Card } from "@/components/ui/card";

const STORAGE_KEY = "ekoa_memory_explainer_collapsed";

export function MemoryExplainer() {
  const { pages_memory: t } = useTranslation();
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      setCollapsed(stored === "true");
    }
  }, []);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(STORAGE_KEY, String(next));
  }

  return (
    <Card padding="none" className="overflow-hidden bg-teal-50/40">
      <button
        onClick={toggle}
        className="flex w-full cursor-pointer items-center justify-between px-4 py-3 transition-colors hover:bg-teal-50/60"
      >
        <div className="flex items-center space-x-2">
          <Info size={15} className="text-teal-600" />
          <span className="text-sm font-medium text-teal-800">
            {t.explainer.title}
          </span>
        </div>
        <motion.div
          animate={{ rotate: collapsed ? 0 : 180 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDown size={16} className="text-teal-500" />
        </motion.div>
      </button>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-1 gap-3 px-4 pb-4 sm:grid-cols-2">
              <div className="flex items-start space-x-2.5">
                <Star size={14} className="mt-0.5 shrink-0 text-teal-600" />
                <p className="text-xs leading-relaxed text-teal-700">
                  {t.explainer.coreDesc}
                </p>
              </div>
              <div className="flex items-start space-x-2.5">
                <Zap size={14} className="mt-0.5 shrink-0 text-blue-500" />
                <p className="text-xs leading-relaxed text-teal-700">
                  {t.explainer.activeDesc}
                </p>
              </div>
              <div className="flex items-start space-x-2.5">
                <Archive size={14} className="mt-0.5 shrink-0 text-neutral-400" />
                <p className="text-xs leading-relaxed text-teal-700">
                  {t.explainer.archiveDesc}
                </p>
              </div>
              <div className="flex items-start space-x-2.5">
                <Sparkles size={14} className="mt-0.5 shrink-0 text-amber-500" />
                <p className="text-xs leading-relaxed text-teal-700">
                  {t.explainer.autoDesc}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
