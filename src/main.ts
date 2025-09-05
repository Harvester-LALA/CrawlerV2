import { run } from "./core/base";
import { CrawlerOptions } from "./types/crawlerOptions";

function printHelp(): void {
  const msg = `Usage: lala-crawler -s <scenario_id> -c <crawler_id> [options]\n\nOptions:\n  -s, --sid       시나리오 ID (필수)\n  -c, --cid       크롤러 ID (필수)\n  -u, --url       크롤링할 URL\n  -k, --keyword   검색 키워드\n  -t, --target    대상 (예: 갤러리, 게시판 등)\n  -h, --help      도움말 표시`;
  console.log(msg);
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "-h" || a === "--help") {
      out.help = true;
      continue;
    }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        out[key] = next;
        i += 1;
      } else {
        out[key] = true;
      }
      continue;
    }
    if (a.startsWith("-")) {
      const key = a.slice(1);
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        out[key] = next;
        i += 1;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

async function main() {
  // python -m crawler.main -s "scenario123" -c "5" -u "https://www.dcinside.com" -k "검색어" -t "갤러리" migration ver.
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const sid = (args.sid as string) || (args.s as string) || "";
  const cid = (args.cid as string) || (args.c as string) || "";
  const url = (args.url as string) || (args.u as string) || undefined;
  const keyword = (args.keyword as string) || (args.k as string) || undefined;
  const target = (args.target as string) || (args.t as string) || undefined;

  if (!sid || !cid) {
    console.error("필수 옵션 누락: -s/--sid, -c/--cid 는 필수입니다.\n");
    printHelp();
    process.exit(1);
  }

  try {
    const options: CrawlerOptions = { sid, cid, url, keyword, target };
    await run(options);
  } catch (error) {
    console.error("크롤링 실행 중 오류가 발생했습니다:", error);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
