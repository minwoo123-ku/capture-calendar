# capture-calendar

카톡·문자·메일·알림 캡처 이미지에서 일정(제목, 날짜, 시작·종료 시간, 장소, 메모)을 뽑아,
사용자가 확인·수정한 뒤 Google 캘린더 링크나 .ics 파일로 내보내는 웹앱. 주로 폰 브라우저에서 쓰고 GitHub Pages로 배포한다.
전체 계획과 진행 상황은 `plan.md`에 있다.

## 반드시 지킬 것

- API 키나 개인정보를 코드·GitHub에 넣지 않는다. 실제 캡처 이미지는 `samples/`에만 두고 커밋하지 않는다(.gitignore). 테스트 문장은 지어낸 것만 쓴다.
- 이미지는 브라우저 안에서만 처리하고 밖으로 보내지 않는다. CDN에서는 코드와 언어 데이터만 받는다.
- 추출 결과는 반드시 확인·수정 화면을 거친 뒤 저장하거나 내보낸다. 자동 등록은 하지 않는다("확인 완료"를 눌러야 저장 버튼이 열린다).
- 저장한 일정은 이 기기 브라우저의 localStorage에만 둔다. 서버나 다른 곳으로 보내지 않는다.
- 모르는 건 추측하지 말고 먼저 사용자에게 묻는다.
- 단계(① parser → ② 화면·OCR → ③ 내보내기 → ④ 배포)마다 끝나면 멈추고 결과를 보여 준다. git push처럼 밖으로 나가는 작업은 직전에 한 번 더 확인받는다.

## 기술 (바꾸지 않는다)

- `index.html` 단일 페이지 + `parser.js`. 빌드 도구·프레임워크·서버·npm 패키지 없음.
- 글자 인식: Tesseract.js 7.0.0 (CDN, SRI 해시 포함, 언어 `kor+eng`). 코어·워커·언어 데이터 주소도 index.html의 `OCR_OPTIONS`에 고정되어 있다. 버전을 올릴 때는 SRI 해시도 다시 계산한다.
- 전처리는 영역별 이진화 + PSM 6이다. 왜 이 방식인지는 plan.md "②에서 정한 것"에 있으니 바꾸기 전에 읽는다.
- 디자인 작업은 `.claude/skills/frontend-design/SKILL.md`(anthropics/skills 커밋 41bbe19, Apache 2.0)를 따른다. 사용자는 "AI가 만든 티"를 싫어한다.
  - 피할 것: 대문자 자간 라벨, 가운뎃점으로 이은 메타 문구, `→`, 같은 모양 카드 반복, 그라데이션 장식
  - 지금 방향(4차): 미색 종이 + 남색 잉크, Pretendard 하나. 포인트는 빨간 펜 동그라미와 형광펜 밑줄뿐. 파스텔 4색은 일정 구분에만 쓴다. 참고 화면을 그대로 베끼지 않는다. 자세한 건 plan.md "디자인 4차" 참고.
- 일정 추출: `parser.js`의 순수 함수. 브라우저에서는 `window.CaptureParser`, node에서는 `require('./parser.js')`.
- 내보내기: Google 캘린더 추가 링크(`ctz=Asia/Seoul`), .ics 다운로드(VALARM 1일 전 / 1시간 전 선택). 만드는 함수도 `parser.js`에 둔다.
- 시간대는 Asia/Seoul 고정. 날짜는 연·월·일 숫자로만 계산하고 `new Date('YYYY-MM-DD')` 같은 문자열 파싱은 쓰지 않는다.

## 명령

이 폴더(`capture-calendar`)에서 실행한다. 경로에 공백·한글이 있으니 항상 따옴표로 감싼다.

- 테스트: `node --test` (`test/*.test.js`를 자동으로 찾는다)
- 로컬 확인(② 단계부터): `py -m http.server 8000` 후 http://localhost:8000 . `file://`로 열면 Tesseract Worker가 막힌다.
- npm은 쓰지 않는다. 혹시 필요하면 PowerShell 실행 정책 때문에 `npm.cmd`/`npx.cmd`로 실행한다.

## 구조

- `index.html` 화면, CSS, OCR 연결, 저장. 화면은 해시로 셋: `#` 처음(버튼 두 개), `#capture` 캡처 올리기·확인·저장, `#list` 날짜별 할 일 목록
- `parser.js` 순수 함수: `normalizeText`, `detectBaseDate`, `extractEvents`, `todaySeoul` (③-3에서 `buildGoogleUrl`, `buildICS` 추가). 일정 모양은 `{title,date,endDate,start,end,allDay,location,memo,isDeadline,warnings}`이고 `endDate`는 여러 날 일정의 마지막 날(그날 포함)이다.
- `test/parser.test.js` node:test 단위 테스트
- `plan.md` 계획과 확정된 해석 규칙
