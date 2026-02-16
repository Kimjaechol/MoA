/**
 * Phone number validation utility with international country code support.
 *
 * Validates phone numbers based on country-specific patterns.
 * Stores numbers in E.164 format (e.g. +821012345678).
 */

export interface CountryCode {
  code: string;       // ISO 3166-1 alpha-2 (e.g. "KR")
  name: string;       // Display name (e.g. "대한민국")
  nameEn: string;     // English name
  dialCode: string;   // Dial code (e.g. "+82")
  pattern: RegExp;    // Regex for local number (without country code)
  example: string;    // Example local number
  minLength: number;  // Min digits (local, without country code)
  maxLength: number;  // Max digits (local, without country code)
}

/**
 * Supported countries with phone number validation patterns.
 * Patterns match the LOCAL part only (after removing the country code).
 */
export const COUNTRY_CODES: CountryCode[] = [
  // East Asia
  { code: "KR", name: "대한민국", nameEn: "South Korea", dialCode: "+82", pattern: /^0?1[0-9]\d{7,8}$/, example: "01012345678", minLength: 9, maxLength: 11 },
  { code: "JP", name: "日本", nameEn: "Japan", dialCode: "+81", pattern: /^0?[789]0\d{8}$/, example: "09012345678", minLength: 10, maxLength: 11 },
  { code: "CN", name: "中国", nameEn: "China", dialCode: "+86", pattern: /^1[3-9]\d{9}$/, example: "13812345678", minLength: 11, maxLength: 11 },
  { code: "TW", name: "台灣", nameEn: "Taiwan", dialCode: "+886", pattern: /^0?9\d{8}$/, example: "0912345678", minLength: 9, maxLength: 10 },
  { code: "HK", name: "香港", nameEn: "Hong Kong", dialCode: "+852", pattern: /^[5-9]\d{7}$/, example: "51234567", minLength: 8, maxLength: 8 },

  // Southeast Asia
  { code: "VN", name: "Việt Nam", nameEn: "Vietnam", dialCode: "+84", pattern: /^0?[3-9]\d{8}$/, example: "0912345678", minLength: 9, maxLength: 10 },
  { code: "TH", name: "ไทย", nameEn: "Thailand", dialCode: "+66", pattern: /^0?[689]\d{8}$/, example: "0812345678", minLength: 9, maxLength: 10 },
  { code: "PH", name: "Philippines", nameEn: "Philippines", dialCode: "+63", pattern: /^0?9\d{9}$/, example: "09171234567", minLength: 10, maxLength: 11 },
  { code: "SG", name: "Singapore", nameEn: "Singapore", dialCode: "+65", pattern: /^[89]\d{7}$/, example: "81234567", minLength: 8, maxLength: 8 },
  { code: "MY", name: "Malaysia", nameEn: "Malaysia", dialCode: "+60", pattern: /^0?1[0-9]\d{7,8}$/, example: "0123456789", minLength: 9, maxLength: 11 },
  { code: "ID", name: "Indonesia", nameEn: "Indonesia", dialCode: "+62", pattern: /^0?8\d{8,11}$/, example: "08123456789", minLength: 9, maxLength: 13 },

  // North America
  { code: "US", name: "United States", nameEn: "United States", dialCode: "+1", pattern: /^[2-9]\d{9}$/, example: "2025551234", minLength: 10, maxLength: 10 },
  { code: "CA", name: "Canada", nameEn: "Canada", dialCode: "+1", pattern: /^[2-9]\d{9}$/, example: "6135551234", minLength: 10, maxLength: 10 },

  // Europe
  { code: "GB", name: "United Kingdom", nameEn: "United Kingdom", dialCode: "+44", pattern: /^0?7\d{9}$/, example: "07911123456", minLength: 10, maxLength: 11 },
  { code: "DE", name: "Deutschland", nameEn: "Germany", dialCode: "+49", pattern: /^0?1[5-7]\d{8,9}$/, example: "01511234567", minLength: 10, maxLength: 12 },
  { code: "FR", name: "France", nameEn: "France", dialCode: "+33", pattern: /^0?[67]\d{8}$/, example: "0612345678", minLength: 9, maxLength: 10 },
  { code: "IT", name: "Italia", nameEn: "Italy", dialCode: "+39", pattern: /^3\d{8,9}$/, example: "3123456789", minLength: 9, maxLength: 10 },
  { code: "ES", name: "España", nameEn: "Spain", dialCode: "+34", pattern: /^[67]\d{8}$/, example: "612345678", minLength: 9, maxLength: 9 },
  { code: "NL", name: "Nederland", nameEn: "Netherlands", dialCode: "+31", pattern: /^0?6\d{8}$/, example: "0612345678", minLength: 9, maxLength: 10 },
  { code: "RU", name: "Россия", nameEn: "Russia", dialCode: "+7", pattern: /^9\d{9}$/, example: "9123456789", minLength: 10, maxLength: 10 },

  // Oceania
  { code: "AU", name: "Australia", nameEn: "Australia", dialCode: "+61", pattern: /^0?4\d{8}$/, example: "0412345678", minLength: 9, maxLength: 10 },
  { code: "NZ", name: "New Zealand", nameEn: "New Zealand", dialCode: "+64", pattern: /^0?2[0-9]\d{6,8}$/, example: "0211234567", minLength: 8, maxLength: 10 },

  // South America
  { code: "BR", name: "Brasil", nameEn: "Brazil", dialCode: "+55", pattern: /^[1-9]\d{10}$/, example: "11912345678", minLength: 11, maxLength: 11 },
  { code: "MX", name: "México", nameEn: "Mexico", dialCode: "+52", pattern: /^[1-9]\d{9}$/, example: "5512345678", minLength: 10, maxLength: 10 },

  // Middle East
  { code: "AE", name: "الإمارات", nameEn: "UAE", dialCode: "+971", pattern: /^0?5[0-9]\d{7}$/, example: "0501234567", minLength: 9, maxLength: 10 },
  { code: "SA", name: "السعودية", nameEn: "Saudi Arabia", dialCode: "+966", pattern: /^0?5[0-9]\d{7}$/, example: "0512345678", minLength: 9, maxLength: 10 },

  // South Asia
  { code: "IN", name: "भारत", nameEn: "India", dialCode: "+91", pattern: /^[6-9]\d{9}$/, example: "9123456789", minLength: 10, maxLength: 10 },

  // Africa
  { code: "NG", name: "Nigeria", nameEn: "Nigeria", dialCode: "+234", pattern: /^0?[789]\d{9}$/, example: "08012345678", minLength: 10, maxLength: 11 },
  { code: "ZA", name: "South Africa", nameEn: "South Africa", dialCode: "+27", pattern: /^0?[6-8]\d{8}$/, example: "0612345678", minLength: 9, maxLength: 10 },
];

