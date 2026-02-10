import { describe, it, expect } from "vitest";
import { extractMetadata, extractPeople } from "./metadata-extractor.js";

describe("extractMetadata", () => {
  it("classifies dispute content", () => {
    const result = extractMetadata(
      "오늘 옆집 민수씨랑 잔디밭 경계 때문에 말다툼을 했어. 앞마당에서 30분 정도 이야기했는데 좀 언성이 높아졌어.",
    );
    expect(result.type).toBe("dispute");
    expect(result.importance).toBeGreaterThanOrEqual(7);
    expect(result.emotion).toBe("frustrated");
    expect(result.place).toBe("앞마당");
    expect(result.status).toBe("active");
  });

  it("classifies meeting content", () => {
    const result = extractMetadata(
      "Today we had a team meeting with the PM and designer to review the v2 design.",
    );
    expect(result.type).toBe("meeting");
    expect(result.domain).toBe("work");
  });

  it("classifies social conversation", () => {
    const result = extractMetadata(
      "절친 A가 오늘 카페에서 이직 고민을 이야기했어. 스타트업 B에서 개발 팀장 제안을 받았대.",
    );
    expect(result.type).toBe("conversation");
    expect(result.domain).toBe("social");
  });

  it("classifies legal content", () => {
    const result = extractMetadata(
      "변호사와 교통사고 합의 관련 상담. 과실비율 쟁점, 다음주까지 블랙박스 영상 확보 필요.",
    );
    expect(result.type).toBe("legal");
    expect(result.domain).toBe("legal");
  });

  it("classifies cooking/knowledge content", () => {
    const result = extractMetadata(
      "소금빵 반죽 발효 실험: 냉장 10시간 저온발효 → 완벽한 식감! 실온발효는 과발효 위험이 있음.",
    );
    expect(result.type).toBe("knowledge");
    expect(result.domain).toBe("cooking");
  });

  it("classifies travel plan", () => {
    const result = extractMetadata(
      "여름 유럽여행 준비: 파리 에어비앤비 예약 완료, 로마 숙소 미정.",
    );
    expect(result.type).toBe("plan");
    expect(result.domain).toBe("travel");
  });

  it("classifies financial content", () => {
    const result = extractMetadata("이번 달 투자 현황: 주식 포트폴리오 +5%, 예산 대비 지출 80%.");
    expect(result.type).toBe("financial");
    expect(result.domain).toBe("finance");
  });

  it("classifies health content", () => {
    const result = extractMetadata("오늘 근력운동: 스쿼트 5x5, 벤치프레스 3x8. 체중 72kg.");
    expect(result.type).toBe("health");
    expect(result.domain).toBe("health");
  });

  it("detects emotions correctly", () => {
    expect(extractMetadata("정말 화가 나서 참을 수가 없었어").emotion).toBe("angry");
    expect(extractMetadata("기분이 너무 좋았어! 행복해!").emotion).toBe("happy");
    expect(extractMetadata("걱정이 돼서 잠을 못 잤어").emotion).toBe("anxious");
    expect(extractMetadata("너무 지쳐서 힘들다").emotion).toBe("tired");
    expect(extractMetadata("I'm so excited about this!").emotion).toBe("excited");
    expect(extractMetadata("I'm grateful for their help").emotion).toBe("grateful");
  });

  it("captures original emotional expression in emotionRaw", () => {
    const angry = extractMetadata("정말 화가 나서 참을 수가 없었어");
    expect(angry.emotion).toBe("angry");
    expect(angry.emotionRaw).toBeDefined();
    expect(angry.emotionRaw).toContain("화가");

    const happy = extractMetadata("기분이 너무 좋았어! 행복해!");
    expect(happy.emotion).toBe("happy");
    expect(happy.emotionRaw).toBeDefined();
    expect(happy.emotionRaw).toContain("좋았");
  });

  it("preserves verbatim sentence for emotion context", () => {
    const result = extractMetadata(
      "오늘 민수씨랑 이야기했는데 참을 수 없을 정도로 화가 났다. 경계선 문제를 인정 안 해서.",
    );
    expect(result.emotion).toBe("angry");
    // emotionRaw should contain the actual sentence, not just the keyword
    expect(result.emotionRaw).toContain("참을 수 없을 정도로 화가 났다");
  });

  it("returns no emotionRaw for neutral content", () => {
    const result = extractMetadata("오늘 미팅에서 프로젝트 진행 상황을 공유했다.");
    expect(result.emotion).toBeUndefined();
    expect(result.emotionRaw).toBeUndefined();
  });

  it("extracts temporal info", () => {
    const result = extractMetadata("2026-03-15에 미팅 예정");
    expect(result.eventDate).toBe("2026-03-15");
  });

  it("extracts deadline from temporal info", () => {
    const result = extractMetadata("2026-03-20까지 보고서 제출 마감");
    expect(result.deadline).toBe("2026-03-20");
  });

  it("assigns higher importance to urgent content", () => {
    const urgent = extractMetadata("긴급! 내일 마감인 보고서를 아직 못 끝냈어.");
    const casual = extractMetadata("오늘 날씨가 좋아서 산책했어.");
    expect(urgent.importance).toBeGreaterThan(casual.importance);
  });
});

describe("extractPeople", () => {
  it("extracts Korean-style people", () => {
    const people = extractPeople("옆집 민수씨와 팀장 박과장이 회의실에서 만났다.");
    expect(people.length).toBeGreaterThan(0);
    const names = people.map((p) => p.name);
    expect(names.some((n) => n.includes("민수"))).toBe(true);
  });

  it("extracts people with identifier context", () => {
    const people = extractPeople("옆집 민수씨가 앞마당에서 얘기하자고 했어.");
    const minsu = people.find((p) => p.name.includes("민수"));
    expect(minsu).toBeDefined();
    expect(minsu?.identifier).toBe("옆집");
  });

  it("extracts 절친 pattern", () => {
    const people = extractPeople("절친 A가 오늘 카페에서 이직 고민을 이야기했어.");
    expect(people.some((p) => p.name.includes("절친 A"))).toBe(true);
  });
});
