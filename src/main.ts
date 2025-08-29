import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { run } from "./core/base";
import { CrawlerOptions } from "./types/crawlerOptions";

async function main() {
  // python -m crawler.main -s "scenario123" -c "5" -u "https://www.dcinside.com" -k "검색어" -t "갤러리" migration ver.
  const argv = await yargs(hideBin(process.argv))
    .scriptName("lala-crawler")
    .usage("Usage: $0 -s <scenario_id> -c <crawler_id> [options]")
    .option("sid", {
      alias: "s",
      type: "string",
      description: "시나리오 ID",
      demandOption: true,
    })
    .option("cid", {
      alias: "c",
      type: "string",
      description: "크롤러 ID",
      demandOption: true,
    })
    .option("url", {
      alias: "u",
      type: "string",
      description: "크롤링할 URL",
    })
    .option("keyword", {
      alias: "k",
      type: "string",
      description: "검색 키워드",
    })
    .option("target", {
      alias: "t",
      type: "string",
      description: "대상 (예: 갤러리, 게시판 등)",
    })
    .help()
    .alias("h", "help")
    .parse();

  try {
    const options: CrawlerOptions = {
      sid: argv.sid,
      cid: argv.cid,
      url: argv.url,
      keyword: argv.keyword,
      target: argv.target,
    };

    // 크롤러 실행
    await run(options);
  } catch (error) {
    console.error("크롤링 실행 중 오류가 발생했습니다:", error);
    process.exit(1);
  }
}

main().catch(console.error);