/** Find a country by its ISO code */
export function findCountryByCode(code: string): CountryCode | undefined {
  return COUNTRY_CODES.find((c) => c.code === code.toUpperCase());
}

/** Strip non-digit characters (except leading +) */
function stripNonDigits(phone: string): string {
  return phone.replace(/[^\d]/g, "");
}

export interface PhoneValidationResult {
  valid: boolean;
  error?: string;
  normalized?: string;  // E.164 format e.g. "+821012345678"
}

/**
 * Validate a phone number for a given country code.
 * @param countryCode ISO 3166-1 alpha-2 code (e.g. "KR")
 * @param phoneNumber Local phone number (can include dashes/spaces)
 */
export function validatePhoneNumber(countryCode: string, phoneNumber: string): PhoneValidationResult {
  const country = findCountryByCode(countryCode);
  if (!country) {
    return { valid: false, error: "지원하지 않는 국가 코드입니다." };
  }

  const digits = stripNonDigits(phoneNumber);

  if (!digits) {
    return { valid: false, error: "휴대폰 번호를 입력해주세요." };
  }

  if (digits.length < country.minLength) {
    return { valid: false, error: `${country.nameEn}의 휴대폰 번호는 최소 ${country.minLength}자리입니다.` };
  }

  if (digits.length > country.maxLength) {
    return { valid: false, error: `${country.nameEn}의 휴대폰 번호는 최대 ${country.maxLength}자리입니다.` };
  }

  if (!country.pattern.test(digits)) {
    return { valid: false, error: `올바른 ${country.nameEn} 휴대폰 번호 형식이 아닙니다. (예: ${country.example})` };
  }

  // Normalize to E.164: strip leading 0 from local number, prepend dial code
  let localDigits = digits;
  // For countries where local numbers commonly start with 0 (trunk prefix)
  if (localDigits.startsWith("0") && countryCode !== "US" && countryCode !== "CA") {
    localDigits = localDigits.slice(1);
  }

  const e164 = `${country.dialCode}${localDigits}`;

  return { valid: true, normalized: e164 };
}

/**
 * Check if a phone number (in any format) has a valid structure for
 * the given country. Simpler version for client-side quick checks.
 */
export function isValidPhoneFormat(countryCode: string, phoneNumber: string): boolean {
  return validatePhoneNumber(countryCode, phoneNumber).valid;
}
