// parser.js 단위 테스트. 실행: capture-calendar 폴더에서 `node --test`
// 기준일은 2026-11-05(목). 테스트 문장은 모두 지어낸 것이다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../parser.js');

const BASE = '2026-11-05';
const ex = (text, base = BASE) => P.extractEvents(text, base);
const one = (text, base) => {
  const list = ex(text, base);
  assert.equal(list.length, 1, '후보가 1개여야 함: ' + JSON.stringify(list));
  return list[0];
};
const hasWarning = (ev, word) => ev.warnings.some((w) => w.includes(word));

// ---- 날짜 표현 ----

test('"11/6" → 2026-11-06 종일', () => {
  const ev = one('11/6 회의');
  assert.equal(ev.date, '2026-11-06');
  assert.equal(ev.allDay, true);
  assert.equal(ev.start, null);
  assert.equal(ev.title, '회의');
});

test('"11월 6일(금)" → 2026-11-06, 요일이 맞으면 경고 없음', () => {
  const ev = one('11월 6일(금) 저녁 약속');
  assert.equal(ev.date, '2026-11-06');
  assert.equal(ev.title, '저녁 약속');
  assert.deepEqual(ev.warnings, []);
});

test('"11월 6일(토)"처럼 요일이 틀리면 경고', () => {
  const ev = one('11월 6일(토) 회식');
  assert.equal(ev.date, '2026-11-06');
  assert.ok(hasWarning(ev, '요일'));
});

test('"내일" → 2026-11-06', () => {
  assert.equal(one('내일 회의').date, '2026-11-06');
});

test('"모레" → 2026-11-07', () => {
  assert.equal(one('모레 영화 보기').date, '2026-11-07');
});

test('"이번 주 금요일" → 2026-11-06', () => {
  assert.equal(one('이번 주 금요일 회식').date, '2026-11-06');
});

test('"다음 주 화요일" → 2026-11-10 (붙여 써도 같음)', () => {
  assert.equal(one('다음 주 화요일 면접').date, '2026-11-10');
  assert.equal(one('다음주 화요일 면접').date, '2026-11-10');
});

test('"2026년 11월 20일" 연도까지 쓴 날짜', () => {
  assert.equal(one('2026년 11월 20일 결혼식').date, '2026-11-20');
});

// ---- 시간 표현 ----

test('"오후 3시" → 15:00~16:00', () => {
  const ev = one('내일 오후 3시 미팅');
  assert.equal(ev.start, '15:00');
  assert.equal(ev.end, '16:00');
  assert.equal(ev.allDay, false);
  assert.equal(ev.title, '미팅');
});

test('"15:00" → 15:00~16:00', () => {
  const ev = one('내일 15:00 미팅');
  assert.equal(ev.start, '15:00');
  assert.equal(ev.end, '16:00');
});

test('"3시 반" → 15:30 (오전/오후 없는 1~6시는 오후)', () => {
  const ev = one('내일 3시 반 미팅');
  assert.equal(ev.start, '15:30');
  assert.equal(ev.end, '16:30');
});

test('"10시 반" → 10:30 (오전/오후 없는 7~11시는 오전)', () => {
  assert.equal(one('내일 10시 반 미팅').start, '10:30');
});

test('"오후 2시에 치과" → 조사 "에"는 제목에서 빠짐', () => {
  const ev = one('내일 오후 2시에 치과 예약');
  assert.equal(ev.start, '14:00');
  assert.equal(ev.title, '치과 예약');
});

test('범위 "오후 3시~5시" → 15:00~17:00', () => {
  const ev = one('내일 오후 3시~5시 세미나');
  assert.equal(ev.start, '15:00');
  assert.equal(ev.end, '17:00');
  assert.equal(ev.isDeadline, false);
});

test('범위 "15:00-17:30"', () => {
  const ev = one('11/6 15:00-17:30 워크숍');
  assert.equal(ev.start, '15:00');
  assert.equal(ev.end, '17:30');
});

test('"3시간"은 시간으로 보지 않음', () => {
  const ev = one('내일 3시간 회의');
  assert.equal(ev.allDay, true);
  assert.equal(ev.start, null);
});

// ---- 마감 ----

test('"11/10까지" → [마감] 종일', () => {
  const ev = one('11/10까지 보고서 제출');
  assert.equal(ev.date, '2026-11-10');
  assert.equal(ev.isDeadline, true);
  assert.equal(ev.allDay, true);
  assert.equal(ev.title, '[마감] 보고서 제출');
});

test('"오후 6시까지" → [마감] 18:00~18:30', () => {
  const ev = one('내일 오후 6시까지 서류 제출');
  assert.equal(ev.date, '2026-11-06');
  assert.equal(ev.isDeadline, true);
  assert.equal(ev.start, '18:00');
  assert.equal(ev.end, '18:30');
  assert.equal(ev.title, '[마감] 서류 제출');
});

