/**
 * Encrypted Vault — 암호화된 백업 + 복구 키 + 타임머신 회전
 *
 * ## 아키텍처
 *
 * ```
 * [장기기억 원본] ──→ [PBKDF2로 키 파생] ──→ [AES-256-GCM 암호화] ──→ .vault 파일
 *                      ↑                                                 ↓
 *           MOA_OWNER_SECRET             서버 로컬 + (선택) Supabase Storage
 *           또는 복구 키 12단어
 * ```
 *
 * ## 보관 정책 (타임머신 회전)
 * - 최근 7일: 매일 백업 유지
 * - 최근 4주: 주 1개 유지
 * - 최근 12개월: 월 1개 유지
 * - 최대 23개 파일, 자동 정리
 *
 * ## 디바이스 로컬 키 (생체인증 연동)
 * - 기기 측 FaceID/TouchID 성공 시 로컬 키로 암호화
 * - 서버에는 이미 암호화된 데이터만 전송
 * - 서버는 복호화 키를 절대 모름 (zero-knowledge)
 *
 * ## 저장 구조
 * .moa-data/vault/
 * ├── vault-meta.json         ← salt, 알고리즘 정보, 복구 키 해시 (키 자체는 없음)
 * ├── daily/
 * │   ├── 2026-02-09.vault    ← AES-256-GCM 암호화된 일일 백업
 * │   └── ...
 * ├── weekly/
 * │   └── 2026-W06.vault
 * ├── monthly/
 * │   └── 2026-02.vault
 * └── device-keys/
 *     └── <deviceId>.pubkey   ← 디바이스 공개키 (로컬 키 교환용)
 */

import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  createHash,
} from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";

// ============================================
// Types
// ============================================

/** Vault 메타데이터 (키 자체는 절대 저장하지 않음) */
export interface VaultMeta {
  /** 키 파생에 사용되는 salt (hex) */
  salt: string;
  /** PBKDF2 반복 횟수 */
  iterations: number;
  /** 암호화 알고리즘 */
  algorithm: "aes-256-gcm";
  /** 키 길이 (bytes) */
  keyLength: number;
  /** 복구 키 해시 (검증용, 복구 키 자체는 아님) */
  recoveryKeyHash?: string;
  /** vault 생성 시각 */
  createdAt: number;
  /** 마지막 백업 시각 */
  lastBackupAt?: number;
  /** 보관 정책 */
  retentionPolicy: RetentionPolicy;
}

/** 보관 정책 */
export interface RetentionPolicy {
  /** 일일 백업 유지 일수 */
  dailyKeepDays: number;
  /** 주간 백업 유지 주수 */
  weeklyKeepWeeks: number;
  /** 월간 백업 유지 개월수 */
  monthlyKeepMonths: number;
}

/** 암호화된 백업 파일 내부 구조 */
interface EncryptedPayload {
  /** 초기화 벡터 (hex) */
  iv: string;
  /** 인증 태그 (hex) — GCM 무결성 검증 */
  authTag: string;
  /** 암호화된 데이터 (hex) */
  encrypted: string;
  /** 백업 시각 */
  timestamp: number;
  /** 백업 유형 */
  type: "daily" | "weekly" | "monthly" | "manual";
  /** 체크섬 (원본 데이터 SHA-256, 복원 후 검증용) */
  checksum: string;
}

/** 복구 키 발급 결과 */
export interface RecoveryKeyResult {
  /** 12단어 니모닉 */
  words: string[];
  /** 표시용 문자열 */
  display: string;
  /** 해시 (검증용으로 vault-meta에 저장) */
  hash: string;
}

/** 디바이스 로컬 키 등록 정보 */
export interface DeviceKeyRegistration {
  deviceId: string;
  /** 디바이스에서 생성한 공개키 (PEM) */
  publicKey: string;
  /** 등록 시각 */
  registeredAt: number;
  /** 마지막 사용 시각 */
  lastUsedAt?: number;
}

