import axios, { AxiosError, AxiosRequestConfig } from "axios";
import { URL, URLSearchParams } from "url";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { Error429, InvalidUrlError } from "../../errors";

/** -------------------- External Types (adjust to your project) -------------------- */
export interface DCCrawlerOptions {
  id: string; // scenarioId
  sid: string; // crawlerId (fallback)
  cid?: string; // legacy code path ("1" keyword, "2" gallog)
  url?: string; // gallery or gallog url
  keyword?: string; // search keyword
  target?: string; // gallery id
  dateFrom?: string; // YYYY-MM-DD
  sleepH?: number; // optional sleep-hour offset used in expirationDate calc
}

export interface RepoLogger {
  info: (...a: unknown[]) => void;
  error: (...a: unknown[]) => void;
}

/** Minimal persistence interface you can map to your DB layer */
export interface Repo {
  // Posts
  findPostByPlatformId(
    scenarioId: string,
    platformPostId: string
  ): Promise<Post | null>;
  insertPost(input: PostInput): Promise<Post>;
  updatePostCommentCount(postId: string, commentCnt: number): Promise<void>;
  listRecentPosts(
    scenarioId: string,
    since: Date
  ): Promise<
    Array<Pick<Post, "postId" | "url" | "platformPostId" | "commentCnt">>
  >;

  // Comments
  insertCommentsBulk(inputs: CommentInput[]): Promise<void>;
  commentExists(
    scenarioId: string,
    platformCommentId: string
  ): Promise<boolean>;
}

export interface Post {
  postId: string;
  scenarioId: string;
  platformPostId: string; // DC&{gallType}&{galleryId}&{postNo}
  url: string;
  title: string;
  contents: string;
  writer: string | null;
  writerId: string | null;
  writerIp: string | null;
  writtenAt: Date;
  likeCnt: number;
  dislikeCnt: number | null;
  commentCnt: number;
}

export interface PostInput extends Omit<Post, "postId"> {}

export interface CommentInput {
  commentId: string;
  postId: string;
  platformCommentId: string; // DC&{gallType}&{galleryId}&{postNo}&{commentNo}
  scenarioId: string;
  writerId: string | null;
  writer: string | null;
  writerIp: string | null;
  contents: string;
  url: string;
  gallery: string; // "{gallType}&{galleryId}"
  writtenAt: Date;
}

export interface DCExtractedInfo {
  gallType: "M" | "MI" | "G" | null;
  galleryId: string | null;
  postNo: string | null;
}

export interface DCRequestOptions {
  method: "GET" | "POST";
  url: string;
  params?: Record<string, string | number | boolean>;
  data?: Record<string, string | number | boolean>;
}

export interface DCCommentApiItem {
  no: string | null; // string numeric
  del_yn: "Y" | "N";
  memo: string; // HTML string
  user_id?: string | null;
  name?: string | null;
  ip?: string | null;
  reg_date: string; // "YYYY.MM.DD HH:mm:ss" or "MM.DD HH:mm:ss"
}

export interface DCCommentPageResult {
  comments: DCCommentApiItem[];
}

export class DCInsideCrawler {
  private static readonly DC_HOST = "https://gall.dcinside.com";
  private static readonly GALLOG_HOST = "https://gallog.dcinside.com";

  private readonly options: DCCrawlerOptions;
  private readonly repo: Repo;
  private readonly logger?: RepoLogger;
  private readonly shouldCancel?: () => boolean;

  private readonly postIdSet: Set<string> = new Set();
  private retryCount = 0;
  private readonly maxRetries = 3;
  private baseUrl: string = DCInsideCrawler.DC_HOST;
  private expirationDate?: Date;
  private readonly requestDelayMs = 1000;

