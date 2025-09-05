import { CrawlerOptions } from "../types/crawlerOptions";

export class RuliwebCrawler {
  async crawl(options: CrawlerOptions): Promise<void> {
    const { sid, url, keyword, target } = options;
    console.log(`[루리웹 크롤러] 시나리오 ${sid} 시작`);

    // TODO: 루리웹 크롤링 로직 구현
    console.log("루리웹 크롤링 기능 구현 예정");

    if (url) {
      console.log(`대상 URL: ${url}`);
    }
    if (keyword) {
      console.log(`검색 키워드: ${keyword}`);
    }
    if (target) {
      console.log(`대상: ${target}`);
    }
  }
}
