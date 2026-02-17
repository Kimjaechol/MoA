#!/bin/bash
# MoA SLM Installation Script
# Installs Ollama and Qwen3-0.6B core model only (~400MB)
# All advanced tasks use Gemini 2.0 Flash (cloud)

set -e

echo "MoA 로컬 AI 설치 스크립트"
echo "================================"
echo ""
echo "Architecture:"
echo "  - Core: Qwen3-0.6B (local, ~400MB) - intent classification, routing, heartbeat"
echo "  - Cloud: Gemini 3.0 Flash (가성비) / Claude Opus 4.6 (최고성능)"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check OS
OS=$(uname -s)
ARCH=$(uname -m)

echo -e "${BLUE}시스템 정보:${NC} $OS $ARCH"
echo ""

# ============================================
# Step 1: Install Ollama
# ============================================

install_ollama() {
    echo -e "${YELLOW}[1/3] Ollama 설치 중...${NC}"

    if command -v ollama &> /dev/null; then
        echo -e "${GREEN}✓ Ollama가 이미 설치되어 있습니다.${NC}"
        ollama --version
        return 0
    fi

    case "$OS" in
        Darwin)
            if command -v brew &> /dev/null; then
                echo "Homebrew로 설치 중..."
                brew install ollama
            else
                echo "curl로 설치 중..."
                curl -fsSL https://ollama.com/install.sh | sh
            fi
            ;;
        Linux)
            curl -fsSL https://ollama.com/install.sh | sh
            ;;
        MINGW*|MSYS*|CYGWIN*)
            echo -e "${RED}Windows에서는 https://ollama.com/download 에서 직접 다운로드하세요.${NC}"
            exit 1
            ;;
        *)
            echo -e "${RED}지원하지 않는 운영체제: $OS${NC}"
            exit 1
            ;;
    esac

    echo -e "${GREEN}✓ Ollama 설치 완료${NC}"
}

# ============================================
# Step 2: Start Ollama Server
# ============================================

start_ollama_server() {
    echo ""
    echo -e "${YELLOW}[2/3] Ollama 서버 시작 중...${NC}"

    if curl -s http://127.0.0.1:11434/api/tags > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Ollama 서버가 이미 실행 중입니다.${NC}"
        return 0
    fi

    echo "서버 시작 중..."
    nohup ollama serve > /tmp/ollama.log 2>&1 &

    for i in {1..30}; do
        if curl -s http://127.0.0.1:11434/api/tags > /dev/null 2>&1; then
            echo -e "${GREEN}✓ Ollama 서버 시작 완료${NC}"
            return 0
        fi
        sleep 1
        echo -n "."
    done

    echo ""
    echo -e "${RED}✗ Ollama 서버 시작 실패${NC}"
    echo "로그 확인: cat /tmp/ollama.log"
    exit 1
}

# ============================================
# Step 3: Download Core Model (Tier 1 only)
# ============================================

download_core_model() {
    echo ""
    echo -e "${YELLOW}[3/3] MoA 코어 모델 다운로드 중...${NC}"
    echo ""

    echo -e "${BLUE}Qwen3-0.6B-Q4 (코어 게이트키퍼)${NC}"
    echo "  - 역할: 의도분류, 라우팅, 하트비트 체크, 프라이버시 감지"
    echo "  - 크기: ~400MB (Q4_K_M 양자화)"
    echo "  - 실행: 항시 백그라운드"
    echo ""

    if ollama list | grep -q "qwen3:0.6b-q4_K_M"; then
        echo -e "${GREEN}✓ qwen3:0.6b-q4_K_M 이미 설치됨${NC}"
    else
        echo "다운로드 중... (약 400MB)"
        ollama pull qwen3:0.6b-q4_K_M
        echo -e "${GREEN}✓ qwen3:0.6b-q4_K_M 설치 완료${NC}"
    fi

    echo ""
    echo -e "${BLUE}고급 작업은 클라우드 AI가 처리합니다.${NC}"
    echo "  - 로컬 Tier 2/3 모델은 설치하지 않습니다."
    echo "  - 가성비: Gemini 3.0 Flash / 최고성능: Claude Opus 4.6"
}

# ============================================
# Step 4: Verify Installation
# ============================================

verify_installation() {
    echo ""
    echo -e "${YELLOW}설치 확인 중...${NC}"
    echo ""

    echo "설치된 모델:"
    ollama list
    echo ""

    echo "빠른 테스트 (qwen3:0.6b-q4_K_M)..."
    RESPONSE=$(ollama run qwen3:0.6b-q4_K_M "Say 'MoA ready' in Korean" 2>/dev/null | head -1)

    if [ -n "$RESPONSE" ]; then
        echo -e "${GREEN}✓ 테스트 성공: $RESPONSE${NC}"
    else
        echo -e "${YELLOW}⚠ 테스트 응답 없음 (정상일 수 있음)${NC}"
    fi
}

# ============================================
# Main
# ============================================

main() {
    echo ""

    install_ollama
    start_ollama_server
    download_core_model
    verify_installation

    echo ""
    echo "================================"
    echo -e "${GREEN}MoA 로컬 AI 설치 완료!${NC}"
    echo ""
    echo "설치 구성:"
    echo "  - 코어 AI: qwen3:0.6b-q4_K_M (~400MB, 로컬) - 의도분류/라우팅/하트비트"
    echo "  - 클라우드 AI: Gemini 3.0 Flash (가성비) / Claude Opus 4.6 (최고성능)"
    echo ""
    echo "수동 테스트:"
    echo "  ollama run qwen3:0.6b-q4_K_M '안녕하세요'"
    echo ""
    echo "서버 상태 확인:"
    echo "  curl http://127.0.0.1:11434/api/tags"
    echo ""
}

main "$@"
