"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import SidePanel from "@/components/builder/side-panel";
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
  const { sidePanel: sp } = useTranslation();

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
            className="fixed left-0 right-0 bottom-0 z-50 bg-white rounded-t-2xl shadow-xl flex flex-col"
            style={{ height: "85vh", maxHeight: "85vh" }}
          >
            {/* Handle bar */}
            <div className="flex justify-center pt-2 pb-1">
              <div className="w-10 h-1 bg-neutral-300 rounded-full" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-100">
              <span className="text-sm font-bold text-neutral-700">
                {sp.preview}
              </span>
              <button
                onClick={onClose}
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
