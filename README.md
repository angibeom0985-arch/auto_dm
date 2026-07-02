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