// ---- 기준 날짜 ----

test('카톡 구분선이 있으면 그 날짜가 기준', () => {
  const text = '2026년 11월 3일 화요일\n내일 오후 7시 저녁 약속';
  assert.equal(P.detectBaseDate(text), '2026-11-03');
  const ev = one(text);
  assert.equal(ev.date, '2026-11-04');
  assert.equal(ev.start, '19:00');
});

test('구분선이 여러 개면 줄마다 가장 가까운 위쪽 구분선 기준', () => {
  const text = [
    '2026년 11월 3일 화요일 >',
    '내일 점심 같이 먹자',
    '2026년 11월 5일 목요일',
    '내일 회의 잊지 마',
  ].join('\n');
  const list = ex(text);
  assert.deepEqual(list.map((e) => e.date), ['2026-11-04', '2026-11-06']);
});

test('구분선 연도가 기준일과 2년 이상 차이 나면 OCR 잘못으로 보고 요일이 맞는 가까운 해로', () => {
  // 작은 흰 글씨 구분선 "2026년"을 "2020년"으로 읽은 경우 (2020-11-05도 목요일)
  const ev = one('2020년 11월 5일 목요일\n내일 회의');
  assert.equal(ev.date, '2026-11-06');
  assert.equal(P.detectBaseDate('2020년 11월 5일 목요일', '2026-11-05'), '2026-11-05');
  // 작년 구분선은 그대로 둔다
  assert.equal(P.detectBaseDate('2025년 12월 31일 수요일', '2026-11-05'), '2025-12-31');
  // 요일이 맞는 해가 작년·올해·내년에 없으면 기준일의 해
  assert.equal(P.detectBaseDate('2019년 3월 4일 일요일', '2026-11-05'), '2026-03-04');
});

test('구분선이 없으면 넘겨받은 기준일, 기준일도 없으면 서울 기준 오늘', () => {
  assert.equal(P.detectBaseDate('내일 회의'), null);
  assert.equal(one('내일 회의').date, '2026-11-06');
  assert.equal(P.extractEvents('오늘 회의')[0].date, P.todaySeoul());
});

test('todaySeoul은 Asia/Seoul 기준 (UTC 16시 = 서울 다음날 1시)', () => {
  assert.equal(P.todaySeoul(new Date('2026-11-05T16:00:00Z')), '2026-11-06');
  assert.equal(P.todaySeoul(new Date('2026-11-05T14:59:00Z')), '2026-11-05');
});

// ---- 여러 일정과 줄 처리 ----

test('한 텍스트에 일정이 여러 개면 모두 후보', () => {
  const list = ex('11/6 회의\n11/8 오후 2시 병원');
  assert.equal(list.length, 2);
  assert.equal(list[0].date, '2026-11-06');
  assert.equal(list[1].date, '2026-11-08');
  assert.equal(list[1].start, '14:00');
  assert.equal(list[1].title, '병원');
});

test('날짜 줄 바로 다음의 시간만 있는 줄은 같은 일정으로 합침', () => {
  const ev = one('11/6 팀 회의\n오후 3시 3층 회의실');
  assert.equal(ev.date, '2026-11-06');
  assert.equal(ev.start, '15:00');
  assert.equal(ev.title, '팀 회의');
  assert.ok(ev.memo.includes('3층 회의실'));
});

test('날짜가 전혀 없고 시간만 있으면 기준일 + 날짜 추정 경고', () => {
  const ev = one('오후 4시에 전화 주세요');
  assert.equal(ev.date, BASE);
  assert.equal(ev.start, '16:00');
  assert.ok(hasWarning(ev, '날짜'));
});

test('카톡 보낸 시각(오후 3:12)만 있는 줄은 무시', () => {
  const ev = one('내일 오후 3시 회의\n1 오후 3:12\n오후 3:13');
  assert.equal(ev.start, '15:00');
  assert.deepEqual(ex('오후 3:12\n9:41'), []);
});

test('줄 끝에 붙은 카톡 보낸 시각(공백 2칸 이상 뒤 "오후 3:12")은 시간으로 보지 않음', () => {
  const ev = one('11/6 회의        오후 3:12\n네 좋아요!');
  assert.equal(ev.allDay, true);
  assert.equal(ev.title, '회의');
  assert.equal(ev.memo, '11/6 회의');
});

test('줄 앞에 붙은 카톡 보낸 시각도 떼어 냄', () => {
  const ev = one('오후 3:20     내일 저녁 7시 반');
  assert.equal(ev.start, '19:30');
});

