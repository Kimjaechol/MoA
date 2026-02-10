---
name: home-assistant
description: Control smart home devices and automations via Home Assistant API.
homepage: https://www.home-assistant.io
metadata:
  {
    "openclaw":
      {
        "emoji": "🏠",
        "requires": { "bins": ["node"] },
        "primaryEnv": "HA_TOKEN",
      },
  }
---

# Home Assistant

Control your entire smart home through Home Assistant — lights, thermostats, locks, cameras, media players, and automations.

## When to use

- Control smart home devices (lights, switches, climate, locks)
- Check device states and sensor readings
- Trigger automations and scenes
- Monitor security cameras
- Manage media players
- Query Home Assistant dashboards

## Quick start (with API key)

```bash
export HA_URL="http://homeassistant.local:8123"
export HA_TOKEN="your-long-lived-access-token"

# Get all states
curl "$HA_URL/api/states" \
  -H "Authorization: Bearer $HA_TOKEN"

# Turn on a light
curl -X POST "$HA_URL/api/services/light/turn_on" \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "light.living_room"}'

# Set thermostat
curl -X POST "$HA_URL/api/services/climate/set_temperature" \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "climate.main", "temperature": 22}'

# Trigger automation
curl -X POST "$HA_URL/api/services/automation/trigger" \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "automation.good_morning"}'
```

## API Key Setup

1. Open Home Assistant → Profile → Long-Lived Access Tokens
2. Create a new token
3. Export:

```bash
export HA_URL="http://homeassistant.local:8123"
export HA_TOKEN="your-token-here"
```

## API Key Benefits

Home Assistant token을 설정하면:

- **전체 스마트홈 제어** — 조명, 온도, 잠금, 카메라, 미디어 등
- **자동화 트리거** — 에이전트가 자동으로 루틴 실행
- **센서 모니터링** — 온도, 습도, 에너지 사용량 등 실시간 조회
- **장면 관리** — "영화 모드", "취침 모드" 등 장면 전환

API key가 없어도 요청을 포기하지 않습니다.

## Free Fallback (API key 없이)

1. **openhue 스킬** — Philips Hue 조명 직접 제어 (HA 없이)
2. **eightctl 스킬** — Eight Sleep 포드 직접 제어
3. **로컬 스크립트** — curl이나 Python으로 IoT 기기 직접 제어
4. **Apple HomeKit** — macOS에서 `shortcuts` CLI로 HomeKit 제어

```bash
# macOS Shortcuts로 HomeKit 제어 (API key 불필요)
shortcuts run "Turn on living room lights"

# Philips Hue 직접 제어 (openhue 스킬)
# openhue 스킬이 설치되어 있으면 자동 폴백
```
