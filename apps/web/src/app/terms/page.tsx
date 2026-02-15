import Nav from "../../components/Nav";

export default function TermsOfService() {
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
            이용약관
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
                이 약관은 로콜(이하 &ldquo;회사&rdquo;)이 제공하는 MoA(Master of
                AI) 서비스(이하 &ldquo;서비스&rdquo;)의 이용에 관한 조건 및
                절차, 회사와 이용자의 권리, 의무 및 책임 사항, 기타 필요한 사항을
                규정함을 목적으로 합니다.
              </p>
            </section>

            <section style={sectionStyle}>
              <h2 style={h2Style}>제2조 (정의)</h2>
              <ul style={ulStyle}>
                <li>
                  &ldquo;서비스&rdquo;란 회사가 제공하는 MoA AI 에이전트 플랫폼
                  및 관련 제반 서비스를 의미합니다.
                </li>
                <li>
                  &ldquo;이용자&rdquo;란 이 약관에 따라 회사가 제공하는
                  서비스를 이용하는 회원 및 비회원을 말합니다.
                </li>
                <li>
                  &ldquo;회원&rdquo;이란 회사에 개인정보를 제공하여 회원 등록을
                  한 자로서, 서비스를 계속적으로 이용할 수 있는 자를 말합니다.
                </li>
                <li>
                  &ldquo;기기&rdquo;란 MoA 에이전트가 설치된 컴퓨터, 스마트폰,
                  태블릿 등의 장치를 말합니다.
                </li>
                <li>
                  &ldquo;스킬&rdquo;이란 MoA가 제공하는 개별 AI 기능 단위를
                  말합니다.
                </li>
              </ul>
            </section>

            <section style={sectionStyle}>
              <h2 style={h2Style}>제3조 (약관의 효력 및 변경)</h2>
              <ul style={ulStyle}>
                <li>
                  이 약관은 서비스 화면에 게시하거나 기타의 방법으로 이용자에게
                  공지함으로써 효력이 발생합니다.
                </li>
                <li>
                  회사는 합리적인 사유가 발생한 경우 관련 법령에 위배되지 않는
                  범위에서 이 약관을 변경할 수 있으며, 변경된 약관은 공지
                  후 효력이 발생합니다.
                </li>
                <li>
                  변경된 약관에 동의하지 않는 이용자는 서비스 이용을 중단하고
                  탈퇴할 수 있습니다.
                </li>
              </ul>
            </section>

            <section style={sectionStyle}>
              <h2 style={h2Style}>제4조 (서비스의 제공)</h2>
              <p style={pStyle}>회사는 다음과 같은 서비스를 제공합니다.</p>
              <ul style={ulStyle}>
                <li>
                  AI 에이전트 서비스: 다중 AI 모델을 활용한 대화, 작업 수행,
                  원격 제어
                </li>
                <li>
                  기기 연동: 여러 기기 간의 연결 및 원격 제어 기능
                </li>
                <li>
                  메신저 연동: 카카오톡, Telegram, Discord 등 다양한 메신저를
                  통한 AI 이용
                </li>
                <li>
                  AI 스킬: 웹 검색, 이미지 생성, 문서 작성, 코딩 등 100개 이상의
                  전문 기능
                </li>
                <li>
                  음성 AI: 비동기 음성, 실시간 음성 대화, 다국어 통역 서비스
                </li>
                <li>
                  문서 작업 및 자동 코딩: AI 기반 문서 생성, 편집 및 코드 작성
                </li>
                <li>푸시 알림: 작업 완료, 시스템 알림 등의 실시간 알림 발송</li>
              </ul>
            </section>

            <section style={sectionStyle}>
              <h2 style={h2Style}>제5조 (회원 가입)</h2>
              <ul style={ulStyle}>
                <li>
                  이용자는 회사가 정한 양식에 따라 회원 정보를 기입한 후 이
                  약관에 동의한다는 의사 표시를 함으로써 회원 가입을 신청합니다.
                </li>
                <li>
                  회사는 다음 각 호에 해당하는 신청에 대해서는 승인을 하지 않을 수
                  있습니다.
                  <ul style={{ ...ulStyle, marginTop: "8px" }}>
                    <li>타인의 명의를 이용한 경우</li>
                    <li>허위 정보를 기재한 경우</li>
                    <li>기타 회원으로 등록하는 것이 부적절한 경우</li>
                  </ul>
                </li>
              </ul>
            </section>

            <section style={sectionStyle}>
              <h2 style={h2Style}>제6조 (서비스 이용 요금)</h2>
              <ul style={ulStyle}>
                <li>
                  서비스의 기본 이용은 무료이며, 일부 프리미엄 기능은 유료로
                  제공됩니다.
                </li>
                <li>
                  유료 서비스의 요금 및 결제 방법은 서비스 내 안내에 따릅니다.
                </li>
                <li>
                  이용자가 직접 입력한 외부 AI 서비스 API 키 사용에 따른
                  비용은 해당 서비스 제공자의 요금 정책에 따르며, 회사는 이에
                  대한 책임을 지지 않습니다.
                </li>
                <li>
                  베타 기간 동안에는 무료 체험이 제공되며, 정식 출시 후 요금
                  정책이 변경될 수 있습니다.
                </li>
              </ul>
            </section>

            <section style={sectionStyle}>
              <h2 style={h2Style}>제7조 (이용자의 의무)</h2>
              <p style={pStyle}>이용자는 다음 행위를 해서는 안 됩니다.</p>
              <ul style={ulStyle}>
                <li>타인의 정보를 도용하거나 허위 정보를 등록하는 행위</li>
                <li>
                  서비스를 이용하여 법령 또는 공서양속에 반하는 행위를 하는 것
                </li>
                <li>
                  회사의 서비스를 방해하거나 서비스에 무단으로 접근하는 행위
                </li>
                <li>다른 이용자의 개인정보를 수집하거나 이용하는 행위</li>
                <li>
                  서비스를 악의적으로 이용하여 회사 또는 타인에게 손해를 끼치는
                  행위
                </li>
                <li>
                  연결된 기기를 통해 불법적인 원격 접근이나 정보 탈취를 시도하는
                  행위
                </li>
                <li>
                  AI 스킬을 악용하여 허위 정보를 생성하거나 유포하는 행위
                </li>
              </ul>
            </section>

            <section style={sectionStyle}>
              <h2 style={h2Style}>제8조 (회사의 의무)</h2>
              <ul style={ulStyle}>
                <li>
                  회사는 관련 법령과 이 약관이 금지하는 행위를 하지 않으며,
                  지속적이고 안정적으로 서비스를 제공하기 위해 노력합니다.
                </li>
                <li>
                  회사는 이용자의 개인정보 보호를 위해 보안 시스템을 갖추어야
                  하며, 개인정보취급방침을 공시하고 준수합니다.
                </li>
                <li>
                  회사는 서비스 이용과 관련하여 이용자로부터 제기된 의견이나
                  불만이 정당하다고 인정할 경우 이를 처리하여야 합니다.
                </li>
              </ul>
            </section>

            <section style={sectionStyle}>
              <h2 style={h2Style}>제9조 (서비스의 변경 및 중단)</h2>
              <ul style={ulStyle}>
                <li>
                  회사는 운영상, 기술상의 필요에 따라 제공하는 서비스를 변경할
                  수 있으며, 변경 전에 해당 내용을 서비스 내에 공지합니다.
                </li>
                <li>
                  회사는 천재지변, 시스템 장애, 서비스 설비의 보수 점검 등
                  불가피한 사유가 있는 경우 서비스의 전부 또는 일부를 제한하거나
                  중단할 수 있습니다.
                </li>
                <li>
                  무료로 제공되는 서비스의 일부 또는 전부를 회사의 정책에 의해
                  수정, 중단, 변경할 수 있으며, 이에 대해 관련 법령에 특별한
                  규정이 없는 한 별도의 보상을 하지 않습니다.
                </li>
              </ul>
            </section>

            <section style={sectionStyle}>
              <h2 style={h2Style}>제10조 (기기 연동 및 원격 제어)</h2>
              <ul style={ulStyle}>
                <li>
                  이용자는 MoA 에이전트를 기기에 설치하여 원격 제어 기능을
                  이용할 수 있습니다.
                </li>
                <li>
                  원격 제어를 통한 기기 접근은 이용자 본인의 기기에 한하며,
                  타인의 기기에 무단으로 접근하는 것은 금지됩니다.
                </li>
                <li>
                  회사는 이용자의 기기에 저장된 파일이나 데이터에 접근하지
                  않으며, 모든 원격 제어 명령은 이용자의 지시에 의해서만
                  실행됩니다.
                </li>
                <li>
                  원격 제어 기능 이용 중 발생하는 데이터 손실이나 시스템 장애에
                  대해 회사는 고의 또는 중대한 과실이 없는 한 책임을 지지
                  않습니다.
                </li>
              </ul>
            </section>

            <section style={sectionStyle}>
              <h2 style={h2Style}>제11조 (API 키 관리)</h2>
              <ul style={ulStyle}>
                <li>
                  이용자는 마이페이지에서 외부 AI 서비스의 API 키를 직접
                  등록하고 관리할 수 있습니다.
                </li>
                <li>
                  등록된 API 키는 암호화하여 저장되며, 회사는 이용자의 API 키를
                  서비스 제공 외의 목적으로 사용하지 않습니다.
                </li>
                <li>
                  API 키의 유출, 분실, 도용 등으로 인한 손해에 대해 회사는
                  고의 또는 중대한 과실이 없는 한 책임을 지지 않습니다.
                </li>
                <li>
                  이용자는 자신의 API 키를 안전하게 관리할 의무가 있습니다.
                </li>
              </ul>
            </section>

            <section style={sectionStyle}>
              <h2 style={h2Style}>제12조 (AI 생성 콘텐츠)</h2>
              <ul style={ulStyle}>
                <li>
                  AI를 통해 생성된 콘텐츠(텍스트, 이미지, 코드 등)의 정확성과
                  적법성에 대해 회사는 보증하지 않습니다.
                </li>
                <li>
                  이용자는 AI 생성 콘텐츠를 검토 없이 사용하여 발생한 문제에
                  대해 스스로 책임을 집니다.
                </li>
                <li>
                  AI 생성 콘텐츠를 이용하여 타인의 권리를 침해하거나 법령을
                  위반하는 행위를 해서는 안 됩니다.
                </li>
              </ul>
            </section>

            <section style={sectionStyle}>
              <h2 style={h2Style}>제13조 (지식재산권)</h2>
              <ul style={ulStyle}>
                <li>
                  서비스에 대한 저작권 및 지식재산권은 회사에 귀속됩니다.
                </li>
                <li>
                  이용자가 서비스를 이용하여 생성한 콘텐츠에 대한 권리는
                  이용자에게 귀속됩니다.
                </li>
                <li>
                  본 서비스는 OpenClaw(MIT License)의 코드를 일부 포함하고
                  있으며, 해당 부분에 대해서는 MIT 라이선스 조건이 적용됩니다.
                </li>
              </ul>
            </section>

            <section style={sectionStyle}>
              <h2 style={h2Style}>제14조 (면책 조항)</h2>
              <ul style={ulStyle}>
                <li>
                  회사는 천재지변 또는 이에 준하는 불가항력으로 인하여 서비스를
                  제공할 수 없는 경우에는 책임이 면제됩니다.
                </li>
                <li>
                  회사는 이용자의 귀책 사유로 인한 서비스 이용의 장애에 대하여는
                  책임을 지지 않습니다.
                </li>
                <li>
                  회사는 이용자가 서비스를 이용하여 기대하는 수익을 얻지 못하거나
                  상실한 것에 대하여 책임을 지지 않습니다.
                </li>
                <li>
                  외부 AI 서비스(GPT-4o, Claude, Gemini 등)의 장애, 서비스 변경
                  또는 중단으로 인한 문제에 대해 회사는 책임을 지지 않습니다.
                </li>
              </ul>
            </section>

            <section style={sectionStyle}>
              <h2 style={h2Style}>제15조 (분쟁 해결)</h2>
              <ul style={ulStyle}>
                <li>
                  서비스 이용으로 발생한 분쟁에 대해 회사와 이용자는 성실히
                  협의하여 해결합니다.
                </li>
                <li>
                  협의가 이루어지지 않을 경우, 관련 분쟁은 민사소송법상의
                  관할법원에 소를 제기할 수 있습니다.
                </li>
                <li>
                  회사와 이용자 간에 제기된 소송에는 대한민국 법을 적용합니다.
                </li>
              </ul>
            </section>

            <section style={sectionStyle}>
              <h2 style={h2Style}>부칙</h2>
              <p style={pStyle}>
                이 약관은 2025년 7월 1일부터 시행합니다.
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
                이메일: support@moa-ai.com
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