test('두 줄로 나뉜 말풍선: 다음 줄에서 제목·장소를 채움', () => {
  const ev = one('다음 주 화요일 오후 2시에\n판교역에서 미팅 가능하세요?');
  assert.equal(ev.date, '2026-11-10');
  assert.equal(ev.start, '14:00');
  assert.equal(ev.location, '판교역');
  assert.equal(ev.title, '미팅');
  assert.ok(ev.memo.includes('판교역에서'));
});

test('말풍선 이어짐은 카톡 보낸 시각에서 끊김', () => {
  const ev = one('내일 오후 3시\n오후 3:12\n네 좋아요!');
  assert.equal(ev.title, '일정');
  assert.ok(!ev.memo.includes('좋아요'));
});

test('제목이 이미 충분하면 다음 줄은 메모에만 붙임', () => {
  const ev = one('11/6 프로젝트 회의\n자료 준비 부탁드려요');
  assert.equal(ev.title, '프로젝트 회의');
  assert.ok(ev.memo.includes('자료 준비'));
});

test('OCR 테두리 잡음이 붙은 구분선도 인식 "| . 2026년 11월 5일 목요일 >  |"', () => {
  assert.equal(P.detectBaseDate('| . 2026년 11월 5일 목요일 >     |'), '2026-11-05');
});

test('같은 날짜·시간 후보는 하나로 합침', () => {
  assert.equal(ex('내일 오후 3시 회의\n내일 오후 3시 회의 맞지?').length, 1);
});

// ---- OCR 잡음 ----

test('OCR 띄어쓰기 "1 1 월 6 일", "오 후 3 시"', () => {
  assert.equal(one('1 1 월 6 일 회의').date, '2026-11-06');
  assert.equal(one('내일 오 후 3 시 회의').start, '15:00');
});

test('전각 숫자·기호 "１１/６ １５：００"', () => {
  const ev = one('１１/６ １５：００ 회의');
  assert.equal(ev.date, '2026-11-06');
  assert.equal(ev.start, '15:00');
});

// ---- 연도와 지난 날짜 ----

test('연도 넘김: 기준 12/28에 "1/3" → 다음 해', () => {
  assert.equal(one('1/3 신년회', '2026-12-28').date, '2027-01-03');
});

test('연도 넘김: 기준 1/3에 "12/28" → 작년 + 지난 날짜 경고', () => {
  const ev = one('12/28 송년회', '2027-01-03');
  assert.equal(ev.date, '2026-12-28');
  assert.ok(hasWarning(ev, '지난'));
});

test('조금 지난 날짜 "11/3"은 올해 그대로 + 지난 날짜 경고', () => {
  const ev = one('11/3 회의');
  assert.equal(ev.date, '2026-11-03');
  assert.ok(hasWarning(ev, '지난'));
});

// ---- 장소 ----

test('장소 "강남역에서"', () => {
  const ev = one('내일 강남역에서 저녁');
  assert.equal(ev.location, '강남역');
  assert.equal(ev.title, '저녁');
});

test('장소 "장소: 홍대입구역 3번 출구"', () => {
  const ev = one('모레 오후 7시 동창 모임 장소: 홍대입구역 3번 출구');
  assert.equal(ev.location, '홍대입구역 3번 출구');
  assert.equal(ev.title, '동창 모임');
  assert.equal(ev.start, '19:00');
});

// ---- 제목 다듬기 (③-1). 원래 문장은 메모에 남는다 ----

test('제목: "보내주세요" → "보내기", 앞의 "그리고"는 뺌', () => {
  const ev = one('그리고 11/13까지 견적서 보내주세요');
  assert.equal(ev.title, '[마감] 견적서 보내기');
  assert.equal(ev.memo, '그리고 11/13까지 견적서 보내주세요');
});

test('제목: "제출해 주세요!!" → "제출"', () => {
  assert.equal(one('11/7 보고서 제출해 주세요!!').title, '보고서 제출');
});

test('제목: 묻는 말·맺는 말·웃음 빼기', () => {
  assert.equal(one('내일 점심 어때요?').title, '점심');
  assert.equal(one('모레 저녁 약속이에요~').title, '저녁 약속');
  assert.equal(one('내일 회의 있어요 ㅎㅎ').title, '회의');
  assert.equal(one('혹시 금요일 회식 가능하세요?').title, '회식');
  assert.equal(one('11/9 미팅 할까요').title, '미팅');
});

test('제목: 끝에 붙은 OCR 찌꺼기("4,50", "oo, ,", "ㅠ』 ,")와 "가요" 빼기', () => {
  assert.equal(one('11/27까지 보고서 제출해 주세요 4,50').title, '[마감] 보고서 제출');
  assert.equal(one('내일 회의 oo, ,').title, '회의');
  assert.equal(one('내일 저녁 약속 ㅠ』 , ,,').title, '저녁 약속');
  assert.equal(one('11/20~11/22 제주 여행 가요').title, '제주 여행');
  assert.equal(one('11/6 회의 ABC').title, '회의 ABC');
});