// ============================================
// Constants
// ============================================

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const PBKDF2_ITERATIONS = 100_000;
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16;

const DEFAULT_RETENTION: RetentionPolicy = {
  dailyKeepDays: 7,
  weeklyKeepWeeks: 4,
  monthlyKeepMonths: 12,
};

// 한국어 니모닉 단어 목록 (BIP-39 스타일, 고유한 256개)
const MNEMONIC_WORDS = [
  "사과", "바다", "하늘", "별", "달", "해", "산", "강",
  "꽃", "나무", "바람", "구름", "비", "눈", "봄", "여름",
  "가을", "겨울", "새벽", "노을", "무지개", "이슬", "서리", "천둥",
  "파도", "모래", "섬", "숲", "들판", "계곡", "폭포", "호수",
  "동굴", "절벽", "언덕", "다리", "탑", "성", "마을", "길",
  "창문", "지붕", "정원", "울타리", "대문", "계단", "거울", "촛불",
  "종이", "붓", "먹", "책", "편지", "노래", "춤", "그림",
  "피아노", "기타", "북", "피리", "종", "시계", "나침반", "열쇠",
  "자물쇠", "상자", "보석", "진주", "금", "은", "동", "옥",
  "호랑이", "용", "봉황", "거북", "학", "독수리", "고래", "돌고래",
  "나비", "잠자리", "무당벌레", "반딧불", "부엉이", "참새", "제비", "까치",
  "소나무", "대나무", "매화", "난초", "국화", "연꽃", "장미", "해바라기",
  "백합", "튤립", "라벤더", "민들레", "토끼풀", "은행", "단풍", "벚꽃",
  "수박", "참외", "감", "배", "포도", "딸기", "귤", "복숭아",
  "토마토", "당근", "감자", "옥수수", "호박", "오이", "고추", "마늘",
  "쌀", "보리", "밀", "콩", "깨", "꿀", "소금", "차",
  "아침", "점심", "저녁", "자정", "일출", "일몰", "만월", "초승달",
  "동쪽", "서쪽", "남쪽", "북쪽", "위", "아래", "안", "밖",
  "하나", "둘", "셋", "넷", "다섯", "여섯", "일곱", "여덟",
  "아홉", "열", "백", "천", "만", "억", "조", "무한",
  "빨강", "주황", "노랑", "초록", "파랑", "남색", "보라", "분홍",
  "하양", "검정", "회색", "갈색", "금색", "은색", "청록", "연두",
  "사랑", "희망", "용기", "지혜", "평화", "자유", "행복", "꿈",
  "믿음", "소망", "인내", "겸손", "감사", "웃음", "우정", "가족",
  "고향", "추억", "약속", "모험", "여행", "발견", "시작", "완성",
  "새벽별", "은하수", "오로라", "유성", "혜성", "태양", "수성", "금성",
  "지구", "화성", "목성", "토성", "천왕성", "해왕성", "명왕성", "안드로메다",
  "기린", "코끼리", "사자", "판다", "펭귄", "수달", "여우", "늑대",
  "올빼미", "공작", "두루미", "백조", "앵무새", "카멜레온", "해마", "불가사리",
  "진달래", "개나리", "목련", "철쭉", "수선화", "코스모스", "억새", "갈대",
  "다이아몬드", "루비", "사파이어", "에메랄드", "자수정", "터키석", "산호", "호박석",
  "활", "검", "방패", "깃발", "왕관", "옥새", "두루마리", "횃불",
];

// ============================================
// Storage Paths
// ============================================

function getDataDir(): string {
  return process.env.MOA_DATA_DIR ?? join(process.cwd(), ".moa-data");
}

