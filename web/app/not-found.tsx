"use client";

import Link from "next/link";
import { useTranslation } from "@/stores/i18n";

export default function NotFound() {
  const { notFound } = useTranslation();

  return (
    <div className="flex h-screen w-full items-center justify-center bg-white">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-neutral-200 mb-4">{notFound.title}</h1>
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
