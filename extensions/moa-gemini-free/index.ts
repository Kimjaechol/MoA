/**
 * MoA Gemini Free — Google 계정으로 Gemini 무료 사용
 *
 * 이 확장은 MoA 사용자가 별도의 API 키 구매 없이
 * Google 계정(Gmail)만으로 Gemini를 사용할 수 있게 합니다.
 *
 * 사용법:
 *   1. 플러그인 활성화: openclaw plugins enable moa-gemini-free
 *   2. 인증: openclaw models auth login --provider moa-gemini-free --set-default
 *   3. 브라우저에서 Google 로그인
 *   4. 바로 사용 가능!
 *
 * 무료 한도 (Google Code Assist Individuals):
 *   - 60 요청/분
 *   - 1,000 요청/일
 *   - Gemini Pro, Flash 등 전체 모델 사용 가능
 *
 * 주의: Google의 내부 API를 사용하므로 한도나 접근 방식이
 *       변경될 수 있습니다.
 */

import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { loginGeminiFree } from "./oauth.js";

const PROVIDER_ID = "moa-gemini-free";
const PROVIDER_LABEL = "Gemini Free (Google 계정)";
const DEFAULT_MODEL = "moa-gemini-free/gemini-2.5-pro";

const moaGeminiFreePlugin = {
  id: "moa-gemini-free",
  name: "MoA Gemini Free",
  description:
    "Google 계정으로 Gemini 무료 사용 — API 키 불필요, 월 추가 비용 없음",
  configSchema: emptyPluginConfigSchema(),
  register(api: {
    registerProvider: (config: {
      id: string;
      label: string;
      docsPath: string;
      aliases: string[];
      auth: Array<{
        id: string;
        label: string;
        hint: string;
        kind: string;
        run: (ctx: {
          isRemote: boolean;
          openUrl: (url: string) => Promise<void>;
          prompter: {
            progress: (msg: string) => {
              update: (msg: string) => void;
              stop: (msg?: string) => void;
            };
            note: (message: string, title?: string) => Promise<void>;
            text: (opts: { message: string }) => Promise<string | symbol>;
          };
          runtime: { log: (msg: string) => void };
        }) => Promise<{
          profiles: Array<{
            profileId: string;
            credential: {
              type: string;
              provider: string;
              access: string;
              refresh: string;
              expires: number;
              email?: string;
              projectId: string;
            };
          }>;
          configPatch: Record<string, unknown>;
          defaultModel: string;
          notes: string[];
        }>;
      }>;
    }) => void;
  }) {
    api.registerProvider({
      id: PROVIDER_ID,
      label: PROVIDER_LABEL,
      docsPath: "/providers/models",
      aliases: ["gemini-free", "moa-gemini"],
      auth: [
        {
          id: "oauth",
          label: "Google 계정 로그인",
          hint: "Google 계정으로 무료 Gemini 사용",
          kind: "oauth",
          run: async (ctx) => {
            const spin = ctx.prompter.progress("MoA Gemini Free 인증 시작...");
            try {
              const result = await loginGeminiFree({
                isRemote: ctx.isRemote,
                openUrl: ctx.openUrl,
                log: (msg) => ctx.runtime.log(msg),
                note: ctx.prompter.note,
                prompt: async (message) =>
                  String(await ctx.prompter.text({ message })),
                progress: spin,
              });

              spin.stop("MoA Gemini Free 인증 완료!");

              const profileId = `moa-gemini-free:${result.email ?? "default"}`;

              return {
                profiles: [
                  {
                    profileId,
                    credential: {
                      type: "oauth",
                      provider: PROVIDER_ID,
                      access: result.access,
                      refresh: result.refresh,
                      expires: result.expires,
                      email: result.email,
                      projectId: result.projectId,
                    },
                  },
                ],
                configPatch: {
                  agents: {
                    defaults: {
                      models: {
                        [DEFAULT_MODEL]: {},
                      },
                    },
                  },
                },
                defaultModel: DEFAULT_MODEL,
                notes: [
                  "Gemini Free 인증이 완료되었습니다!",
                  "무료 한도: 60 요청/분, 1,000 요청/일",
                  "사용 가능 모델: Gemini Pro, Flash 등",
                  "",
                  "요청 실패 시 GOOGLE_CLOUD_PROJECT 환경 변수를 설정해 보세요.",
                ],
              };
            } catch (err) {
              spin.stop("MoA Gemini Free 인증 실패");
              await ctx.prompter.note(
                [
                  "인증에 실패했습니다. 확인사항:",
                  "1. Google 계정이 Gemini 접근 권한이 있는지 확인",
                  "2. 네트워크 연결 상태 확인",
                  "3. 브라우저 팝업 차단 해제",
                ].join("\n"),
                "인증 도움말",
              );
              throw err;
            }
          },
        },
      ],
    });
  },
};

export default moaGeminiFreePlugin;
