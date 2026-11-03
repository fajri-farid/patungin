/**
 * Sistem Palet Chip Peserta & Inisial ("Struk yang Sudah Diberi Pemilik")
 *
 * Mendukung hingga 30+ peserta tanpa tabrakan visual:
 * - 8 warna utama dengan kontras WCAG AA pada tema tunggal Patungin.
 * - Jika peserta > 8, sistem menggabungkan rotasi warna dengan variasi gaya
 *   (Tier 0: solid, Tier 1: dashed + ring, Tier 2: double border + badge sudut,
 *   Tier 3: aksen tebal) serta inisial yang otomatis didisambiguasi.
 */

export interface ParticipantChipStyle {
  slotIndex: number;
  tier: number;
  colorName: string;
  bgHex: string;
  borderHex: string;
  textHex: string;
  avatarBgHex: string;
  avatarTextHex: string;
  borderStyle: "solid" | "dashed" | "double";
  ringHex?: string;
  tierBadge?: string;
}

export interface BasePaletteSlot {
  name: string;
  bgHex: string;
  borderHex: string;
  textHex: string;
  avatarBgHex: string;
  avatarTextHex: string;
}

export const PARTICIPANT_BASE_PALETTE: readonly BasePaletteSlot[] = [
  {
    name: "Cobalt",
    bgHex: "#E8F0FE",
    borderHex: "#A8C7FA",
    textHex: "#1742A6",
    avatarBgHex: "#2855D9",
    avatarTextHex: "#FFFFFF",
  },
  {
    name: "Emerald",
    bgHex: "#E6F6F0",
    borderHex: "#9ADBC3",
    textHex: "#0F5942",
    avatarBgHex: "#157A58",
    avatarTextHex: "#FFFFFF",
  },
  {
    name: "Amber",
    bgHex: "#FEF3E2",
    borderHex: "#F5CA86",
    textHex: "#873E06",
    avatarBgHex: "#B8560C",
    avatarTextHex: "#FFFFFF",
  },
  {
    name: "Plum",
    bgHex: "#F3E8FD",
    borderHex: "#D2A6F7",
    textHex: "#5C1B99",
    avatarBgHex: "#7A29C7",
    avatarTextHex: "#FFFFFF",
  },
  {
    name: "Rose",
    bgHex: "#FCE8EF",
    borderHex: "#F4A6C2",
    textHex: "#911645",
    avatarBgHex: "#BF215B",
    avatarTextHex: "#FFFFFF",
  },
  {
    name: "Teal",
    bgHex: "#E4F5F7",
    borderHex: "#96D6E0",
    textHex: "#0C525C",
    avatarBgHex: "#11717F",
    avatarTextHex: "#FFFFFF",
  },
  {
    name: "Indigo",
    bgHex: "#ECEBFD",
    borderHex: "#B4AFF7",
    textHex: "#342B99",
    avatarBgHex: "#493DC7",
    avatarTextHex: "#FFFFFF",
  },
  {
    name: "Olive",
    bgHex: "#F0F5E6",
    borderHex: "#BDD494",
    textHex: "#36520F",
    avatarBgHex: "#4B7016",
    avatarTextHex: "#FFFFFF",
  },
] as const;

/**
 * Menghasilkan gaya visual chip dan avatar berdasarkan allocationOrder peserta.
 * Tetap deterministik untuk peserta ke-1 sampai ke-30+.
 */
export function getParticipantChipStyle(allocationOrder: number): ParticipantChipStyle {
  const safeOrder = Math.max(0, Math.floor(allocationOrder));
  const slotIndex = safeOrder % PARTICIPANT_BASE_PALETTE.length;
  const tier = Math.floor(safeOrder / PARTICIPANT_BASE_PALETTE.length);
  const base = PARTICIPANT_BASE_PALETTE[slotIndex];

  if (tier === 0) {
    return {
      slotIndex,
      tier,
      colorName: base.name,
      bgHex: base.bgHex,
      borderHex: base.borderHex,
      textHex: base.textHex,
      avatarBgHex: base.avatarBgHex,
      avatarTextHex: base.avatarTextHex,
      borderStyle: "solid",
    };
  }

  if (tier === 1) {
    // Peserta ke-9 s/d ke-16: menggunakan border dashed & aksen terbalik pada avatar
    return {
      slotIndex,
      tier,
      colorName: `${base.name} II`,
      bgHex: "#FFFFFF",
      borderHex: base.avatarBgHex,
      textHex: base.textHex,
      avatarBgHex: base.bgHex,
      avatarTextHex: base.textHex,
      borderStyle: "dashed",
      ringHex: base.avatarBgHex,
      tierBadge: "•",
    };
  }

  if (tier === 2) {
    // Peserta ke-17 s/d ke-24: menggunakan double border & penanda bintang/plus
    return {
      slotIndex,
      tier,
      colorName: `${base.name} III`,
      bgHex: base.bgHex,
      borderHex: base.textHex,
      textHex: base.textHex,
      avatarBgHex: base.textHex,
      avatarTextHex: "#FFFFFF",
      borderStyle: "double",
      ringHex: base.borderHex,
      tierBadge: "✦",
    };
  }

  // Peserta ke-25 s/d ke-30+: kontras penuh dengan penanda angka tier
  return {
    slotIndex,
    tier,
    colorName: `${base.name} IV`,
    bgHex: "#FFFFFF",
    borderHex: base.textHex,
    textHex: base.textHex,
    avatarBgHex: base.textHex,
    avatarTextHex: "#FFFFFF",
    borderStyle: "solid",
    ringHex: base.textHex,
    tierBadge: `${tier + 1}`,
  };
}

