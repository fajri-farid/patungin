import type { Metadata } from "next";
import { Link2Off } from "lucide-react";
import { resolvePublicShareToken } from "@/server/store/repository";
import { PublicShareClient } from "./PublicShareClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Rincian patungan",
  description: "Rincian patungan tagihan makan transparan dan adil.",
  robots: {
    index: false,
    follow: false,
  },
  referrer: "no-referrer",
};

export default async function PublicSharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const projection = await resolvePublicShareToken(token);

  if (!projection) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-4 py-12 bg-[#F4F7FC]">
        <div className="w-full max-w-md bg-white border border-[#D8E2F2] rounded-3xl p-6 text-center space-y-3 shadow-xs">
          <div className="w-12 h-12 rounded-2xl bg-[#FDECEC] text-[#B42318] flex items-center justify-center mx-auto">
            <Link2Off className="w-6 h-6" />
          </div>
          <h1 className="text-lg font-extrabold text-[#17233B] font-display">
            Link sudah tidak tersedia.
          </h1>
          <p className="text-sm text-[#4A5B7C] leading-relaxed">
            Link ini mungkin sudah kedaluwarsa atau dinonaktifkan. Minta link
            baru ke teman yang membuat tagihan, ya.
          </p>
        </div>
      </main>
    );
  }

  return <PublicShareClient projection={projection} shareToken={token} />;
}
