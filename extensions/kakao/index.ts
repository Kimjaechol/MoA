import type { MoltbotPluginApi } from "clawdbot/plugin-sdk";
import { kakaoPlugin } from "./src/channel.js";
import { setKakaoRuntime } from "./src/runtime.js";
import { createKakaoApiClient } from "./src/api-client.js";
import { resolveKakaoAccount } from "./src/config.js";
import { generateSystemPrompt, parseLawCallRoutes } from "./src/lawcall-router.js";

/**
 * KakaoTalk Channel Plugin for Moltbot
 *
 * This plugin enables Moltbot to communicate via KakaoTalk using:
 * 1. Kakao i Open Builder - Skill server for receiving messages
 * 2. Kakao Friend Talk - For proactive outbound messages (optional)
 *
 * Setup:
 * 1. Create a Kakao Developers app at https://developers.kakao.com
 * 2. Create a Kakao i Open Builder bot at https://i.kakao.com
 * 3. Configure the skill URL to point to your Moltbot webhook
 * 4. (Optional) Set up NHN Cloud Toast for Friend Talk
 *
 * Configuration example (~/.moltbot.json):
 * {
 *   "channels": {
 *     "kakao": {
 *       "accounts": {
 *         "default": {
 *           "adminKey": "your-rest-api-key",
 *           "channelId": "your-channel-id",
 *           "webhookPort": 8788,
 *           "webhookPath": "/kakao/webhook"
 *         }
 *       }
 *     }
 *   }
 * }
 *
 * Environment variables:
 * - KAKAO_ADMIN_KEY or KAKAO_REST_API_KEY: REST API Admin Key
 * - KAKAO_APP_KEY or KAKAO_JAVASCRIPT_KEY: JavaScript Key
 * - KAKAO_CHANNEL_ID: Kakao Channel ID
 * - KAKAO_SENDER_KEY: Sender Key for Friend Talk
 * - TOAST_APP_KEY: NHN Cloud Toast App Key
 * - TOAST_SECRET_KEY: NHN Cloud Toast Secret Key
 */

const emptyPluginConfigSchema = () => ({
  parse: (value: unknown) => value ?? {},
  uiHints: {},
});

