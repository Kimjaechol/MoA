/**
 * RAG Module - Retrieval-Augmented Generation
 *
 * 다양한 데이터 소스에서 관련 정보를 검색하여 LLM 응답 품질 향상
 */

export {
  legalRAG,
  searchLaws,
  searchPrecedents,
  getLawDetail,
  detectLegalCategory,
  needsExpertConsultation,
  formatLegalRAGMessage,
  buildLegalContext,
  type LegalDocument,
  type LegalRAGResult,
} from './legal-rag.js';
