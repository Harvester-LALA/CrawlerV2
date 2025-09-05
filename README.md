# CrawlerV2

## How to run

### Command (Windows Powershell)

```bash
$env:DC_KEYWORD_CRAWLER="myScenario"
npm run dev -- -s <--sid: 시나리오 id> -c <--cid: 크롤러 id(크롤러 종류 선택)> -t <--target: 타깃 갤러리 id> -k <--keyword: 검색어>
```

### Command Examples
```bash
$env:DC_KEYWORD_CRAWLER="myScenario"
npm run dev -- -s myScenario -c 5 -t programming -k "검색어"
```
