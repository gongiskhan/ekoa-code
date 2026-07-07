"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import { useTranslation } from "@/stores/i18n";
import { useVerticalProfile } from "@/lib/verticals";

interface OnboardingWelcomeProps {
  /** Sends a chip's text through the normal composer send path. */
  onSend: (text: string) => void;
  /** Focuses the empty-state composer without sending (the "own words" chip). */
  onFocusComposer: () => void;
}

/**
 * First-turn welcome for a fresh onboarding session: an assistant-styled bubble
 * (matching WelcomeMessageBubble) that greets the user and asks the opening
 * question, followed by quick-reply chips. Rendered in the conversation column
 * while the onboarding session has no messages yet.
 *
 * The send chips push their text through the same handleSendMessage the
 * composer uses, so everything downstream is untouched. The freeform chip only
 * focuses the composer, inviting the user to answer in their own words.
 *
 * Send chips are vertical-flavoured: the active vertical profile may override
 * them (e.g. legal supplies the "advogado" identity), falling back to the
 * generic locale chips. The freeform chip stays locale-only.
 */
export function OnboardingWelcome({ onSend, onFocusComposer }: OnboardingWelcomeProps) {
  const { onboarding } = useTranslation();
  const { onboardingChips: chips } = useVerticalProfile();
  const { freeformChip } = onboarding.welcome;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="flex justify-start space-x-3"
    >
      <div className="w-8 h-8 flex items-center justify-center flex-shrink-0 mt-0.5 overflow-hidden">
        <Image
          src="/ekoa_logo.png"
          alt="Ekoa"
          width={20}
          height={20}
          className="object-contain"
        />
      </div>

      <div className="min-w-0 max-w-2xl">
        <div className="flex items-center space-x-2 mb-1">
          <span className="text-xs font-semibold text-neutral-700">EKOA</span>
        </div>

        <div className="text-sm text-neutral-700 leading-relaxed space-y-2">
          <p>{onboarding.welcome.greeting}</p>
          <p>{onboarding.welcome.question}</p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {chips.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => onSend(chip)}
              className="rounded-full border border-neutral-200 bg-white px-3.5 py-1.5 text-xs text-neutral-700 transition-all hover:border-teal-300 hover:bg-teal-50/60 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-1 cursor-pointer"
            >
              {chip}
            </button>
          ))}
          <button
            type="button"
            onClick={onFocusComposer}
            className="rounded-full border border-neutral-200 bg-white px-3.5 py-1.5 text-xs text-neutral-700 transition-all hover:border-teal-300 hover:bg-teal-50/60 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-1 cursor-pointer"
          >
            {freeformChip}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
