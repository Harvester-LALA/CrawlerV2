import { DCinsideCrawler } from "./dcinside";
import { YouTubeCrawler } from "./youtube";
import { RuliwebCrawler } from "./ruliweb";
import { CrawlerOptions } from "../types/crawlerOptions";

export class CrawlerRunner {
  private readonly options: CrawlerOptions;

  constructor(options: CrawlerOptions) {
    this.options = options;
  }

  /**
   * cid에 따라 적절한 크롤러를 실행
   */
  public async run() {
    console.log(`[${new Date().toISOString()}] 크롤러 실행 시작`, this.options);

    try {
      // 플랫폼(cid)에 따라 다른 크롤러 실행
      switch (this.options.cid) {
        case "1":
          await new YouTubeCrawler().crawl(this.options);
          break;
        case "5":
          await new DCinsideCrawler().crawl(this.options);
          break;
        case "6":
          await new RuliwebCrawler().crawl(this.options);
          break;
        default:
          throw new Error(`지원하지 않는 플랫폼입니다: ${this.options.cid}`);
      }

      console.log(`[${new Date().toISOString()}] 크롤링 완료`);
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] 크롤링 중 오류 발생:`,
        error
      );
      throw error;
    }
  }
}

/**
 * 크롤러 실행을 위한 팩토리 함수
 * @param options 크롤링 옵션
 * @returns 크롤러 실행 결과
 */
export async function run(options: CrawlerOptions) {
  const runner = new CrawlerRunner(options);
  return runner.run();
}
