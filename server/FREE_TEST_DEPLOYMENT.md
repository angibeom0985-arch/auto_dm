# Vercel + Supabase 무료 테스트 배포

이 백엔드는 Vercel Hobby와 Supabase Free에서 Meta OAuth, Webhook, 테스트 자동응답을 검증하도록 구성됐다. 서버리스 환경에서는 상시 워커를 유지할 수 없으므로 저장된 대기열은 보호된 테스트 API로 수동 처리한다.

| 환경 변수 | 용도 |
|---|---|
| DATABASE_URL | Supabase Shared Pooler transaction mode URL(포트 6543). `pgbouncer=true&connection_limit=1&connect_timeout=30`을 추가한다. |
| DIRECT_URL | Prisma schema push/migration용 direct 또는 session-pooler URL이다. |
| SERVERLESS_TEST_MODE | Vercel 테스트 환경에서는 `true`로 설정한다. |
| TEST_TRIGGER_SECRET | `POST /api/internal/process-queue` 호출의 `x-test-trigger` 헤더와 일치해야 한다. |

## 테스트 순서

Meta Webhook이 이벤트를 Supabase 대기열에 저장한 뒤, `x-test-trigger` 헤더를 포함해 `POST /api/internal/process-queue`를 호출하면 최대 25개 대기 항목을 처리한다. 이 경로는 테스트 모드와 비밀 헤더가 모두 일치할 때만 동작한다.

운영 환경에서는 지속 실행 워커와 영속 큐가 필요하며, 수동 실행 경로에 의존해서는 안 된다.