  constructor(
    options: DCCrawlerOptions,
    repo: Repo,
    logger?: RepoLogger,
    shouldCancel?: () => boolean
  ) {
    this.options = options;
    this.repo = repo;
    this.logger = logger;
    this.shouldCancel = shouldCancel;

    // baseUrl 결정
    const crawlerId = this.getEffectiveCrawlerId();
    const KEYWORD_ID = process.env.DC_KEYWORD_CRAWLER;
    const GALLOG_ID = process.env.DC_GALLOG_CRAWLER;
    if (KEYWORD_ID && crawlerId === KEYWORD_ID)
      this.baseUrl = DCInsideCrawler.DC_HOST;
    else if (GALLOG_ID && crawlerId === GALLOG_ID)
      this.baseUrl = DCInsideCrawler.GALLOG_HOST;
    else {
      try {
        const u = new URL(this.getFirstUrl());
        this.baseUrl = `${u.protocol}//${u.host}`;
      } catch {
        this.baseUrl = DCInsideCrawler.DC_HOST;
      }
    }

    // 만료 기준일 계산
    const periodDays = Number.parseInt(
      process.env.EXPIRATION_PERIOD ?? "0",
      10
    );
    const sleepH = this.options.sleepH ?? 0;
    if (!Number.isNaN(periodDays)) {
      const now = new Date();
      const exp = new Date(now);
      if (periodDays) exp.setDate(exp.getDate() - periodDays);
      if (sleepH) exp.setHours(exp.getHours() - sleepH);
      this.expirationDate = exp;
    }
  }

  /** -------------------- Static helpers -------------------- */
  public static extractGalleryInfoFromUrl(url: string): DCExtractedInfo {
    const parsedUrl = new URL(url);
    let gallType: DCExtractedInfo["gallType"] = null;

    if (parsedUrl.pathname.startsWith("/mgallery/")) gallType = "M";
    else if (parsedUrl.pathname.startsWith("/mini/")) gallType = "MI";
    else if (parsedUrl.pathname.startsWith("/board/")) gallType = "G";
    else throw new InvalidUrlError("Invalid DCInside URL format");

    const params = new URLSearchParams(parsedUrl.search);
    const galleryId = params.get("id");
    const postNo = params.get("no");

    if (!galleryId) throw new InvalidUrlError("Gallery ID not found in URL");

    return { gallType, galleryId, postNo };
  }

  public static urlToPlatformId(url: string): string {
    const data = this.extractGalleryInfoFromUrl(url);
    return `DC&${data.gallType}&${data.galleryId}&${data.postNo ?? ""}`;
  }

  public static platformIdToUrl(platformId: string): string {
    const [_, gallType, galleryId, postNo] = platformId.split("&");
    let prefix = "";
    if (gallType === "M") prefix = "/mgallery";
    else if (gallType === "MI") prefix = "/mini";
    return `${this.DC_HOST}${prefix}/board/view?id=${galleryId}&no=${postNo}`;
  }

  public static splitPlatformId(platformId: string): string[] {
    return platformId.replace(/^DC&/, "").split("&");
  }

  /** -------------------- HTTP core -------------------- */
  private getHeaders(
    method: "GET" | "POST",
    requestUrl?: string
  ): Record<string, string> {
    const baseHeaders: Record<string, string> = {
      "User-Agent": this.getRandomUserAgent(),
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      "Accept-Language": "ko-KR,ko;q=0.8,en-US;q=0.5,en;q=0.3",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      Connection: "keep-alive",
    };

    if (method === "GET") {
      let referer = this.baseUrl.endsWith("/")
        ? this.baseUrl
        : `${this.baseUrl}/`;
      if (requestUrl) {
        try {
          const u = new URL(requestUrl);
          referer = `${u.protocol}//${u.host}/`;
        } catch {
          /* ignore */
        }
      }
      return { ...baseHeaders, Referer: referer };
    }

    const referer = this.options.url || "https://www.dcinside.com/";
    return {
      ...baseHeaders,
      Accept: "application/json, text/javascript, */*; q=0.01",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Referer: referer,
    };
  }

