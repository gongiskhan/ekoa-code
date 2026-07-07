"use client";

import { Settings, Sparkles, Star } from "lucide-react";
import { useTranslation } from "@/stores/i18n";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";

export function MemorySettings() {
  const { pages_memory: t } = useTranslation();

  return (
    <div className="max-w-xl space-y-6">
      <div className="mb-2 flex items-center space-x-2">
        <Settings size={16} className="text-neutral-500" />
        <h2 className="text-sm font-semibold text-neutral-800">
          {t.memorySettings.title}
        </h2>
      </div>

      {/* Auto-extract toggle */}
      <Card>
        <div className="flex items-start justify-between">
          <div className="flex items-start space-x-3">
            <Sparkles size={16} className="mt-0.5 shrink-0 text-amber-500" />
            <div>
              <h3 className="text-sm font-medium text-neutral-800">
                {t.memorySettings.autoExtract}
              </h3>
              <p className="mt-0.5 text-xs text-neutral-500">
                {t.memorySettings.autoExtractDesc}
              </p>
            </div>
          </div>
          <div className="ml-4 shrink-0">
            {/* Display-only: always-on system behavior */}
            <Switch checked disabled onChange={() => {}} />
          </div>
        </div>
      </Card>

      {/* Max core memories */}
      <Card>
        <div className="flex items-start justify-between">
          <div className="flex items-start space-x-3">
            <Star size={16} className="mt-0.5 shrink-0 text-teal-600" />
            <div>
              <h3 className="text-sm font-medium text-neutral-800">
                {t.memorySettings.maxCore}
              </h3>
              <p className="mt-0.5 text-xs text-neutral-500">
                {t.memorySettings.maxCoreDesc}
              </p>
            </div>
          </div>
          <div className="ml-4 shrink-0">
            {/* Display-only fixed value */}
            <Input
              type="number"
              value={5}
              readOnly
              wrapperClassName="w-16"
              className="text-center"
            />
          </div>
        </div>
      </Card>

      {/* Info text */}
      <p className="text-xs leading-relaxed text-neutral-400">
        {t.explainer.coreDesc} {t.explainer.activeDesc}
      </p>
    </div>
  );
}
