import { describe, it, expect } from "vitest";
import {
  classifyWithRules,
  buildClassificationPrompt,
  parseClassificationResponse,
} from "./classifier.js";

describe("classifyWithRules", () => {
  it("classifies dispute content", () => {
    const result = classifyWithRules(
      "오늘 옆집 민수씨랑 잔디밭 경계 때문에 말다툼을 했어. 앞마당에서 30분 정도 이야기했는데 좀 언성이 높아졌어.",
    );
    expect(result.type).toBe("dispute");
    expect(result.importance).toBeGreaterThanOrEqual(7);
    expect(result.emotion).toBe("frustrated");
  });

  it("classifies meeting content", () => {
    const result = classifyWithRules(
      "Today we had a team meeting with the PM and designer to review the v2 design.",
    );
    expect(result.type).toBe("meeting");
    expect(result.domain).toBe("work");
  });

  it("classifies project content", () => {
    const result = classifyWithRules(
      "앱 v2 개발 프로젝트 진행 상황: 결제 플로우 3단계에서 2단계로 축소하기로 결정.",
    );
    expect(result.type).toBe("project");
  });

  it("classifies travel plan", () => {
    const result = classifyWithRules(
      "여름 유럽여행 준비: 파리 에어비앤비 예약 완료, 로마 숙소 미정, 바르셀로나→파리 야간열차 확인 필요.",
    );
    expect(result.type).toBe("plan");
    expect(result.domain).toBe("travel");
  });

  it("classifies cooking content", () => {
    const result = classifyWithRules(
      "소금빵 반죽 발효 실험: 냉장 10시간 저온발효 → 완벽한 식감! 실온발효는 과발효 위험이 있음.",
    );
    expect(result.type).toBe("knowledge");
    expect(result.domain).toBe("cooking");
  });

  it("classifies health content", () => {
    const result = classifyWithRules("오늘 근력운동: 스쿼트 5x5, 벤치프레스 3x8. 체중 72kg.");
    expect(result.type).toBe("health");
    expect(result.domain).toBe("health");
  });

  it("classifies social conversation", () => {
    const result = classifyWithRules(
      "절친 A가 오늘 카페에서 이직 고민을 이야기했어. 스타트업 B에서 개발 팀장 제안을 받았대.",
    );
    expect(result.type).toBe("conversation");
    expect(result.domain).toBe("social");
  });

  it("classifies financial content", () => {
    const result = classifyWithRules("이번 달 투자 현황: 주식 포트폴리오 +5%, 예산 대비 지출 80%.");
    expect(result.type).toBe("financial");
    expect(result.domain).toBe("finance");
  });

  it("classifies learning content", () => {
    const result = classifyWithRules(
      "Python 공부 진행 중: 오늘 리스트 컴프리헨션과 제너레이터 학습 완료.",
    );
    expect(result.type).toBe("learning");
    expect(result.domain).toBe("learning");
  });

  it("classifies legal content", () => {
    const result = classifyWithRules(
      "변호사와 교통사고 합의 관련 상담. 과실비율 쟁점, 다음주까지 블랙박스 영상 확보 필요.",
    );
    expect(result.type).toBe("legal");
    expect(result.domain).toBe("legal");
  });

  it("detects emotions correctly", () => {
    expect(classifyWithRules("정말 화가 나서 참을 수가 없었어").emotion).toBe("angry");
    expect(classifyWithRules("기분이 너무 좋았어! 행복해!").emotion).toBe("happy");
    expect(classifyWithRules("걱정이 돼서 잠을 못 잤어").emotion).toBe("anxious");
    expect(classifyWithRules("너무 지쳐서 힘들다").emotion).toBe("tired");
    expect(classifyWithRules("I'm so excited about this!").emotion).toBe("excited");
    expect(classifyWithRules("I'm grateful for their help").emotion).toBe("grateful");
  });

  it("extracts people heuristically (Korean)", () => {
    const result = classifyWithRules("옆집 민수씨와 팀장 박과장이 회의실에서 만났다.");
    expect(result.people).toBeDefined();
    expect(result.people!.length).toBeGreaterThan(0);
  });

  it("extracts tags", () => {
    const result = classifyWithRules("앱 개발 프로젝트 회의 내용");
    expect(result.tags).toBeDefined();
    expect(result.tags.length).toBeGreaterThan(0);
  });

  it("assigns higher importance to urgent content", () => {
    const urgent = classifyWithRules("긴급! 내일 마감인 보고서를 아직 못 끝냈어.");
    const casual = classifyWithRules("오늘 날씨가 좋아서 산책했어.");
    expect(urgent.importance).toBeGreaterThan(casual.importance);
  });
});

describe("buildClassificationPrompt", () => {
  it("builds a complete prompt with context", () => {
    const prompt = buildClassificationPrompt({
      content: "Test content",
      existingEntities: [{ id: "person_test", name: "Test Person", type: "person" }],
      existingTags: ["work", "meeting"],
      existingCases: ["Project_v2"],
    });
    expect(prompt).toContain("Test content");
    expect(prompt).toContain("Test Person");
    expect(prompt).toContain("work");
    expect(prompt).toContain("Project_v2");
  });

  it("handles empty context", () => {
    const prompt = buildClassificationPrompt({ content: "Test content" });
    expect(prompt).toContain("Test content");
    expect(prompt).toContain("none");
  });
});

describe("parseClassificationResponse", () => {
  it("parses valid JSON response", () => {
    const response = JSON.stringify({
      type: "meeting",
      entities: [{ id: "person_john", name: "John", type: "person", is_new: true }],
      relationships: [{ from: "person_john", to: "case_v2", type: "participant" }],
      tags: ["work", "meeting"],
      importance: 7,
      emotion: "neutral",
      domain: "work",
      people: ["John"],
      case: "project_v2",
      place: "office",
    });

    const result = parseClassificationResponse(response);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("meeting");
    expect(result!.entities).toHaveLength(1);
    expect(result!.entities[0].name).toBe("John");
    expect(result!.tags).toContain("work");
    expect(result!.importance).toBe(7);
    expect(result!.people).toContain("John");
  });

  it("parses JSON wrapped in markdown code blocks", () => {
    const response =
      '```json\n{"type": "conversation", "tags": ["test"], "importance": 5, "entities": [], "relationships": []}\n```';
    const result = parseClassificationResponse(response);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("conversation");
  });

  it("normalizes invalid type to personal_note", () => {
    const response = JSON.stringify({
      type: "invalid_type",
      entities: [],
      relationships: [],
      tags: [],
      importance: 5,
    });
    const result = parseClassificationResponse(response);
    expect(result!.type).toBe("personal_note");
  });

  it("clamps importance to 1-10", () => {
    const response = JSON.stringify({
      type: "meeting",
      entities: [],
      relationships: [],
      tags: [],
      importance: 15,
    });
    const result = parseClassificationResponse(response);
    expect(result!.importance).toBe(10);
  });

  it("returns null for invalid JSON", () => {
    expect(parseClassificationResponse("not json at all")).toBeNull();
  });
});
