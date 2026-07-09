# CD: GitHub Actions로 OCI Ampere 인스턴스에 배포

## 배경

프로덕션은 OCI Ampere 인스턴스(`ampere-01`, VM.Standard.A1.Flex, ap-seoul-1,
퍼블릭 IP `146.56.170.98`, 호스트네임 `ampere-mariadb-01`)에서 운영한다.
지금까지는 배포 자동화가 없었고, 이번이 첫 배포다. MariaDB는 이미 이 서버에
설치·실행 중이며 접속 정보만 `.env`에 넣으면 된다.

인스턴스가 ARM(A1.Flex)인 반면 GitHub Actions 러너는 x86_64이므로, CI에서
빌드한 산출물(특히 `sharp` 같은 네이티브 모듈)을 그대로 옮기면 아키텍처
불일치로 깨진다. 따라서 **소스만 서버로 옮기고 빌드는 서버(ARM)에서
수행**한다.

## 배포 흐름

1. `master`에 push → 워크플로우 트리거
2. `test` job: `npm ci` → `npm run lint` → `npm test`. 실패 시 배포 중단.
3. `deploy` job (`test` 성공 시에만 실행):
   - SSH agent에 `SSH_PRIVATE_KEY` 로드
   - `rsync -avz --delete`로 소스를 서버의 앱 디렉터리(`DEPLOY_PATH`)에 전송.
     `.git/`, `node_modules/`, `.next/`, `.env`, `generation_output/`,
     `generation_reference/`, `tsconfig.tsbuildinfo`는 제외 대상이며,
     `--delete`가 걸려 있어도 제외된 항목은 서버 쪽에 그대로 남는다
     (서버의 `.env`는 절대 덮어쓰거나 삭제되지 않음).
   - SSH로 서버에 접속해 `scripts/deploy-remote.sh` 실행

4. `scripts/deploy-remote.sh` (서버에서 실행, 이번에 새로 작성):
   - `cd "$DEPLOY_PATH"`
   - `npm ci`
   - `npx prisma migrate deploy` (운영 DB에 마이그레이션 적용)
   - `npm run build`
   - systemd user 유닛(`~/.config/systemd/user/drillup.service`)이 없으면
     레포의 `deploy/drillup.service`를 복사하고 `systemctl --user daemon-reload`
   - `systemctl --user restart drillup` (최초 실행 시 `enable --now`)

## 구성 요소

### `.github/workflows/deploy.yml`
- 트리거: `push` to `master`
- `test` → `deploy` 순서 (needs)
- `deploy`는 `environment: production` 없이 단순 job으로 시작 (개인 프로젝트 규모)
- 사용 시크릿: `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`, `DEPLOY_PATH`
  (필수, 서버 상 앱 디렉터리 절대경로, 홈 디렉터리 하위여야 함),
  `SSH_PORT`(선택, 없으면 22)

### `scripts/deploy-remote.sh`
- 서버에서 실행되는 배포 스크립트. 레포에 커밋되어 rsync로 서버에도 전달됨.
- 멱등성: 유닛 파일이 이미 있으면 재설치하지 않고, 없을 때만 설치

### `deploy/drillup.service`
- systemd **user** 유닛 (root/sudo 불필요)
- `ExecStart=/usr/bin/npm start`, `WorkingDirectory=%h/<앱 디렉터리>`,
  `Environment=PORT=3000`, `Restart=on-failure`
- `%h`(홈 디렉터리) 기준 상대 경로 사용 → `DEPLOY_PATH`가 홈 하위에 있어야 함

## 서버 측 1회성 사전 준비 (사용자가 직접, 워크플로우가 대신할 수 없음)

- Node 22+ 설치 확인
- `DEPLOY_PATH`에 프로덕션용 `.env` 파일 직접 생성
  (`DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME`,
  `APP_PASSWORD`, `SESSION_SECRET`, `NODE_ENV=production`, `PORT=3000`)
- `loginctl enable-linger <user>` 1회 실행 (재부팅 후에도 user 서비스가
  살아있게 하려면 필요 — sudo 필요, 워크플로우에서 자동화 불가)
- GitHub repo secrets 등록: `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`,
  (선택) `SSH_PORT`, `DEPLOY_PATH`

## 범위 밖

- nginx/HTTPS 리버스 프록시, 도메인, 인증서 설정 — 이번 워크플로우는 앱이
  `localhost:3000`에서 뜨는 것까지만 다룬다. README에 명시된 "HTTPS 리버스
  프록시 뒤에서 운영" 요건은 별도 작업으로 다룬다.
- 롤백 자동화 — 실패 시 자동 되돌리기는 없음. 문제 발생 시 이전 커밋으로
  다시 push하거나 서버에서 수동 대응.
- 무중단 배포(블루/그린 등) — 개인 프로젝트 규모이므로 단순 재시작으로 충분.

## 테스트

- 워크플로우 자체는 실제 서버에 SSH 접속이 필요해 로컬에서 완전히 재현할
  수 없다. `test` job은 기존 `npm test`/`npm run lint`를 그대로 사용하므로
  별도 테스트 코드는 불필요.
- 구현 후 실제로 `master`에 push하여 워크플로우가 끝까지 성공하고, 서버에서
  `systemctl --user status drillup`이 `active (running)`인지, `curl
  localhost:3000`이 응답하는지 확인하는 것으로 검증한다.