/**
 * Membentuk inisial dasar (1-2 karakter) dari nama panggilan peserta.
 */
export function extractBaseInitials(name: string): string {
  const cleaned = name.trim().replace(/\s+/g, " ");
  if (!cleaned) return "P";

  const words = cleaned.split(" ").filter(Boolean);
  if (words.length >= 2) {
    const first = Array.from(words[0])[0] ?? "";
    const second = Array.from(words[1])[0] ?? "";
    return `${first}${second}`.toUpperCase();
  }

  const chars = Array.from(words[0]);
  if (chars.length >= 2) {
    return `${chars[0]}${chars[1]}`.toUpperCase();
  }
  return (chars[0] ?? "P").toUpperCase();
}

export interface ParticipantVisualIdentity {
  id: string;
  name: string;
  displayLabel: string;
  initials: string;
  style: ParticipantChipStyle;
}

/**
 * Menghasilkan identitas visual lengkap (inisial unik, label pembeda jika nama kembar,
 * dan warna chip) untuk seluruh daftar peserta secara deterministik.
 */
export function buildParticipantVisualMap<
  T extends { id: string; name: string; allocationOrder: number; label?: string }
>(participants: readonly T[]): Record<string, ParticipantVisualIdentity> {
  // Urutkan berdasarkan allocationOrder lalu ID agar penomoran inisial kembar stabil
  const sorted = [...participants].sort((a, b) => {
    if (a.allocationOrder !== b.allocationOrder) {
      return a.allocationOrder - b.allocationOrder;
    }
    return a.id.localeCompare(b.id);
  });

  const baseInitialCounts = new Map<string, number>();
  const normalizedNameCounts = new Map<string, number>();

  for (const p of sorted) {
    const baseInit = extractBaseInitials(p.name);
    baseInitialCounts.set(baseInit, (baseInitialCounts.get(baseInit) ?? 0) + 1);

    const normName = p.name.trim().toLowerCase();
    normalizedNameCounts.set(normName, (normalizedNameCounts.get(normName) ?? 0) + 1);
  }

  const seenInitialIndex = new Map<string, number>();
  const seenNameIndex = new Map<string, number>();
  const result: Record<string, ParticipantVisualIdentity> = {};

  for (const p of sorted) {
    const baseInit = extractBaseInitials(p.name);
    const totalSameInit = baseInitialCounts.get(baseInit) ?? 1;
    const currentInitIdx = (seenInitialIndex.get(baseInit) ?? 0) + 1;
    seenInitialIndex.set(baseInit, currentInitIdx);

    // Jika ada lebih dari 1 orang dengan inisial sama, tambahkan angka pembeda
    const initials =
      totalSameInit > 1 ? `${baseInit}${currentInitIdx}` : baseInit;

    const normName = p.name.trim().toLowerCase();
    const totalSameName = normalizedNameCounts.get(normName) ?? 1;
    const currentNameIdx = (seenNameIndex.get(normName) ?? 0) + 1;
    seenNameIndex.set(normName, currentNameIdx);

    let displayLabel = p.name.trim();
    if (p.label && p.label.trim()) {
      displayLabel = `${displayLabel} (${p.label.trim()})`;
    } else if (totalSameName > 1) {
      displayLabel = `${displayLabel} #${currentNameIdx}`;
    }

    result[p.id] = {
      id: p.id,
      name: p.name.trim(),
      displayLabel,
      initials,
      style: getParticipantChipStyle(p.allocationOrder),
    };
  }

  return result;
}
