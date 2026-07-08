# drillup

개인용 문제은행 PWA. LLM으로 생성한 문제(객관식/빈칸)를 주제별로 저장하고,
SRS(간격 반복)로 반복 학습한다.

설계서: `docs/superpowers/specs/2026-07-07-drillup-design.md`

## 개발 환경 실행

필요: Node 22+, 접속 가능한 MariaDB 서버(로컬/원격/도커 무관)

    # 1. 의존성
    npm install

    # 2. 환경변수 - .env.example을 복사한 뒤 자신의 MariaDB 접속 정보를 직접 입력
    #    DB_HOST(IP) / DB_PORT / DB_USER(ID) / DB_PASSWORD(PW) / DB_NAME
    #    + APP_PASSWORD / SESSION_SECRET
    #    (DATABASE_URL은 채울 필요 없다 - DB_* 값으로 자동 구성된다)
    copy .env.example .env

    # (선택) 쓸 MariaDB가 없으면 로컬 도커 DB 기동 후 그 계정을 .env에 입력
    docker compose up -d

    # 3. 마이그레이션
    npx prisma migrate dev

    # 4. 개발 서버
    npm run dev

http://localhost:3000 접속 후 APP_PASSWORD로 로그인.

## 테스트

    npm test

## 프로덕션 빌드 (오라클 클라우드 인스턴스)

    npm run build
    npx prisma migrate deploy   # 운영 DB에 마이그레이션 적용
    npm start                   # PORT=3000

환경변수는 서버의 `.env`에 설정한다. `SESSION_SECRET`은 충분히 긴 랜덤 문자열,
`APP_PASSWORD`는 실제 사용할 비밀번호로 설정한다. HTTPS 리버스 프록시 뒤에서
운영할 것. 세션 쿠키는 production에서 Secure 속성을 갖는다.

## 사용 흐름

1. **가져오기**: 주제 생성 -> "프롬프트 복사" -> LLM 채팅에 붙여넣고 지시 추가
   -> 출력된 JSON을 붙여넣기 -> 검증/미리보기 -> 저장
2. **학습**: 대시보드에서 "복습 시작"(SRS) 또는 "연습"(스케줄 무관 랜덤)
3. **통계**: 주제별 진척도(미학습/학습 중/암기 완료), 문제별 정답률
