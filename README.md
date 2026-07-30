# 아이디어스 판매량·리뷰·순위 측정기

아이디어스 검색 결과 카드 이미지 위에 다음 지표를 표시합니다.

- 누적 판매량
- 오늘 판매량
- 최근 7일 판매량
- 오늘 증가한 리뷰 수
- 광고를 제외한 자연 검색 순위와 전날 대비 등락

## Chrome 확장프로그램 설치

1. Chrome 주소창에서 `chrome://extensions`를 엽니다.
2. 오른쪽 위 **개발자 모드**를 켭니다.
3. **압축해제된 확장 프로그램을 로드합니다**를 누릅니다.
4. 이 `idus-sales-tracker` 폴더를 선택합니다.
5. 아이디어스 검색 결과 페이지를 새로고침합니다.

서버를 연결하지 않아도 동작하지만, Chrome이 꺼진 날의 기록은
누락됩니다.

## GitHub 무료 수집기 배포

PC가 꺼져 있어도 기록하려면 이 폴더 전체를 공개 GitHub 저장소에
올립니다. 저장소의 **Settings → Actions → General → Workflow
permissions**에서 **Read and write permissions**를 선택해야 자동 수집
결과를 커밋할 수 있습니다.

Actions 화면에서 **Collect idus metrics** 워크플로를 한 번 수동
실행합니다. 성공하면 `data/tracker.json`에 첫 기록이 생성됩니다.
이후 매일 한국시간 00:05에 자동 실행됩니다.

확장프로그램 아이콘을 누르고 **GitHub 데이터 주소**에 아래 형식의
주소를 입력합니다.

```text
https://raw.githubusercontent.com/GITHUB_ID/REPOSITORY/main/data/tracker.json
```

저장소가 비공개이면 확장프로그램이 인증 없이 데이터를 읽을 수
없으므로 공개 저장소를 사용해야 합니다. 저장되는 내용은 공개된 상품
ID, 상품명, 누적 판매량, 리뷰 수와 검색 순위입니다.

## 키워드 추가

`collector/config.json`의 `keywords` 배열에 키워드와 아이디어스 검색
URL을 추가합니다.

```json
{
  "keyword": "액막이명태",
  "url": "https://www.idus.com/v2/search?keyword=..."
}
```

## 집계 기준

- **오늘 판매량**: 오늘 00:05경 저장된 누적 판매량과 현재값의 차이
- **최근 7일**: 정확히 7일 전 누적 판매량과 현재값의 차이
- **리뷰 증가**: 전날 00:05경 리뷰 수와 현재 리뷰 수의 차이
- **자연 순위**: `.BaseBadgeAd`가 있는 광고 카드를 제외한 순서
- **순위 등락**: 전날 자연 순위와 현재 자연 순위의 차이

`▲2`는 전날보다 두 계단 상승, `▼2`는 두 계단 하락을 뜻합니다.
광고로만 노출되고 자연 검색 결과에는 없는 상품은
`광고·자연순위 없음`으로 표시됩니다.

## 확인 명령

```bash
npm ci
npm test
npx playwright install chromium
npm run collect
```

아이디어스의 페이지 구조나 구매 문구가 바뀌면 수집기를 수정해야 할 수
있습니다. 지나치게 짧은 주기로 반복 수집하지 마세요.
