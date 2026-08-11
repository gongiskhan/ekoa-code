"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import SidePanel from "@/components/builder/side-panel";
import { useOrchestrationStore, panelContentFor } from "@/stores/orchestration";
import { useTranslation } from "@/stores/i18n";

interface MobileSidePanelDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string | null;
}

export default function MobileSidePanelDrawer({
  isOpen,
  onClose,
  sessionId,
}: MobileSidePanelDrawerProps) {
  const { sidePanel: sp, sheetFeed } = useTranslation();
  // B6: the drawer header names WHAT the overlay hosts (the B.A panel union) - the
  // sheet feed for chat sessions, the build preview otherwise. The hosted SidePanel
  // decides its own content the same way; this only keeps the label honest.
  const panelKind = useOrchestrationStore((s) => panelContentFor(s, sessionId).kind);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50"
            onClick={onClose}
          />

          {/* Drawer from bottom */}
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            data-testid="mobile-side-panel-drawer"
            className="fixed left-0 right-0 bottom-0 z-50 bg-white rounded-t-2xl shadow-xl flex flex-col"
            style={{ height: "85vh", maxHeight: "85vh" }}
          >
            {/* Handle bar */}
            <div className="flex justify-center pt-2 pb-1">
              <div className="w-10 h-1 bg-neutral-300 rounded-full" />
            </div>

            {/* Header. Sheet-feed carries no visible title (WS5): before the agent
                has classified the job, "Folhas"/"Sheets" reads as a wrong tab name
                for whatever the user actually asked for. The build/integrate
                variants keep their own titles - they only render once the agent
                has committed to a job kind. The sheet-feed locale string survives
                as the row's accessible name so screen readers still get one. */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-100">
              <span
                data-testid="mobile-drawer-title"
                role="group"
                aria-label={panelKind === "sheet-feed" ? sheetFeed.title : undefined}
                className="text-sm font-bold text-neutral-700"
              >
                {panelKind === "sheet-feed"
                  ? ""
                  : panelKind === "integrate"
                    ? sp.integrationBuilder
                    : sp.preview}
              </span>
              <button
                onClick={onClose}
                title={sheetFeed.hidePanel}
                aria-label={sheetFeed.hidePanel}
                className="p-2 text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 rounded-lg transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">
              <SidePanel sessionId={sessionId} />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