test('제목: 다듬을 게 없으면 그대로, 다 지워지면 원래 제목', () => {
  assert.equal(one('11/6 프로젝트 회의').title, '프로젝트 회의');
  assert.equal(one('내일 가능하세요?').title, '가능하세요?');
});

// ---- 여러 날 일정 (③-1) ----

test('여러 날 "11/6~11/8 제주 여행" → endDate', () => {
  const ev = one('11/6~11/8 제주 여행');
  assert.equal(ev.date, '2026-11-06');
  assert.equal(ev.endDate, '2026-11-08');
  assert.equal(ev.allDay, true);
  assert.equal(ev.title, '제주 여행');
});

test('여러 날 "11월 6일부터 8일까지"는 마감이 아님', () => {
  const ev = one('11월 6일부터 8일까지 워크숍');
  assert.equal(ev.date, '2026-11-06');
  assert.equal(ev.endDate, '2026-11-08');
  assert.equal(ev.isDeadline, false);
  assert.equal(ev.title, '워크숍');
});

test('여러 날: 달을 넘기는 "11/30-12/2 출장"', () => {
  const ev = one('11/30-12/2 출장');
  assert.equal(ev.endDate, '2026-12-02');
});

test('하루짜리 일정은 endDate가 null, 시간 범위는 여러 날로 보지 않음', () => {
  assert.equal(one('11/6 회의').endDate, null);
  const ev = one('11/6 15:00-17:30 워크숍');
  assert.equal(ev.endDate, null);
  assert.equal(ev.end, '17:30');
  assert.equal(one('11/6 - 3시 회의').endDate, null);
});

// ---- 잘못 읽힌 카톡 보낸 시각 (③-1) ----

test('OCR이 잘못 읽은 보낸 시각만 있는 줄은 무시 ("모후 3:15", "os 316", "1 모후 312")', () => {
  assert.deepEqual(ex('모후 3:15'), []);
  assert.deepEqual(ex('os 316'), []);
  assert.deepEqual(ex('1 모후 312'), []);
  assert.deepEqual(ex('오후 312'), []);
});

test('줄 끝·앞에 붙은 잘못 읽힌 보낸 시각은 공백 1칸이어도 떼어 냄', () => {
  const ev = one('내일 오후 3시 회의 모후 312');
  assert.equal(ev.title, '회의');
  assert.equal(ev.start, '15:00');
  const ev2 = one('OS 316 내일 저녁 약속');
  assert.equal(ev2.title, '저녁 약속');
  assert.equal(ev2.allDay, true);
});

test('"모레 3:15"처럼 진짜 날짜 낱말은 보낸 시각으로 보지 않음', () => {
  const ev = one('모레 3:15 회의');
  assert.equal(ev.date, '2026-11-07');
  assert.equal(ev.start, '15:15');
});

// ---- 실제 PC 카톡 캡처 (③-2 다듬기) ----

test('끝에 붙은 자음·모음만 있는 낱말("ㄱㄱ", "ㅁㅁ")은 제목에서 뺌', () => {
  assert.equal(one('11/19 저녁 ㄱㄱ').title, '저녁');
  assert.equal(one('11/19 저녁ㄱㄱ').title, '저녁');
  assert.equal(one('11/19 회의 ㅇㅋ').title, '회의');
});

test('글자 없이 숫자·기호만 남은 제목은 "일정"으로', () => {
  assert.equal(one('11/19 207 ㅁㅁ').title, '일정');
});

test('카톡 입력창 "메시지 입력" 줄은 일정에 붙이지 않음', () => {
  const ev = one('11/19 저녁\n메시지 입력');
  assert.equal(ev.memo, '11/19 저녁');
  const ev2 = one('11/19 7시\n[메시지 입력');
  assert.equal(ev2.title, '일정');
  assert.equal(ev2.memo, '11/19 7시');
});

test('PC 카톡 캡처 OCR 결과 모양(위가 잘린 말풍선, 보낸 시각, 입력창) → 일정 하나만', () => {
  // 실제 캡처에서 나온 OCR 결과와 같은 모양으로 지어낸 문장
  const text = '오후 2:05  10719 1eM ㅁㅁ\n오후 207  11월 19일 저녁 ㄱㄱ\n메시지 입력';
  const evs = ex(text);
  assert.equal(evs.length, 1);
  assert.equal(evs[0].date, '2026-11-19');
  assert.equal(evs[0].allDay, true);
  assert.equal(evs[0].title, '저녁');
  assert.equal(evs[0].memo, '11월 19일 저녁 ㄱㄱ');
});

// ---- 일정이 없는 텍스트 ----

test('날짜·시간이 없으면 빈 배열', () => {
  assert.deepEqual(ex('안녕하세요 반갑습니다'), []);
  assert.deepEqual(ex(''), []);
});
