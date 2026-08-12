# Superset + DuckDB — 분석 화면의 질의 엔진.
#
# 새 질의 엔진(Trino 등)을 넣지 않는다. Superset 이 SQLAlchemy 드라이버로만 붙는다는
# 제약을 duckdb-engine 으로 만족시키고, DuckDB 가 Iceberg REST 카탈로그를 직접 ATTACH 한다.
# ATTACH 는 세션마다 사라지므로 접속 시점에 다시 실행해야 한다 — superset_config.py 참고.
FROM apache/superset:5.0.0

USER root

COPY requirements-local.txt /tmp/requirements-local.txt

# `pip install` 을 그냥 쓰면 안 된다.
#
# 이 이미지는 uv 로 만든 venv(/app/.venv)에서 돌지만, PATH 상의 pip 은
# **시스템 pip**(/usr/local/bin/pip)이다. python 만 venv 를 가리킨다:
#
#     which python  →  /app/.venv/bin/python
#     which pip     →  /usr/local/bin/pip
#
# 그래서 `pip install duckdb` 는 성공했다고 나오지만 venv 밖에 떨어지고,
# Superset 은 그 패키지를 못 본다. 증상이 «설치했는데 ModuleNotFoundError» 라서
# 원인을 찾기 어렵다. venv 를 명시해 uv 로 넣는다.
RUN uv pip install --python /app/.venv/bin/python --no-cache \
        -r /tmp/requirements-local.txt \
 && /app/.venv/bin/python -c "import duckdb, duckdb_engine, psycopg2; \
        print('설치 확인 — duckdb', duckdb.__version__)"

# 이미지 기본 사용자로 되돌린다. root 로 돌리면 Superset 이 홈 디렉터리를 잘못 잡는다.
USER superset
