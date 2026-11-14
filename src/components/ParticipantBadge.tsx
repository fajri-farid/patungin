"use client";

import React from "react";
import type { ParticipantVisualIdentity } from "@/lib/palette";

interface ParticipantAvatarProps {
  identity: ParticipantVisualIdentity;
  size?: "sm" | "md" | "lg";
}

export function ParticipantAvatar({
  identity,
  size = "md",
}: ParticipantAvatarProps) {
  const { style, initials } = identity;

  const sizeClass =
    size === "sm"
      ? "w-6 h-6 text-[10px]"
      : size === "lg"
        ? "w-10 h-10 text-sm"
        : "w-8 h-8 text-xs";

  return (
    <span
      className={`relative inline-flex items-center justify-center rounded-full font-bold select-none shrink-0 ${sizeClass}`}
      style={{
        backgroundColor: style.avatarBgHex,
        color: style.avatarTextHex,
        borderWidth: style.ringHex ? "2px" : "1px",
        borderStyle: style.borderStyle,
        borderColor: style.ringHex ?? style.borderHex,
      }}
      aria-hidden="true"
    >
      {initials}
      {style.tierBadge && (
        <span
          className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full text-[9px] font-extrabold flex items-center justify-center shadow-xs"
          style={{
            backgroundColor: "#FFFFFF",
            color: style.textHex,
            border: `1px solid ${style.borderHex}`,
          }}
        >
          {style.tierBadge}
        </span>
      )}
    </span>
  );
}

interface ParticipantChipProps {
  identity: ParticipantVisualIdentity;
  suffix?: string;
  isPayer?: boolean;
  selected?: boolean;
  onClick?: () => void;
  size?: "sm" | "md";
}

export function ParticipantChip({
  identity,
  suffix,
  isPayer,
  selected,
  onClick,
  size = "md",
}: ParticipantChipProps) {
  const { style, displayLabel } = identity;

  const basePadding =
    size === "sm" ? "px-2 py-0.5 text-xs gap-1.5" : "px-2.5 py-1 text-sm gap-2";

  const interactiveClasses = onClick
    ? "cursor-pointer transition-colors min-h-[44px]"
    : "";

  const Tag = onClick ? "button" : "span";

  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      aria-pressed={onClick ? selected : undefined}
      className={`inline-flex max-w-full flex-wrap items-center rounded-full font-medium ${basePadding} ${interactiveClasses}`}
      style={{
        backgroundColor: style.bgHex,
        color: style.textHex,
        borderWidth: selected
          ? "2px"
          : style.borderStyle === "double"
            ? "3px"
            : "1.5px",
        borderStyle: style.borderStyle,
        borderColor: selected ? "#2855D9" : style.borderHex,
      }}
    >
      <ParticipantAvatar
        identity={identity}
        size={size === "sm" ? "sm" : "sm"}
      />
      <span className="truncate max-w-[130px] font-semibold">
        {displayLabel}
      </span>
      {suffix && (
        <span
          className="px-1.5 py-0.5 rounded-full text-[11px] font-bold tabular-money"
          style={{
            backgroundColor: "rgba(255, 255, 255, 0.78)",
            color: style.textHex,
          }}
        >
          {suffix}
        </span>
      )}
      {isPayer && (
        <span className="shrink-0 whitespace-nowrap px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[#17233B] text-white">
          Yang bayar duluan
        </span>
      )}
    </Tag>
  );
}
