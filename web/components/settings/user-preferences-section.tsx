"use client";

import { useEffect } from "react";
import { SlidersHorizontal } from "lucide-react";
import { useUserSettingsStore } from "@/stores/user-settings";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

/**
 * Per-user preferences (Amendment 2). Hosts the two `user_settings` toggles,
 * both default ON and written through `PATCH /settings/me`:
 *   - Verificar as construções — `build.verifyBuilds` (FC-507)
 *   - Extração automática de memórias — `memory.autoExtract` (FC-504)
 *
 * These are per-user (unlike the org settings above), so any signed-in user sees
 * and controls them.
 */
export function UserPreferencesSection() {
  const verifyBuilds = useUserSettingsStore((s) => s.verifyBuilds);
  const autoExtract = useUserSettingsStore((s) => s.autoExtract);
  const isLoaded = useUserSettingsStore((s) => s.isLoaded);
  const isSaving = useUserSettingsStore((s) => s.isSaving);
  const fetchUserSettings = useUserSettingsStore((s) => s.fetchUserSettings);
  const setVerifyBuilds = useUserSettingsStore((s) => s.setVerifyBuilds);
  const setAutoExtract = useUserSettingsStore((s) => s.setAutoExtract);

  useEffect(() => {
    if (!isLoaded) fetchUserSettings();
  }, [isLoaded, fetchUserSettings]);

  return (
    <section data-testid="settings-user-preferences">
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
          <SlidersHorizontal size={15} className="text-neutral-500" aria-hidden />
          Preferências pessoais
        </h2>
        <p className="mt-0.5 text-xs text-neutral-500">
          Opções que se aplicam apenas à sua conta.
        </p>
      </div>

      <Card>
        <div className="flex items-start justify-between gap-6 py-4 first:pt-0 border-b border-line">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-neutral-900">Verificar as construções</div>
            <p className="mt-0.5 text-sm leading-relaxed text-neutral-500">
              Testar cada aplicação depois de a construir. Melhora a qualidade do resultado, mas
              torna a construção mais demorada e com maior custo.
            </p>
          </div>
          <div className="mt-0.5 shrink-0">
            <Switch
              checked={verifyBuilds}
              disabled={isSaving}
              onChange={setVerifyBuilds}
              data-testid="toggle-verify-builds"
            />
          </div>
        </div>

        <div className="flex items-start justify-between gap-6 py-4 last:pb-0">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-neutral-900">
              Extração automática de memórias
            </div>
            <p className="mt-0.5 text-sm leading-relaxed text-neutral-500">
              Guardar automaticamente memórias a partir do seu trabalho. As memórias criadas
              automaticamente ficam sempre privadas.
            </p>
          </div>
          <div className="mt-0.5 shrink-0">
            <Switch
              checked={autoExtract}
              disabled={isSaving}
              onChange={setAutoExtract}
              data-testid="toggle-auto-extract"
            />
          </div>
        </div>
      </Card>
    </section>
  );
}
