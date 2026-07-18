"use client";

import Link from "next/link";
import { useTranslation } from "@/stores/i18n";

export default function NotFound() {
  const { notFound } = useTranslation();

  return (
    <div className="relative flex h-screen w-full items-center justify-center bg-canvas">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-dots [mask-image:radial-gradient(ellipse_50%_50%_at_50%_50%,black_20%,transparent_75%)]"
      />
      <div className="relative text-center">
        <h1 className="font-display text-6xl font-semibold text-neutral-300 mb-4">{notFound.title}</h1>
        <p className="text-sm text-neutral-500 mb-6">{notFound.message}</p>
        <Link
          href="/"
          className="text-sm text-teal-600 hover:text-teal-700 font-medium"
        >
          {notFound.goToBuilder}
        </Link>
      </div>
    </div>
  );
}
