"""분석(Superset) 연동.

  client.py — Superset REST 클라이언트. 서비스 계정 세션 하나를 계속 쓴다.
  proxy.py  — /superset/* 리버스 프록시. 사용자에게 Superset 주소를 노출하지 않는다.

원칙은 「Superset 은 엔진이고 제품은 Data Mates 하나」다. 그래서 목록·진입·
용어는 플랫폼이 만들고, Superset 이 그리는 영역은 iframe 안쪽으로 한정한다.
"""
