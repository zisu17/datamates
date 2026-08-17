# ui/vendor

외부에서 받아 저장소에 넣어 둔 파일. **손으로 고치지 않는다** — 올릴 때는 원본을 다시 받는다.

화면은 별도 빌드 단계 없이 `index.html`의 `<script>`로 파일을 로드한다.

| 파일 | 출처 | 버전 | 라이선스 |
| --- | --- | --- | --- |
| `superset-embedded-sdk.js` | npm `@superset-ui/embedded-sdk` → `bundle/index.js` | 0.4.0 | Apache-2.0 |

## superset-embedded-sdk.js

UMD 번들(7.3KB). 전역 `supersetEmbeddedSdk.embedDashboard` 를 노출한다.
의존성(`@superset-ui/switchboard`, `jwt-decode`)은 번들 안에 포함돼 있어 추가 파일이 없다.

Superset의 임베드 화면은 부모 창과 postMessage 핸드셰이크로 게스트 토큰을 받습니다.
이 SDK가 `/embedded/<uuid>` 화면의 인증과 통신을 처리합니다.

**갱신 방법**

```bash
npm pack @superset-ui/embedded-sdk          # 원하는 버전을 받는다
tar xzf superset-ui-embedded-sdk-*.tgz
cp package/bundle/index.js ui/vendor/superset-embedded-sdk.js
```

Superset 을 올릴 때 이 SDK 도 같이 볼 것 — 핸드셰이크 프로토콜이 바뀌면
화면 B 가 조용히 빈 화면이 된다.