const kakaoPluginDefinition = {
  id: "kakao",
  name: "KakaoTalk",
  description: "KakaoTalk channel plugin using Kakao i Open Builder and Friend Talk",
  configSchema: emptyPluginConfigSchema(),

  register(api: MoltbotPluginApi) {
    // Initialize runtime
    setKakaoRuntime(api.runtime);

    // Register the channel plugin
    api.registerChannel({ plugin: kakaoPlugin });

    // Register CLI commands
    api.registerCli(
      ({ program }) => {
        const kakaoCmd = program
          .command("kakao")
          .description("KakaoTalk channel management");

        // Status command
        kakaoCmd
          .command("status")
          .description("Show KakaoTalk channel status")
          .option("--account <id>", "Account ID", "default")
          .action(async (opts) => {
            const account = resolveKakaoAccount({
              cfg: api.config,
              accountId: opts.account,
            });

            if (!account) {
              console.log("❌ KakaoTalk not configured");
              console.log("\nTo configure, add to ~/.moltbot.json:");
              console.log(JSON.stringify({
                channels: {
                  kakao: {
                    accounts: {
                      default: {
                        adminKey: "YOUR_REST_API_KEY",
                        webhookPort: 8788,
                      },
                    },
                  },
                },
              }, null, 2));
              return;
            }

            console.log(`\n📱 KakaoTalk Channel Status`);
            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            console.log(`Account:    ${account.accountId}`);
            console.log(`Enabled:    ${account.enabled ? "✅" : "❌"}`);
            console.log(`Admin Key:  ${account.adminKey ? "✅ Configured" : "❌ Missing"}`);
            console.log(`Channel ID: ${account.channelId ?? "Not set"}`);
            console.log(`Sender Key: ${account.senderKey ? "✅ Configured" : "Not set"}`);
            console.log(`Toast Key:  ${account.toastAppKey ? "✅ Configured" : "Not set"}`);
            console.log(`\nWebhook:`);
            console.log(`  Port: ${account.config.webhookPort ?? 8788}`);
            console.log(`  Path: ${account.config.webhookPath ?? "/kakao/webhook"}`);

            // Probe API
            const client = createKakaoApiClient(account);
            const probe = await client.probe();
            console.log(`\nAPI Status: ${probe.ok ? "✅ Reachable" : "❌ Unreachable"} (${probe.latencyMs}ms)`);
          });

        // Send test message
        kakaoCmd
          .command("send <phone> <message>")
          .description("Send a test message via Friend Talk")
          .option("--account <id>", "Account ID", "default")
          .action(async (phone, message, opts) => {
            const account = resolveKakaoAccount({
              cfg: api.config,
              accountId: opts.account,
            });

            if (!account) {
              console.log("❌ KakaoTalk not configured");
              return;
            }

            if (!account.senderKey || !account.toastAppKey) {
              console.log("❌ Friend Talk not configured (need senderKey and toastAppKey)");
              return;
            }

            const client = createKakaoApiClient(account);
            console.log(`📤 Sending to ${phone}...`);

            const result = await client.sendFriendTalk({
              recipientNo: phone,
              content: message,
            });

            if (result.success) {
              console.log(`✅ Message sent! Request ID: ${result.requestId}`);
            } else {
              console.log(`❌ Failed: ${result.error}`);
            }
          });

        // LawCall routes status
        kakaoCmd
          .command("lawcall")
          .description("Show LawCall routing configuration")
          .action(async () => {
            const routes = parseLawCallRoutes();

            console.log(`\n⚖️  LawCall Routing Configuration`);
            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            console.log(`Service:    ${routes.serviceName}`);
            console.log(`Lawyer:     ${routes.lawyerName}`);
            console.log(`Default:    ${routes.defaultUrl}`);
            console.log(`\n📋 Categories:`);

            for (const cat of routes.categories) {
              console.log(`\n  ${cat.name}:`);
              console.log(`    URL: ${cat.url}`);
              console.log(`    Keywords: ${cat.keywords.slice(0, 5).join(", ")}${cat.keywords.length > 5 ? "..." : ""}`);
            }

            console.log(`\n💡 환경변수로 설정:`);
            console.log(`  LAWCALL_ROUTES='${JSON.stringify(Object.fromEntries(routes.categories.map(c => [c.name, c.url])))}'`);
            console.log(`  LAWCALL_LAWYER_NAME='${routes.lawyerName}'`);
            console.log(`  LAWCALL_SERVICE_NAME='${routes.serviceName}'`);
          });

        // Generate system prompt
        kakaoCmd
          .command("prompt")
          .description("Generate system prompt for LawCall agent")
          .action(async () => {
            const prompt = generateSystemPrompt();
            console.log(prompt);
          });

        // Setup wizard
        kakaoCmd
          .command("setup")
          .description("Interactive setup wizard")
          .action(async () => {
            console.log(`
╔══════════════════════════════════════════════════════════════╗
║              KakaoTalk Channel Setup Wizard                  ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  이 가이드는 Moltbot을 KakaoTalk과 연동하는 방법을 안내합니다.   ║
║                                                              ║
║  📋 준비 사항:                                                 ║
║  1. Kakao Developers 계정                                     ║
║  2. Kakao i Open Builder 계정                                 ║
║  3. (선택) NHN Cloud Toast 계정                               ║
║                                                              ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  📌 Step 1: Kakao Developers 앱 생성                          ║
║  ─────────────────────────────────────                       ║
║  1. https://developers.kakao.com 방문                         ║
║  2. "내 애플리케이션" → "애플리케이션 추가하기"                   ║
║  3. 앱 생성 후 "앱 키" 탭에서 REST API 키 복사                  ║
║                                                              ║
║  📌 Step 2: Kakao i Open Builder 스킬 설정                    ║
║  ─────────────────────────────────────────                   ║
║  1. https://i.kakao.com 방문                                  ║
║  2. 봇 생성 후 "스킬" → "스킬 생성"                             ║
║  3. 스킬 URL 입력: http://your-server:8788/kakao/webhook       ║
║  4. "시나리오"에서 스킬 연결                                    ║
║                                                              ║
║  📌 Step 3: 환경 변수 설정                                     ║
║  ─────────────────────────                                   ║
║  export KAKAO_ADMIN_KEY="your-rest-api-key"                  ║
║  export KAKAO_CHANNEL_ID="your-channel-id"                   ║
║                                                              ║
║  📌 Step 4: Moltbot 설정 (~/.moltbot.json)                   ║
║  ──────────────────────────────────────                      ║
║  {                                                           ║
║    "channels": {                                             ║
║      "kakao": {                                              ║
║        "accounts": {                                         ║
║          "default": {                                        ║
║            "enabled": true,                                  ║
║            "webhookPort": 8788                               ║
║          }                                                   ║
║        }                                                     ║
║      }                                                       ║
║    }                                                         ║
║  }                                                           ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝

💡 설정 후 'moltbot kakao status'로 상태를 확인하세요.
💡 웹훅 서버가 외부에서 접근 가능해야 합니다 (ngrok 등 사용).
`);
          });
      },
      { commands: ["kakao"] },
    );

    // Register gateway method for sending messages
    api.registerGatewayMethod("kakao.send", async ({ params, respond }) => {
      const account = resolveKakaoAccount({
        cfg: api.config,
        accountId: typeof params?.accountId === "string" ? params.accountId : "default",
      });

      if (!account) {
        respond(false, { error: "KakaoTalk not configured" });
        return;
      }

      const phone = typeof params?.to === "string" ? params.to : "";
      const message = typeof params?.message === "string" ? params.message : "";

      if (!phone || !message) {
        respond(false, { error: "phone (to) and message required" });
        return;
      }

      const client = createKakaoApiClient(account);
      const result = await client.sendFriendTalk({
        recipientNo: phone,
        content: message,
      });

      respond(result.success, result.success ? { requestId: result.requestId } : { error: result.error });
    });

    api.logger.info("[kakao] KakaoTalk channel plugin registered");
  },
};

export default kakaoPluginDefinition;
