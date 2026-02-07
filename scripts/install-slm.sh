#!/bin/bash
# MoA SLM Installation Script
# Installs Ollama and downloads Qwen3 models (Q4 quantized)

set -e

echo "🤖 MoA 로컬 AI 설치 스크립트"
echo "================================"
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
            # macOS
            if command -v brew &> /dev/null; then
                echo "Homebrew로 설치 중..."
                brew install ollama
            else
                echo "curl로 설치 중..."
                curl -fsSL https://ollama.com/install.sh | sh
            fi
            ;;
        Linux)
            # Linux
            curl -fsSL https://ollama.com/install.sh | sh
            ;;
        MINGW*|MSYS*|CYGWIN*)
            # Windows (Git Bash)
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

    # Check if already running
    if curl -s http://127.0.0.1:11434/api/tags > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Ollama 서버가 이미 실행 중입니다.${NC}"
        return 0
    fi

    # Start server in background
    echo "서버 시작 중..."
    nohup ollama serve > /tmp/ollama.log 2>&1 &

    # Wait for server to start
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
# Step 3: Download Models
# ============================================

download_models() {
    echo ""
    echo -e "${YELLOW}[3/3] MoA SLM 모델 다운로드 중...${NC}"
    echo ""

    # Tier 1: Qwen3-0.6B (Agent Core)
    echo -e "${BLUE}Tier 1: Qwen3-0.6B (에이전트 코어)${NC}"
    echo "  - 역할: 라우팅, 의도분류, 도구호출, 기본응답"
    echo "  - 크기: ~500MB (Q4 양자화)"
    echo "  - 실행: 항시 백그라운드"
    echo ""

    if ollama list | grep -q "qwen3:0.6b"; then
        echo -e "${GREEN}✓ qwen3:0.6b 이미 설치됨${NC}"
    else
        echo "다운로드 중... (약 400MB)"
        ollama pull qwen3:0.6b
        echo -e "${GREEN}✓ qwen3:0.6b 설치 완료${NC}"
    fi

    echo ""

    # Check memory for Tier 2
    TOTAL_MEM_GB=$(free -g 2>/dev/null | awk '/^Mem:/{print $2}' || sysctl -n hw.memsize 2>/dev/null | awk '{print int($1/1024/1024/1024)}' || echo "8")

    if [ "$TOTAL_MEM_GB" -lt 6 ]; then
        echo -e "${YELLOW}⚠ 메모리 부족 (${TOTAL_MEM_GB}GB) - Tier 2 건너뜀${NC}"
        echo "  Tier 2는 6GB 이상의 RAM이 필요합니다."
        echo "  나중에 'ollama pull qwen3:4b'로 설치할 수 있습니다."
    else
        # Tier 2: Qwen3-4B (Advanced Processing)
        echo -e "${BLUE}Tier 2: Qwen3-4B (고급 처리)${NC}"
        echo "  - 역할: 오프라인 심층추론, 복잡한 대화"
        echo "  - 크기: ~3.5GB (Q4 양자화)"
        echo "  - 실행: 온디맨드 (필요시 로드)"
        echo ""

        if ollama list | grep -q "qwen3:4b"; then
            echo -e "${GREEN}✓ qwen3:4b 이미 설치됨${NC}"
        else
            echo "다운로드 중... (약 2.6GB)"
            ollama pull qwen3:4b
            echo -e "${GREEN}✓ qwen3:4b 설치 완료${NC}"
        fi
    fi
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

    # Quick test
    echo "빠른 테스트 (qwen3:0.6b)..."
    RESPONSE=$(ollama run qwen3:0.6b "Say 'MoA ready' in Korean" 2>/dev/null | head -1)

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
    download_models
    verify_installation

    echo ""
    echo "================================"
    echo -e "${GREEN}🎉 MoA 로컬 AI 설치 완료!${NC}"
    echo ""
    echo "설치된 모델:"
    echo "  • Tier 1: qwen3:0.6b (~500MB) - 항시 실행"
    echo "  • Tier 2: qwen3:4b (~3.5GB) - 온디맨드"
    echo ""
    echo "수동 테스트:"
    echo "  ollama run qwen3:0.6b '안녕하세요'"
    echo ""
    echo "서버 상태 확인:"
    echo "  curl http://127.0.0.1:11434/api/tags"
    echo ""
}

main "$@"
