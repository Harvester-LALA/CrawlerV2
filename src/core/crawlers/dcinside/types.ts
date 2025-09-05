import { CrawlerOptions } from "../../../types/crawlerOptions";

export interface DCExtractedInfo {
  gallType: "M" | "MI" | "G" | null;
  galleryId: string;
  postNo: string | null;
}

export interface DCSearchParams {
  s_type?: string;
  s_keyword?: string;
  page?: number;
}

export interface DCRequestOptions {
  method: "GET" | "POST";
  url: string;
  params?: Record<string, string | number>;
  data?: Record<string, string | number>;
}

export interface DCPost {
  id: string;
  title: string;
  content: string;
  author: string;
  timestamp: Date;
  url: string;
  viewCount: number;
  recommendCount: number;
  comments: DCComment[];
}

export interface DCComment {
  id: string;
  author: string;
  content: string;
  timestamp: Date;
  isReply: boolean;
  parentId: string | null;
}

/**
 * 댓글 페이지 결과(페이징 유무 포함)
 */
export interface DCCommentPageResult {
  comments: DCComment[];
  hasNext: boolean;
}
/**
 * DCinside 전용 옵션
 * - Python DCinsideCrawler.__init__에서 사용하던 입력값을 포함
 *   - date_from -> dateFrom (YYYY-MM-DD 형식 문자열)
 *   - sleep_h   -> sleepH (시간 단위 숫자)
 * 나머지 sid/cid/url/keyword/target 은 CrawlerOptions에서 상속
 */
export interface DCCrawlerOptions extends CrawlerOptions {
  /** 'YYYY-MM-DD' 형식의 수집 기준일 */
  dateFrom: string;
  /** 만료 계산에 사용되는 시간 지연(시간 단위) */
  sleepH: number;
  /** Python 버전에서 사용하던 crawlerId (환경변수와의 매칭에 사용). 전달 시 sid보다 우선 적용 */
  crawlerId?: string;
}
