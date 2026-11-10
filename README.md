# Miracle GYM

개인용 식단·운동 기록 웹앱 (아이폰·맥북 홈 화면 앱으로 사용).

- 호스팅: GitHub Pages
- 데이터: Supabase (로그인한 본인만 읽고 쓰기, Row Level Security)
- 아이폰 건강 데이터: 단축어 → `rpc/ingest_health` 로 자동 수신
- 운동 이미지: [free-exercise-db](https://github.com/yuhonas/free-exercise-db) (Public Domain)
- 음식 영양값: 일반적인 1인분 기준 근사치

`config.js`의 키는 브라우저 공개용(publishable) 키입니다. 데이터베이스 스키마는 `supabase/schema.sql`에 있습니다.
