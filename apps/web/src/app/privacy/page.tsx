import Nav from "../../components/Nav";

export default function PrivacyPolicy() {
  return (
    <>
      <Nav />
      <main
        style={{
          paddingTop: "100px",
          paddingBottom: "80px",
          minHeight: "100vh",
        }}
      >
        <div className="container" style={{ maxWidth: "800px" }}>
          <h1
            style={{
              fontSize: "clamp(1.8rem, 4vw, 2.5rem)",
              fontWeight: 800,
              marginBottom: "12px",
            }}
          >
            개인정보취급방침
          </h1>
          <p
            style={{
              color: "var(--text-muted)",
              fontSize: "0.9rem",
              marginBottom: "48px",
            }}
          >
            시행일: 2025년 7월 1일 &nbsp;|&nbsp; 최종 수정일: 2025년 7월 1일
          </p>

          <article className="legal-content">
            <section style={sectionStyle}>
              <h2 style={h2Style}>제1조 (목적)</h2>
              <p style={pStyle}>
                로콜(이하 &ldquo;회사&rdquo;)은 MoA(Master of AI) 서비스(이하
                &ldquo;서비스&rdquo;)를 제공함에 있어 이용자의 개인정보를
                보호하고, 이와 관련한 고충을 신속하고 원활하게 처리할 수 있도록
                하기 위하여 다음과 같이 개인정보취급방침을 수립하고 공개합니다.
              </p>
            </section>

            <section style={sectionStyle}>
              <h2 style={h2Style}>제2조 (수집하는 개인정보 항목)</h2>
              <p style={pStyle}>
                회사는 서비스 제공을 위해 아래와 같은 개인정보를 수집합니다.
              </p>
              <h3 style={h3Style}>1. 필수 수집 항목</h3>
              <ul style={ulStyle}>
                <li>회원가입: 아이디, 비밀번호, 이메일 주소</li>
                <li>기기 등록: 기기 이름, 기기 식별자(UUID), 운영체제 정보</li>
                <li>서비스 이용: 접속 로그, IP 주소, 서비스 이용 기록</li>
              </ul>
              <h3 style={h3Style}>2. 선택 수집 항목</h3>
              <ul style={ulStyle}>
                <li>
                  메신저 연동: 카카오톡, Telegram, Discord 등 메신저 계정 정보
                </li>
                <li>결제 정보: 결제 수단, 결제 이력 (결제 대행사를 통해 처리)</li>
                <li>
                  API 키: 사용자가 직접 입력한 외부 AI 서비스 API 키 (암호화
                  저장)
                </li>
                <li>
                  푸시 알림: FCM 토큰 (Firebase Cloud Messaging 푸시 알림 발송용)
                </li>
              </ul>
            </section>

            <section style={sectionStyle}>
              <h2 style={h2Style}>제3조 (개인정보의 수집 및 이용 목적)</h2>
              <ul style={ulStyle}>
                <li>회원 관리: 회원제 서비스 이용에 따른 본인 식별 및 인증</li>
                <li>서비스 제공: AI 에이전트 서비스, 기기 간 연동, 원격 제어</li>
                <li>결제 처리: 유료 서비스 결제 및 정산</li>
                <li>
                  서비스 개선: 서비스 이용 통계 분석 및 맞춤형 서비스 제공
                </li>
                <li>보안: 부정 이용 방지 및 비인가 접근 탐지</li>
                <li>
                  고객 지원: 문의 사항 처리 및 공지사항 전달, 푸시 알림 발송
                </li>
              </ul>
            </section>

            <section style={sectionStyle}>
              <h2 style={h2Style}>제4조 (개인정보의 보유 및 이용 기간)</h2>
              <p style={pStyle}>
                회사는 개인정보 수집 및 이용 목적이 달성된 후에는 해당 정보를
                지체 없이 파기합니다. 단, 관련 법령에 의해 보존할 필요가 있는
                경우 아래와 같이 보관합니다.
              </p>
              <ul style={ulStyle}>
                <li>
                  계약 또는 청약 철회 등에 관한 기록: 5년 (전자상거래 등에서의
                  소비자보호에 관한 법률)
                </li>
                <li>
                  대금 결제 및 재화 등의 공급에 관한 기록: 5년
                </li>
                <li>
                  소비자의 불만 또는 분쟁 처리에 관한 기록: 3년
                </li>
                <li>
                  접속에 관한 기록: 3개월 (통신비밀보호법)
                </li>
              </ul>
            </section>

            <section style={sectionStyle}>
              <h2 style={h2Style}>제5조 (개인정보의 제3자 제공)</h2>
              <p style={pStyle}>
                회사는 이용자의 개인정보를 원칙적으로 외부에 제공하지 않습니다.
                다만, 아래의 경우에는 예외로 합니다.
              </p>
              <ul style={ulStyle}>
                <li>이용자가 사전에 동의한 경우</li>
                <li>법령의 규정에 의거하거나, 수사 목적으로 법령에 정해진 절차와 방법에 따라 수사기관의 요구가 있는 경우</li>
              </ul>
            </section>

            <section style={sectionStyle}>
              <h2 style={h2Style}>제6조 (개인정보의 처리 위탁)</h2>
              <p style={pStyle}>
                회사는 서비스 향상을 위해 아래와 같이 개인정보를 위탁하고 있으며,
                관련 법령에 따라 위탁 계약 시 개인정보가 안전하게 관리될 수
                있도록 필요한 사항을 규정하고 있습니다.
              </p>
              <ul style={ulStyle}>
                <li>결제 처리: Stripe (결제 대행)</li>
                <li>클라우드 인프라: Vercel, Railway (서버 호스팅)</li>
                <li>데이터베이스: Supabase (데이터 저장)</li>
                <li>푸시 알림: Firebase Cloud Messaging (알림 발송)</li>
              </ul>
            </section>

            <section style={sectionStyle}>
              <h2 style={h2Style}>제7조 (개인정보의 파기 절차 및 방법)</h2>
              <p style={pStyle}>
                회사는 원칙적으로 개인정보 수집 및 이용 목적이 달성된 후에는
                해당 정보를 지체 없이 파기합니다.
              </p>
              <ul style={ulStyle}>
                <li>
                  파기 절차: 이용자가 입력한 정보는 목적 달성 후 별도의 DB에
                  옮겨져 내부 방침 및 기타 관련 법령에 따라 일정 기간 저장된 후
                  파기됩니다.
                </li>
                <li>
                  파기 방법: 전자적 파일 형태의 정보는 기록을 재생할 수 없는
                  기술적 방법을 사용합니다.
                </li>
              </ul>
            </section>

            <section style={sectionStyle}>
              <h2 style={h2Style}>
                제8조 (이용자 및 법정 대리인의 권리와 그 행사 방법)
              </h2>
              <ul style={ulStyle}>
                <li>
                  이용자는 언제든지 등록되어 있는 자신의 개인정보를 조회하거나
                  수정할 수 있으며, 가입 해지를 요청할 수 있습니다.
                </li>
                <li>
                  개인정보의 오류에 대한 정정을 요청한 경우에는 정정을 완료하기
                  전까지 당해 개인정보를 이용 또는 제공하지 않습니다.
                </li>
                <li>
                  회원 탈퇴 요청은 마이페이지 또는 고객 지원 이메일을 통해
                  가능합니다.
                </li>
              </ul>
            </section>

            <section style={sectionStyle}>
              <h2 style={h2Style}>
                제9조 (개인정보 보호를 위한 기술적/관리적 대책)
              </h2>
              <ul style={ulStyle}>
                <li>
                  비밀번호 암호화: 이용자의 비밀번호는 암호화되어 저장 및
                  관리되며, 본인만이 알 수 있습니다.
                </li>
                <li>
                  암호화 통신: E2E(종단 간) 암호화 및 AES-256 암호화를 적용하여
                  데이터를 보호합니다.
                </li>
                <li>
                  API 키 보호: 사용자의 AI 서비스 API 키는 암호화하여 저장하며,
                  평문으로 노출되지 않습니다.
                </li>
                <li>
                  접근 제한: 개인정보에 대한 접근 권한을 최소한의 인원으로
                  제한하고 있습니다.
                </li>
                <li>
                  해킹 방지: SHA-256 무결성 검증, 2단계 보안 인증 등을 통해
                  외부 침입을 방지합니다.
                </li>
              </ul>
            </section>

            <section style={sectionStyle}>
              <h2 style={h2Style}>
                제10조 (자기 학습 엔진과 개인정보)
              </h2>
              <p style={pStyle}>
                MoA의 자기 학습 엔진은 다음과 같이 개인정보를 보호합니다.
              </p>
              <ul style={ulStyle}>
                <li>
                  학습 데이터는 사용자의 기기에서 로컬로만 처리되며, 외부
                  서버로 전송되지 않습니다.
                </li>
                <li>
                  네트워크 호출 없이 동작하며, 동적 코드 실행이 없어
                  안전합니다.
                </li>
                <li>
                  SHA-256 해시로 학습 데이터의 무결성을 실시간 검증합니다.
                </li>
              </ul>
            </section>

            <section style={sectionStyle}>
              <h2 style={h2Style}>제11조 (쿠키의 사용)</h2>
              <p style={pStyle}>
                회사는 이용자에게 맞춤형 서비스를 제공하기 위해 쿠키를 사용할 수
                있습니다. 이용자는 웹 브라우저 설정을 통해 쿠키 허용 여부를
                선택할 수 있습니다.
              </p>
            </section>

            <section style={sectionStyle}>
              <h2 style={h2Style}>제12조 (개인정보 보호 책임자)</h2>
              <ul style={{ ...ulStyle, listStyle: "none" }}>
                <li>성명: 김재철</li>
                <li>직위: 대표</li>
                <li>이메일: privacy@moa-ai.com</li>
              </ul>
              <p style={pStyle}>
                기타 개인정보 침해에 대한 신고나 상담이 필요하신 경우에는 아래
                기관에 문의하시기 바랍니다.
              </p>
              <ul style={ulStyle}>
                <li>개인정보 침해신고센터 (privacy.kisa.or.kr / 118)</li>
                <li>대검찰청 사이버수사과 (spo.go.kr / 1301)</li>
                <li>경찰청 사이버안전국 (ecrm.cyber.go.kr / 182)</li>
              </ul>
            </section>

            <section style={sectionStyle}>
              <h2 style={h2Style}>제13조 (방침 변경에 관한 사항)</h2>
              <p style={pStyle}>
                이 개인정보취급방침은 법령 및 방침에 따라 변경될 수 있으며,
                변경 시 웹사이트를 통해 공지합니다. 본 방침은 2025년 7월 1일부터
                시행됩니다.
              </p>
            </section>

            <div
              style={{
                marginTop: "48px",
                padding: "24px",
                borderRadius: "var(--radius)",
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
              }}
            >
              <p
                style={{
                  color: "var(--text-muted)",
                  fontSize: "0.85rem",
                  lineHeight: 1.8,
                  margin: 0,
                }}
              >
                상호: 로콜 &nbsp;|&nbsp; 대표: 김재철 &nbsp;|&nbsp;
                사업자등록번호: 685-21-02314
                <br />
                소재지: 서울특별시 강동구 동남로75길 19, 제지하2층 제1호 (명일동,
                명일빌딩)
                <br />
                이메일: privacy@moa-ai.com
              </p>
            </div>
          </article>
        </div>
      </main>
    </>
  );
}

const sectionStyle: React.CSSProperties = {
  marginBottom: "40px",
};

const h2Style: React.CSSProperties = {
  fontSize: "1.25rem",
  fontWeight: 700,
  marginBottom: "16px",
  paddingBottom: "8px",
  borderBottom: "1px solid var(--border)",
};

const h3Style: React.CSSProperties = {
  fontSize: "1.05rem",
  fontWeight: 600,
  marginBottom: "10px",
  marginTop: "16px",
};

const pStyle: React.CSSProperties = {
  color: "var(--text-muted)",
  fontSize: "0.95rem",
  lineHeight: 1.8,
  marginBottom: "12px",
};

const ulStyle: React.CSSProperties = {
  color: "var(--text-muted)",
  fontSize: "0.95rem",
  lineHeight: 2,
  paddingLeft: "20px",
  marginBottom: "12px",
};
