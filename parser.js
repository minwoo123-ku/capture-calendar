/*
 * parser.js — 캡처 OCR 텍스트에서 일정 후보를 뽑는 순수 함수 모음.
 * 시간대는 Asia/Seoul 고정. 날짜는 연·월·일 숫자(내부적으로는 1970-01-01부터의 "일 번호")로만 계산한다.
 * 브라우저: <script src="parser.js"> → window.CaptureParser
 * node:     require('./parser.js')
 * 해석 규칙의 근거는 plan.md 3장을 본다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CaptureParser = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WEEKDAYS = '일월화수목금토'; // getUTCDay() 순서 (0 = 일요일)
  const PAST_LIMIT_DAYS = 60; // 연도 없는 날짜: 기준일보다 이만큼 넘게 지났으면 다음 해로 본다
  const DEFAULT_MINUTES = 60; // 끝 시간이 없을 때 일정 길이
  const DEADLINE_MINUTES = 30; // 시간 있는 마감 일정 길이
  const LAST_MINUTE = 23 * 60 + 59;
  const TITLE_MAX = 30;

  // ---------------------------------------------------------------- 날짜 계산

  const dayNum = (y, m, d) => Math.round(Date.UTC(y, m - 1, d) / 86400000);
  const fromDayNum = (n) => {
    const t = new Date(n * 86400000);
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
  };
  const weekdayOf = (n) => new Date(n * 86400000).getUTCDay();
  const pad = (n) => String(n).padStart(2, '0');
  const fmtDay = (n) => {
    const t = fromDayNum(n);
    return `${t.y}-${pad(t.m)}-${pad(t.d)}`;
  };
  const fmtTime = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

  function isValid(y, m, d) {
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    const t = fromDayNum(dayNum(y, m, d));
    return t.m === m && t.d === d;
  }

  function parseDay(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    if (!m || !isValid(+m[1], +m[2], +m[3])) throw new Error(`기준 날짜는 YYYY-MM-DD 형식이어야 해요: ${s}`);
    return dayNum(+m[1], +m[2], +m[3]);
  }

  /** Asia/Seoul 기준 오늘 'YYYY-MM-DD' */
  function todaySeoul(now) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now || new Date());
  }

  // 연도 없는 월/일: 작년·올해·내년 중 "기준일 - 60일" 이후로 가장 이른 날
  function monthDay(m, d, base) {
    const y = fromDayNum(base).y;
    for (const yy of [y - 1, y, y + 1]) {
      if (isValid(yy, m, d) && dayNum(yy, m, d) >= base - PAST_LIMIT_DAYS) return dayNum(yy, m, d);
    }
    return null;
  }
  const exact = (y, m, d) => (isValid(y, m, d) ? dayNum(y, m, d) : null);

  // ---------------------------------------------------------------- 전처리

  // OCR이 글자 사이에 넣은 공백을 없앨 낱말
  const JOIN_WORDS = ['오전', '오후', '오늘', '내일', '모레', '글피', '이번주', '다다음주', '다음주', '까지', '부터', '장소'];
  const JOIN_RES = JOIN_WORDS.map((w) => [new RegExp(w.split('').join(' *'), 'g'), w]);
  const STAMP_SRC = '(?:\\d{1,3} ?)?(?:오전|오후) ?\\d{1,2}:\\d{2}';
  const STAMP_TAIL_RE = new RegExp(`[ \\t\\u00a0\\u3000]{2,}(${STAMP_SRC})[ \\t]*$`, 'gm');
  const STAMP_HEAD_RE = new RegExp(`^[ \\t]*(${STAMP_SRC})[ \\t\\u00a0\\u3000]{2,}`, 'gm');
  // 작은 글씨에서 OCR이 잘못 읽은 보낸 시각: "모후 312", "os 316", "오후 312"(콜론 빠짐).
  // 사람이 이렇게 쓰지는 않으므로 공백 1칸으로 붙어 있어도 떼어 낸다
  const FUZZY_PERIOD = '(?:[모으0O][후흐]|오[흐훈휴]|[오모]천|[0O][sS5]|[oO][sS5n])';
  const FUZZY_SRC = `(?:\\d{1,3} ?)?(?:${FUZZY_PERIOD} ?\\d{1,2}[:;.]?\\d{2}|(?:오전|오후) ?\\d{3,4})`;
  const FUZZY_TAIL_RE = new RegExp(`[ \\t\\u00a0\\u3000]+(${FUZZY_SRC})[ \\t]*$`, 'gm');
  const FUZZY_HEAD_RE = new RegExp(`^[ \\t]*(${FUZZY_SRC})[ \\t\\u00a0\\u3000]+`, 'gm');

  function normalizeText(text) {
    let s = String(text == null ? '' : text);
    s = s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/：/g, ':').replace(/／/g, '/').replace(/（/g, '(').replace(/）/g, ')')
      .replace(/[～∼〜]/g, '~').replace(/[－–—]/g, '-')
      .replace(/\r\n?/g, '\n')
      // 같은 줄에 붙어 나온 카톡 보낸 시각(공백 2칸 이상으로 떨어짐)은 따로 한 줄로 뗀다
      .replace(STAMP_TAIL_RE, '\n$1')
      .replace(STAMP_HEAD_RE, '$1\n')
      .replace(FUZZY_TAIL_RE, '\n$1')
      .replace(FUZZY_HEAD_RE, '$1\n')
      .replace(/[ \t 　]+/g, ' ');
    for (const [re, w] of JOIN_RES) s = s.replace(re, w);
    s = s
      .replace(/(^|[^\d/.:])(\d) +(\d) *(?=[년월일시분])/gm, '$1$2$3') // "1 1 월" → "11월"
      .replace(/(\d) +(?=[년월일시분])/g, '$1') //                     "6 일" → "6일"
      .replace(/(\d) *([:/]) *(\d)/g, '$1$2$3') //                       "3 : 30" → "3:30"
      .replace(/([월화수목금토일]) +요일/g, '$1요일');
    return s.split('\n').map((l) => l.trim()).join('\n');
  }

  // ---------------------------------------------------------------- 줄 판별

  // 카톡 날짜 구분선: "2026년 11월 5일 목요일" (OCR이 테두리를 "| ." 같은 기호로 읽은 것 허용)
  const DIVIDER_RE = /^[^\d가-힣]{0,6}(\d{4})년 ?(\d{1,2})월 ?(\d{1,2})일 ?([월화수목금토일])요일[^\d가-힣]{0,6}$/;
  // 카톡 보낸 시각("1 오후 3:12")이나 상태바 시계("9:41")만 있는 줄
  const STAMP_RE = /^(?:\d{1,3} ?)?(?:오전|오후)? ?\d{1,2}:\d{2}$/;
  const FUZZY_STAMP_RE = new RegExp(`^${FUZZY_SRC}$`);
  const isStamp = (line) => STAMP_RE.test(line) || FUZZY_STAMP_RE.test(line);

  function readDivider(line) {
    const m = DIVIDER_RE.exec(line);
    return m ? exact(+m[1], +m[2], +m[3]) : null;
  }

  // ---------------------------------------------------------------- 날짜 찾기

  const WD = '(?: ?\\( ?([월화수목금토일])(?:요일)? ?\\)| ?([월화수목금토일])요일)?';
  const WEEK_OFFSET = { 이번주: 0, 다음주: 7, 담주: 7, 차주: 7, 다다음주: 14 };
  const REL_OFFSET = { 오늘: 0, 내일: 1, 모레: 2, 글피: 3 };

  // 우선순위 순서. wd = 요일 캡처 그룹 번호(두 개 연속)
  const DATE_RULES = [
    { re: new RegExp('(\\d{4})년 ?(\\d{1,2})월 ?(\\d{1,2})일' + WD), wd: 4, get: (m) => exact(+m[1], +m[2], +m[3]) },
    { re: new RegExp('(?<!\\d)(\\d{4})[./-](\\d{1,2})[./-](\\d{1,2})(?!\\d)' + WD), wd: 4, get: (m) => exact(+m[1], +m[2], +m[3]) },
    { re: new RegExp('(?<!\\d)(\\d{1,2})월 ?(\\d{1,2})일' + WD), wd: 3, get: (m, b) => monthDay(+m[1], +m[2], b) },
    { re: new RegExp('(?<![\\d/.:])(\\d{1,2})/(\\d{1,2})(?![\\d/])' + WD), wd: 3, get: (m, b) => monthDay(+m[1], +m[2], b) },
    {
      re: /(이번주|다다음주|다음주|담주|차주) ?([월화수목금토일])요일/,
      get: (m, b) => {
        const monday = b - ((weekdayOf(b) + 6) % 7); // 한 주는 월요일부터
        return monday + ((WEEKDAYS.indexOf(m[2]) + 6) % 7) + WEEK_OFFSET[m[1]];
      },
    },
    { re: /(오늘|내일|모레|글피)/, get: (m, b) => b + REL_OFFSET[m[1]] },
    { re: /([월화수목금토일])요일/, get: (m, b) => b + ((WEEKDAYS.indexOf(m[1]) - weekdayOf(b) + 7) % 7) },
  ];

  function findDate(line, base) {
    for (const rule of DATE_RULES) {
      const m = rule.re.exec(line);
      if (!m) continue;
      const day = rule.get(m, base);
      if (day == null) continue;
      const warnings = [];
      const wd = rule.wd ? m[rule.wd] || m[rule.wd + 1] : null;
      if (wd && WEEKDAYS[weekdayOf(day)] !== wd) {
        warnings.push(`요일이 안 맞아요: ${fmtDay(day)}은 ${WEEKDAYS[weekdayOf(day)]}요일인데 캡처에는 ${wd}요일`);
      }
      return { day, index: m.index, length: m[0].length, warnings };
    }
    return null;
  }

  // ---------------------------------------------------------------- 시간 찾기

  // 그룹(6개): 1 때, 2 H(콜론), 3 MM, 4 H(시), 5 분, 6 반
  const TIME_SRC =
    '(?:(오전|오후|아침|낮|점심|저녁|밤|새벽) ?)?' +
    '(?:(?<![\\d:])(\\d{1,2}):(\\d{2})(?!\\d)|(?<![\\d:])(\\d{1,2}) ?시(?!간)(?: ?(\\d{1,2}) ?분| ?(반))?)';
  const TIME_RE = new RegExp(TIME_SRC);
  const RANGE_RE = new RegExp(TIME_SRC + ' ?(?:~|-|부터) ?' + TIME_SRC);

  function to24(h, period, leadingZero) {
    if (h > 23) return null;
    switch (period) {
      case '오후': case '저녁': case '밤': return h < 12 ? h + 12 : h;
      case '오전': case '아침': case '새벽': return h === 12 ? 0 : h;
      case '낮': case '점심': return h >= 1 && h <= 6 ? h + 12 : h;
      default:
        if (leadingZero || h === 0 || h >= 12) return h; // 24시간 표기로 본다
        return h <= 6 ? h + 12 : h; // 1~6시는 오후, 7~11시는 오전
    }
  }

  function readTime(m, o, inheritPeriod) {
    const raw = m[o + 1] != null ? m[o + 1] : m[o + 3];
    const min = m[o + 2] != null ? +m[o + 2] : m[o + 4] != null ? +m[o + 4] : m[o + 5] ? 30 : 0;
    const h = to24(+raw, m[o] || inheritPeriod || null, raw.length === 2 && raw[0] === '0');
    if (h == null || min > 59) return null;
    return h * 60 + min;
  }

  function findTime(s) {
    let m = RANGE_RE.exec(s);
    if (m) {
      const start = readTime(m, 1);
      let end = readTime(m, 7, m[1]);
      if (start != null && end != null) {
        if (end <= start && !m[7] && end + 720 < 1440) end += 720; // "11시~1시" → 13시
        return { start, end: end > start ? end : null, index: m.index, length: m[0].length };
      }
    }
    m = TIME_RE.exec(s);
    if (m) {
      const start = readTime(m, 1);
      if (start != null) return { start, end: null, index: m.index, length: m[0].length };
    }
    return null;
  }

  // ---------------------------------------------------------------- 장소·제목

  const LOC_STOP = ['어디', '거기', '여기', '저기', '그곳', '이곳'];

  function findLocation(s) {
    let m = /장소(?:는)? ?:? ?(\S.*)$/.exec(s);
    if (m) return { value: m[1].replace(/[,.!?]+$/, '').trim(), index: m.index, length: m[0].length };
    m = /(^| )@ ?([^ ,]+)/.exec(s);
    if (m) return { value: m[2], index: m.index, length: m[0].length };
    const re = /([가-힣A-Za-z0-9]+)에서(?=$|[ ,.!?])/g;
    while ((m = re.exec(s))) {
      if (!LOC_STOP.includes(m[1])) return { value: m[1], index: m.index, length: m[0].length };
    }
    return null;
  }

  const cut = (s, index, length) => s.slice(0, index) + ' ' + s.slice(index + length);

  function cleanTitle(s) {
    s = (' ' + s.replace(/까지/g, ' ') + ' ')
      .replace(/ (?:에는|에|부터|쯤|경)(?= )/g, ' ') // 날짜·시간을 뺀 자리에 남은 조사
      .replace(/ +/g, ' ');
    let prev;
    do {
      prev = s;
      s = s.trim().replace(/^[,.:;~\-·!?)\]]+/, '').replace(/[,.:;~\-·(\[]+$/, '');
    } while (s !== prev);
    return s.slice(0, TITLE_MAX).trim();
  }

  // 대화체 제목을 일정 이름으로 다듬는다 (원래 문장은 메모에 그대로 남는다)
  const LEAD_FILLER_RE = /^(?:그리고|혹시|근데|그럼|그러면|아|네|저기|참|그래서) +/;
  const TAIL_NOISE_RE = /(?: *(?:[ㅎㅋㅠㅜ]+|[!?~.^]+|\p{Extended_Pictographic}+))+$/u;
  // 말풍선 꼬리·보낸 시각을 OCR이 읽은 찌꺼기: 숫자·기호로 시작하는 4자 이하 낱말, 또는 영문 1~2자
  const TAIL_JUNK_RE = /(?: +(?:[^가-힣A-Za-z\s][^가-힣\s]{0,3}|[A-Za-z]{1,2}[^가-힣A-Za-z\s]{0,2}))+$/;
  const ENDING_RES = [
    / *(?:가능하세요|가능하신가요|가능하실까요|가능할까요|가능해요|괜찮으세요|괜찮으신가요|괜찮을까요|괜찮아요|어떠세요|어떠신가요|어떨까요|어때요|어때)$/,
    / *(?:있어요|있습니다|있어|있음|있대요)$/,
    / *(?:할까요|할래요|할래|하실래요|하시죠|합시다|해야 해요|해야 돼요|해야 함|해요|하자|합니다)$/,
    / +(?:가요|갈게요|갈래요|갑니다|가자)$/,
    /(?<=[가-힣])(?:이에요|예요|입니다|이요)$/,
  ];
  // "~해 주세요"는 앞 낱말만, 자주 쓰는 동사는 "~기"로
  const ASK_RE = /(\S+?) ?(?:주세요|줘요|줘|주실래요|주시겠어요|주시면 돼요|주시면 됩니다)$/;
  const ASK_VERBS = {
    보내: '보내기', 가져와: '가져오기', 챙겨: '챙기기', 알려: '알리기', 써: '쓰기',
    읽어: '읽기', 봐: '보기', 들러: '들르기', 넣어: '넣기', 내: '내기', 와: '오기',
  };

  function polishTitle(title) {
    let s = title;
    for (let i = 0; i < 3; i++) {
      const before = s;
      s = s.replace(LEAD_FILLER_RE, '').replace(TAIL_JUNK_RE, '').replace(TAIL_NOISE_RE, '');
      const ask = ASK_RE.exec(s);
      if (ask) {
        const word = ask[1];
        if (word.endsWith('해')) s = s.slice(0, ask.index) + word.slice(0, -1);
        else if (ASK_VERBS[word]) s = s.slice(0, ask.index) + ASK_VERBS[word];
      }
      for (const re of ENDING_RES) s = s.replace(re, '');
      s = s.trim();
      if (s === before) break;
    }
    return s || title;
  }

  // 여러 날 일정의 끝 날짜: 날짜 바로 뒤의 "~11/8", "-12/2", "부터 8일까지"
  const SPAN_RE = /^ ?(?:~|-|부터) ?(?:(\d{1,2}) ?(?:\/|월 ?))?(\d{1,2})(?! ?[:시\d])일?(?: ?\( ?[월화수목금토일](?:요일)? ?\)| ?[월화수목금토일]요일)?(?: ?까지)?/;
  const SPAN_MAX_DAYS = 31;

  function findSpanEnd(tail, start) {
    const m = SPAN_RE.exec(tail);
    if (!m) return null;
    let end;
    if (m[1]) end = monthDay(+m[1], +m[2], start);
    else {
      const s = fromDayNum(start);
      end = exact(s.y, s.m, +m[2]);
      if (end == null || end <= start) end = exact(s.m === 12 ? s.y + 1 : s.y, s.m === 12 ? 1 : s.m + 1, +m[2]);
    }
    if (end == null || end <= start || end - start > SPAN_MAX_DAYS) return null;
    return { day: end, length: m[0].length };
  }

  function applyTime(ev, time, deadline) {
    ev.allDay = false;
    ev.start = fmtTime(time.start);
    if (deadline) {
      ev.end = fmtTime(Math.min(time.start + DEADLINE_MINUTES, LAST_MINUTE));
      if (!ev.title.startsWith('[마감]')) ev.title = '[마감] ' + ev.title;
      ev.isDeadline = true;
    } else {
      ev.end = fmtTime(time.end != null ? time.end : Math.min(time.start + DEFAULT_MINUTES, LAST_MINUTE));
    }
  }

  // ---------------------------------------------------------------- 공개 함수

  /** 캡처 속 첫 번째 카톡 날짜 구분선의 날짜. 없으면 null */
  function detectBaseDate(text) {
    for (const line of normalizeText(text).split('\n')) {
      const day = readDivider(line);
      if (day != null) return fmtDay(day);
    }
    return null;
  }

  /**
   * OCR 텍스트 → 일정 후보 배열
   * @param {string} text OCR 결과
   * @param {string} [baseDate] 'YYYY-MM-DD'. 구분선이 없는 줄의 기준일. 생략하면 서울 기준 오늘
   * @returns {{title,date,endDate,start,end,allDay,location,memo,isDeadline,warnings}[]}
   */
  function extractEvents(text, baseDate) {
    let lineBase = parseDay(baseDate || todaySeoul());
    const events = [];
    let lastDay = null; // 위쪽에서 마지막으로 찾은 날짜
    let last = null; // 마지막 후보
    let gap = 0; // 마지막 후보 이후 지나간 내용 줄 수
    let open = false; // 마지막 후보의 말풍선이 아직 이어지는지 (카톡 보낸 시각이 나오면 끊김)
    let lastCore = ''; // 마지막 후보의 제목([마감] 제외)
    let contCount = 0; // 이어 붙인 줄 수

    for (const line of normalizeText(text).split('\n')) {
      if (!line) continue;
      const dividerDay = readDivider(line);
      if (dividerDay != null) {
        lineBase = dividerDay;
        lastDay = null;
        last = null;
        continue;
      }
      if (isStamp(line)) {
        open = false;
        continue;
      }
      gap++;

      const date = findDate(line, lineBase);
      let rest = line;
      let span = null;
      if (date) {
        span = findSpanEnd(line.slice(date.index + date.length), date.day);
        rest = cut(line, date.index, date.length + (span ? span.length : 0));
      }
      const time = findTime(rest);
      if (!date && !time) {
        // 두 줄 이상으로 나뉜 말풍선: 메모에 붙이고, 제목이 비었거나 아주 짧으면 제목·장소를 채운다
        if (last && open && gap === 1 && contCount < 3) {
          last.memo += '\n' + line;
          let more = line;
          const moreLoc = last.location ? null : findLocation(more);
          if (moreLoc) {
            last.location = moreLoc.value;
            more = cut(more, moreLoc.index, moreLoc.length);
          }
          if (lastCore.length < 4) {
            lastCore = cleanTitle(lastCore + ' ' + more);
            last.title = (last.isDeadline ? '[마감] ' : '') + (polishTitle(lastCore) || '일정');
          }
          contCount++;
          gap = 0;
        }
        continue;
      }
      if (time) rest = cut(rest, time.index, time.length);
      const deadline = /까지/.test(line) && !(time && time.end != null) && !span;
      const loc = findLocation(rest);
      if (loc) rest = cut(rest, loc.index, loc.length);

      // 날짜 없이 시간만 있는 줄 → 바로 위 줄의 종일 후보에 시간을 채운다
      if (!date && last && last.allDay && gap === 1) {
        applyTime(last, time, deadline);
        if (!last.location && loc) last.location = loc.value;
        last.memo += '\n' + line;
        gap = 0;
        continue;
      }

      let day;
      const warnings = date ? date.warnings.slice() : [];
      if (date) day = date.day;
      else if (lastDay != null) {
        day = lastDay;
        warnings.push('날짜가 없어 위쪽 일정의 날짜를 넣었어요');
      } else {
        day = lineBase;
        warnings.push('날짜가 없어 기준일로 넣었어요');
      }
      if (day < lineBase) warnings.push('이미 지난 날짜예요');

      const core = cleanTitle(rest);
      const ev = {
        title: (deadline ? '[마감] ' : '') + (polishTitle(core) || '일정'),
        date: fmtDay(day),
        endDate: span ? fmtDay(span.day) : null, // 여러 날 일정의 마지막 날 (그날 포함)
        start: null,
        end: null,
        allDay: true,
        location: loc ? loc.value : '',
        memo: line,
        isDeadline: deadline,
        warnings,
      };
      if (time) applyTime(ev, time, deadline);
      events.push(ev);
      last = ev;
      lastDay = day;
      lastCore = core;
      open = true;
      contCount = 0;
      gap = 0;
    }

    // 날짜와 시작 시간이 같은 후보(종일이면 제목까지 같은 후보)는 하나로
    const seen = new Map();
    const out = [];
    for (const ev of events) {
      const key = `${ev.date}|${ev.allDay ? 'A|' + ev.title : ev.start}`;
      const kept = seen.get(key);
      if (kept) {
        kept.memo += '\n' + ev.memo;
        if (!kept.location) kept.location = ev.location;
      } else {
        seen.set(key, ev);
        out.push(ev);
      }
    }
    return out;
  }

  return { normalizeText, detectBaseDate, extractEvents, todaySeoul };
});
