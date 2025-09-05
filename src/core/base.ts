import { DCInsideCrawler } from "./crawlers/dcinside";
import { YouTubeCrawler } from "./youtube";
import { RuliwebCrawler } from "./ruliweb";
import type {
  Repo as DCRepo,
  RepoLogger as DCRepoLogger,
  DCCrawlerOptions,
  Post,
  PostInput,
  CommentInput,
} from "./crawlers/dcinside";
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
          // DCInside 크롤러는 별도의 옵션 형태와 Repo 주입이 필요
          const dcOptions: DCCrawlerOptions = {
            id: this.options.sid, // 시나리오 ID를 sid로 매핑
            sid: this.options.sid,
            cid: this.options.cid,
            url: this.options.url,
            keyword: this.options.keyword,
            target: this.options.target,
          };
          const repo: DCRepo = new InMemoryRepo();
          const logger: DCRepoLogger = {
            info: (...a: unknown[]) => console.log("[DC]", ...a),
            error: (...a: unknown[]) => console.error("[DC]", ...a),
          };
          await new DCInsideCrawler(dcOptions, repo, logger).startCrawling();
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
 * DCInside용 간단한 In-Memory Repo 스텁 구현
 * 실제 저장소로 교체하기 전까지 타입 만족 및 동작 확인 용도
 */
class InMemoryRepo implements DCRepo {
  private postsByScenario: Map<string, Map<string, Post>> = new Map();
  private commentsByScenario: Map<string, Set<string>> = new Map();

  private getPostMap(scenarioId: string): Map<string, Post> {
    let m = this.postsByScenario.get(scenarioId);
    if (!m) {
      m = new Map<string, Post>();
      this.postsByScenario.set(scenarioId, m);
    }
    return m;
  }

  private getCommentSet(scenarioId: string): Set<string> {
    let s = this.commentsByScenario.get(scenarioId);
    if (!s) {
      s = new Set<string>();
      this.commentsByScenario.set(scenarioId, s);
    }
    return s;
  }

  private genId(): string {
    const rnd = Math.floor(Math.random() * 1_000_000_000)
      .toString(36)
      .padStart(6, "0");
    return `mem-${Date.now().toString(36)}-${rnd}`;
  }

  async findPostByPlatformId(
    scenarioId: string,
    platformPostId: string
  ): Promise<Post | null> {
    const m = this.getPostMap(scenarioId);
    return m.get(platformPostId) ?? null;
  }

  async insertPost(input: PostInput): Promise<Post> {
    const post: Post = { postId: this.genId(), ...input };
    this.getPostMap(post.scenarioId).set(post.platformPostId, post);
    return post;
  }

  async updatePostCommentCount(
    postId: string,
    commentCnt: number
  ): Promise<void> {
    for (const m of this.postsByScenario.values()) {
      for (const p of m.values()) {
        if (p.postId === postId) {
          p.commentCnt = commentCnt;
          return;
        }
      }
    }
  }

  async listRecentPosts(
    scenarioId: string,
    since: Date
  ): Promise<
    Array<Pick<Post, "postId" | "url" | "platformPostId" | "commentCnt">>
  > {
    const m = this.getPostMap(scenarioId);
    const out: Array<
      Pick<Post, "postId" | "url" | "platformPostId" | "commentCnt">
    > = [];
    for (const p of m.values()) {
      if (p.writtenAt >= since) {
        out.push({
          postId: p.postId,
          url: p.url,
          platformPostId: p.platformPostId,
          commentCnt: p.commentCnt,
        });
      }
    }
    return out;
  }

  async insertCommentsBulk(inputs: CommentInput[]): Promise<void> {
    for (const c of inputs) {
      this.getCommentSet(c.scenarioId).add(c.platformCommentId);
    }
  }

  async commentExists(
    scenarioId: string,
    platformCommentId: string
  ): Promise<boolean> {
    return this.getCommentSet(scenarioId).has(platformCommentId);
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
