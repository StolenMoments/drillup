# 문제 목록 검색 기능 설계

날짜: 2026-07-15

## 목적

`/questions` 페이지에는 주제·유형·키워드·정렬 필터만 있고 텍스트 검색이 없다.
문제 본문, 선택지, 해설, 키워드 이름 중 원하는 범위를 골라 검색어로 문제를
찾을 수 있게 한다.

## 확정된 동작

- 검색 대상 필드는 본문/선택지/해설/키워드 4개 체크박스로 다중 선택한다.
  기본값은 본문만 체크된 상태다.
- 검색어 입력과 체크박스 변경은 즉시 반영되지 않는다. Enter 또는 검색
  버튼을 눌러야 실제 검색이 실행된다(폼 제출).
- 매칭은 대소문자 무시 부분일치(substring)다. 여러 단어를 AND로 쪼개지
  않고 입력한 문자열 전체를 하나의 부분 문자열로 매칭한다.
- 검색은 기존 topic/type/keyword 필터와 AND로 결합된다.
- 검색 실행 시 페이지는 1로 리셋된다.
- 검색 결과가 없으면 기존 "문제가 없습니다." empty-state를 그대로 쓴다.

## 필드별 매칭 대상

- 본문: MCQ는 `payload.question`, CLOZE는 `payload.text`
- 선택지: MCQ의 `payload.choices[].text`만 해당 (CLOZE는 대상 없음)
- 해설: `explanation` 컬럼
- 키워드: 문제에 연결된 `keyword.name` 목록

## API 계약

`GET /api/questions`에 파라미터 추가:

- `search?: string` — 검색어 (빈 문자열/미지정 시 검색 필터 미적용)
- `searchIn?: string` — `body,choices,explanation,keyword` 콤마 구분 목록.
  `search`가 있는데 `searchIn`이 비어 있으면 `body`로 취급.

응답 형식(`QuestionListPageDto`)은 변경 없음.

## 서버 구현

`listQuestions` (`src/server/question-service.ts`)는 이미 전체 목록을
가져온 뒤 JS에서 type 필터링·정렬·페이지네이션을 하는 in-memory 구조이므로
같은 패턴을 따른다.

- 쿼리에 `keywords: { include: { keyword: true } }`를 추가해 키워드 이름을
  가져온다(현재는 `reviewLogs`만 include).
- 문제별로 검색 대상 필드에서 텍스트를 뽑는 헬퍼를 추가한다. MCQ/CLOZE
  payload 구조가 다르므로 타입별로 분기해 본문·선택지 텍스트를 추출한다.
- `params.search`와 `params.searchIn`이 있으면, 선택된 필드에서 추출한
  텍스트들을 합쳐 부분일치 여부를 판정하는 필터를 type 필터와 같은 자리에
  추가한다.
- `QuestionListParams`, `QuestionListItemDto`는 검색 필드 자체를 응답에
  포함할 필요는 없다(기존 `preview`로 충분).

## API 라우트 / 클라이언트

- `src/app/api/questions/route.ts`: `search`, `searchIn` 쿼리 파라미터를
  파싱해 서비스로 전달.
- `src/lib/api-types.ts`의 `QuestionListParams`에 `search?: string`,
  `searchIn?: ("body" | "choices" | "explanation" | "keyword")[]` 추가.
- `src/lib/api-client.ts`의 `api.questions.list()`가 `searchIn` 배열을
  콤마 구분 문자열로 직렬화해 쿼리스트링에 담는다.

## 화면

`src/app/questions/page.tsx` 기존 필터 바(`surface surface-pad ...`)에
추가:

- 검색 입력창 + 검색 버튼을 `<form onSubmit>`으로 묶어 Enter/버튼 모두
  제출을 트리거하게 한다.
- 본문/선택지/해설/키워드 체크박스 4개(기본값: 본문만 체크).
- 검색어와 체크박스는 "입력 중" state로 관리하고, 제출 시에만
  "커밋된" state(`committedSearch`, `committedSearchIn`)를 갱신한다.
  `reload`의 `useEffect` 의존성 배열은 커밋된 값만 참조하므로, 입력 중에는
  재조회가 발생하지 않는다.
- 제출 시 기존 `resetPage()`를 호출해 페이지를 1로 되돌린다.

## 테스트

- 서비스 단위: 본문/선택지/해설/키워드 각 필드 매칭, 다중 필드 조합,
  대소문자 무시, type/topic/keyword 필터와의 AND 결합, 빈 검색어 무시.
- API 라우트: `search`/`searchIn` 파싱 및 서비스 호출 인자 검증.
- 화면: 검색어 입력만으로는 재조회가 없고 제출 시에만 재조회되는지,
  제출 시 페이지가 1로 리셋되는지, 결과 0건일 때 empty-state가 뜨는지.
- 개발 서버로 `/questions`에서 실제 검색 조작 후 결과 확인(수동 검증).
