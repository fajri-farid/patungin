"use client";

import React, { useId, useState } from "react";

interface MoneyInputProps {
  id?: string;
  label?: string;
  value: number | null | undefined;
  onChange: (newValue: number | null) => void;
  placeholder?: string;
  allowNull?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * Input nominal Rupiah ramah ponsel:
 * - Menampilkan angka berformat ribuan (10.000) saat tidak sedang diketik.
 * - Fokus tidak mengubah isi field agar pilihan teks dan tempel tetap stabil.
 * - Setelah mulai mengetik, gunakan angka mentah dengan keypad numerik.
 */
export function MoneyInput({
  id,
  label,
  value,
  onChange,
  placeholder = "0",
  allowNull = false,
  disabled = false,
  className = "",
}: MoneyInputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [rawText, setRawText] = useState("");

  const formattedDisplay =
    value === null || value === undefined || !Number.isFinite(value)
      ? ""
      : Math.max(0, Math.round(value)).toLocaleString("id-ID");

  const handleFocus = () => {
    setIsFocused(true);
    setRawText(formattedDisplay);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digitsOnly = e.target.value.replace(/[^0-9]/g, "");
    setRawText(digitsOnly);

    if (!digitsOnly) {
      onChange(allowNull ? null : 0);
      return;
    }

    const parsed = Number.parseInt(digitsOnly, 10);
    if (Number.isSafeInteger(parsed)) {
      onChange(Math.min(parsed, 1_000_000_000_000));
    }
  };

  const handleBlur = () => {
    setIsFocused(false);
  };

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && (
        <label
          htmlFor={inputId}
          className="text-xs font-semibold text-[#4A5B7C] select-none"
        >
          {label}
        </label>
      )}
      <div className="relative flex items-center">
        <span className="absolute left-3 text-sm font-semibold text-[#4A5B7C] pointer-events-none select-none">
          Rp
        </span>
        <input
          id={inputId}
          name={inputId}
          aria-label={label ?? "Jumlah dalam rupiah"}
          aria-invalid={allowNull && (value === null || value === undefined)}
          autoComplete="off"
          type="text"
          inputMode="numeric"
          disabled={disabled}
          value={isFocused ? rawText : formattedDisplay}
          onFocus={handleFocus}
          onChange={handleChange}
          onBlur={handleBlur}
          placeholder={placeholder}
          className="w-full min-h-[44px] pl-9 pr-3 py-2 rounded-xl bg-white border border-[#D8E2F2] text-sm font-bold text-[#17233B] tabular-money placeholder:text-[#7687A6] focus:border-[#2855D9] focus:outline-none disabled:bg-[#EAF0FA] disabled:text-[#7687A6]"
        />
      </div>
    </div>
  );
}
