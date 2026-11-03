/** Safe, actionable login errors. Never display raw SDK errors or tokens. */
export interface LoginIssue {
  code: string;
  message: string;
  guidance: string;
}

export function getAuthErrorCode(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return "UNKNOWN_ERROR";
  }
  return typeof error.code === "string" && /^[a-zA-Z0-9/_.-]{1,100}$/.test(error.code)
    ? error.code
    : "UNKNOWN_ERROR";
}

const serviceIssue = {
  message: "Masuk dengan Google sedang tidak tersedia.",
  guidance: "Coba lagi nanti. Jika masih gagal, hubungi pengelola Patungin.",
};
const googleIssues: Record<string, Omit<LoginIssue, "code">> = {
  "auth/configuration-not-found": serviceIssue,
  "auth/operation-not-allowed": serviceIssue,
  "auth/invalid-api-key": serviceIssue,
  "auth/api-key-not-valid.-please-pass-a-valid-api-key.": serviceIssue,
  "auth/app-not-authorized": serviceIssue,
  "auth/unauthorized-domain": {
    message: "Alamat web ini belum bisa digunakan untuk masuk.",
    guidance: "Buka alamat Patungin yang diberikan pengelola, lalu coba lagi.",
  },
  "auth/popup-blocked": {
    message: "Browser memblokir jendela masuk Google.",
    guidance: "Izinkan popup untuk situs ini, lalu tekan Masuk dengan Google lagi. Jika dibuka dari aplikasi chat, gunakan browser utama.",
  },
  "auth/network-request-failed": {
    message: "Tidak dapat terhubung ke layanan login Google.",
    guidance: "Periksa koneksi internet, lalu coba lagi.",
  },
  "auth/web-storage-unsupported": {
    message: "Browser belum mengizinkan proses masuk.",
    guidance: "Izinkan penyimpanan situs atau buka Patungin di browser lain.",
  },
  "auth/operation-not-supported-in-this-environment": {
    message: "Google login tidak didukung di browser ini.",
    guidance: "Buka Patungin di browser utama, lalu coba lagi.",
  },
  "auth/too-many-requests": {
    message: "Terlalu banyak percobaan masuk.",
    guidance: "Tunggu beberapa saat sebelum mencoba kembali.",
  },
  "auth/user-disabled": {
    message: "Akun ini dinonaktifkan pada aplikasi.",
    guidance: "Hubungi pengelola Patungin atau gunakan akun lain yang sudah diizinkan.",
  },
};

export function getGoogleLoginIssue(error: unknown): LoginIssue | null {
  const code = getAuthErrorCode(error);
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
    return null;
  }
  // Firebase can include punctuation in this particular legacy error code.
  const known = googleIssues[code];
  return {
    code,
    ...(known ?? {
      message: "Google login belum berhasil.",
      guidance: "Periksa koneksi internet lalu coba lagi. Jika masih gagal, hubungi pengelola Patungin.",
    }),
  };
}

export function getSessionLoginIssue(code: string): LoginIssue {
  const issues: Record<string, Omit<LoginIssue, "code">> = {
    EMAIL_NOT_ALLOWED: {
      message: "Akun ini belum diizinkan mengakses aplikasi.",
      guidance: "Pilih akun Google yang sudah diizinkan oleh pemilik aplikasi.",
    },
    EMAIL_NOT_VERIFIED: {
      message: "Email akun Google belum terverifikasi.",
      guidance: "Verifikasi email akun Google terlebih dahulu, lalu masuk kembali.",
    },
    PROVIDER_NOT_GOOGLE: {
      message: "Aplikasi hanya menerima Google login.",
      guidance: "Gunakan tombol Masuk dengan Google untuk melanjutkan.",
    },
    FIREBASE_NOT_CONFIGURED: serviceIssue,
    FIREBASE_PROJECT_MISMATCH: serviceIssue,
    INVALID_ID_TOKEN: {
      message: "Sesi Google tidak valid atau sudah kedaluwarsa.",
      guidance: "Masuk kembali dengan Google untuk melanjutkan.",
    },
    RECENT_LOGIN_REQUIRED: {
      message: "Verifikasi login sudah terlalu lama.",
      guidance: "Masuk kembali dengan Google untuk membuat sesi baru.",
    },
    FIREBASE_SERVICE_UNAVAILABLE: {
      message: "Belum bisa memverifikasi akun Google.",
      guidance: "Coba lagi sebentar. Jika masih gagal, hubungi pengelola Patungin.",
    },
    ORIGIN_MISMATCH: {
      message: "Alamat web ini belum bisa digunakan untuk masuk.",
      guidance: "Buka alamat Patungin yang diberikan pengelola, lalu coba lagi.",
    },
    NETWORK_ERROR: {
      message: "Gagal menghubungi server aplikasi.",
      guidance: "Periksa koneksi internet, lalu coba lagi.",
    },
    CLIENT_NOT_CONFIGURED: serviceIssue,
  };
  return {
    code,
    ...(issues[code] ?? {
      message: "Sesi login belum berhasil dibuat.",
      guidance: "Coba masuk kembali. Jika masih gagal, hubungi pengelola Patungin.",
    }),
  };
}