  private async sendRequest<T = unknown>(opts: DCRequestOptions): Promise<T> {
    const { method, url, params, data } = opts;
    try {
      const config: AxiosRequestConfig = {
        method,
        url,
        params: method === "GET" ? params : undefined,
        data:
          method === "POST" && data
            ? new URLSearchParams(
                Object.entries(data).reduce<Record<string, string>>(
                  (acc, [k, v]) => {
                    acc[k] = String(v);
                    return acc;
                  },
                  {}
                )
              ).toString()
            : undefined,
        headers: this.getHeaders(method, url),
        timeout: 10000,
        // DCInside는 메이저/마이너/미니 전환 시 3xx 리다이렉트를 반환할 수 있음
        // 리다이렉트를 허용하여 최종 HTML을 직접 수신
        maxRedirects: 5,
        validateStatus: () => true,
      };

      const response = await axios(config);
      this.retryCount = 0;

      // status handling
      if (response.status === 429) throw new Error429("Rate limit exceeded");
      if (response.status === 404) {
        this.logger?.error("HTTP 404", method, url);
        throw new Error("Not Found");
      }
      if (response.status >= 400) {
        this.logger?.error(`HTTP ${response.status}`, method, url);
        throw new Error(`HTTP ${response.status}`);
      }

      return response.data as T;
    } catch (error) {
      if (error instanceof AxiosError) {
        this.logger?.error(
          "Axios error",
          error.message,
          error.response?.status
        );
      } else {
        this.logger?.error("Request error", String(error));
      }

      const isNotFound =
        (error instanceof Error && error.message === "Not Found") ||
        (error as AxiosError)?.response?.status === 404;

      if (!isNotFound && this.retryCount < this.maxRetries) {
        this.retryCount += 1;
        const delay = Math.pow(2, this.retryCount) * 1000;
        this.logger?.info(
          `Retry ${this.retryCount}/${this.maxRetries} in ${delay}ms`
        );
        await this.sleep(delay);
        return this.sendRequest<T>(opts);
      }
      throw error;
    }
  }

