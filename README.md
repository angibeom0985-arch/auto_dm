# DOT 인스타 DM 자동화

Instagram 공식 API 기반 자동 DM 서비스를 만들기 위한 웹 콘솔 MVP입니다.

## 실행

```bash
npm install
npm run dev
```

## 현재 포함된 화면

- 자동화 운영 대시보드
- 댓글 키워드 기반 DM 플로우 빌더
- 실시간 이벤트 로그 목업
- 런칭 준비 체크 상태
- 반응형 관리자 UI

## 다음 구현 방향

- Meta OAuth 연결
- Instagram Webhook 수신 API
- Private Reply / Send API 발송 모듈
- PostgreSQL 데이터 모델
- 발송 큐와 rate limit
- 결제, 플랜, 사용량 제한

## Meta 운영 준비 상태

서버의 `GET /api/meta/readiness`는 Meta App ID, 앱 시크릿, Webhook 검증 토큰, HTTPS Webhook URL, OAuth 리디렉션 URL, Live 모드 설정을 비밀값 없이 점검합니다.

이 엔드포인트는 환경 변수의 설정 형식만 확인합니다. 실제 App Review 승인, Business Verification, Webhook Dashboard 검증 및 테스트 계정 연결은 Meta App Dashboard에서 별도로 완료해야 합니다.

## 공식 Meta OAuth 연결

관리자 콘솔의 **Instagram Professional 계정 연결** 버튼은 인증된 사용자에 대해 `GET /api/meta/oauth/start`를 호출한 뒤 Instagram Business Login 창을 엽니다. 콜백은 인가 코드를 서버에서 장기 토큰으로 교환하고, 토큰은 AES-256-GCM 암호문으로만 보관합니다.

Webhook은 원문 본문과 `X-Hub-Signature-256`을 HMAC-SHA256 및 timing-safe 비교로 검증합니다. 서명 누락·불일치와 앱 시크릿 미설정 요청은 허용하지 않습니다.

운영 배포 전에는 `META_APP_ID`, `META_APP_SECRET`, `META_TOKEN_ENCRYPTION_KEY`, `META_OAUTH_REDIRECT_URL`, `META_WEBHOOK_URL`, `FRONTEND_ORIGIN`을 설정해야 합니다. `META_ALLOW_MANUAL_TOKEN_IMPORT`는 기본값 `false`를 유지하세요.