function getVaultDir(): string {
  const dir = join(getDataDir(), "vault");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function getSubDir(sub: string): string {
  const dir = join(getVaultDir(), sub);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ============================================
// Key Derivation
// ============================================

/**
 * PBKDF2로 비밀구문에서 암호화 키를 파생합니다.
 * - 동일 비밀구문 + 동일 salt → 동일 키 (결정적)
 * - salt는 vault 생성 시 1회 생성, vault-meta.json에 저장
 */
function deriveKey(secret: string, salt: Buffer): Buffer {
  return pbkdf2Sync(secret, salt, PBKDF2_ITERATIONS, KEY_LENGTH, "sha512");
}

// ============================================
// Vault Meta Operations
// ============================================

function getVaultMetaPath(): string {
  return join(getVaultDir(), "vault-meta.json");
}

/**
 * Vault 메타데이터를 로드합니다.
 */
export function loadVaultMeta(): VaultMeta | null {
  const path = getVaultMetaPath();
  if (!existsSync(path)) { return null; }
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as VaultMeta;
  } catch {
    return null;
  }
}

/**
 * Vault를 초기화합니다 (최초 1회).
 * 새로운 salt를 생성하고 메타데이터를 저장합니다.
 */
export function initializeVault(retentionPolicy?: Partial<RetentionPolicy>): VaultMeta {
  const existing = loadVaultMeta();
  if (existing) { return existing; }

  const meta: VaultMeta = {
    salt: randomBytes(32).toString("hex"),
    iterations: PBKDF2_ITERATIONS,
    algorithm: ALGORITHM,
    keyLength: KEY_LENGTH,
    createdAt: Date.now(),
    retentionPolicy: { ...DEFAULT_RETENTION, ...retentionPolicy },
  };

  writeFileSync(getVaultMetaPath(), JSON.stringify(meta, null, 2), "utf-8");
  console.log("[Vault] Initialized new vault");
  return meta;
}

/**
 * Vault가 초기화되어 있는지 확인합니다.
 */
export function isVaultInitialized(): boolean {
  return !!loadVaultMeta();
}

// ============================================
// Encryption / Decryption
// ============================================

/**
 * 데이터를 AES-256-GCM으로 암호화합니다.
 */
function encrypt(data: string, key: Buffer): { iv: string; authTag: string; encrypted: string } {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  let encrypted = cipher.update(data, "utf-8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  return {
    iv: iv.toString("hex"),
    authTag,
    encrypted,
  };
}

/**
 * AES-256-GCM 암호화된 데이터를 복호화합니다.
 */
function decrypt(encrypted: string, key: Buffer, iv: string, authTag: string): string {
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, "hex"), {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(Buffer.from(authTag, "hex"));

  let decrypted = decipher.update(encrypted, "hex", "utf-8");
  decrypted += decipher.final("utf-8");

  return decrypted;
}

// ============================================
// Backup Operations
// ============================================

/**
 * 암호화된 백업을 생성합니다.
 *
 * @param data - 백업할 데이터 (JSON 직렬화 가능한 객체)
 * @param secret - 암호화에 사용할 비밀구문 (MOA_OWNER_SECRET)
 * @param type - 백업 유형
 */
export function createEncryptedBackup(
  data: Record<string, unknown>,
  secret: string,
  type: "daily" | "weekly" | "monthly" | "manual" = "manual",
): { filePath: string; size: number } {
  const meta = initializeVault();
  const salt = Buffer.from(meta.salt, "hex");
  const key = deriveKey(secret, salt);

  const jsonData = JSON.stringify(data);
  const checksum = createHash("sha256").update(jsonData).digest("hex");
  const { iv, authTag, encrypted } = encrypt(jsonData, key);

  const payload: EncryptedPayload = {
    iv,
    authTag,
    encrypted,
    timestamp: Date.now(),
    type,
    checksum,
  };

  // Determine file path based on type
  const now = new Date();
  let fileName: string;
  let subDir: string;

  switch (type) {
    case "daily":
      subDir = "daily";
      fileName = `${now.toISOString().slice(0, 10)}.vault`;
      break;
    case "weekly": {
      subDir = "weekly";
      const weekNum = getISOWeek(now);
      fileName = `${now.getFullYear()}-W${String(weekNum).padStart(2, "0")}.vault`;
      break;
    }
    case "monthly":
      subDir = "monthly";
      fileName = `${now.toISOString().slice(0, 7)}.vault`;
      break;
    default:
      subDir = "manual";
      fileName = `backup-${now.toISOString().slice(0, 19).replace(/:/g, "-")}.vault`;
  }

  const dir = getSubDir(subDir);
  const filePath = join(dir, fileName);
  const fileContent = JSON.stringify(payload);

  writeFileSync(filePath, fileContent, "utf-8");

  // Update meta
  meta.lastBackupAt = Date.now();
  writeFileSync(getVaultMetaPath(), JSON.stringify(meta, null, 2), "utf-8");

  console.log(`[Vault] Created ${type} backup: ${fileName} (${fileContent.length} bytes)`);

  return { filePath, size: fileContent.length };
}

/**
 * 암호화된 백업을 복호화합니다.
 */
export function restoreFromBackup(
  filePath: string,
  secret: string,
): { data: Record<string, unknown>; timestamp: number; verified: boolean } | null {
  const meta = loadVaultMeta();
  if (!meta) {
    console.error("[Vault] Vault not initialized");
    return null;
  }

  try {
    const fileContent = readFileSync(filePath, "utf-8");
    const payload = JSON.parse(fileContent) as EncryptedPayload;

    const salt = Buffer.from(meta.salt, "hex");
    const key = deriveKey(secret, salt);

    const decrypted = decrypt(payload.encrypted, key, payload.iv, payload.authTag);

    // Verify checksum
    const checksum = createHash("sha256").update(decrypted).digest("hex");
    const verified = checksum === payload.checksum;

    if (!verified) {
      console.warn("[Vault] Checksum mismatch — data may be corrupted");
    }

    const data = JSON.parse(decrypted) as Record<string, unknown>;

    return { data, timestamp: payload.timestamp, verified };
  } catch (err) {
    console.error("[Vault] Restore failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * 복구 키(니모닉)로 백업을 복호화합니다.
 */
export function restoreWithRecoveryKey(
  filePath: string,
  mnemonicWords: string[],
): { data: Record<string, unknown>; timestamp: number; verified: boolean } | null {
  // 니모닉에서 비밀구문을 재파생
  const secret = mnemonicToSecret(mnemonicWords);
  return restoreFromBackup(filePath, secret);
}

// ============================================
// Recovery Key (12-word Mnemonic)
// ============================================

/**
 * 12단어 복구 키를 발급합니다.
 *
 * 복구 키는 MOA_OWNER_SECRET과는 별개의 독립적인 복호화 수단입니다.
 * 주인이 비밀구문을 잊어도 복구 키로 백업을 복원할 수 있습니다.
 *
 * 발급 후 반드시 안전한 곳에 보관해야 합니다 (종이에 적기 권장).
 * 서버에는 해시만 저장하고, 키 자체는 저장하지 않습니다.
 */
export function generateRecoveryKey(): RecoveryKeyResult {
  // 12개의 랜덤 단어 선택
  const words: string[] = [];
  const usedIndices = new Set<number>();

  while (words.length < 12) {
    const bytes = randomBytes(2);
    const index = bytes.readUInt16BE(0) % MNEMONIC_WORDS.length;
    if (!usedIndices.has(index)) {
      usedIndices.add(index);
      words.push(MNEMONIC_WORDS[index]);
    }
  }

  // 해시 생성 (검증용)
  const hash = createHash("sha256").update(words.join(" ")).digest("hex");

  // 표시용 문자열
  const display = words.map((w, i) => `${i + 1}. ${w}`).join("\n");

  // vault-meta에 해시 저장
  const meta = initializeVault();
  meta.recoveryKeyHash = hash;
  writeFileSync(getVaultMetaPath(), JSON.stringify(meta, null, 2), "utf-8");

  return { words, display, hash };
}

/**
 * 복구 키를 검증합니다.
 */
export function verifyRecoveryKey(words: string[]): boolean {
  const meta = loadVaultMeta();
  if (!meta?.recoveryKeyHash) { return false; }

  const hash = createHash("sha256").update(words.join(" ")).digest("hex");
  return hash === meta.recoveryKeyHash;
}

/**
 * 니모닉 단어에서 비밀 키를 파생합니다.
 */
function mnemonicToSecret(words: string[]): string {
  // 니모닉 자체를 비밀구문으로 사용 (PBKDF2가 키를 파생)
  return `moa-recovery:${words.join(" ")}`;
}

/**
 * 복구 키를 사용해 별도의 암호화 백업을 생성합니다.
 * (주 비밀구문과 별개로 복구 키로도 복호화 가능하도록)
 */
export function createRecoveryBackup(
  data: Record<string, unknown>,
  recoveryWords: string[],
): { filePath: string; size: number } {
  const secret = mnemonicToSecret(recoveryWords);
  return createEncryptedBackup(data, secret, "manual");
}

// ============================================
// Retention Policy (타임머신 회전)
// ============================================

/**
 * 보관 정책에 따라 오래된 백업을 정리합니다.
 * 타임머신처럼:
 * - 최근 N일: 일일 백업 유지
 * - 최근 N주: 주간 백업 유지
 * - 최근 N개월: 월간 백업 유지
 */
export function enforceRetentionPolicy(): { deleted: string[]; kept: number } {
  const meta = loadVaultMeta();
  if (!meta) { return { deleted: [], kept: 0 }; }

  const policy = meta.retentionPolicy;
  const now = Date.now();
  const deleted: string[] = [];
  let kept = 0;

  // Clean daily backups
  const dailyDir = getSubDir("daily");
  const dailyCutoff = now - policy.dailyKeepDays * 24 * 60 * 60 * 1000;
  kept += cleanDirectory(dailyDir, dailyCutoff, deleted);

  // Clean weekly backups
  const weeklyDir = getSubDir("weekly");
  const weeklyCutoff = now - policy.weeklyKeepWeeks * 7 * 24 * 60 * 60 * 1000;
  kept += cleanDirectory(weeklyDir, weeklyCutoff, deleted);

  // Clean monthly backups
  const monthlyDir = getSubDir("monthly");
  const monthlyCutoff = now - policy.monthlyKeepMonths * 30 * 24 * 60 * 60 * 1000;
  kept += cleanDirectory(monthlyDir, monthlyCutoff, deleted);

  if (deleted.length > 0) {
    console.log(`[Vault] Retention cleanup: deleted ${deleted.length}, kept ${kept}`);
  }

  return { deleted, kept };
}

function cleanDirectory(dir: string, cutoffMs: number, deleted: string[]): number {
  if (!existsSync(dir)) { return 0; }

  const files = readdirSync(dir).filter((f) => f.endsWith(".vault"));
  let kept = 0;

  for (const file of files) {
    const filePath = join(dir, file);
    try {
      const content = JSON.parse(readFileSync(filePath, "utf-8")) as EncryptedPayload;
      if (content.timestamp < cutoffMs) {
        unlinkSync(filePath);
        deleted.push(file);
      } else {
        kept++;
      }
    } catch {
      // Can't parse — skip
      kept++;
    }
  }

  return kept;
}

/**
 * 일일 자동 백업을 실행합니다 (서버 시작 시 또는 cron 호출).
 * 주간/월간 백업도 해당 시점이면 함께 생성합니다.
 */
export function runScheduledBackup(
  data: Record<string, unknown>,
  secret: string,
): { daily: boolean; weekly: boolean; monthly: boolean } {
  const now = new Date();
  const result = { daily: false, weekly: false, monthly: false };

  // 일일 백업
  const dailyFile = join(getSubDir("daily"), `${now.toISOString().slice(0, 10)}.vault`);
  if (!existsSync(dailyFile)) {
    createEncryptedBackup(data, secret, "daily");
    result.daily = true;
  }

  // 주간 백업 (월요일)
  if (now.getDay() === 1) {
    const weekNum = getISOWeek(now);
    const weeklyFile = join(
      getSubDir("weekly"),
      `${now.getFullYear()}-W${String(weekNum).padStart(2, "0")}.vault`,
    );
    if (!existsSync(weeklyFile)) {
      createEncryptedBackup(data, secret, "weekly");
      result.weekly = true;
    }
  }

  // 월간 백업 (1일)
  if (now.getDate() === 1) {
    const monthlyFile = join(getSubDir("monthly"), `${now.toISOString().slice(0, 7)}.vault`);
    if (!existsSync(monthlyFile)) {
      createEncryptedBackup(data, secret, "monthly");
      result.monthly = true;
    }
  }

  // 보관 정책 적용
  enforceRetentionPolicy();

  return result;
}

// ============================================
// Device Local Key (생체인증 연동용 API)
// ============================================

/**
 * 디바이스 로컬 키를 등록합니다.
 *
 * ## 생체인증 연동 흐름:
 * 1. 기기 앱에서 FaceID/TouchID로 인증
 * 2. 성공 시 기기가 키 쌍(공개키/개인키) 생성
 * 3. 공개키를 서버에 등록 (이 함수)
 * 4. 서버 → 기기: 공개키로 암호화된 세션 키 전송
 * 5. 기기: 개인키(Secure Enclave)로 복호화
 *
 * 서버는 개인키를 절대 모름 = zero-knowledge
 */
export function registerDeviceKey(deviceId: string, publicKey: string): void {
  const dir = getSubDir("device-keys");
  const reg: DeviceKeyRegistration = {
    deviceId,
    publicKey,
    registeredAt: Date.now(),
  };
  writeFileSync(join(dir, `${deviceId}.json`), JSON.stringify(reg, null, 2), "utf-8");
  console.log(`[Vault] Registered device key: ${deviceId}`);
}

/**
 * 디바이스의 공개키를 가져옵니다.
 */
export function getDeviceKey(deviceId: string): DeviceKeyRegistration | null {
  const filePath = join(getSubDir("device-keys"), `${deviceId}.json`);
  if (!existsSync(filePath)) { return null; }
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as DeviceKeyRegistration;
  } catch {
    return null;
  }
}

/**
 * 디바이스에서 이미 암호화된 데이터를 받아 저장합니다.
 * 서버는 데이터를 복호화하지 않고 그대로 보관합니다 (zero-knowledge).
 */
export function storeDeviceEncryptedData(
  deviceId: string,
  encryptedData: string,
): { filePath: string } {
  const dir = getSubDir("device-encrypted");
  const fileName = `${deviceId}-${Date.now()}.enc`;
  const filePath = join(dir, fileName);
  writeFileSync(filePath, encryptedData, "utf-8");
  return { filePath };
}

// ============================================
// Backup Listing & Info
// ============================================

/** 백업 파일 정보 */
export interface BackupInfo {
  fileName: string;
  filePath: string;
  type: "daily" | "weekly" | "monthly" | "manual";
  timestamp: number;
  size: number;
}

/**
 * 모든 백업 목록을 가져옵니다.
 */
export function listBackups(): BackupInfo[] {
  const backups: BackupInfo[] = [];

  for (const type of ["daily", "weekly", "monthly", "manual"] as const) {
    const dir = getSubDir(type);
    if (!existsSync(dir)) { continue; }

    const files = readdirSync(dir).filter((f) => f.endsWith(".vault"));
    for (const file of files) {
      const filePath = join(dir, file);
      try {
        const content = readFileSync(filePath, "utf-8");
        const payload = JSON.parse(content) as EncryptedPayload;
        backups.push({
          fileName: file,
          filePath,
          type,
          timestamp: payload.timestamp,
          size: content.length,
        });
      } catch {
        // Skip malformed
      }
    }
  }

  return backups.toSorted((a, b) => b.timestamp - a.timestamp);
}

/**
 * 백업 용량 통계를 계산합니다.
 */
export function getBackupStats(): {
  totalFiles: number;
  totalSize: number;
  totalSizeKB: string;
  byType: Record<string, { count: number; size: number }>;
  oldestBackup?: number;
  newestBackup?: number;
} {
  const backups = listBackups();
  const byType: Record<string, { count: number; size: number }> = {};
  let totalSize = 0;

  for (const b of backups) {
    totalSize += b.size;
    if (!byType[b.type]) { byType[b.type] = { count: 0, size: 0 }; }
    byType[b.type].count++;
    byType[b.type].size += b.size;
  }

  return {
    totalFiles: backups.length,
    totalSize,
    totalSizeKB: (totalSize / 1024).toFixed(1),
    byType,
    oldestBackup: backups.length > 0 ? backups[backups.length - 1].timestamp : undefined,
    newestBackup: backups.length > 0 ? backups[0].timestamp : undefined,
  };
}

// ============================================
// Formatting for Chat Display
// ============================================

/**
 * 백업 목록을 채팅용으로 포맷합니다.
 */
export function formatBackupList(backups: BackupInfo[], maxLen: number = 2000): string {
  if (backups.length === 0) {
    return "저장된 백업이 없습니다.\n\n\"!백업\"으로 수동 백업을 생성하세요.";
  }

  const typeEmoji: Record<string, string> = {
    daily: "📅",
    weekly: "📆",
    monthly: "🗓️",
    manual: "💾",
  };

  const typeLabel: Record<string, string> = {
    daily: "일일",
    weekly: "주간",
    monthly: "월간",
    manual: "수동",
  };

  let output = "🔐 암호화 백업 목록\n\n";

  for (const b of backups) {
    const time = new Date(b.timestamp).toLocaleString("ko-KR", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
    const emoji = typeEmoji[b.type] ?? "📦";
    const label = typeLabel[b.type] ?? b.type;
    const sizeKB = (b.size / 1024).toFixed(1);

    output += `${emoji} ${label}: ${b.fileName}\n`;
    output += `   ${time} · ${sizeKB}KB\n`;
    if (output.length > maxLen - 100) {
      output += "\n...";
      break;
    }
  }

  const stats = getBackupStats();
  output += `\n총 ${stats.totalFiles}개 · ${stats.totalSizeKB}KB`;
  output += `\n복원: "!백업 복원 [파일명]"`;

  return output;
}

/**
 * 복구 키를 채팅용으로 포맷합니다.
 */
export function formatRecoveryKey(result: RecoveryKeyResult): string {
  return [
    "🔑 복구 키가 발급되었습니다!",
    "",
    "아래 12단어를 안전한 곳에 보관하세요.",
    "이 키로 비밀구문을 잊어도 백업을 복원할 수 있습니다.",
    "",
    "┌─────────────────────────────┐",
    ...result.words.map((w, i) => `│  ${String(i + 1).padStart(2, " ")}. ${w.padEnd(10, " ")}           │`),
    "└─────────────────────────────┘",
    "",
    "⚠️ 이 키는 다시 표시되지 않습니다!",
    "⚠️ 종이에 적어서 안전한 곳에 보관하세요.",
    "⚠️ 스크린샷은 권장하지 않습니다.",
  ].join("\n");
}

// ============================================
// Helpers
// ============================================

function getISOWeek(date: Date): number {
  const d = new Date(date.getTime());
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}