  private getRandomUserAgent(): string {
    const uas = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Safari/605.1.15",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0",
    ];
    return uas[Math.floor(Math.random() * uas.length)];
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }

  private jitter(ms: number): number {
    return ms + Math.floor(ms * 0.5 * Math.random());
  }

  private getEffectiveCrawlerId(): string {
    return this.options.sid;
  }

  /** -------------------- High-level flow -------------------- */
  private getFirstUrl(): string {
    const KEYWORD_ID = process.env.DC_KEYWORD_CRAWLER;
    const GALLOG_ID = process.env.DC_GALLOG_CRAWLER;
    const crawlerId = this.getEffectiveCrawlerId();

    if (KEYWORD_ID && crawlerId === KEYWORD_ID) {
      if (!this.options.keyword) throw new Error("Keyword is required");
      if (!this.options.target)
        throw new Error("Target gallery ID is required");
      return `${DCInsideCrawler.DC_HOST}/board/lists/?id=${
        this.options.target
      }&s_type=search_subject_memo&s_keyword=${encodeURIComponent(
        this.options.keyword
      )}`;
    }

    if (GALLOG_ID && crawlerId === GALLOG_ID) {
      if (!this.options.url)
        throw new Error("URL is required for gallog crawler");
      return `${this.options.url.replace(/\/$/, "")}/posting`;
    }

    // fallback: legacy cid
    if (this.options.cid === "1") {
      if (!this.options.keyword || !this.options.target)
        throw new Error("Keyword and target required");
      return `${DCInsideCrawler.DC_HOST}/board/lists/?id=${
        this.options.target
      }&s_type=search_subject_memo&s_keyword=${encodeURIComponent(
        this.options.keyword
      )}`;
    }
    if (this.options.cid === "2") {
      if (!this.options.url)
        throw new Error("URL is required for gallog crawler");
      return `${this.options.url.replace(/\/$/, "")}/posting`;
    }

    if (this.options.url) return this.options.url;
    if (!this.options.target) throw new Error("Either URL or target required");
    return `${DCInsideCrawler.DC_HOST}/board/lists/?id=${this.options.target}`;
  }

  /** Python: start_crawling */
  public async startCrawling(): Promise<void> {
    const heartbeat: NodeJS.Timeout = setInterval(() => {
      this.logger?.info(`[hb] alive ${new Date().toISOString()}`);
    }, 15000);
    try {
      // 1) 기존 수집 게시글 댓글 추가 수집
      // await this.saveFromExistingPosts();
      // 2) 검색 (목록 수집)
      await this.search();
      // 3) 수집된 postIdSet 기준으로 상세/댓글 수집
      const ids = Array.from(this.postIdSet);
      // Python은 과거순 정렬: gallType, galleryId, postNo 기준 정렬
      ids.sort((a, b) => {
        const as = DCInsideCrawler.splitPlatformId(a);
        const bs = DCInsideCrawler.splitPlatformId(b);
        // [gallType, galleryId, postNo]
        if (as[0] !== bs[0]) return as[0] < bs[0] ? -1 : 1;
        if (as[1] !== bs[1]) return as[1] < bs[1] ? -1 : 1;
        return Number(as[2]) - Number(bs[2]);
      });

      this.logger?.info(`searching done. ${ids.length} posts found.`);

      let idx = 0;
      for (const platformId of ids) {
        if (this.shouldCancel?.()) return;
        await this.savePostInfo(platformId);
        idx += 1;
        this.logger?.info(
          `[post] done #${platformId}, ${idx}/${ids.length} (${(
            (idx / ids.length) *
            100
          ).toFixed(2)}%)`
        );
        await this.sleep(this.jitter(this.requestDelayMs));
      }

      this.logger?.info(`${this.options.id} DONE.`);
    } finally {
      clearInterval(heartbeat);
    }
  }

  /** Python: save_from_existing_posts */
  // public async saveFromExistingPosts(): Promise<void> {
  //   if (!this.expirationDate) return;
  //   const posts = await this.repo.listRecentPosts(
  //     this.options.id,
  //     this.expirationDate
  //   );
  //   this.logger?.info(`${posts.length} found in DB.`);

  //   let idx = 0;
  //   for (const p of posts) {
  //     this.logger?.info(`[post] start #${p.platformPostId}`);
  //     if (this.shouldCancel?.()) return;

  //     // GET post page
  //     let html: string;
  //     try {
  //       html = await this.fetchHtml(p.url);
  //     } catch (e) {
  //       // 게시글 삭제 등 → skip
  //       continue;
  //     }

  //     try {
  //       const $ = cheerio.load(html);
  //       const esno =
  //         $("form#_view_form_").find("input#e_s_n_o").attr("value") ?? "";
  //       const infoWrap = $("main#container").find("div.view_content_wrap");
  //       const commentCntTxt = infoWrap.find("span.gall_comment").text().trim();
  //       const commentCnt = this.parseTailInteger(commentCntTxt);

  //       if (p.commentCnt !== commentCnt)
  //         await this.repo.updatePostCommentCount(p.postId, commentCnt);
  //       if (commentCnt === 0) continue;

  //       await this.saveCommentsFromPost(p.postId, p.url, esno);
  //     } catch (e) {
  //       this.logger?.error("saveFromExistingPosts error", e);
  //       return;
  //     }

  //     idx += 1;
  //     this.logger?.info(
  //       `[post] done #${p.platformPostId}, ${idx}/${posts.length} (${(
  //         (idx / posts.length) *
  //         100
  //       ).toFixed(2)}%)`
  //     );
  //   }
  // }

  /** Python: search */
  public async search(): Promise<void> {
    let nextUrl = this.getFirstUrl();

    while (true) {
      if (this.shouldCancel?.()) return;

      const { postList, pagingBar } = await this.searchPage(nextUrl, true);
      const shouldContinue = await this.getPostList(postList);
      if (!shouldContinue) return; // 기존 수집 지점 도달 → 종료

      // 현재 pagination block의 개별 페이지들 순회
      const pageLinks = pagingBar ? cheerio.load(pagingBar)("a").toArray() : [];
      const currentPageUrl = nextUrl;
      for (const a of pageLinks) {
        const $a = cheerio.load(a).root();
        const classList = ($a.attr("class") ?? "").trim();
        if (classList.length > 0) continue; // prev/next 등 class가 있으면 skip (Python과 동일)

        const href = $a.attr("href");
        if (!href) continue;
        try {
          nextUrl = new URL(href, currentPageUrl).toString();
        } catch {
          continue;
        }

        try {
          const { postList: innerList } = await this.searchPage(nextUrl, false);
          const ok = await this.getPostList(innerList);
          if (!ok) return;
        } catch (e) {
          this.logger?.error("search inner page error", e);
          break;
        }
        await this.sleep(this.jitter(1000));
      }

      // 다음 pagination block (page_next or search_next)
      const nextHref = this.extractNextHrefFromPaging(pagingBar);
      if (!nextHref) break;
      try {
        nextUrl = new URL(nextHref, currentPageUrl).toString();
      } catch {
        break;
      }
      await this.sleep(this.jitter(1000));
    }
  }

  /** Python: search_page */
  private async searchPage(
    url: string,
    pagingBar = false
  ): Promise<{ postList: AnyNode[]; pagingBar?: string }> {
    this.logger?.info(`[search] GET ${url}`);
    const html = await this.fetchHtml(url);
    const $ = cheerio.load(html);

    const crawlerId = this.getEffectiveCrawlerId();
    const KEYWORD_ID = process.env.DC_KEYWORD_CRAWLER;
    const GALLOG_ID = process.env.DC_GALLOG_CRAWLER;

    if (KEYWORD_ID && crawlerId === KEYWORD_ID) {
      // 일반/마이너/미니 공통 테이블 중 id가 없는 실제 목록 테이블 선택
      const rows = $("table.gall_list")
        .filter((_, el) => !$(el).attr("id"))
        .find("tbody > tr")
        .toArray();
      this.logger?.info(`[search] rows=${rows.length} (keyword mode)`);
      if (pagingBar) {
        const $paging = $(
          "div.bottom_paging_wrap.re div.bottom_paging_box.iconpaging"
        );
        return { postList: rows, pagingBar: $paging.html() ?? undefined };
      }
      return { postList: rows };
    }

    if (GALLOG_ID && crawlerId === GALLOG_ID) {
      const rows = $("ul.cont_listbox > li").toArray();
      if (pagingBar) {
        const $paging = $("div.cont_box div.bottom_paging_box.iconpaging");
        return { postList: rows, pagingBar: $paging.html() ?? undefined };
      }
      return { postList: rows };
    }

    // fallback: keyword 형태로 간주
    const rows = $("table.gall_list")
      .filter((_, el) => !$(el).attr("id"))
      .find("tbody > tr")
      .toArray();
    const $paging = $(
      "div.bottom_paging_wrap.re div.bottom_paging_box.iconpaging"
    );
    this.logger?.info(`[search] rows=${rows.length} (fallback)`);
    return {
      postList: rows,
      pagingBar: pagingBar ? $paging.html() ?? undefined : undefined,
    };
  }

  /** Python: get_post_list → return boolean (계속 진행 여부) */
  private async getPostList(rows: AnyNode[]): Promise<boolean> {
    const crawlerId = this.getEffectiveCrawlerId();
    const KEYWORD_ID = process.env.DC_KEYWORD_CRAWLER;
    const GALLOG_ID = process.env.DC_GALLOG_CRAWLER;
    const dateFrom = this.options.dateFrom
      ? new Date(`${this.options.dateFrom}T00:00:00+09:00`)
      : undefined;

    const total = rows.length;
    let withDataNo = 0;
    let withNumericNum = 0;
    let queued = 0;
    let noHref = 0;
    let invalidUrl = 0;

    for (const row of rows) {
      const $row = cheerio.load(row).root();
      // 공지/광고 제외 규칙: data-no가 있거나, gall_num이 숫자(공지 아님)
      const dataNoAttr = $row.attr("data-no");
      const gallNumTxt = $row.find("td.gall_num").text().trim();
      const isNumericNum = /^[0-9]+$/.test(gallNumTxt);
      const isNotice = gallNumTxt.includes("공지");
      const isPostRow = Boolean(dataNoAttr) || (isNumericNum && !isNotice);
      if (!isPostRow) continue;
      if (dataNoAttr) withDataNo += 1;
      if (!dataNoAttr && isNumericNum && !isNotice) withNumericNum += 1;

      // 링크 선택: view 링크를 우선, 없으면 제목 영역, 마지막으로 임의 a[href]
      const aView = $row.find('a[href*="/board/view"]');
      const aTit = $row.find("td.gall_tit a[href]");
      const aAny = $row.find("a[href]");
      const href =
        (aView.length ? aView.first().attr("href") : undefined) ||
        (aTit.length ? aTit.first().attr("href") : undefined) ||
        (aAny.length ? aAny.first().attr("href") : undefined);
      if (!href) {
        noHref += 1;
        continue;
      }

      let url: string | null = null;
      try {
        url = new URL(href, this.baseUrl).toString();
      } catch {
        invalidUrl += 1;
        continue;
      }

      let writtenAt: Date | null = null;
      try {
        if (KEYWORD_ID && crawlerId === KEYWORD_ID) {
          const dateTitle = $row.find("td.gall_date").attr("title") ?? ""; // "YYYY-MM-DD HH:mm:ss"
          const day = dateTitle.split(" ")[0];
          writtenAt = new Date(`${day}T00:00:00+09:00`);
        } else if (GALLOG_ID && crawlerId === GALLOG_ID) {
          const dateTxt = $row.find("span.date").text().trim(); // "YYYY.MM.DD"
          const iso = dateTxt.replace(/\./g, "-");
          writtenAt = new Date(`${iso}T00:00:00+09:00`);
        } else {
          const dateTitle = $row.find("td.gall_date").attr("title") ?? "";
          const day = dateTitle.split(" ")[0];
          writtenAt = new Date(`${day}T00:00:00+09:00`);
        }
      } catch {
        /* ignore parse errors */
      }

      if (dateFrom && writtenAt && writtenAt < dateFrom) return false; // 수집 대상 아님 → 종료

      if (!url) continue;
      const platformPostId = DCInsideCrawler.urlToPlatformId(url);

      // DB 존재 여부 확인
      const exists = await this.repo.findPostByPlatformId(
        this.options.id,
        platformPostId
      );
      if (exists) {
        this.logger?.info("already exists");
        return false; // 지난 수집 지점 도달 → 종료
      }

      const titleAnchor = aView.length
        ? aView.first()
        : aTit.length
        ? aTit.first()
        : aAny.first();
      const titleText = (titleAnchor.text() || "").replace(/\s+/g, " ").trim();

      this.postIdSet.add(platformPostId);
      queued += 1;
      this.logger?.info(`[match] "${titleText}" | ${platformPostId} - ${url}`);
    }

    this.logger?.info(
      `[match] summary rows=${total} withDataNo=${withDataNo} withNumericNum=${withNumericNum} queued=${queued} skipped(noHref=${noHref}, invalidUrl=${invalidUrl})`
    );
    return true;
  }

  private extractNextHrefFromPaging(
    pagingBarHtml?: string
  ): string | undefined {
    if (!pagingBarHtml) return undefined;
    const $ = cheerio.load(pagingBarHtml);
    const next = $("a.page_next, a.search_next").first();
    const href = next.attr("href");
    return href ? href : undefined;
  }

  /** -------------------- Post detail & comments -------------------- */
  private async savePostInfo(platformPostId: string): Promise<void> {
    const url = DCInsideCrawler.platformIdToUrl(platformPostId);

    let html: string;
    try {
      html = await this.fetchHtml(url);
    } catch (e) {
      return; // 404 삭제 등
    }

    try {
      const $ = cheerio.load(html);
      const postInfo = $("main#container").find("div.view_content_wrap");
      const form = $("form#_view_form_");
      const postNo = form.find("input#no").attr("value") ?? "";

      // 싫어요(optional)
      const dislikeNode = postInfo.find(`p#recommend_view_down_${postNo}`);
      const dislikeTxt = dislikeNode.text().trim();
      const dislikeCnt = dislikeTxt ? this.parseInteger(dislikeTxt) : null;

      const title = postInfo.find("header span.title_subject").text().trim();
      const contents = postInfo.find("div.write_div").text().trim();

      const writerBox = postInfo.find("header div.gall_writer.ub-writer");
      const writer = writerBox.attr("data-nick") ?? null;
      const writerId = writerBox.attr("data-uid") ?? null;
      const writerIp = writerBox.attr("data-ip") ?? null;

      const writtenAtRaw = postInfo.find("header span.gall_date").text().trim();
      const writtenAt = this.parseKSTDateTime(writtenAtRaw);

      const likeTxt = postInfo
        .find(`p#recommend_view_up_${postNo}`)
        .text()
        .trim();
      const likeCnt = this.parseInteger(likeTxt);

      const commentCntTxt = postInfo.find("span.gall_comment").text().trim();
      const commentCnt = this.parseTailInteger(commentCntTxt);

      const esno = form.find("input#e_s_n_o").attr("value") ?? "";

      const post: PostInput = {
        scenarioId: this.options.id,
        platformPostId: platformPostId,
        url,
        title,
        contents,
        writer,
        writerId,
        writerIp,
        writtenAt,
        likeCnt,
        dislikeCnt,
        commentCnt,
      };

      const saved = await this.repo.insertPost(post);
      if (saved.commentCnt > 0) {
        await this.saveCommentsFromPost(saved.postId, url, esno);
      }
    } catch (e) {
      this.logger?.error("savePostInfo parse error", e);
    }
  }

  private async saveCommentsFromPost(
    postId: string,
    postUrl: string,
    esno: string
  ): Promise<void> {
    let page = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      this.logger?.info(`[comment] start page#${page}`);
      await this.sleep(this.jitter(2000));
      try {
        const result = await this.getCommentPage(postId, postUrl, page, esno);
        const list = result.comments ?? [];
        if (list.length === 0) break; // EndOfPage
        await this.saveCommentInfo(postId, postUrl, list);
      } catch (e) {
        // EndOfPage or parse error
        break;
      }
      page += 1;
    }
  }

  private async getCommentPage(
    postId: string,
    postUrl: string,
    pageNum: number,
    esno: string
  ): Promise<DCCommentPageResult> {
    void postId; // kept for parity with Python signature
    const info = DCInsideCrawler.extractGalleryInfoFromUrl(postUrl);

    const data = {
      id: info.galleryId ?? "", // gallery_id
      no: info.postNo ?? "", // article_no
      cmt_id: info.galleryId ?? "",
      cmt_no: info.postNo ?? "",
      focus_cno: "",
      focus_pno: "",
      e_s_n_o: esno,
      comment_page: pageNum,
      sort: "N", // I, D, N, R
      prevCnt: 0,
      board_type: "",
      _GALLTYPE_: info.gallType ?? "G",
    } as const;

    const url = `${DCInsideCrawler.DC_HOST}/board/comment/`;
    const res = await this.sendRequest<DCCommentPageResult>({
      method: "POST",
      url,
      data,
    });
    // 서버는 { comments: DCCommentApiItem[] } 형태 반환 (Python과 동일 가정)
    return res;
  }

  private async saveCommentInfo(
    postId: string,
    url: string,
    commentList: DCCommentApiItem[]
  ): Promise<void> {
    const results: CommentInput[] = [];

    for (const c of commentList) {
      if (!c.no) continue; // 댓글 아님(댓글돌이 등)
      if (c.del_yn === "Y") continue; // 삭제 댓글

      const platformCommentId = `${DCInsideCrawler.urlToPlatformId(url)}&${
        c.no
      }`;

      const dup = await this.repo.commentExists(
        this.options.id,
        platformCommentId
      );
      if (dup) continue;

      const contents = this.stripHtml(c.memo).trim();
      if (!contents) continue;

      // gallery: gallType & galleryId
      const p = DCInsideCrawler.extractGalleryInfoFromUrl(url);
      const gallery = `${p.gallType ?? "G"}&${p.galleryId ?? ""}`;

      // 날짜 보정: "MM.DD HH:mm:ss" → 현재 KST 연도로 보정
      let writtenAtStr = c.reg_date;
      if (writtenAtStr.split(".").length === 2) {
        const y = new Date();
        writtenAtStr = `${y.getFullYear()}.${writtenAtStr}`;
      }
      const writtenAt = this.parseDotDateTimeKST(writtenAtStr);

      results.push({
        commentId: cryptoRandomUUID(),
        postId,
        platformCommentId,
        scenarioId: this.options.id,
        writerId: c.user_id ?? null,
        writer: c.name ?? null,
        writerIp: c.ip ?? null,
        contents,
        url,
        gallery,
        writtenAt,
      });
    }

    if (results.length > 0) await this.repo.insertCommentsBulk(results);
  }

  /** -------------------- Utilities -------------------- */
  private async fetchHtml(url: string): Promise<string> {
    const data = await this.sendRequest<string>({ method: "GET", url });
    return typeof data === "string" ? data : String(data);
  }

  private parseKSTDateTime(txt: string): Date {
    // DCInside 예: "2025.09.01 12:34:56" 또는 "2025-09-01 12:34:56"
    const norm = txt.trim().replace(/\./g, "-");
    return new Date(
      `${norm}:00`.replace(/(\d{2}:\d{2})$/, "$1:00").replace(" ", "T") +
        "+09:00"
    );
  }

  private parseDotDateTimeKST(txt: string): Date {
    // 예: "2025.09.01 12:34:56"
    const norm = txt.trim().replace(/\./g, "-");
    return new Date(`${norm.replace(" ", "T")}+09:00`);
  }

  private parseInteger(txt: string): number {
    const num = txt.replace(/[^0-9\-]/g, "");
    return Number.parseInt(num || "0", 10);
  }

  private parseTailInteger(txt: string): number {
    // 예: "댓글 1,234" → 1234
    const t = txt.split(" ").pop() ?? txt;
    return this.parseInteger(t.replace(/,/g, ""));
  }

  private stripHtml(html: string): string {
    const $ = cheerio.load(html);
    return $.root().text();
  }
}

/** cryptoRandomUUID polyfill for Node<19 */
function cryptoRandomUUID(): string {
  if (
    typeof globalThis.crypto !== "undefined" &&
    "randomUUID" in globalThis.crypto
  ) {
    return globalThis.crypto.randomUUID();
  }
  // Fallback (not RFC4122-complaint strict, but stable)
  const s4 = (): string =>
    Math.floor((1 + Math.random()) * 0x10000)
      .toString(16)
      .substring(1);
  return `${s4()}${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`;
}
